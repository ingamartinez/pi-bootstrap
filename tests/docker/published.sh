#!/usr/bin/env bash
# Prueba el camino real del dev: curl | sh contra el repo publicado.
set -uo pipefail

VERSION="${PI_BOOTSTRAP_VERSION:-0.1.0}"
REPO="${PI_BOOTSTRAP_REPO:-https://github.com/ingamartinez/pi-bootstrap}"
PROFILE="${PROFILE:-full-deepseek}"
FAILS=0

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
pass() { printf '  \033[32mok\033[0m %s\n' "$*"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$*"; FAILS=$((FAILS + 1)); }
assert_eq() { if [ "$2" = "$3" ]; then pass "$1 = $3"; else fail "$1: esperado '$3', obtenido '$2'"; fi; }

export PATH="$HOME/.local/bin:$PATH"

say "one-liner publicado"
URL="$REPO/raw/v$VERSION/bootstrap.sh"
printf '  curl -fsSL %s | sh -s -- --profile %s\n' "$URL" "$PROFILE"
curl -fsSL "$URL" | sh -s -- --tiers base,tools --profile "$PROFILE" --yes --skip-auth
RC=$?
assert_eq "exit code" "$RC" "0"

say "el árbol descargado se reutiliza"
assert_eq "cache del tarball" "$([ -f "$HOME/.cache/pi-bootstrap/src/$VERSION/bin/pi-bootstrap" ] && echo si || echo no)" "si"
assert_eq "segunda invocación (sin red nueva)" "$(curl -fsSL "$URL" | sh -s -- --profile "$PROFILE" --yes --skip-auth --dry-run >/dev/null 2>&1; echo $?)" "0"

say "resultado"
[ "$FAILS" -eq 0 ] && { printf '\033[32mtodo verde (camino publicado)\033[0m\n'; exit 0; }
printf '\033[31m%d fallo(s)\033[0m\n' "$FAILS"; exit 1
