#!/usr/bin/env bash
# Asserts de contenido para el perfil indicado. Lo usa scenario.sh dentro del contenedor.
set -uo pipefail

PROFILE="${1:-full-deepseek}"
SRC=/src
PI_DIR="$HOME/.pi/agent"
GENTLE_DIR="$HOME/.pi/gentle-ai"
FAILS=0

pass() { printf '  \033[32mok\033[0m %s\n' "$*"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$*"; FAILS=$((FAILS + 1)); }
assert_eq() { if [ "$2" = "$3" ]; then pass "$1 = $3"; else fail "$1: esperado '$3', obtenido '$2'"; fi; }

json() { node -e "const v=require('$1'); process.stdout.write(String($2))" 2>/dev/null || echo "__ERR__"; }

# --- binarios ---
assert_eq "node major" "$(node -v | cut -c2-3)" "24"
assert_eq "pi" "$(pi --version 2>/dev/null | head -1)" "1.5.0"
assert_eq "gentle-ai" "$(gentle-ai --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)" "4.3.1"
assert_eq "engram" "$(engram --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)" "3.6.2"
assert_eq "codegraph" "$(codegraph --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)" "1.6.2"

# --- archivos de config ---
for f in "$PI_DIR/settings.json" "$PI_DIR/mcp.json" "$PI_DIR/subagents.json" \
         "$PI_DIR/web-search.json" "$GENTLE_DIR/profiles.json"; do
  if [ -f "$f" ]; then
    if node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" 2>/dev/null; then
      pass "JSON válido: $(basename "$f")"
    else
      fail "JSON inválido: $f"
    fi
  elif [ "$f" = "$PI_DIR/web-search.json" ]; then
    pass "web-search.json ausente (correcto para $PROFILE)"
  else
    fail "falta $f"
  fi
done

# --- agentes ---
assert_eq "agentes .md" "$(ls "$PI_DIR/agents" 2>/dev/null | grep -c '\.md$')" "10"

# --- perfil aplicado ---
assert_eq "subagents.model_profiles" "$(json "$PI_DIR/subagents.json" 'Object.keys(v.model_profiles).length')" "10"
assert_eq "profiles.active" "$(json "$GENTLE_DIR/profiles.json" 'v.active')" "$PROFILE"
assert_eq "profiles[$PROFILE] roles" "$(json "$GENTLE_DIR/profiles.json" "Object.keys(v.profiles['$PROFILE']).length")" "13"

# --- gga fuera del set (gate de pre-commit, opt-in) ---
GA_COMPONENTS=$(node -e "const s=require(process.env.HOME+'/.gentle-ai/state.json'); process.stdout.write((s.components||[]).join(','))" 2>/dev/null || echo "__ERR__")
case "$GA_COMPONENTS" in
  *gga*) fail "gga sigue en los componentes: $GA_COMPONENTS" ;;
  __ERR__) fail "no se pudo leer ~/.gentle-ai/state.json" ;;
  *) pass "gga fuera del set: $GA_COMPONENTS" ;;
esac

