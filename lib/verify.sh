#!/usr/bin/env bash
# Verificación: lo que convierte el bootstrap en algo confiable.
# Cada check imprime PASS/FAIL; exit 1 si algo falla. `--strict` también falla en WARN.

VERIFY_FAILS=0
VERIFY_WARNS=0

vpass() { printf '  \033[32mPASS\033[0m %s\n' "$*" >&2; }
vfail() { printf '  \033[31mFAIL\033[0m %s\n' "$*" >&2; VERIFY_FAILS=$((VERIFY_FAILS + 1)); }
vwarn() { printf '  \033[33mWARN\033[0m %s\n' "$*" >&2; VERIFY_WARNS=$((VERIFY_WARNS + 1)); }

check_tool() {
  # check_tool <id>
  local id="$1" ver cmd cur
  ver=$(mget "m.tools['$id'].version") || return 0
  cmd=$(node -e "const m=require('$SRC/manifest.json'); const t=m.tools['$id']; process.stdout.write(t.exposes?t.exposes[0]:(t.artifact||''))")
  if ! have "$cmd"; then vfail "$id: '$cmd' no está en PATH"; return 0; fi
  cur=$(tool_version "$cmd")
  if ver_ge "${cur:-0.0.0}" "$ver"; then vpass "$id $cur (pin $ver)"
  else vfail "$id $cur < pin $ver"; fi
}

check_json() {
  # check_json <archivo> [descripción]
  local f="$1" what="${2:-$1}"
  if [ ! -f "$f" ]; then vfail "$what: no existe ($f)"; return 0; fi
  if node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" 2>/dev/null; then
    vpass "$what: JSON válido"
  else
    vfail "$what: JSON inválido"
  fi
}

verify_all() {
  step "verificación"
  local pi_dir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
  local gentle_dir="${GENTLE_PI_CONFIG_HOME:-$HOME/.pi/gentle-ai}"

  log ""
  log "  binarios"
  local ids="node pi gentle-ai"
  case ",$TIERS," in *",tools,"*) ids="$ids engram codegraph" ;; esac
  case " $PROFILE_REQUIRES " in *" claude "*) ids="$ids claude-code" ;; esac
  for id in $ids; do check_tool "$id"; done

  log ""
  log "  configuración"
  check_json "$pi_dir/settings.json" "settings.json"
  check_json "$pi_dir/mcp.json" "mcp.json"
  check_json "$pi_dir/subagents.json" "subagents.json"
  check_json "$gentle_dir/profiles.json" "gentle-pi profiles.json"

  local agents_n
  agents_n=$(ls "$pi_dir/agents" 2>/dev/null | grep -c '\.md$' || true)
  if [ "${agents_n:-0}" -ge 10 ]; then vpass "agentes: $agents_n .md"; else vfail "agentes: $agents_n (esperados 10)"; fi

  if [ -n "$PROFILE" ]; then
    if node "$SRC/scripts/apply-profile.mjs" --check "$PROFILE" >/dev/null 2>&1; then
      vpass "perfil $PROFILE: runtime en sync (subagents + profiles + web-search)"
    else
      vfail "perfil $PROFILE: drift entre subagents.json y profiles.json (corre: pi-bootstrap profile $PROFILE)"
    fi
  else
    vwarn "sin --profile: no se verifica coherencia de perfiles"
  fi

  if node "$SRC/scripts/apply-config.mjs" --check >/dev/null 2>&1; then
    vpass "config en sync con el repo"
  else
    vfail "config en drift con el repo (corre: pi-bootstrap install)"
  fi

  log ""
  log "  pi"
  if pi list >/dev/null 2>&1; then
    local n; n=$(pi list 2>/dev/null | grep -cE '^  (npm|git):' || true)
    if [ "${n:-0}" -ge 7 ]; then vpass "paquetes de pi: $n"; else vwarn "paquetes de pi: $n (esperados ≥7)"; fi
  else
    vfail "pi list falló"
  fi

  log ""
  log "  proveedores del perfil (${PROFILE_REQUIRES:-ninguno})"
  local p
  for p in ${PROFILE_REQUIRES:-}; do
    if auth_ready "$p"; then vpass "$p: credenciales presentes"
    else vwarn "$p: sin credenciales todavía (pi-bootstrap auth)"; fi
  done

  log ""
  if [ "$VERIFY_FAILS" -gt 0 ]; then
    printf '\033[31m%d fallo(s)\033[0m, %d aviso(s)\n' "$VERIFY_FAILS" "$VERIFY_WARNS" >&2
    return 1
  fi
  if [ "${STRICT:-0}" = "1" ] && [ "$VERIFY_WARNS" -gt 0 ]; then
    printf '\033[33m%d aviso(s) en modo estricto\033[0m\n' "$VERIFY_WARNS" >&2
    return 1
  fi
  printf '\033[32mtodo verificado\033[0m (%d aviso(s))\n' "$VERIFY_WARNS" >&2
  return 0
}
