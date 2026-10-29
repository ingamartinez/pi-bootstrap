// Escribe una API key en auth.json sin pasar por la TUI.
//   node scripts/set-api-key.mjs <provider> <key>
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const [provider, key] = process.argv.slice(2);
if (!provider || !key) {
  console.error("uso: set-api-key.mjs <provider> <key>");
  process.exit(2);
}
const piDir = process.env.PI_CODING_AGENT_DIR || join(process.env.PI_BOOTSTRAP_HOME || homedir(), ".pi", "agent");
const authPath = join(piDir, "auth.json");
const auth = existsSync(authPath) ? JSON.parse(readFileSync(authPath, "utf8") || "{}") : {};
auth[provider] = { type: "key", key };
mkdirSync(piDir, { recursive: true });
writeFileSync(authPath, JSON.stringify(auth, null, 2) + "\n", { mode: 0o600 });
chmodSync(authPath, 0o600);
console.log(`credencial escrita para ${provider} en ${authPath}`);
