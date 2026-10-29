#!/usr/bin/env bash
# reset: borra configuración y/o herramientas que instaló pi-bootstrap.
# Nada se borra sin backup previo de la configuración, ni sin --yes.

reset_targets_config() {
  printf '%s\n' \
    "$HOME/.pi/agent/settings.json" \
    "$HOME/.pi/agent/mcp.json" \
    "$HOME/.pi/agent/subagents.json" \
    "$HOME/.pi/agent/keybindings.json" \
    "$HOME/.pi/agent/web-search.json" \
    "$HOME/.pi/gentle-ai/profiles.json" \
    "$HOME/.pi/gentle-ai/models.json" \
    "$HOME/.pi/gentle-ai/channel.json" \
    "$HOME/.pi/gentle-ai/background-subagents.json" \
    "$HOME/.pi/agent/agents"
}

reset_targets_tools() {
  printf '%s\n' \
    "$PREFIX/bin/pi" \
    "$PREFIX/bin/node" \
    "$PREFIX/bin/npm" \
    "$PREFIX/bin/npx" \
    "$PREFIX/bin/gentle-ai" \
    "$PREFIX/bin/engram" \
    "$PREFIX/bin/codegraph" \
    "$PREFIX/bin/gentle-shell" \
    "$PREFIX/node" \
    "$HOME/.pi/agent/install" \
    "$HOME/.pi/agent/npm" \
    "$HOME/.pi/agent/git"
}

reset_targets_shell() {
  printf '%s\n' "$HOME/.gentle-shell"
}

reset_targets_auth() {
  printf '%s\n' \
    "$HOME/.pi/agent/auth.json" \
    "$HOME/.pi/agent/trust.json" \
    "$HOME/.pi/agent/browser-harness.json"
}

reset_backup_config() {
  local dir="$BACKUP_ROOT/pi-bootstrap-reset-$(date +%Y%m%d-%H%M%S)"
  local f any=0
  while IFS= read -r f; do
    [ -e "$f" ] || continue
    mkdir -p "$dir"
    cp -R "$f" "$dir/$(basename "$f")"
    any=1
  done <<EOF
$(reset_targets_config)
EOF
  if [ "$any" = "1" ]; then ok "backup de configuración en $dir"; else log "  (no había configuración que respaldar)"; fi
}

cmd_reset() {
  local do_config=0 do_tools=0 do_shell=0 do_auth=0
  [ "${RESET_CONFIG:-0}" = "1" ] && do_config=1
  [ "${RESET_TOOLS:-0}" = "1" ] && do_tools=1
  [ "${RESET_SHELL:-0}" = "1" ] && do_shell=1
  [ "${RESET_ALL:-0}" = "1" ] && { do_config=1; do_tools=1; do_shell=1; }
  [ "${PURGE_AUTH:-0}" = "1" ] && do_auth=1

  if [ $((do_config + do_tools + do_shell + do_auth)) -eq 0 ]; then
    die "indica qué borrar: --config, --tools, --shell, --all y/o --purge-auth (usa --dry-run para verlo)"
  fi

  step "reset"

  # 1) inventario (no toca nada)
  local list="" f
  while IFS= read -r f; do
    [ -e "$f" ] || [ -L "$f" ] || continue
    list="$list$f
"
  done <<EOF
$(if [ "$do_config" = 1 ]; then reset_targets_config; fi
  if [ "$do_tools" = 1 ]; then reset_targets_tools; fi
  if [ "$do_shell" = 1 ]; then reset_targets_shell; fi
  if [ "$do_auth" = 1 ]; then reset_targets_auth; fi)
EOF

  local count; count=$(printf '%s' "$list" | grep -c . || true)

  log "  configuración: $( [ "$do_config" = 1 ] && echo 'settings, mcp, subagents, keybindings, web-search, gentle-ai, agentes' || echo 'no')"
  log "  herramientas:  $( [ "$do_tools" = 1 ] && echo "binarios en $PREFIX, node pineado, paquetes de pi" || echo 'no')"
  log "  gentle-shell:  $( [ "$do_shell" = 1 ] && echo '~/.gentle-shell' || echo 'no')"
  [ "$do_auth" = 1 ] && warn "credenciales: auth.json, trust.json, browser-harness.json (irreversible)"

  if [ "$DRY_RUN" = "1" ]; then
    printf '%s' "$list" | while IFS= read -r f; do [ -n "$f" ] && log "  borraría $f"; done
    log ""
    log "(--dry-run) $count elemento(s); nada borrado"
    return 0
  fi

  if [ "$count" = "0" ]; then ok "no había nada que borrar"; return 0; fi

  # 2) confirmación explícita (--yes la salta; sin TTY no se asume nada)
  if [ "${ASSUME_YES:-0}" != "1" ]; then
    interactive || die "sin TTY: añade --yes para confirmar, o --dry-run para verlo"
    printf '%s' "$list" | while IFS= read -r f; do [ -n "$f" ] && log "  borraría $f"; done
    confirm "¿Borrar $count elemento(s)? Es irreversible" || { ok "cancelado, no se borró nada"; return 1; }
  fi

  # 3) backup de config ANTES de borrar
  if [ "$do_config" = 1 ]; then reset_backup_config; fi

  # 4) borrado
  printf '%s' "$list" | while IFS= read -r f; do
    [ -n "$f" ] || continue
    log "  borrando $f"
    rm -rf "$f"
  done

  hash -r 2>/dev/null || true
  ok "$count elemento(s) eliminados"
  [ "$do_tools" = 1 ] && log "  el bloque '# >>> pi-bootstrap >>>' de los rc del shell se puede quitar a mano"
  [ "$do_config" = 1 ] && log "  recupera todo con: pi-bootstrap install --profile <perfil> --yes"
  return 0
}
