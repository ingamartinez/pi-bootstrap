// Login de un proveedor de pi SIN abrir la TUI.
//
//   node scripts/pi-login.mjs <provider> [--prefer browser|device_code] [--timeout 600] [--open] [--bind <host>]
//
// Conduce el mismo flujo OAuth que el comando `/login` de la TUI, pero con la interacción
// manejada por el script: imprime la URL de verificación (y el código, si el proveedor usa
// device code) y sólo pregunta lo imprescindible por /dev/tty. No hay TUI que cerrar: el
// proceso termina solo cuando pi escribe la credencial en auth.json.
//
// Sale con 0 si la credencial quedó guardada, 1 si no (cancelado, timeout o error).
//
// Dos detalles que costaron un bug cada uno:
//  - el terminal se lee con `tty.ReadStream`, NO con `fs.createReadStream` sobre el fd: una
//    lectura de `fs` en vuelo sobre un tty bloquea el event loop en Linux y los timers dejan de
//    disparar (el proceso quedaba vivo hasta que el usuario pulsaba Enter).
//  - la salida se escribe con `writeSync` y se termina con `process.exit` inmediato, para no
//    depender de ningún timer ni de un flush asíncrono.
import { readdirSync, existsSync, openSync, closeSync, readFileSync, writeFileSync, mkdirSync, realpathSync, writeSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { execFile, execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { ReadStream as TtyReadStream } from "node:tty";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

// Salida síncrona: con `process.exit` inmediato no hay riesgo de perder líneas a medio escribir.
function out(line = "") {
  try { writeSync(1, `${line}\n`); } catch { /* stdout cerrado */ }
}

function err(line = "") {
  try { writeSync(2, `${line}\n`); } catch { /* stderr cerrado */ }
}

// ---------------------------------------------------------------- argumentos

function parseArgs(argv) {
  const opts = { provider: "", prefer: process.env.PI_LOGIN_PREFER || "", timeout: 900, open: false, bind: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--open") opts.open = true;
    else if (arg === "--prefer") opts.prefer = String(argv[++i] || "");
    else if (arg === "--timeout") opts.timeout = Number(argv[++i] || 900) || 900;
    else if (arg === "--bind") opts.bind = String(argv[++i] || "");
    else if (arg === "-h" || arg === "--help") { out(USAGE); process.exit(0); }
    else if (arg.startsWith("-")) fail(`opción desconocida: ${arg}`);
    else if (!opts.provider) opts.provider = arg;
  }
  if (!opts.provider) fail("falta el proveedor");
  return opts;
}

const USAGE = `uso: pi-login.mjs <provider> [--prefer browser|device_code] [--timeout <s>] [--open] [--bind <host>]

  <provider>   id de proveedor de pi (openai, openai-codex, anthropic, ...)
  --prefer     método preferido cuando el proveedor ofrece varios
  --timeout    segundos antes de abortar el flujo (por defecto 600)
  --open       intenta abrir la URL de verificación en el navegador del sistema
  --bind       interfaz del callback local (default 127.0.0.1; en Docker: 0.0.0.0)`;

function fail(message) {
  err(`✖ ${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------- entorno

// Mismo criterio que set-api-key.mjs: el home de pi se puede aislar por env.
const piDir = process.env.PI_CODING_AGENT_DIR
  || join(process.env.PI_BOOTSTRAP_HOME || homedir(), ".pi", "agent");
const authPath = join(piDir, "auth.json");
const settingsPath = join(piDir, "settings.json");
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// OpenAI identifica cada instalación por un `urn:uuid:<deviceId>` estable. La TUI lo crea y lo
// guarda en settings.json (settings-manager.getOrCreateDeviceId); aquí hacemos lo mismo para que
// el login headless use la MISMA identidad que una sesión interactiva.
function getOrCreateDeviceId() {
  let settings = {};
  try { settings = JSON.parse(readFileSync(settingsPath, "utf8") || "{}"); } catch { settings = {}; }
  if (typeof settings.deviceId === "string" && UUID_PATTERN.test(settings.deviceId)) {
    return settings.deviceId;
  }
  const deviceId = randomUUID();
  try {
    mkdirSync(piDir, { recursive: true });
    writeFileSync(settingsPath, `${JSON.stringify({ ...settings, deviceId }, null, 2)}\n`);
  } catch { /* si no se puede escribir, el id sigue sirviendo para este login */ }
  return deviceId;
}

function ancestorsOf(start, depth = 8) {
  const out = [];
  let dir = start;
  for (let i = 0; i < depth; i += 1) {
    out.push(dir);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return out;
}

function piBinRealPath() {
  try {
    const bin = execFileSync("/bin/sh", ["-c", "command -v pi"], { encoding: "utf8" }).trim();
    return bin ? realpathSync(bin) : "";
  } catch { return ""; }
}

function releaseDirs() {
  const releases = join(piDir, "install", "releases");
  try {
    return readdirSync(releases)
      .sort((a, b) => {
        const pa = a.split(".").map(Number); const pb = b.split(".").map(Number);
        for (let i = 0; i < 3; i += 1) if ((pa[i] || 0) !== (pb[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
        return 0;
      })
      .map((version) => join(releases, version, "node_modules", "@earendil-works", "pi-coding-agent"));
  } catch { return []; }
}

// El binario `pi` puede ser un shim propio (instalación autogestionada) o un symlink de npm a
// `dist/cli.js`. Mirar el paquete, su padre y los layouts de npm/pnpm cubre los dos casos sin
// adivinar el prefijo.
function piModuleCandidates() {
  const out = [];
  const addFile = (file) => { if (file && !out.includes(file)) out.push(file); };
  const addRoot = (root) => {
    if (!root) return;
    const real = resolve(root);
    addFile(join(real, "dist", "core", "model-runtime.js"));
    addFile(join(real, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "core", "model-runtime.js"));
    addFile(join(real, "lib", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "core", "model-runtime.js"));
  };

  // Escape hatch para tests y layouts raros: acepta el paquete o el archivo directamente.
  const explicit = process.env.PI_BOOTSTRAP_PI_MODULE;
  if (explicit) {
    if (explicit.endsWith(".js")) addFile(resolve(explicit));
    else addRoot(explicit);
  }

  addRoot(process.env.PI_BOOTSTRAP_PREFIX);
  addRoot(join(dirname(process.execPath), "..")); // prefijo global de node
  for (const dir of releaseDirs()) addRoot(dir);  // ~/.pi/agent/install/releases/<versión>

  // Subir desde el `pi` real: cubre `<prefix>/lib/node_modules/...` y `<paquete>/dist/cli.js`.
  const bin = piBinRealPath();
  if (bin) for (const dir of ancestorsOf(dirname(bin))) addRoot(dir);

  return out;
}

function resolvePiModule() {
  for (const entry of piModuleCandidates()) {
    if (existsSync(entry)) return entry;
  }
  fail("no encuentro el paquete de pi (dist/core/model-runtime.js). ¿Está instalado?");
  return "";
}

// ---------------------------------------------------------------- interacción

function openDevTty() {
  let fd;
  try { fd = openSync("/dev/tty", "r"); } catch { return null; }
  try { closeSync(fd); } catch { /* nada que cerrar */ }
  return fd;
}

function canAsk() {
  return openDevTty() !== null;
}

// Un único lector de /dev/tty para todo el proceso: el stdin del instalador puede ser el script
// (curl|sh), y abrir/cerrar un descriptor por pregunta provocaba dobles close (EBADF).
let ttyReader = null;
let ttyStream = null;
let ttyFd = null;
let ttyWaiter = null;
let ttyEof = false;
const ttyLines = [];

function ensureTtyReader() {
  if (ttyReader) return true;
  let fd;
  try { fd = openSync("/dev/tty", "r"); } catch { return false; }
  ttyFd = fd;
  // tty.ReadStream (no fs.createReadStream): usa el camino de stream/epoll del terminal, así una
  // lectura pendiente NO congela el event loop. Con fs, en Linux, los timers dejaban de disparar.
  ttyStream = new TtyReadStream(fd);
  if (typeof ttyStream.unref === "function") ttyStream.unref();
  ttyStream.on("error", () => { /* descriptor cerrado a propósito al salir */ });
  ttyReader = createInterface({ input: ttyStream, terminal: false });
  ttyReader.on("line", (line) => {
    if (ttyWaiter) { const settle = ttyWaiter; ttyWaiter = null; settle(line); }
    else ttyLines.push(line);
  });
  // EOF del terminal (Ctrl-D): no dejar la pregunta colgada para siempre.
  ttyReader.on("close", () => {
    ttyEof = true;
    if (ttyWaiter) { const settle = ttyWaiter; ttyWaiter = null; settle(""); }
  });
  return true;
}

// Sin esto el stream de /dev/tty mantiene vivo el proceso y el script no termina nunca (o sólo
// termina cuando alguien pulsa Enter, que es exactamente el síntoma opuesto al que queremos).
function closeTtyReader() {
  if (!ttyReader) return;
  try { ttyReader.close(); } catch { /* ya cerrado */ }
  try { ttyStream.destroy(); } catch { /* ya destruido */ }
  // Cerrar el descriptor es lo que cancela la lectura pendiente: destruir el stream con
  // autoClose:false lo deja vivo y con el event loop enganchado.
  if (ttyFd !== null) { try { closeSync(ttyFd); } catch { /* ya cerrado */ } }
  ttyReader = null;
  ttyStream = null;
  ttyFd = null;
}

function readLine(message, signal) {
  if (signal?.aborted) return Promise.reject(new Error("aborted"));
  if (!ensureTtyReader()) return Promise.reject(new Error("no hay terminal (/dev/tty) para preguntar"));
  if (ttyEof && !ttyLines.length) return Promise.reject(new Error("eof"));
  try { writeSync(1, message); } catch { /* stdout cerrado */ }
  return new Promise((resolve, reject) => {
    const onAbort = () => { ttyWaiter = null; reject(new Error("aborted")); };
    signal?.addEventListener("abort", onAbort, { once: true });
    const settle = (value) => {
      signal?.removeEventListener("abort", onAbort);
      resolve(value);
    };
    if (ttyLines.length) settle(ttyLines.shift());
    else ttyWaiter = settle;
  });
}

// Sin terminal ya no se puede pegar la URL, pero el callback puede seguir llegando: se espera ahí.
function waitForCallback(signal) {
  out("  esperando el callback del navegador (Ctrl-C para cancelar)…");
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error("aborted")); return; }
    signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
}

function pickOption(options, prefer) {
  const wanted = String(prefer || "").toLowerCase();
  if (wanted) {
    const match = options.find((option) =>
      option.id.toLowerCase().includes(wanted) || option.label.toLowerCase().includes(wanted));
    if (match) return match;
  }
  return options[0];
}

function openBrowser(url) {
  const command = process.platform === "darwin" ? "open" : "xdg-open";
  execFile(command, [url], () => { /* best-effort: si no hay navegador, la URL ya está impresa */ });
}

function makeInteraction(opts) {
  return {
    notify(event) {
      switch (event.type) {
        case "info": {
          out(event.message);
          for (const link of event.links || []) out(`  ${link.url}`);
          break;
        }
        case "auth_url": {
          out("\nAbre esta URL en el navegador y autoriza el acceso:");
          out(`  ${event.url}`);
          if (event.instructions) out(event.instructions);
          out("El script escucha el callback: si el navegador vuelve solo, no hay que pegar nada.");
          if (opts.open) openBrowser(event.url);
          break;
        }
        case "device_code": {
          out(`\nAbre ${event.verificationUri} e introduce el código: ${event.userCode}`);
          if (event.expiresInSeconds) out(`  (caduca en ${Math.round(event.expiresInSeconds / 60)} min)`);
          if (opts.open) openBrowser(event.verificationUri);
          break;
        }
        case "progress":
          out(`  ${event.message}`);
          break;
        default:
          break;
      }
    },

    async prompt(prompt) {
      if (prompt.type === "select") {
        const chosen = pickOption(prompt.options, opts.prefer);
        out(`${prompt.message}\n  → ${chosen.label}`);
        return chosen.id;
      }
      // `manual_code` es un atajo, no un requisito: pi lo lanza en paralelo con el servidor de
      // callback. Si la persona pulsa Enter (o el terminal llega a EOF) NO se cancela el login:
      // se sigue esperando el callback, que es el camino normal.
      if (prompt.type === "manual_code") {
        for (;;) {
          let answer;
          try {
            answer = await readLine(`\n${prompt.message} `, prompt.signal);
          } catch (error) {
            if (error.message === "aborted") throw error;
            return waitForCallback(prompt.signal);
          }
          const value = String(answer || "").trim();
          if (value) return value;
          out("  (Enter sin URL: sigo esperando el callback del navegador…)");
        }
      }
      const message = `${prompt.message} `;
      try {
        const answer = await readLine(message, prompt.signal);
        return String(answer || "").trim();
      } catch (error) {
        if (error.message === "aborted") throw error;
        throw new Error(`${error.message}: este proveedor necesita una respuesta aquí`);
      }
    },
  };
}

// ---------------------------------------------------------------- principal

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!canAsk()) {
    fail("no hay /dev/tty: un login OAuth necesita que alguien abra la URL y confirme");
  }

  // En Docker el puerto publicado llega desde el gateway de la VM, no desde loopback: 127.0.0.1
  // rechaza la conexión. El redirect_uri sigue siendo 127.0.0.1 (lo que ve el navegador).
  if (opts.bind) process.env.PI_OAUTH_CALLBACK_HOST = opts.bind;

  const { ModelRuntime } = await import(pathToFileURL(resolvePiModule()).href);
  const runtime = await ModelRuntime.create({ authPath });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(5, opts.timeout) * 1000);
  const onSignal = () => controller.abort();
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  out(`▸ login ${opts.provider} (sin TUI${opts.bind ? `, callback en ${opts.bind}:1455` : ""})`);
  // El flujo de pi lanza el prompt de "pega la URL de callback" en paralelo con el servidor
  // local; cuando el callback gana, ese prompt queda rechazado y sin dueño. Node lo trataría
  // como error fatal, así que aquí se ignora: el resultado real lo da el await de abajo.
  process.on("unhandledRejection", () => { /* prompt de callback que perdió la carrera */ });
  try {
    const interaction = makeInteraction(opts);
    interaction.signal = controller.signal;
    await runtime.login(opts.provider, "oauth", interaction, {
      getDeviceId: getOrCreateDeviceId,
      agentName: "Pi",
    });
    out(`✔ credencial de ${opts.provider} guardada en ${authPath}`);
    return 0;
  } catch (error) {
    const message = String(error?.message || error);
    if (controller.signal.aborted) {
      err(`✖ ${opts.provider}: login abortado o fuera de tiempo (${message})`);
    } else {
      err(`✖ ${opts.provider}: ${message}`);
    }
    return 1;
  } finally {
    clearTimeout(timeout);
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    closeTtyReader();
  }
}

// Salida inmediata, sin timers ni flush asíncrono. Con una lectura pendiente sobre el terminal,
// cualquier espera basada en timers puede no llegar nunca: el usuario no tiene por qué pulsar
// Enter para que el instalador continúe. `writeSync` ya dejó la salida en el descriptor.
process.exit(await main());
