# pi-bootstrap

Deja **Pi + Gentle AI + un perfil de modelos** listos en macOS o Linux, sin sudo, para que un dev
escriba `pi` dentro de cualquier repo y empiece a trabajar.

## Instalar

### 1. Modo interactivo (recomendado la primera vez)

```bash
curl -fsSL https://github.com/ingamartinez/pi-bootstrap/raw/v0.2.0/bootstrap.sh | sh
```

Pregunta lo que no puede adivinar: perfil de modelos, si quieres el tier `shell`, si conectas
credenciales ahora o después, y **confirma antes de escribir nada**. El plan que imprime después
refleja tus respuestas.

Funciona porque `bootstrap.sh`, al detectar que viene por una tubería (stdin es el script), reabre
`/dev/tty` como entrada del instalador. Si prefieres no depender de eso, las dos alternativas son
igual de válidas:

```bash
sh -c "$(curl -fsSL https://github.com/ingamartinez/pi-bootstrap/raw/v0.2.0/bootstrap.sh)"
git clone https://github.com/ingamartinez/pi-bootstrap && cd pi-bootstrap && ./bootstrap.sh
```

Sin terminal de control (CI, contenedor) no hay preguntas posibles: ahí va el bloque 2.

### 2. One-shot (CI, dotfiles, máquinas remotas)

```bash
curl -fsSL https://github.com/ingamartinez/pi-bootstrap/raw/v0.2.0/bootstrap.sh \
  | sh -s -- --profile hybrid-openai --yes
```

### 3. Desde el checkout, sin preguntas

```bash
./bootstrap.sh --profile hybrid-openai --yes
```

## Estado

Release actual **v0.2.0**, CI verde en `main` y en cada tag.

| Pieza | Estado |
|---|---|
| Binarios pineados (node, pi, gentle-ai, engram, codegraph, claude-code) con sha256 por os/arch | ✅ |
| Config Pi (settings, mcp, 10 agentes, keybindings) con merge conservador | ✅ |
| Matriz de 5 perfiles × 13 roles → `subagents.json` + `profiles.json` + `web-search.json` | ✅ |
| Tier `shell` (gentle-shell sin wizard) | ✅ |
| Stack gentle-ai declarado explícitamente (preset, persona, componentes) | ✅ |
| `upgrade` (plan, apply, rollback con downgrade real) | ✅ |
| `reset` (config / tools / shell, con backup previo) | ✅ |
| Login guiado (deepseek por key; openai y claude por TUI + polling) | ⚠️ escrito, **no ejecutado** todavía en una TTY real |
| Prueba con un dev externo | ⏳ pendiente |

Lo verificado se comprobó así: **Linux limpio** (`ubuntu:24.04`, usuario no-root, sin TTY, sin
navegador, checkout montado read-only) en arm64 y amd64, **macOS** con `HOME` aislado (bash 3.2),
y el **one-liner publicado** en contenedor limpio.

## Comandos

```bash
pi-bootstrap install --profile <id> [--tiers base,tools,shell] [--yes] [--dry-run] [--skip-auth]
pi-bootstrap profiles            # perfiles disponibles
pi-bootstrap profile <id>        # cambiar el perfil activo
pi-bootstrap auth                # revisar/conectar credenciales del perfil
pi-bootstrap verify              # ¿quedó todo bien? (exit != 0 si no)
pi-bootstrap doctor              # diagnóstico sin modificar nada
pi-bootstrap init [dir]          # preparar un repo: AGENTS.md, trust, codegraph, odd/tasks
pi-bootstrap upgrade [--apply|--rollback] [--major] [--to <ts>]
pi-bootstrap reset [--config|--tools|--shell|--all] [--purge-auth] [--dry-run]
pi-bootstrap export-config       # re-snapshot de config/ desde esta máquina
```

## Cómo funciona

`preflight → binarios pineados → gentle-ai → paquetes de pi → config → perfil → shell → verify`

