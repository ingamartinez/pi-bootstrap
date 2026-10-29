// Aplica config/ a los destinos declarados en manifest.json.
//
//   node scripts/apply-config.mjs            # aplica (con backup)
//   node scripts/apply-config.mjs --dry-run  # sólo reporta
//   node scripts/apply-config.mjs --check    # exit 1 si algún destino no coincide
//
// Política de merge ("json-shallow"): las claves escalares del template ganan, los arrays se
// unen (template primero, sin duplicados) y las claves que sólo tiene el usuario se preservan.
// Nunca se borra configuración existente.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const check = args.includes("--check");
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const home = process.env.PI_BOOTSTRAP_HOME || homedir();
const expand = (p) => p.replace(/^~/, home);

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

/** Identidad de un paquete: `npm:gentle-pi@4.5.1` y `npm:gentle-pi` son el mismo. */
function packageIdentity(spec) {
  if (typeof spec !== "string") return String(spec);
  if (spec.startsWith("npm:")) return "npm:" + spec.slice(4).replace(/@[^@/]*$/, "");
  if (spec.startsWith("git:")) return "git:" + spec.slice(4).replace(/[#@][^#@/]*$/, "");
  return spec;
}

function mergeShallow(template, target) {
  const out = { ...target };
  for (const [key, value] of Object.entries(template)) {
    if (Array.isArray(value)) {
      const existing = Array.isArray(out[key]) ? out[key] : [];
      if (key === "packages") {
        // gentle-ai escribe npm:x sin versión; el template manda y no se duplica por nombre.
        const seen = new Set(value.map(packageIdentity));
        out[key] = [...value, ...existing.filter((e) => !seen.has(packageIdentity(e)))];
      } else {
        out[key] = [...new Set([...value, ...existing])];
      }
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      if (key === "mcpServers") {
        // Un servidor se reemplaza entero: mezclar claves deja definiciones híbridas inválidas
        // (p.ej. context7 con `url` propio y `command`/`args` de gentle-ai).
        out[key] = { ...(out[key] && typeof out[key] === "object" ? out[key] : {}), ...value };
      } else {
        out[key] = { ...(out[key] && typeof out[key] === "object" ? out[key] : {}), ...value };
      }
    } else {
      out[key] = value;
    }
  }
  return out;
}

let changed = 0;
let failures = 0;
const plan = [];

for (const item of manifest.config) {
  const src = join(root, item.src);
  const dest = expand(item.dest);
  if (!existsSync(src)) {
    failures++;
    console.error(`falta en el repo: ${item.src}`);
    continue;
  }

  const isDir = statSync(src).isDirectory();

  if (item.merge === "json-shallow") {
    const template = readJson(src);
    const current = existsSync(dest) ? readJson(dest) : null;
    const merged = mergeShallow(template, current ?? {});
    const body = JSON.stringify(merged, null, 2) + "\n";
    const before = current ? JSON.stringify(current, null, 2) + "\n" : "";
    if (body === before) continue;
    changed++;
    plan.push(`json    ${item.dest}`);
    if (dryRun || check) continue;
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, body);
  } else if (isDir) {
    for (const f of readdirSync(src)) {
      const target = join(dest, f);
      if (existsSync(target)) continue;
      changed++;
      plan.push(`copia   ${item.dest}/${f}`);
      if (dryRun || check) continue;
      mkdirSync(dest, { recursive: true });
      copyFileSync(join(src, f), target);
    }
  } else {
    const body = readFileSync(src, "utf8");
    const current = existsSync(dest) ? readFileSync(dest, "utf8") : "";
    if (body === current) continue;
    changed++;
    plan.push(`copia   ${item.dest}`);
    if (dryRun || check) continue;
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
  }
}

if (failures) process.exit(1);

if (check) {
  if (changed) {
    console.error(`${changed} destino(s) en drift — corre pi-bootstrap install`);
    process.exit(1);
  }
  console.log("ok: config en sync con config/");
} else if (dryRun) {
  console.log(plan.length ? `--dry-run: ${changed} cambio(s)\n  ${plan.join("\n  ")}` : "--dry-run: nada que hacer");
} else {
  console.log(changed ? `config aplicada: ${changed} cambio(s)` : "config ya estaba al día");
}

export { mergeShallow };
