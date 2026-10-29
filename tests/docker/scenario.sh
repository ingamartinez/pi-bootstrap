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

say "reset --config y recuperación"
"$SRC/bin/pi-bootstrap" reset --config --yes > /tmp/reset.log 2>&1
RC_R=$?
assert_eq "reset exit code" "$RC_R" "0"
if [ -f "$HOME/.pi/agent/settings.json" ]; then fail "reset no borró settings.json"; else pass "settings.json eliminado"; fi
if ls "$HOME/.pi/backups"/pi-bootstrap-reset-* >/dev/null 2>&1; then pass "backup del reset presente"; else fail "reset no dejó backup"; fi
"$SRC/bootstrap.sh" --tiers "${TIERS:-base,tools,shell}" --profile "$PROFILE" --yes --skip-auth > /tmp/recover.log 2>&1
assert_eq "recuperación exit code" "$?" "0"
if [ -f "$HOME/.pi/agent/settings.json" ]; then pass "configuración recuperada"; else fail "la reinstalación no recuperó settings.json"; fi
bash "$SRC/tests/docker/assert.sh" "$PROFILE" || FAILS=$((FAILS + 1))

say "resultado"
if [ "$FAILS" -gt 0 ]; then
  printf '\033[31m%d fallo(s)\033[0m\n' "$FAILS"
  exit 1
fi
printf '\033[32mtodo verde\033[0m\n'