# --- coherencia cruzada: cada rol de subagents debe coincidir con el perfil ---
MISMATCH=$(node -e '
const s=require("'"$PI_DIR"'/subagents.json").model_profiles;
const p=require("'"$GENTLE_DIR"'/profiles.json");
const active=p.profiles[p.active];
const bad=Object.entries(s).filter(([role,cfg]) => !active[role] || active[role].model !== cfg.model).map(([r])=>r);
process.stdout.write(bad.join(","));
')
assert_eq "roles desalineados (subagents vs profiles)" "${MISMATCH:-ninguno}" "ninguno"

# --- checks propios del repo ---
if node "$SRC/scripts/apply-profile.mjs" --check "$PROFILE" >/dev/null 2>&1; then
  pass "apply-profile --check"
else
  fail "apply-profile --check (drift de runtime)"
fi
if node "$SRC/scripts/apply-config.mjs" --check >/dev/null 2>&1; then
  pass "apply-config --check"
else
  fail "apply-config --check (drift con config/)"
fi

# --- paquetes de pi ---
NPKG=$(pi list 2>/dev/null | grep -cE '^  (npm|git):')
if [ "${NPKG:-0}" -ge 7 ]; then pass "paquetes de pi instalados: $NPKG"; else fail "paquetes de pi: $NPKG (esperados ≥7)"; fi

# --- tier shell (gentle-shell vive en el paquete gentle-pi, sin wizard) ---
if command -v gentle-shell >/dev/null 2>&1; then
  assert_eq "gentle-shell" "$(gentle-shell --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)" "4.6.0"
  [ -f "$HOME/.gentle-shell/agent/settings.json" ] \
    && pass "gentle-shell: home aislado provisionado" \
    || fail "gentle-shell: falta ~/.gentle-shell/agent/settings.json"
  [ -f "$HOME/.gentle-shell/gentle-ai/persona.json" ] \
    && pass "gentle-shell: persona.json" \
    || fail "gentle-shell: falta persona.json"
else
  fail "gentle-shell no está en PATH (tier shell)"
fi

# --- fuente git pineada (el formato de pin es @<ref>) ---
if pi list 2>/dev/null | grep -q "pi-community-themes"; then
  pass "paquete git pineado instalado (pi-community-themes)"
else
  fail "paquete git pineado no quedó instalado (revisa el formato @<ref>)"
fi

# --- nada del autor debe haberse colado ---
for leaked in "$PI_DIR/browser-harness.json" "$PI_DIR/auth.json"; do
  case "$leaked" in
    *auth.json) [ -f "$leaked" ] && pass "auth.json presente (sin credenciales, correcto con --skip-auth)" ;;
    *) [ -f "$leaked" ] && fail "se coló $(basename "$leaked") del autor" || pass "sin $(basename "$leaked")" ;;
  esac
done

if grep -q "llm-gateway" "$PI_DIR/settings.json" 2>/dev/null; then
  fail "settings.json menciona llm-gateway (config privada del autor)"
else
  pass "sin referencias a llm-gateway"
fi

# sobre una COPIA: mutar el settings.json real rompe el test de idempotencia del escenario.
tol="$(mktemp -d)"
mkdir -p "$tol/agent" "$tol/gentle"
cp "$PI_DIR/settings.json" "$PI_DIR/subagents.json" "$tol/agent/" 2>/dev/null
cp -R "$PI_DIR/agents" "$tol/agent/agents" 2>/dev/null
cp "$(dirname "$PI_DIR")/gentle-ai/profiles.json" "$tol/gentle/" 2>/dev/null
node -e '
const fs=require("fs"); const f=process.argv[1];
const s=JSON.parse(fs.readFileSync(f,"utf8"));
s.theme=s.theme||"catppuccin-mocha"; s.defaultModel="modelo-cambiado-en-la-tui"; s.collapseChangelog=true;
fs.writeFileSync(f, JSON.stringify(s,null,2)+"\n");
' "$tol/agent/settings.json" 2>/dev/null
if PI_CODING_AGENT_DIR="$tol/agent" GENTLE_PI_CONFIG_HOME="$tol/gentle" \
   node "$SRC/scripts/apply-profile.mjs" --check "$1" >/dev/null 2>&1; then
  pass "settings.json tolera escrituras de pi (tema/modelo/changelog)"
else
  fail "settings.json marca drift por escrituras que no son del perfil"
fi
rm -rf "$tol"

# Regresión: el login de Claude se comprueba por ~/.claude/.credentials.json, NO por
# `pi auth check --provider claude-bridge` (ese provider sólo existe con la extensión cargada
# dentro de una sesión de pi, así que jamás respondía ready y el flujo esperaba 90s en vano).
probe_claude_auth() {
  HOME="$1" bash -c ". '$SRC/lib/common.sh'; . '$SRC/lib/steps.sh'; auth_ready claude && echo ready || echo not-ready" 2>/dev/null
}

fake="$(mktemp -d)"
mkdir -p "$fake/.claude"
assert_eq "claude sin credenciales" "$(probe_claude_auth "$fake")" "not-ready"
printf '{"claudeAiOauth":{"accessToken":"t","refreshToken":"r"}}\n' > "$fake/.claude/.credentials.json"
assert_eq "claude con credenciales" "$(probe_claude_auth "$fake")" "ready"
: > "$fake/.claude/.credentials.json"
assert_eq "claude con fichero vacío" "$(probe_claude_auth "$fake")" "not-ready"
rm -rf "$fake"
if grep -q 'wait_for_auth claude-bridge 90' "$SRC/lib/steps.sh"; then
  fail "volvió el wait de 90s contra claude-bridge"
else
  pass "sin espera muerta contra claude-bridge"
fi

exit $([ "$FAILS" -eq 0 ] && echo 0 || echo 1)
