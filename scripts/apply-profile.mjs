// Deriva la configuración de runtime desde un perfil.
//
//   node scripts/apply-profile.mjs <perfil> [--dry-run]
//   node scripts/apply-profile.mjs --check <perfil>     # sólo compara, exit 1 si hay drift
//
// Archivos que escribe (los derivados del perfil):
//   ~/.pi/agent/subagents.json      { model_profiles: { role: { model, effort } } }
//   ~/.pi/gentle-ai/profiles.json   { kind, version, active, profiles: { <id>: { role: { model, thinking } } } }
//   ~/.pi/agent/web-search.json     { provider, model } | (se elimina si el perfil no tiene)
//   ~/.pi/agent/settings.json       defaultProvider / defaultModel / defaultThinkingLevel
//   ~/.pi/agent/agents/<rol>.md     `model:` y `thinking:` del frontmatter
//
// Merge: se preservan perfiles y claves desconocidas; nunca se borra configuración del usuario.
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { getProfile, profileForRoute, SUBAGENT_ROLES } from "./profiles.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const check = args.includes("--check");
const dryRun = args.includes("--dry-run") || check;
const id = args.find((a) => !a.startsWith("--"));
if (!id) {
  console.error("uso: apply-profile.mjs <perfil> [--dry-run] [--check]");
  process.exit(2);
}

const routeFlag = args.find((a) => a.startsWith("--deepseek-via"));
const route =
  (routeFlag && (routeFlag.includes("=") ? routeFlag.split("=")[1] : args[args.indexOf(routeFlag) + 1])) ||
  process.env.PI_BOOTSTRAP_DEEPSEEK_VIA ||
  "deepseek";

// El perfil se enruta UNA vez: de aquí salen subagents.json, profiles.json y el --check de verify.
const profile = profileForRoute(getProfile(id), route);

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

// --- settings.json: el perfil manda en provider/modelo por defecto ---
// Antes `profile.settings` era código muerto y el default quedaba fijo en settings.json.
const settingsPath = join(piDir, "settings.json");
const settings = readJson(settingsPath, {});

function routedDefault(provider, model) {
  if (provider !== "deepseek" || route !== "opencode-go") return { provider, model };
  // Mismo criterio que el mapa de roles: los ids de opencode-go no son isomorfos.
  return { provider: "opencode-go", model: /flash/.test(model) ? "deepseek-v4.1-flash" : "deepseek-v4-pro" };
}

if (profile.settings) {
  const d = routedDefault(profile.settings.defaultProvider, profile.settings.defaultModel);
  settings.defaultProvider = d.provider;
  settings.defaultModel = d.model;
  settings.defaultThinkingLevel = profile.settings.defaultThinkingLevel;
}

// --- agentes .md: el frontmatter sale del perfil, no del snapshot ---
// Los .md del repo son plantillas sin `model:`/`thinking:`: si los llevaran, quedarían mintiendo
// en cuanto cambies de perfil o de ruta (apply-config copia con copy-missing y no los reescribe).
function syncFrontmatter(src, role) {
  const block = src.match(/^---\n([\s\S]*?)\n---\n/);
  if (!block) return null;
  const lines = block[1].split("\n");
  const set = (key, value) => {
    const i = lines.findIndex((l) => l.startsWith(`${key}:`));
    if (i >= 0) {
      lines[i] = `${key}: ${value}`;
      return;
    }
    const anchor = lines.findIndex((l) => l.startsWith("description:"));
    lines.splice(anchor >= 0 ? anchor + 1 : 0, 0, `${key}: ${value}`);
  };
  set("model", role.model);
  set("thinking", role.thinking);
  const next = src.replace(block[0], `---\n${lines.join("\n")}\n---\n`);
  return next === src ? null : next;
}

const agentsDir = join(piDir, "agents");
const agentOutputs = [];
if (existsSync(agentsDir)) {
  for (const role of SUBAGENT_ROLES) {
    const path = join(agentsDir, `${role}.md`);
    if (!existsSync(path)) continue;
    const next = syncFrontmatter(readFileSync(path, "utf8"), profile.roles[role]);
    if (next !== null) agentOutputs.push([path, next]);
  }
}

// settings.json: lo escribe también pi en vivo (tema, modelo, changelog, la TUI), así que el
// drift se mide sólo por PRESENCIA de las claves que este script posee. Si cambias de modelo
// en la TUI, eso es estado tuyo: `verify` no debe fallar por ello. Al aplicar el perfil sí se
// escriben los tres valores del perfil.
const SETTINGS_OWNED = ["defaultProvider", "defaultModel", "defaultThinkingLevel"];
const currentSettings = readJson(settingsPath, {});
// En `--check`: falta alguna clave → el perfil no llegó a aplicarse (drift).
// Aplicando: si el valor difiere del perfil, se escribe (cambiar de perfil cambia el default).
const settingsNeedWrite = check
  ? SETTINGS_OWNED.some((key) => !currentSettings[key])
  : SETTINGS_OWNED.some((key) => currentSettings[key] !== settings[key]);

const outputs = [
  [subagentsPath, JSON.stringify(subagents, null, 2) + "\n"],
  [gentlePath, JSON.stringify(gentle, null, 2) + "\n"],
  [webSearchPath, webSearch ? JSON.stringify(webSearch, null, 2) + "\n" : null],
];

// Ficheros compartidos con pi: se comparan por campo, no por byte.
const sharedOutputs = [];
if (settingsNeedWrite) sharedOutputs.push([settingsPath, JSON.stringify(settings, null, 2) + "\n"]);
sharedOutputs.push(...agentOutputs);

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

// settings.json y agentes .md: aquí ya sólo llegan los que difieren en los campos del perfil.
for (const [path, body] of sharedOutputs) {
  drift++;
  // `--check` es de sólo lectura: ni settings.json ni el frontmatter se tocan al verificar.
  if (check || dryRun) {
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
