// Escribe una API key en auth.json sin pasar por la TUI.
//   node scripts/set-api-key.mjs <provider> <key>
//
// El esquema es el de pi (dist/core/auth-storage.js): {"type":"api_key","key":"..."}.
// `type:"key"` NO es un alias válido: load() lanza "Invalid auth.json credential" y entonces
// NINGÚN proveedor se puede leer — un OAuth correcto de otro proveedor también aparece como
// "invalid_state". Por eso la migración de abajo, para curar archivos escritos por versiones
// anteriores de este script.
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync, renameSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const [provider, key] = process.argv.slice(2);
if (!provider || !key) {
  console.error("uso: set-api-key.mjs <provider> <key>");
  process.exit(2);
}

const piDir = process.env.PI_CODING_AGENT_DIR || join(process.env.PI_BOOTSTRAP_HOME || homedir(), ".pi", "agent");
const authPath = join(piDir, "auth.json");

function readAuth() {
  if (!existsSync(authPath)) return {};
  const raw = readFileSync(authPath, "utf8").trim();
  if (!raw) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Nunca sobreescribir un archivo que no entendemos: puede tener credenciales buenas.
    console.error(`✖ ${authPath} no es JSON válido; no lo toco.`);
    console.error("  muévelo aparte (p. ej. auth.json.roto) y vuelve a intentarlo.");
    process.exit(1);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    console.error(`✖ ${authPath} no contiene un objeto de credenciales; no lo toco.`);
    process.exit(1);
  }
  return parsed;
}

// {"type":"key","key":"..."} → {"type":"api_key","key":"..."}
function migrate(entry) {
  if (entry && typeof entry === "object" && entry.type === "key" && typeof entry.key === "string") {
    return { type: "api_key", key: entry.key };
  }
  return entry;
}

const auth = readAuth();
let migrated = 0;
for (const [id, entry] of Object.entries(auth)) {
  const fixed = migrate(entry);
  if (fixed !== entry) {
    auth[id] = fixed;
    migrated += 1;
  }
}
auth[provider] = { type: "api_key", key };

mkdirSync(piDir, { recursive: true });
// Escritura atómica: si el proceso muere a mitad, auth.json no queda truncado.
const tmp = `${authPath}.tmp`;
writeFileSync(tmp, `${JSON.stringify(auth, null, 2)}\n`, { mode: 0o600 });
renameSync(tmp, authPath);
chmodSync(authPath, 0o600);

console.log(`credencial escrita para ${provider} en ${authPath}`);
if (migrated > 0) console.log(`migradas ${migrated} entrada(s) type:"key" → "api_key"`);
