// Registra qué quedó instalado, para que `upgrade` sepa de dónde partir.
//   node scripts/record-state.mjs <tiers> <profile>
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const [tiers = "base,tools", profile = ""] = process.argv.slice(2);
const home = process.env.PI_BOOTSTRAP_HOME || homedir();
const out = join(home, ".pi-bootstrap", "installed.json");

const version = (cmd) => {
  try {
    const raw = execFileSync(cmd, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return (raw.match(/\d+\.\d+\.\d+/) || [raw.trim()])[0];
  } catch {
    return null;
  }
};

const tools = {};
for (const [id, tool] of Object.entries(manifest.tools)) {
  const cmd = tool.exposes?.[0] || tool.artifact;
  if (!cmd) continue;
  const found = version(cmd);
  if (found) tools[id] = { pinned: tool.version, installed: found };
}

let gentleAiSelection = null;
try {
  const st = JSON.parse(readFileSync(join(home, ".gentle-ai", "state.json"), "utf8"));
  gentleAiSelection = { persona: st.persona, preset: st.preset, components: st.components, agents: st.installed_agents };
} catch {
  /* aún no configurado */
}

const state = {
  at: new Date().toISOString(),
  tiers,
  profile,
  source: process.env.PI_BOOTSTRAP_SOURCE || "checkout",
  tools,
  packages: manifest.pi.packages,
  gentleAi: gentleAiSelection,
};

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(state, null, 2) + "\n");
console.error(`estado registrado en ${out}`);
