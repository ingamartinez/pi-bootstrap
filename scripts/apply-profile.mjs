// Deriva la configuración de runtime desde un perfil.
//
//   node scripts/apply-profile.mjs <perfil> [--dry-run]
//   node scripts/apply-profile.mjs --check <perfil>     # sólo compara, exit 1 si hay drift
//
// Archivos que escribe (los únicos tres derivados):
//   ~/.pi/agent/subagents.json      { model_profiles: { role: { model, effort } } }
//   ~/.pi/gentle-ai/profiles.json   { kind, version, active, profiles: { <id>: { role: { model, thinking } } } }
//   ~/.pi/agent/web-search.json     { provider, model } | (se elimina si el perfil no tiene)
//
// Merge: se preservan perfiles y claves desconocidas; nunca se borra configuración del usuario.
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { getProfile, SUBAGENT_ROLES } from "./profiles.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const check = args.includes("--check");
const dryRun = args.includes("--dry-run") || check;
const id = args.find((a) => !a.startsWith("--"));
if (!id) {
  console.error("uso: apply-profile.mjs <perfil> [--dry-run] [--check]");
  process.exit(2);
}

const profile = getProfile(id);

const home = process.env.PI_BOOTSTRAP_HOME || homedir();
const piDir = process.env.PI_CODING_AGENT_DIR || join(home, ".pi", "agent");
const gentleDir = process.env.GENTLE_PI_CONFIG_HOME || join(home, ".pi", "gentle-ai");

const readJson = (path, fallback) => {
  if (!existsSync(path)) return fallback;
  const raw = readFileSync(path, "utf8").trim();
  if (!raw) return fallback;
  return JSON.parse(raw);
};

// --- subagents.json (10 roles; sin orchestrator/refuter/validator) ---
const subagentsPath = join(piDir, "subagents.json");
const subagents = readJson(subagentsPath, {});
subagents.model_profiles = {};
for (const role of SUBAGENT_ROLES) {
  const { model, thinking } = profile.roles[role];
  subagents.model_profiles[role] = { model, effort: thinking };
}

// --- ~/.pi/gentle-ai/profiles.json (13 roles, multi-perfil, con `active`) ---
const gentlePath = join(gentleDir, "profiles.json");
const gentle = readJson(gentlePath, {});
gentle.kind = gentle.kind || "gentle-pi.agent_model_profiles";
gentle.version = gentle.version || 1;
gentle.profiles = gentle.profiles || {};
gentle.profiles[id] = Object.fromEntries(
  Object.entries(profile.roles).map(([role, { model, thinking }]) => [role, { model, thinking }]),
);
gentle.active = id;

// --- web-search.json ---
const webSearchPath = join(piDir, "web-search.json");
const webSearch = profile.webSearch ?? null;

const outputs = [
  [subagentsPath, JSON.stringify(subagents, null, 2) + "\n"],
  [gentlePath, JSON.stringify(gentle, null, 2) + "\n"],
  [webSearchPath, webSearch ? JSON.stringify(webSearch, null, 2) + "\n" : null],
];

let drift = 0;
for (const [path, body] of outputs) {
  const current = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (body === null) {
    if (current !== null) {
      drift++;
      if (check) console.error(`drift: ${path} debería no existir`);
      else {
        unlinkSync(path);
        console.log(`eliminado ${path}`);
      }
    }
    continue;
  }
  if (current === body) continue;
  drift++;
  if (dryRun) {
    console.error(`drift: ${path}`);
    continue;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
  console.log(`escrito ${path}`);
}

if (check) {
  if (drift) process.exit(1);
  console.log(`ok: runtime en sync con el perfil ${id}`);
} else if (dryRun) {
  console.log(`--dry-run: ${drift} archivo(s) cambiarían`);
}

export { profile };
