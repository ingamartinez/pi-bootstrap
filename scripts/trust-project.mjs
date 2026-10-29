// Marca un directorio como confiable para que `pi` no pregunte al entrar.
//   node scripts/trust-project.mjs <dir>
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

const dir = resolve(process.argv[2] || process.cwd());
const piDir = process.env.PI_CODING_AGENT_DIR || join(process.env.PI_BOOTSTRAP_HOME || homedir(), ".pi", "agent");
const trustPath = join(piDir, "trust.json");
const trust = existsSync(trustPath) ? JSON.parse(readFileSync(trustPath, "utf8") || "{}") : {};

if (trust[dir] === true) {
  console.log(`ya confiable: ${dir}`);
} else {
  trust[dir] = true;
  mkdirSync(piDir, { recursive: true });
  writeFileSync(trustPath, JSON.stringify(trust, null, 2) + "\n");
  console.log(`marcado como confiable: ${dir}`);
}
