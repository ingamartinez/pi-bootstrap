// Snapshot saneado: toma la config de la máquina actual y escribe config/ lista para shippear.
//
//   node scripts/export-config.mjs [--from <agent-dir>]
//
// Qué se copia: paquetes (pineados desde manifest.json), preferencias de UI, mcp.json
// (sin figma), keybindings, los 10 agentes .md, y los flags de gentle-pi.
// Qué se descarta a propósito: deviceId, rutas personales de skills, extensiones de harness
// (orca/herdr), auth.json, browser-harness.json, trust.json, models.json (llm-gateway privado).
import { readFileSync, writeFileSync, mkdirSync, cpSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const fromIdx = args.indexOf("--from");
const sourceHome = fromIdx >= 0 ? args[fromIdx + 1] : homedir();
const agentDir = join(sourceHome, ".pi", "agent");
const gentleDir = join(sourceHome, ".pi", "gentle-ai");
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

const out = join(root, "config");
mkdirSync(join(out, "pi", "agents"), { recursive: true });
mkdirSync(join(out, "gentle-ai"), { recursive: true });

// --- settings.json: paquetes desde el manifest, preferencias del host, cero ruido personal ---
const hostSettings = readJson(join(agentDir, "settings.json"));
const settings = {
  packages: [...manifest.pi.packages],
  defaultProvider: "openai",
  defaultModel: "gpt-6.1-sol",
  defaultThinkingLevel: "high",
  hideThinkingBlock: true,
  terminal: { hyperlinks: true },
  theme: hostSettings.theme || "catppuccin-mocha",
  tuiMode: hostSettings.tuiMode || "fullscreen",
  extensions: hostSettings.extensions || [],
};
writeFileSync(join(out, "pi", "settings.json"), JSON.stringify(settings, null, 2) + "\n");

// --- mcp.json: sólo servidores que funcionan sin nada del autor instalado ---
const hostMcp = readJson(join(agentDir, "mcp.json"));
const mcpServers = {};
for (const name of ["codegraph", "context7"]) {
  if (hostMcp.mcpServers?.[name]) mcpServers[name] = hostMcp.mcpServers[name];
}
writeFileSync(join(out, "pi", "mcp.json"), JSON.stringify({ mcpServers }, null, 2) + "\n");

// --- keybindings ---
if (existsSync(join(agentDir, "keybindings.json"))) {
  cpSync(join(agentDir, "keybindings.json"), join(out, "pi", "keybindings.json"));
}

// --- agentes .md ---
const agentsSrc = join(agentDir, "agents");
let agents = 0;
if (existsSync(agentsSrc)) {
  for (const f of readdirSync(agentsSrc).filter((f) => f.endsWith(".md"))) {
    cpSync(join(agentsSrc, f), join(out, "pi", "agents", f));
    agents++;
  }
}

// --- gentle-pi: sólo los flags, no los perfiles (esos los deriva apply-profile) ---
for (const f of ["channel.json", "background-subagents.json"]) {
  if (existsSync(join(gentleDir, f))) cpSync(join(gentleDir, f), join(out, "gentle-ai", f));
}

console.log(`config/ actualizado: settings, mcp (${Object.keys(mcpServers).join(", ")}), ${agents} agentes, gentle-ai flags`);