Cada paso comprueba antes de instalar y verifica después: correrlo dos veces no cambia nada (hay un
test que lo exige). El orden importa: `gentle-ai install` **antes** de copiar agentes, porque captura
los `.md` presentes en disco en ese momento; y el perfil se **re-aplica** después del
`gentle-shell setup`, porque ese paso corre `gentle-ai install` y puede regenerar `profiles.json`.

### Sin Homebrew y sin sudo

`gentle-ai`, `engram` y `node` se bajan como tarballs pineados desde sus releases y se verifican con
sha256; `pi`, `codegraph` y `claude-code` van por `npm -g --prefix ~/.local`. Un solo camino para
macOS y Linux, todo bajo `$HOME`. Cada herramienta declara **su** nombre de arquitectura
(GoReleaser usa `amd64`, nodejs.org usa `x64`) y `scripts/check-urls.mjs` comprueba las 12 URLs
pineadas en las 4 plataformas.

### Qué instala el stack (`full-gentleman`)

Los componentes están en `manifest.json → gentleAi` y se pasan como flags explícitos; nunca se
delegan a los defaults de gentle-ai (sin flags, gentle-ai instala su mínimo: persona + engram).
Efecto real con `--agent pi`, medido comparando el árbol de un `HOME` limpio antes/después:

| Componente | Qué hace en Pi |
|---|---|
| `persona` | `~/.pi/gentle-ai/persona.json` → `{"mode":"gentleman"}` |
| `engram` | memoria persistente (binario + config) |
| `context7` | MCP de documentación — **gana nuestra definición** (URL remota), no la stdio de gentle-ai |
| `skills` | **no escribe nada para Pi**: las 29 skills embebidas apuntan a Claude/OpenCode/Cursor/Kimi |
| `claude-theme`, `opencode-gentle-logo`, `permissions` | sin efecto en Pi |
| ~~`gga`~~ | **fuera por defecto.** Gate de revisión en pre-commit: bloquea commits y necesita un CLI de proveedor mapeado. Opt-in con `--component ...,gga` |

Las skills que ve un dev de Pi son las **13 del paquete `gentle-pi`** (pinneado), no el componente
`skills`: eso lo determina el pin, no la selección de gentle-ai.

### Perfiles

| Perfil | Proveedores | Independencia |
|---|---|---|
| `hybrid-claude` | deepseek + claude | cross-provider |
| `hybrid-openai` | deepseek + openai | cross-provider |
| `full-claude` | claude | same-family |
| `full-openai` | openai | same-family |
| `full-deepseek` | deepseek | same-family |

La matriz vive en `scripts/profiles.mjs` (única fuente de verdad, 13 roles). Los perfiles
`same-family` verifican con la misma familia que producen: sirven para trabajo diario, no para gates
críticos, y `verify` lo advierte. `apply-profile` deriva los tres archivos de runtime y detecta
desincronización entre ellos.

### Tier `shell` sin wizard

`gentle-ai` **no** instala gentle-shell: instala el stack del agente (persona, engram, skills,
routing). Gentle Shell es el workspace construido sobre Pi y su binario viaja dentro del paquete
`gentle-pi`, que ya instalamos. Su instalador oficial es un wizard de navegador, pero el paquete
expone las mismas piezas por CLI:

```
shim ~/.local/bin/gentle-shell → <gentle-pi>/bin/gentle-shell.mjs
gentle-shell home isolated      # hogar propio en ~/.gentle-shell (no toca ~/.pi)
gentle-shell home import-pi     # reutiliza auth.json y mcp.json de pi; nunca sobreescribe
gentle-shell setup              # aprovisiona con gentle-ai (≈9s, sin navegador)
apply-profile                   # se re-aplica por lo dicho arriba
```

Frente al instalador oficial se pierde su runtime Node propio (usamos el node pineado, la misma
versión que él bundlea) y `upgrade --channel/--rollback` (queda cubierto por nuestro `upgrade`).
Quien prefiera un solo hogar en vez de dos: `gentle-shell --link` reutiliza `~/.pi/agent`.

## ¿Pregunta o va de una?

Tres modos, sin ambigüedad:

