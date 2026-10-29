// Actualización de las herramientas pineadas.
//
//   node scripts/upgrade.mjs                 # plan: qué hay nuevo (no toca nada)
//   node scripts/upgrade.mjs --json          # plan en JSON
//   node scripts/upgrade.mjs --apply --yes   # aplica: backup → manifest+sha256 → instalar → verificar
//   node scripts/upgrade.mjs --rollback      # vuelve a la última copia de seguridad
//   node scripts/upgrade.mjs --rollback --to <ts>
//
// Nunca escribe fuera de: manifest.json, lib/pins.sh (vía gen-pins) y ~/.pi-bootstrap/rollback/.
import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valueOf = (f, d) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d;
};
const home = process.env.PI_BOOTSTRAP_HOME || homedir();
const statePath = join(home, ".pi-bootstrap", "installed.json");
const rollbackRoot = join(home, ".pi-bootstrap", "rollback");
const manifestPath = join(root, "manifest.json");

const log = (...a) => console.error(...a);
const ok = (m) => log(`\x1b[32m✔\x1b[0m ${m}`);
const warn = (m) => log(`\x1b[33m⚠\x1b[0m ${m}`);

const platformKey = (os, arch) => `${os}-${arch}`;

async function githubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

async function get(url, headers = {}) {
  const res = await fetch(url, { headers: { "user-agent": "pi-bootstrap", ...headers } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res;
}

async function npmLatest(pkg) {
  const res = await get(`https://registry.npmjs.org/${pkg.replace("/", "%2F")}/latest`);
  return (await res.json()).version;
}

async function nodeLatest(currentVersion, allowMajor) {
  const index = await (await get("https://nodejs.org/dist/index.json")).json();
  const major = currentVersion.split(".")[0];
  const lts = index.filter((r) => r.lts);
  // Por defecto sólo se sube dentro del mismo major: saltar de 24 a 26 sin querer es un riesgo.
  const pick = allowMajor ? lts[0] : lts.find((r) => r.version.startsWith(`v${major}.`));
  if (!pick) return { version: currentVersion, sha256: null };
  const version = pick.version.replace(/^v/, "");
  const sums = await (await get(`https://nodejs.org/dist/v${version}/SHASUMS256.txt`)).text();
  const sha256 = {};
  for (const [os, arch] of [["darwin", "x64"], ["darwin", "arm64"], ["linux", "x64"], ["linux", "arm64"]]) {
    const file = `node-v${version}-${os}-${arch}.tar.gz`;
    const line = sums.split("\n").find((l) => l.trim().endsWith(file));
    if (!line) throw new Error(`SHASUMS256 sin ${file}`);
    sha256[platformKey(os, arch)] = line.trim().split(/\s+/)[0];
  }
  return { version, sha256 };
}

async function goReleases(repo, tool) {
  const token = await githubToken();
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  const rel = await (await get(`https://api.github.com/repos/${repo}/releases/latest`, headers)).json();
  const version = String(rel.tag_name).replace(/^v/, "");

  // sha256 por plataforma: primero el digest del asset, luego un fichero de checksums
  const sha256 = {};
  const want = {
    "darwin-x64": `${tool}_${version}_darwin_amd64.tar.gz`,
    "darwin-arm64": `${tool}_${version}_darwin_arm64.tar.gz`,
    "linux-x64": `${tool}_${version}_linux_amd64.tar.gz`,
    "linux-arm64": `${tool}_${version}_linux_arm64.tar.gz`,
  };
  for (const [key, name] of Object.entries(want)) {
    const asset = rel.assets?.find((a) => a.name === name);
    if (!asset) throw new Error(`release ${version} no publica ${name}`);
    if (typeof asset.digest === "string" && asset.digest.startsWith("sha256:")) {
      sha256[key] = asset.digest.slice(7);
    }
  }
  if (Object.keys(sha256).length !== 4) {
    const sumsAsset = rel.assets?.find((a) => /checksum/i.test(a.name));
    if (!sumsAsset) throw new Error(`sin digests ni checksums para ${tool} ${version}`);
    const text = await (await get(sumsAsset.browser_download_url)).text();
    for (const [key, name] of Object.entries(want)) {
      const line = text.split("\n").find((l) => l.trim().endsWith(name));
      if (!line) throw new Error(`checksums sin ${name}`);
      sha256[key] = line.trim().split(/\s+/)[0];
    }
  }
  return { version, sha256 };
}

/** Resuelve la última versión de cada herramienta pineada. */
async function resolveLatest(manifest, allowMajor) {
  const out = [];
  for (const [id, tool] of Object.entries(manifest.tools)) {
    try {
      if (id === "node") {
        const { version, sha256 } = await nodeLatest(tool.version, allowMajor);
        out.push({ id, current: tool.version, latest: version, sha256 });
      } else if (tool.kind === "tarball") {
        const repo = tool.url.match(/github\.com\/([^/]+)\/([^/]+)\/releases/);
        if (!repo) throw new Error("no se pudo derivar el repo de la URL");
        const { version, sha256 } = await goReleases(`${repo[1]}/${repo[2]}`, tool.artifact);
        out.push({ id, current: tool.version, latest: version, sha256 });
      } else if (tool.kind === "npm-global") {
        out.push({ id, current: tool.version, latest: await npmLatest(tool.package) });
      } else if (tool.kind === "pi-package-bin") {
        out.push({ id, current: tool.version, latest: await npmLatest(tool.package) });
      }
    } catch (e) {
      out.push({ id, current: tool.version, latest: null, error: String(e.message || e) });
    }
  }

  // paquetes de pi: sólo se reportan; el pin se actualiza en el manifest al aplicar
  const packages = [];
  for (const spec of manifest.pi.packages) {
    if (!spec.startsWith("npm:")) continue;
    const m = spec.match(/^npm:(.+?)@([^@]+)$/);
    if (!m) continue;
    try {
      const latest = await npmLatest(m[1]);
      packages.push({ spec, name: m[1], current: m[2], latest });
    } catch (e) {
      packages.push({ spec, name: m[1], current: m[2], latest: null, error: String(e.message || e) });
    }
  }
  // Major distinto: se informa, pero no se propone salvo --major
  if (!allowMajor) {
    for (const t of out) {
      if (!t.latest || t.latest === t.current) continue;
      if (t.latest.split(".")[0] !== t.current.split(".")[0]) {
        t.blocked = t.latest;
        t.latest = t.current;
      }
    }
    for (const p of packages) {
      if (!p.latest || p.latest === p.current) continue;
      if (p.latest.split(".")[0] !== p.current.split(".")[0]) {
        p.blocked = p.latest;
        p.latest = p.current;
      }
    }
  }
  return { tools: out, packages };
}

function printPlan({ tools, packages }) {
  log("");
  log("  herramienta            actual      disponible");
  log("  ─────────────────────  ──────────  ──────────");
  let pending = 0;
  for (const t of tools) {
    const mark = t.latest && t.latest !== t.current ? "↑" : "=";
    if (mark === "↑") pending++;
    const extra = t.blocked ? `  (${t.blocked} requiere --major)` : "";
    log(`  ${mark} ${t.id.padEnd(20)} ${t.current.padEnd(11)} ${t.latest ?? "error: " + t.error}${extra}`);
  }
  log("");
  log("  paquetes de pi");
  for (const p of packages) {
    const mark = p.latest && p.latest !== p.current ? "↑" : "=";
    if (mark === "↑") pending++;
    const extra = p.blocked ? `  (${p.blocked} requiere --major)` : "";
    log(`  ${mark} ${p.name.padEnd(30)} ${p.current.padEnd(11)} ${p.latest ?? "error: " + p.error}${extra}`);
  }
  log("");
  if (!pending) {
    ok("todo está en la última versión pineada");
  } else {
    log(`  ${pending} actualización(es) disponibles. Aplica con: pi-bootstrap upgrade --apply --yes`);
  }
  return pending;
}

function backup(manifest) {
  const ts = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "");
  const dir = join(rollbackRoot, ts);
  mkdirSync(dir, { recursive: true });
  cpSync(manifestPath, join(dir, "manifest.json"));
  const files = [
    [".pi/agent/settings.json", "settings.json"],
    [".pi/agent/mcp.json", "mcp.json"],
    [".pi/agent/subagents.json", "subagents.json"],
    [".pi/agent/keybindings.json", "keybindings.json"],
    [".pi/agent/web-search.json", "web-search.json"],
    [".pi/gentle-ai/profiles.json", "profiles.json"],
    [".pi/gentle-ai/models.json", "models.json"],
    [".pi/gentle-ai/channel.json", "channel.json"],
    [".pi/gentle-ai/background-subagents.json", "background-subagents.json"],
  ];
  for (const [rel, name] of files) {
    const src = join(home, rel);
    if (existsSync(src)) cpSync(src, join(dir, name));
  }
  if (existsSync(statePath)) cpSync(statePath, join(dir, "installed.json"));
  writeFileSync(join(dir, "meta.json"), JSON.stringify({ ts, manifest: manifest.updated }, null, 2) + "\n");
  return dir;
}

function applyPlan(manifest, plan) {
  const next = JSON.parse(JSON.stringify(manifest));
  for (const t of plan.tools) {
    if (!t.latest || t.latest === t.current) continue;
    next.tools[t.id].version = t.latest;
    if (t.sha256) next.tools[t.id].sha256 = t.sha256;
  }
  for (const p of plan.packages) {
    if (!p.latest || p.latest === p.current) continue;
    next.pi.packages = next.pi.packages.map((s) => (s.startsWith(`npm:${p.name}@`) ? `npm:${p.name}@${p.latest}` : s));
    // gentle-shell sigue la versión de gentle-pi (viven en el mismo paquete)
    if (p.name === "gentle-pi" && next.tools["gentle-shell"]) next.tools["gentle-shell"].version = p.latest;
  }
  next.updated = new Date().toISOString().slice(0, 10);
  writeFileSync(manifestPath, JSON.stringify(next, null, 2) + "\n");
  execFileSync(process.execPath, [join(root, "scripts", "gen-pins.mjs")], { stdio: "inherit" });
}

function run(cmd, cmdArgs, extraEnv = {}) {
  return execFileSync(join(root, "bin", "pi-bootstrap"), [cmd, ...cmdArgs], {
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
}

function activeProfile() {
  try {
    return JSON.parse(readFileSync(join(home, ".pi/gentle-ai/profiles.json"), "utf8")).active || null;
  } catch {
    return null;
  }
}

function installedState() {
  try {
    return JSON.parse(readFileSync(statePath, "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  if (has("--rollback")) {
    if (!existsSync(rollbackRoot)) {
      console.error("no hay copias de seguridad de upgrade");
      process.exit(1);
    }
    const all = readdirSync(rollbackRoot).sort();
    const ts = valueOf("--to", all[all.length - 1]);
    const dir = join(rollbackRoot, ts);
    if (!existsSync(join(dir, "manifest.json"))) {
      console.error(`no existe la copia ${ts}`);
      process.exit(1);
    }
    log(`rollback a ${ts}`);
    cpSync(join(dir, "manifest.json"), manifestPath);
    const files = ["settings.json", "mcp.json", "subagents.json", "keybindings.json", "web-search.json",
      "profiles.json", "models.json", "channel.json", "background-subagents.json"];
    const destOf = {
      "settings.json": ".pi/agent/settings.json", "mcp.json": ".pi/agent/mcp.json",
      "subagents.json": ".pi/agent/subagents.json", "keybindings.json": ".pi/agent/keybindings.json",
      "web-search.json": ".pi/agent/web-search.json", "profiles.json": ".pi/gentle-ai/profiles.json",
      "models.json": ".pi/gentle-ai/models.json", "channel.json": ".pi/gentle-ai/channel.json",
      "background-subagents.json": ".pi/gentle-ai/background-subagents.json",
    };
    for (const f of files) {
      const src = join(dir, f);
      if (existsSync(src)) {
        const dest = join(home, destOf[f]);
        mkdirSync(dirname(dest), { recursive: true });
        cpSync(src, dest);
      }
    }
    execFileSync(process.execPath, [join(root, "scripts", "gen-pins.mjs")], { stdio: "inherit" });
    warn("manifest.json del repo restaurado (queda modificado en el working tree)");
    const profile = activeProfile();
    // EXACT: un rollback también baja versiones, no sólo los pins del manifest
    run("install", ["--force", "--yes", ...(profile ? ["--profile", profile] : []), "--skip-auth"], {
      PI_BOOTSTRAP_EXACT: "1",
    });
    run("verify", profile ? ["--profile", profile] : []);
    return;
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const plan = await resolveLatest(manifest, has("--major"));

  if (has("--json")) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  const pending = printPlan(plan);

  if (!has("--apply")) return;
  if (!pending) return;
  if (!has("--yes")) {
    console.error("--apply requiere --yes (escribe manifest.json y reinstala)");
    process.exit(2);
  }

  const dir = backup(manifest);
  ok(`backup en ${dir}`);
  applyPlan(manifest, plan);
  ok("manifest.json y lib/pins.sh actualizados");

  const st = installedState();
  const profile = valueOf("--profile", st?.profile || activeProfile());
  const tiers = valueOf("--tiers", st?.tiers || "base,tools,shell");
  run("install", ["--force", "--yes", "--profile", profile, "--tiers", tiers, "--skip-auth"]);
  run("verify", ["--profile", profile, "--tiers", tiers]);
  ok(`actualizado. Para volver atrás: pi-bootstrap upgrade --rollback --to ${dir.split("/").pop()}`);
}

main().catch((e) => {
  console.error(`upgrade falló: ${e.message || e}`);
  process.exit(1);
});
