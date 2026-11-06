#!/usr/bin/env bash
# Escenario dentro del contenedor: instala, verifica, corre otra vez y comprueba idempotencia.
set -uo pipefail

PROFILE="${PROFILE:-full-deepseek}"
SRC=/src
FAILS=0

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
pass() { printf '  \033[32mok\033[0m %s\n' "$*"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$*"; FAILS=$((FAILS + 1)); }
assert_eq() { if [ "$2" = "$3" ]; then pass "$1: $3"; else fail "$1: esperado '$3', obtenido '$2'"; fi; }
assert_cmd() { if "$@" >/dev/null 2>&1; then pass "$*"; else fail "$*"; fi; }

export PATH="$HOME/.local/bin:$PATH"

say "corrida 1 — instalación desde cero"
"$SRC/bootstrap.sh" --tiers "${TIERS:-base,tools,shell}" --profile "$PROFILE" --yes --skip-auth
RC=$?
assert_eq "bootstrap exit code" "$RC" "0"
[ "$RC" -eq 0 ] || { fail "abortando: la instalación no terminó"; exit 1; }

say "estado del filesystem tras instalar"
find "$HOME" -type f -not -path "*/.cache/*" -not -path "*/node_modules/*" -not -path "*/.npm/*" \
  -not -path "*/node/*" -not -path "*/.pi/agent/npm/*" | sort > /tmp/state-after-1.txt
pass "$(wc -l < /tmp/state-after-1.txt | tr -d ' ') archivos en \$HOME"

say "verificación de contenido"
bash "$SRC/tests/docker/assert.sh" "$PROFILE" || FAILS=$((FAILS + 1))

say "corrida 2 — idempotencia"
HASH_BEFORE=$(cat "$HOME/.pi/agent/settings.json" "$HOME/.pi/agent/subagents.json" \
  "$HOME/.pi/agent/mcp.json" "$HOME/.pi/gentle-ai/profiles.json" 2>/dev/null | sha256sum | awk '{print $1}')
"$SRC/bootstrap.sh" --tiers "${TIERS:-base,tools,shell}" --profile "$PROFILE" --yes --skip-auth >/tmp/run2.log 2>&1
RC2=$?
assert_eq "segunda corrida exit code" "$RC2" "0"
HASH_AFTER=$(cat "$HOME/.pi/agent/settings.json" "$HOME/.pi/agent/subagents.json" \
  "$HOME/.pi/agent/mcp.json" "$HOME/.pi/gentle-ai/profiles.json" 2>/dev/null | sha256sum | awk '{print $1}')
assert_eq "config sin cambios entre corridas" "$HASH_AFTER" "$HASH_BEFORE"

find "$HOME" -type f -not -path "*/.cache/*" -not -path "*/node_modules/*" -not -path "*/.npm/*" \
  -not -path "*/node/*" -not -path "*/.pi/agent/npm/*" | sort > /tmp/state-after-2.txt
if diff -q /tmp/state-after-1.txt /tmp/state-after-2.txt >/dev/null; then
  pass "sin archivos nuevos en la segunda corrida"
else
  fail "la segunda corrida creó o borró archivos:"
  diff /tmp/state-after-1.txt /tmp/state-after-2.txt | sed 's/^/      /' >&2
fi

say "el checkout quedó intacto"
if [ -w "$SRC/" ]; then
  if [ -n "$(cd "$SRC" && git status --porcelain 2>/dev/null)" ]; then
    fail "el bootstrap modificó el checkout"
  else
    pass "sin cambios en el checkout"
  fi
else
  pass "checkout montado read-only (no se pudo escribir)"
fi

say "modo interactivo (respuestas pipeadas, hook de test)"
# Respuestas en orden: sólo la ruta de DeepSeek (1 = API directa). El tier shell y la conexión de
# credenciales ya no se preguntan: entran siempre.
printf '1\n' | PI_BOOTSTRAP_ASSUME_TTY=1 "$SRC/bootstrap.sh" --profile "$PROFILE" --dry-run > /tmp/interactive.log 2>&1
assert_eq "interactivo exit code" "$?" "0"
grep -q "deepseek: deepseek" /tmp/interactive.log \
  && pass "la ruta de DeepSeek se aplicó" \
  || fail "la ruta de DeepSeek no se aplicó"
grep -q "tiers:   base,tools,shell" /tmp/interactive.log \
  && pass "el tier shell entra sin preguntar" \
  || fail "el tier shell no entró por defecto"
grep -q "auth:    sí, ahora" /tmp/interactive.log \
  && pass "las credenciales se conectan sin preguntar" \
  || fail "las credenciales no se conectan por defecto"
grep -q "¿Instalar también el tier shell" /tmp/interactive.log \
  && fail "volvió la pregunta del tier shell" \
  || pass "sin pregunta de tier shell"
grep -q "¿Conectar credenciales ahora" /tmp/interactive.log \
  && fail "volvió la pregunta de credenciales" \
  || pass "sin pregunta de credenciales"

say "camino por pipe (curl|sh): los flags sobreviven al exec"
# En el contenedor no hay /dev/tty, así que aquí se cubre el reenvío de argumentos y el no-TTY.
# El caso interactivo por tubería se prueba a mano con un pty (ver README).
cat "$SRC/bootstrap.sh" | PI_BOOTSTRAP_SRC="$SRC" sh -s -- --profile "$PROFILE" --yes --dry-run > /tmp/piped.log 2>&1
assert_eq "pipe exit code" "$?" "0"
grep -q "(--dry-run) nada modificado" /tmp/piped.log \
  && pass "los flags llegaron a través del pipe" \
  || fail "los flags se perdieron en el camino por pipe"

say "reset --config y recuperación"
"$SRC/bin/pi-bootstrap" reset --config --yes > /tmp/reset.log 2>&1
RC_R=$?
assert_eq "reset exit code" "$RC_R" "0"
if [ -f "$HOME/.pi/agent/settings.json" ]; then fail "reset no borró settings.json"; else pass "settings.json eliminado"; fi
if ls "$HOME/.pi/backups"/pi-bootstrap-reset-* >/dev/null 2>&1; then pass "backup del reset presente"; else fail "reset no dejó backup"; fi
"$SRC/bootstrap.sh" --tiers "${TIERS:-base,tools,shell}" --profile "$PROFILE" --yes --skip-auth > /tmp/recover.log 2>&1
assert_eq "recuperación exit code" "$?" "0"
if [ -f "$HOME/.pi/agent/settings.json" ]; then pass "configuración recuperada"; else fail "la reinstalación no recuperó settings.json"; fi

say "auth sin TUI (pty de verdad, con script(1))"
# El contenedor no trae navegador: lo que se comprueba es que el login se conduce desde el script
# (menú de método, URL impresa, espera acotada) y que jamás se abre una TUI que haya que cerrar.
# HOMEs aparte para no contaminar las credenciales del escenario principal.
AUTH_KEY_HOME=$(mktemp -d)
AUTH_OAUTH_HOME=$(mktemp -d)

# Ojo: pi crea auth.json = {} con sólo inicializar el storage. Lo que importa es que no haya
# ninguna credencial dentro (toda credencial lleva "type").
auth_file_has_creds() {
  [ -f "$1/.pi/agent/auth.json" ] && grep -q '"type"' "$1/.pi/agent/auth.json"
}

# 1) Sin TTY: avisa y no se cuelga (timeout como red de seguridad).
timeout 60 env HOME="$AUTH_KEY_HOME" PI_BOOTSTRAP_PROFILE=full-openai \
  "$SRC/bin/pi-bootstrap" auth > /tmp/auth-notty.log 2>&1
assert_eq "auth sin TTY exit code" "$?" "0"
grep -q "sin terminal" /tmp/auth-notty.log \
  && pass "sin TTY avisa en vez de colgarse" \
  || fail "sin TTY no avisó"
if auth_file_has_creds "$AUTH_KEY_HOME"; then
  fail "escribió credenciales sin que hubiera terminal"
else
  pass "sin TTY no inventa credenciales"
fi

# 2) Con pty, método 2: la API key se pregunta y se persiste en auth.json.
printf '2\nsk-fake-openai-key\n' | HOME="$AUTH_KEY_HOME" PI_BOOTSTRAP_PROFILE=full-openai \
  script -q /dev/null -c "$SRC/bin/pi-bootstrap auth" > /tmp/auth-key.log 2>&1
grep -q "1) Iniciar sesión con ChatGPT" /tmp/auth-key.log \
  && pass "el menú de método se pregunta (API key disponible)" \
  || fail "no apareció el menú de método de OpenAI"
grep -q "sk-fake-openai-key" "$AUTH_KEY_HOME/.pi/agent/auth.json" 2>/dev/null \
  && pass "la API key pegada quedó en auth.json" \
  || fail "la API key no se persistió"

# 3) Con pty, método 1: imprime la URL del OAuth y la espera es acotada (nada de TUI).
#    El `\n\n` final comprueba que pulsar Enter sin pegar nada NO cancela el login.
printf '1\n\n' | HOME="$AUTH_OAUTH_HOME" PI_BOOTSTRAP_PROFILE=full-openai PI_LOGIN_TIMEOUT=5 \
  script -q /dev/null -c "$SRC/bin/pi-bootstrap auth" > /tmp/auth-oauth.log 2>&1
grep -q "login openai (sin TUI)" /tmp/auth-oauth.log \
  && pass "el login corre por debajo, sin TUI" \
  || { fail "el login no arrancó por debajo"; sed -n '1,20p' /tmp/auth-oauth.log | sed 's/^/    /'; }
grep -q "auth.openai.com/api/accounts/authorize" /tmp/auth-oauth.log \
  && pass "imprime la URL de autorización" \
  || fail "no imprimió la URL de autorización"
grep -q "sigo esperando el callback" /tmp/auth-oauth.log \
  && pass "Enter sin URL no cancela el login" \
  || fail "Enter sin URL canceló el login"
grep -q "no quedó autenticado" /tmp/auth-oauth.log \
  && pass "al expirar avisa y sigue (no se cuelga)" \
  || fail "al expirar no avisó"
if auth_file_has_creds "$AUTH_OAUTH_HOME"; then
  fail "guardó credenciales de un login que no se completó"
else
  pass "login incompleto no deja credenciales a medias"
fi

# 4) device_code de `openai-codex`: el otro OAuth de pi, el único que no necesita un navegador en
#    la misma máquina (código de 8 caracteres). Va directo al script porque `pi-bootstrap auth`
#    sólo recorre los proveedores del perfil (openai, claude, deepseek…).
#    Este caso sí pide red, igual que el resto del suite (node, pi y gentle-ai se descargan).
AUTH_CODEX_HOME=$(mktemp -d)
printf '\n' | HOME="$AUTH_CODEX_HOME" script -q /dev/null \
  -c "node $SRC/scripts/pi-login.mjs openai-codex --prefer device_code --timeout 8" \
  > /tmp/auth-codex.log 2>&1
grep -q "Device code login (headless)" /tmp/auth-codex.log \
  && pass "--prefer device_code elige el método headless" \
  || { fail "no eligió el device code"; sed -n '1,15p' /tmp/auth-codex.log | sed 's/^/    /'; }
grep -qE 'codex/device.*[A-Z0-9]{4,5}-[A-Z0-9]{4,5}' /tmp/auth-codex.log \
  && pass "imprime URL y código de verificación del device code" \
  || { fail "no imprimió URL+código del device code"; sed -n '1,15p' /tmp/auth-codex.log | sed 's/^/    /'; }
if auth_file_has_creds "$AUTH_CODEX_HOME"; then
  fail "el device code incompleto dejó credenciales"
else
  pass "device code incompleto no deja credenciales"
fi
rm -rf "$AUTH_CODEX_HOME"

# 5) set-api-key escribe el esquema que pi acepta (type:"api_key") y migra las entradas viejas.
#    Un type:"key" invalida TODO auth.json porque load() lanza, así que un OAuth correcto de otro
#    proveedor también aparecía como "sin credenciales".
AUTH_SCHEMA_HOME=$(mktemp -d)
mkdir -p "$AUTH_SCHEMA_HOME/.pi/agent"
printf '{"openai":{"type":"oauth","access":"tok","refresh":"ref","expires":9999999999999},"legacy":{"type":"key","key":"sk-legacy"}}\n' \
  > "$AUTH_SCHEMA_HOME/.pi/agent/auth.json"
HOME="$AUTH_SCHEMA_HOME" node "$SRC/scripts/set-api-key.mjs" deepseek sk-fake-schema > /tmp/setkey.log 2>&1
assert_eq "set-api-key exit code" "$?" "0"
grep -q '"type": "api_key"' "$AUTH_SCHEMA_HOME/.pi/agent/auth.json" \
  && pass "set-api-key escribe type=api_key" \
  || fail "set-api-key no escribe el esquema de pi"
grep -q '"type": "key"' "$AUTH_SCHEMA_HOME/.pi/agent/auth.json" \
  && fail "quedó una entrada type:key inválida" \
  || pass "migra las entradas type:key heredadas"
assert_eq "pi lee la key sin invalid_state" \
  "$(HOME="$AUTH_SCHEMA_HOME" pi auth print-api-key --provider deepseek 2>/dev/null)" "sk-fake-schema"
if HOME="$AUTH_SCHEMA_HOME" pi auth check --provider openai --no-refresh --json 2>/dev/null | grep -q '"status":"ready"'; then
  pass "escribir una key no invalida el OAuth de openai"
else
  fail "escribir una key dejó auth.json ilegible para pi"
fi
rm -rf "$AUTH_SCHEMA_HOME"
rm -rf "$AUTH_KEY_HOME" "$AUTH_OAUTH_HOME"

bash "$SRC/tests/docker/assert.sh" "$PROFILE" || FAILS=$((FAILS + 1))

say "resultado"
if [ "$FAILS" -gt 0 ]; then
  printf '\033[31m%d fallo(s)\033[0m\n' "$FAILS"
  exit 1
fi
printf '\033[32mtodo verde\033[0m\n'