| Situación | Comportamiento |
|---|---|
| Terminal interactiva, sin `--yes` | **Pregunta**: perfil (si falta), tier `shell`, conectar credenciales ahora o después… y **confirma antes de tocar nada** |
| Con `--yes` | No pregunta nada: usa los flags y los valores por defecto. Es el modo para CI y para el one-liner |
| Sin terminal y sin `--yes` | **Falla** con instrucciones en vez de asumir un sí |

Las preguntas del install son tres como máximo:

```
¿Qué perfil de modelos quieres?
  1) full-claude    Todo Claude (vía Claude Code / claude-bridge)
  ...
¿Instalar también el tier shell (gentle-shell, home aislado)? [s/N]
¿Conectar credenciales ahora (abre la TUI de pi / Claude Code)? [S/n]
¿Procedo con la instalación? [s/N]
```

y el plan que imprime justo después refleja las respuestas (`tiers:`, `auth:`), para que veas qué
vas a instalar antes de aceptar. `reset` también confirma: `--dry-run` enseña la lista y sin `--yes`
no borra nada.

> Para probar los prompts sin terminal está `PI_BOOTSTRAP_ASSUME_TTY=1`, que sólo se usa en los
> tests (`printf 's\nn\n' \| … --dry-run`). No cambia el comportamiento normal.

## Actualizar

```bash
pi-bootstrap upgrade                     # plan: qué hay nuevo (no toca nada)
pi-bootstrap upgrade --apply --yes       # backup → manifest+sha256 → instalar → verificar
pi-bootstrap upgrade --rollback          # vuelve a la copia previa al último upgrade
pi-bootstrap upgrade --rollback --to <ts>
```

De dónde salen las versiones: registro de npm (`pi`, `codegraph`, `claude-code`, paquetes de pi),
`nodejs.org/dist/index.json` + `SHASUMS256.txt` para Node (sólo LTS), y la API de releases de GitHub
para `gentle-ai`/`engram` (digest del asset o fichero de checksums).

- **Guard de major**: por defecto sólo propone cambios dentro del mismo major — saltar de Node 24 a
  26 o de gentle-ai 4 a 5 sin querer es un riesgo. `--major` lo permite.
- **Rollback que baja de verdad**: restaura el manifest, la configuración y aplica el modo
  `PI_BOOTSTRAP_EXACT=1`, que exige la versión exacta del pin. Sin eso, la comprobación
  `instalado ≥ pin` reutilizaba el binario nuevo y el "rollback" sólo cambiaba el manifest.
- El backup vive en `~/.pi-bootstrap/rollback/<ts>/` (manifest + configuración + `installed.json`).
  El rollback restaura ese manifest **en el working tree del repo**: después conviene
  `git diff manifest.json` para decidir si se commitea.
- El estado instalado (pin vs versión real, perfil y selección de gentle-ai) queda en
  `~/.pi-bootstrap/installed.json`, que es de donde `upgrade` parte.

## Borrar

```bash
pi-bootstrap reset --config --dry-run    # ver qué borraría
pi-bootstrap reset --config --yes        # configuración (con backup previo)
pi-bootstrap reset --tools --yes         # binarios en ~/.local + paquetes de pi
pi-bootstrap reset --all --yes           # config + tools (+ --shell)
```

- `--config` **respalda antes** en `~/.pi/backups/pi-bootstrap-reset-<ts>/`. Nada se borra sin
  `--yes`.
- `--tools` quita lo que instaló el bootstrap, no binarios del sistema.
- `--purge-auth` es el único que toca credenciales (`auth.json`, `trust.json`,
  `browser-harness.json`) y es irreversible: no se respaldan.
- Después de `reset --config`, se recupera con `pi-bootstrap install --profile <perfil> --yes`.

## Pruebas

```bash
./tests/docker/run.sh                                # Linux limpio: instala, verifica, idempotencia, reset y recuperación
MODE=published ./tests/docker/run.sh                 # el one-liner real contra el tag publicado
PLATFORM=linux/amd64 ./tests/docker/run.sh           # la arquitectura que no es la de tu máquina (emulada)
PROFILE=full-openai ./tests/docker/run.sh
node scripts/gen-profiles.mjs --check                # la matriz y los perfiles no divergen
node scripts/gen-pins.mjs --check                    # lib/pins.sh y manifest.json no divergen
node scripts/check-urls.mjs                          # las 12 URLs pineadas existen (4 plataformas)
```

