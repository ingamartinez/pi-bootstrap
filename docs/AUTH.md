# Autenticación: el único paso humano (y ya no pasa por una TUI)

El bootstrap conecta las credenciales **siempre**, sin preguntar si quieres hacerlo y sin abrir la
TUI de `pi` ni la de Claude Code. Cada proveedor se resuelve con el flujo más corto que exista:

| Proveedor | Qué hace el bootstrap | Qué hace la persona |
|---|---|---|
| `deepseek` / `opencode-go` | escribe la key en `~/.pi/agent/auth.json` (chmod 600) | pega la key (o exporta la variable) |
| `openai` | conduce el OAuth de pi con `scripts/pi-login.mjs` | autoriza en el navegador |
| `claude` | `claude auth login` (vuelve solo) | autoriza en el navegador |

La diferencia con la versión anterior: ya **no** hay que entrar a `pi`, escribir `/login` y salir. El
script imprime la URL, escucha el callback local y sigue cuando la credencial está escrita.

## Estado de tus credenciales

```bash
pi-bootstrap auth                      # revisa los proveedores de tu perfil
pi auth check --provider openai --json # equivalente, manual
pi auth check --provider openai --no-refresh --json  # sin refrescar tokens
```

`pass` = hay credenciales. `warn` = falta el paso humano de abajo.

Ojo con un matiz verificado: si tienes `DEEPSEEK_API_KEY`/`OPENAI_API_KEY` exportada en el
entorno, `pi auth check` responde `ready` **aunque no exista `auth.json`** — pi resuelve la key del
entorno. Es correcto, pero significa que "verde" puede venir de una variable de shell y no de una
credencial persistida. Si quieres que sobreviva a cerrar la terminal, corre `pi-bootstrap auth`.

## DeepSeek (30 segundos, sin navegador)

```bash
export DEEPSEEK_API_KEY=sk-...
pi-bootstrap auth          # la escribe en ~/.pi/agent/auth.json (chmod 600)
```

Es el único proveedor que se puede dejar listo sin intervención. El perfil `full-deepseek`
existe justamente para eso: probar el harness completo con una sola key.

El esquema importa: `scripts/set-api-key.mjs` escribe `{"type":"api_key","key":"..."}`, que es lo
que valida `dist/core/auth-storage.js`. Una entrada con `type:"key"` (lo que escribían versiones
anteriores del script) hace que `load()` lance y **todo** `auth.json` quede ilegible: los demás
proveedores aparecen como `invalid_state` aunque su credencial sea válida. El script migra esas
entradas al escribir, y el harness tiene un assert para que no vuelva.

## DeepSeek vía opencode-go (alternativa al API directo)

Si prefieres que esos mismos roles corran por el catálogo de `opencode-go` en vez de la API directa
de DeepSeek, la ruta cambia y la credencial también:

```bash
export OPENCODE_API_KEY=...
pi-bootstrap install --profile hybrid-openai --deepseek-via opencode-go --yes
```

Qué cambia y qué no:

| | `--deepseek-via deepseek` (default) | `--deepseek-via opencode-go` |
|---|---|---|
| Credencial | `DEEPSEEK_API_KEY` | `OPENCODE_API_KEY` |
| Modelo pro | `deepseek/deepseek-v4-pro` | `opencode-go/deepseek-v4-pro` |
| Modelo flash | `deepseek/deepseek-flash` | `opencode-go/deepseek-v4.1-flash` |
| Roles del perfil | los 13 | los mismos 13 |

Los ids **no** son isomorfos: el flash de opencode-go se llama `deepseek-v4.1-flash`, no
`deepseek-flash`. Por eso el mapa es explícito en `scripts/profiles.mjs`, no un `replace` del prefijo.

Con `--deepseek-via none` el instalador **oculta y rechaza** los perfiles que requieren DeepSeek
(`full-deepseek`, `hybrid-claude`, `hybrid-openai`, `full-deepseek-claude-openai`) y el menú solo
ofrece los tres que no lo usan. La ruta elegida se guarda en `~/.pi-bootstrap/installed.json`, así que
`verify`, `auth` y `profile` la respetan sin tener que repetir el flag.

## OpenAI (una vez, en el navegador — sin TUI)

```bash
pi-bootstrap auth
#   1) Iniciar sesión con ChatGPT (navegador)
#   2) Pegar OPENAI_API_KEY
```

La opción 1 ejecuta `node scripts/pi-login.mjs openai`, que conduce el mismo flujo OAuth que el
`/login` de la TUI:

1. imprime la URL de `auth.openai.com` (y la abre con `--open`);
2. levanta el callback en `127.0.0.1:1455` y espera;
3. cuando autorizas, escribe la credencial en `auth.json` y **termina solo**.

