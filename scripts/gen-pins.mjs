// Emite lib/pins.sh desde manifest.json.
// Existe porque el bootstrap instala Node ANTES de tener Node: no puede parsear JSON todavía.
// La única copia mantenida a mano es el manifest; esto es un espejo generado.
//
//   node scripts/gen-pins.mjs [--check]
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const check = process.argv.includes("--check");
const node = manifest.tools.node;

const lines = [
  "# GENERADO por scripts/gen-pins.mjs — no editar a mano.",
  `# manifest updated: ${manifest.updated}`,
  `NODE_VERSION='${node.version}'`,
  `NODE_URL_TEMPLATE='${node.url}'`,
];
for (const [key, sha] of Object.entries(node.sha256)) {
  const [os, arch] = key.split("-");
  lines.push(`NODE_SHA_${os}_${arch}='${sha}'`);
}
const body = lines.join("\n") + "\n";
const target = join(root, "lib", "pins.sh");

if (check) {
  const current = readFileSync(target, "utf8");
  if (current !== body) {
    console.error(`drift: ${target} no coincide con manifest.json (corre node scripts/gen-pins.mjs)`);
    process.exit(1);
  }
  console.log("ok: lib/pins.sh en sync con manifest.json");
} else {
  writeFileSync(target, body);
  console.log(`escrito ${target}`);
}