La CI corre en cada push a `main` y en cada tag: drift de generados + sintaxis POSIX/bash, escenario
completo en contenedor Linux, smoke de macOS (bash 3.2) y el guard tag↔versión.

## Trampas documentadas

Todas se descubrieron ejecutando, y la mayoría tiene un assert que las vigila.

- **Pin de git**: pi usa `git:repo@<ref>`. Con `#<sha>` falla en silencio (el paquete no se instala).
- **`{arch}` no es universal**: GoReleaser publica `amd64`, nodejs.org publica `x64`. Con un solo
  nombre, el camino `linux/x64` da 404 y en arm64 (donde coinciden) no lo notas.
- **`gentle-ai --component` es aditivo**: quitar un componente del manifest no lo desinstala en una
  máquina ya instalada; sólo evita instalarlo en máquinas limpias. Para quitarlo hay que retirar
  `~/.config/gga` y `~/.local/share/gga` a mano.
- **`gentle-ai install` escribe `packages` sin versión** (`npm:gentle-pi`) y define `context7` como
  stdio. El merge dedupe por identidad de paquete y reemplaza servidores MCP enteros; si no,
  quedarían duplicados pinneados/sin pinnear y un `context7` híbrido inválido (`url` + `command`).
- **`gentle-ai install` ya trae** `gentle-pi`, `gentle-engram`, `pi-web-access` y `pi-btw`: nuestros
  `pi install` de esos son redundantes, pero no dañinos.
- **`~/.pi/gentle-ai/` es human-controlled**: un tool de modelo no puede escribirlo; el bootstrap lo
  hace con `cp`/node y valida leyendo el resultado.
- **Node**: si ya hay un `node` ≥ pin en `PATH`, se reutiliza; el pin sólo se instala cuando no hay
  ninguno o es más viejo. Es deliberado: no se pisa el runtime del usuario. Por eso
  `~/.local/bin/node` puede no existir aunque el pin diga 24.x.
- **`reset` debe respaldar antes de borrar**: la primera versión respaldaba después y dejaba el
  backup vacío con los archivos ya borrados.
- **Flags de subcomando**: `upgrade --apply` / `--rollback` hay que reenviarlos tal cual; el parser
  del CLI no debe intentar interpretarlos.
- **Nunca se copia** del autor: `deviceId`, `auth.json`, `browser-harness.json`, `trust.json`,
  `models.json` (`llm-gateway` es privado) ni `~/.engram/engram.db`.

## Estructura

```
bootstrap.sh                  entry (checkout o curl | sh, descarga el tarball del tag)
bin/pi-bootstrap              CLI
manifest.json                 pins: versiones, sha256, archMap, tiers, gentleAi, paquetes, qué se copia
lib/{common,steps,verify,reset}.sh
lib/pins.sh                   GENERADO desde manifest.json (existe para instalar node sin node)
config/pi/{settings,mcp,keybindings}.json · config/pi/agents/*.md
config/profiles/*.json        GENERADOS desde scripts/profiles.mjs
config/gentle-ai/{channel,background-subagents}.json
scripts/profiles.mjs          matriz de 13 roles (fuente de verdad de los perfiles)
scripts/{gen-profiles,apply-profile,apply-config,export-config,gen-pins,check-urls,upgrade,record-state}.mjs
scripts/{set-api-key,trust-project}.mjs
scripts/release.sh            fija versión, commitea, tagea y publica
project/AGENTS.md             plantilla para `pi-bootstrap init`
docs/AUTH.md                  el paso humano por proveedor
tests/docker/                 Dockerfile, escenario, asserts, modo published
```

## Autenticación

Ver [`docs/AUTH.md`](docs/AUTH.md). Resumen: `deepseek` se resuelve con una key (30 segundos, sin
navegador); `openai` y `claude` requieren un login en la TUI y el bootstrap espera comprobando
`pi auth check`. El bootstrap **nunca** copia credenciales de otra máquina.