Si el navegador está en otra máquina o el puerto 1455 está ocupado por otro login a medias, el
script pide pegar la URL final de redirección. La opción 2 escribe una API key sin navegador.

La espera por defecto es de 10 minutos y se puede acortar con `PI_LOGIN_TIMEOUT` (segundos): lo usan
los tests de Docker, donde no hay navegador y lo que importa es que el flujo arranque y aborte limpio.

Dentro de un contenedor el callback tiene que escuchar en todas las interfaces:

```bash
node scripts/pi-login.mjs openai --bind 0.0.0.0      # o PI_OAUTH_CALLBACK_HOST=0.0.0.0
```

Con el puerto publicado (`-p 127.0.0.1:1455:1455`) el navegador de tu máquina llega al contenedor,
pero **desde el gateway de la VM**: un socket atado a `127.0.0.1` lo rechaza y el navegador muestra
`ERR_EMPTY_RESPONSE`. El `redirect_uri` no cambia: sigue siendo `http://127.0.0.1:1455/auth/callback`,
que es lo que el navegador necesita.

Si el navegador no vuelve solo, el script pide pegar la URL final. Pulsar **Enter sin pegar nada no
cancela el login**: sigue esperando el callback. Cuando el callback gana la carrera, el prompt de
pegado queda sin dueño y se descarta a propósito.

El `deviceId` que OpenAI exige por instalación se lee (o se crea) en `~/.pi/agent/settings.json`,
el mismo que usa una sesión interactiva: el login headless no inventa una identidad distinta.

Nota: el proveedor `openai-codex` sí tiene *device code* puro (código de 8 caracteres, sin
localhost). Este repo no lo usa porque los perfiles apuntan a `openai/…`, pero el script lo soporta:
`node scripts/pi-login.mjs openai-codex --prefer device_code`.

## Claude (subscripción, vía Claude Code)

`claude-bridge` no usa una API key: presta la cuota de tu **subscripción de Claude Code**.

```bash
claude auth login      # abre el navegador y vuelve solo; no es la TUI de trabajo
claude auth status     # JSON con loggedIn/authMethod; exit 0 si hay sesión
```

`claude auth login` es el comando que ejecuta el bootstrap. Antes se abría `claude` a secas, lo que
dejaba al usuario dentro de la TUI teniendo que escribir `/login` y salir a mano. `setup-token`
(la alternativa oficial para CI) imprime un token de un año pero **no** escribe credenciales: el
bootstrap no lo usa porque dejaría el paso a medias.

Si el flujo pide pegar un código, se pega y se pulsa Enter: **no se ve mientras lo escribes** porque
es una entrada secreta de su UI. El bootstrap avisa de eso antes de lanzarlo, porque si no parece que
el terminal se colgó. Ese camino también funciona dentro de Docker (su `redirect_uri` es remoto, no
localhost), así que el login de Claude sí se puede completar en un contenedor.

Notas:

- El bootstrap instala `@anthropic-ai/claude-code` cuando el perfil lo requiere.
- Consume cuota de subscripción, no facturación por API (el propio paquete lo advierte).
- `provider.plan` (`pro` por defecto) sólo importa si usas modelos plan-gated
  (`opus-4-6`, `sonnet-4-6`). La matriz por defecto usa `sonnet-5-5`/`opus-5-5`/`haiku-5-5`,
  que dan 1M de contexto sin importar el plan. Si algún día usas `opus-4-6`:
  `{ "provider": { "plan": "max" } }` en `~/.pi/agent/claude-bridge.json`.
- Sin subscripción no hay perfil `claude`; usa `full-openai` o `full-deepseek`.

## Lo que el bootstrap nunca hace

- Copiar `auth.json` de otra máquina (el refresh de OAuth puede invalidar el token del origen).
- Guardar secretos en el repo: `config/` no contiene credenciales y `.gitignore` cubre lo local.
- Reutilizar `~/.pi/agent/models.json` de otra persona (`llm-gateway` es configuración privada).

## Problemas típicos

| Síntoma | Causa | Arreglo |
|---|---|---|
| `openai: sin credenciales` | el OAuth no se completó | `pi-bootstrap auth` (o `node scripts/pi-login.mjs openai`) |
| `Port 1455 is in use` al hacer login | otro login a medias o el CLI de Codex | cierra el otro proceso y reintenta; el script también acepta pegar la URL |
| `claude: sin credenciales` | Claude Code no logueado | `claude auth login` |
| `claude-bridge` no aparece | falta el paquete o el binario | `pi install npm:pi-claude-bridge@0.10.0` y `claude --version` |
| modelo inexistente en el perfil | perfil de un proveedor que no tienes | `pi-bootstrap profile full-deepseek` |
