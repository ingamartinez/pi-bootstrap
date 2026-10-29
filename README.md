# pi-bootstrap

Deja **Pi + Gentle AI + un perfil de modelos** listos en macOS o Linux, sin sudo, para que un dev
escriba `pi` dentro de cualquier repo y empiece a trabajar.

```bash
git clone <repo> && cd pi-bootstrap
./bootstrap.sh --profile hybrid-openai --yes      # instala, configura y verifica
```

## Estado (POC, 2026-10-29)

Verificado en **Linux limpio** (`ubuntu:24.04`, usuario no-root, sin TTY, sin navegador,
checkout montado read-only): instalación desde cero, verificación de contenido, segunda corrida
idempotente y cero escrituras al repo. `./tests/docker/run.sh`.

| Pieza | Estado |
|---|---|
| Binarios pineados (node, pi, gentle-ai, engram, codegraph, claude-code) con sha256 por os/arch | ✅ verificado en Docker |
| Config Pi (settings, mcp, 10 agentes, keybindings) con merge conservador | ✅ |
| Matriz de 5 perfiles × 13 roles → `subagents.json` + `profiles.json` + `web-search.json` | ✅ |
| Verificación (versiones, JSON, coherencia cruzada de perfiles, paquetes, drift) | ✅ |
| Idempotencia (segunda corrida sin cambios) | ✅ |
| Login guiado (deepseek por key, openai/claude por TUI + polling) | ⚠️ escrito, no probado en Docker (no hay navegador ni TTY) |
| Tier `shell` (gentle-shell) | ❌ pendiente: su instalador oficial es un wizard de navegador |
| `upgrade` con rollback | ❌ pendiente: hoy sólo imprime el procedimiento |
| `curl \| sh` publicado | ❌ pendiente: falta el repo real y el tag (TODO en `bootstrap.sh`) |

## Cómo funciona

`preflight → binarios pineados → gentle-ai → paquetes de pi → config → perfil → auth → verify`

Cada paso comprueba antes de instalar y verifica después: correrlo dos veces no cambia nada
(hay un test que lo exige). El orden importa: `gentle-ai install` **antes** de copiar agentes,
porque captura los `.md` presentes en disco en ese momento.

### Sin Homebrew y sin sudo

`gentle-ai`, `engram` y `node` se bajan como tarballs pineados desde sus releases y se verifican
con sha256; `pi`, `codegraph` y `claude-code` van por `npm -g --prefix ~/.local`. Un solo camino
para macOS y Linux, todo bajo `$HOME`.

### Perfiles

| Perfil | Proveedores | Independencia |
|---|---|---|
| `hybrid-claude` | deepseek + claude | cross-provider |
| `hybrid-openai` | deepseek + openai | cross-provider |
| `full-claude` | claude | same-family |
| `full-openai` | openai | same-family |
| `full-deepseek` | deepseek | same-family |

La matriz vive en `scripts/profiles.mjs` (única fuente de verdad, 13 roles). Los perfiles
`same-family` verifican con la misma familia que producen: sirven para trabajo diario, no para
gates críticos, y `verify` lo advierte.

### Comandos

```
pi-bootstrap [install] [--tiers base,tools] [--profile <id>] [--yes] [--dry-run] [--skip-auth]
pi-bootstrap profiles | profile <id> | auth | verify | doctor | init [dir] | upgrade
```

## Pruebas

```bash
./tests/docker/run.sh                    # Linux limpio (necesita el daemon de Docker)
PROFILE=full-openai ./tests/docker/run.sh
node scripts/gen-profiles.mjs --check    # la matriz y los perfiles no divergen
node scripts/gen-pins.mjs --check        # lib/pins.sh y manifest.json no divergen
```

## Trampas ya documentadas

- **Pin de git**: pi usa `git:repo@<ref>`. Con `#<sha>` falla en silencio (el paquete no se
  instala); hay un assert que lo detecta.
- **`gentle-ai install` ya trae** `gentle-pi`, `gentle-engram`, `pi-web-access` y `pi-btw`:
  nuestros `pi install` de esos son redundantes, pero no dañinos.
- **`~/.pi/gentle-ai/` es human-controlled**: un tool de modelo no puede escribirlo; el bootstrap
  lo hace con `cp`/node y lo valida leyendo el resultado.
- **Nunca se copia** del autor: `deviceId`, `auth.json`, `browser-harness.json`, `trust.json`,
  `models.json` (`llm-gateway` es privado) ni `~/.engram/engram.db`.

## Estructura

```
bootstrap.sh                 entry (checkout o curl | sh)
bin/pi-bootstrap             CLI
manifest.json                pins: versiones, sha256, tiers, paquetes, qué se copia
lib/{common,steps,verify}.sh pasos idempotentes
lib/pins.sh                  GENERADO desde manifest.json (existe para instalar node sin node)
config/pi/{settings,mcp,keybindings}.json · config/pi/agents/*.md
config/profiles/*.json       GENERADOS desde scripts/profiles.mjs
config/gentle-ai/{channel,background-subagents}.json
scripts/*.mjs                perfiles, apply, export, pins, auth key, trust
project/AGENTS.md            plantilla para `pi-bootstrap init`
tests/docker/                Linux limpio + asserts + idempotencia
```
