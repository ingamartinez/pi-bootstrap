// Verifica que TODAS las URLs pineadas existan, para las 4 plataformas.
// Atrapa la clase de bug que rompió CI: gentle-ai/engram publican `amd64`, nodejs.org publica `x64`.
// Sólo comprueba existencia (HEAD/GET parcial); el sha256 se valida al instalar de verdad.
//
//   node scripts/check-urls.mjs
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const targets = [
  ["darwin", "x64"], ["darwin", "arm64"],
  ["linux", "x64"], ["linux", "arm64"],
];

let failures = 0;
for (const [id, tool] of Object.entries(manifest.tools)) {
  if (tool.kind !== "tarball") continue;
  for (const [os, arch] of targets) {
    const artifactArch = tool.archMap?.[arch] ?? arch;
    const url = tool.url
      .replaceAll("{version}", tool.version)
      .replaceAll("{os}", os)
      .replaceAll("{arch}", artifactArch);
    const sha = tool.sha256[`${os}-${arch}`];
    const label = `${id} ${os}/${arch}`;

    if (!sha) {
      console.error(`FAIL ${label}: sin sha256 pineado`);
      failures++;
      continue;
    }

    // GET con rango 0-0: barato y aceptado por GitHub/nodejs.org donde HEAD a veces se rechaza.
    const res = await fetch(url, { headers: { Range: "bytes=0-0" }, redirect: "follow" });
    if (res.ok || res.status === 206) {
      console.log(`ok   ${label} → ${res.status}`);
    } else {
      console.error(`FAIL ${label} → HTTP ${res.status}\n     ${url}`);
      failures++;
    }
  }
}

if (failures) {
  console.error(`\n${failures} URL(s) inválidas: el nombre de arquitectura del proyecto no coincide con el pin.`);
  process.exit(1);
}
console.log("\ntodas las URLs pineadas existen (4 plataformas)");
