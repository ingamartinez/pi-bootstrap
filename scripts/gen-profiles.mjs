// Escribe config/profiles/<id>.json a partir de la matriz.
// Uso: node scripts/gen-profiles.mjs [--check]
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PROFILES, getProfile } from "./profiles.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "config", "profiles");
const check = process.argv.includes("--check");

mkdirSync(outDir, { recursive: true });

let drift = 0;
for (const profile of PROFILES) {
  getProfile(profile.id); // valida los 13 roles
  const file = join(outDir, `${profile.id}.json`);
  const body = JSON.stringify({ schema: "pi-bootstrap.profile/1", ...profile }, null, 2) + "\n";
  if (check) {
    const current = existsSync(file) ? readFileSync(file, "utf8") : "";
    if (current !== body) {
      console.error(`drift: ${file}`);
      drift++;
    }
    continue;
  }
  writeFileSync(file, body);
  console.log(`escrito ${file}`);
}

if (check) {
  const known = new Set(PROFILES.map((p) => `${p.id}.json`));
  for (const f of readdirSync(outDir).filter((f) => f.endsWith(".json"))) {
    if (!known.has(f)) {
      console.error(`perfil huérfano (no está en la matriz): ${f}`);
      drift++;
    }
  }
  if (drift) process.exit(1);
  console.log(`ok: ${PROFILES.length} perfiles en sync con la matriz`);
}
