#!/usr/bin/env bash
# Pasos del bootstrap. Todos idempotentes: comprobar → instalar → verificar.

# ---------------------------------------------------------------- helpers

mget() { node -e "const m=require('$SRC/manifest.json'); const v=$1; process.stdout.write(typeof v==='string'?v:JSON.stringify(v))"; }
mget_list() { node -e "const m=require('$SRC/manifest.json'); for (const x of $1) console.log(x)"; }

tool_version() {
  # primera versión semver-ish de `<cmd> --version`
  "$1" --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1
}

url_for() {
  # url_for <template> <version> — {arch} usa TOOL_ARCH si el paso lo definió
  printf '%s' "$1" | sed "s/{version}/$2/g; s/{os}/$OS/g; s/{arch}/${TOOL_ARCH:-$ARCH}/g"
}

tool_arch() {
  # tool_arch <id> — el nombre de arquitectura que usa ESE proyecto (Go: amd64, node: x64)
  node -e "const t=require('$SRC/manifest.json').tools['$1']; const m=t.archMap||{}; process.stdout.write(m['$ARCH']||'$ARCH')"
}

# ---------------------------------------------------------------- preflight

preflight() {
  step "preflight"
  detect_platform
  log "  plataforma: $OS/$ARCH"
  [ -n "${HOME:-}" ] || die "HOME no está definido"
  case "$HOME" in /*) ;; *) die "HOME debe ser una ruta absoluta" ;; esac
  have curl || have wget || die "falta curl o wget"
  have tar || die "falta tar"
  have awk || die "falta awk"
  mkdir -p "$CACHE_DIR" "$PREFIX/bin" "$STATE_DIR"
  local free
  free=$(df -Pk "$HOME" | awk 'NR==2{print int($4/1024)}')
  [ "${free:-0}" -ge 500 ] || die "espacio insuficiente en $HOME (${free}MB libres, mínimo 500MB)"
  ok "preflight ok"
}

# ---------------------------------------------------------------- binarios

install_node() {
  local want="$NODE_VERSION"
  if have node; then
    local cur; cur=$(tool_version node)
    if [ "${cur:-0.0.0}" = "$want" ]; then
      ok "node $cur (pin $want) ya instalado"
      return 0
    fi
    if ver_ge "${cur:-0.0.0}" "$want" && [ "$EXACT" != "1" ]; then
      ok "node $cur ≥ pin $want: se reutiliza"
      return 0
    fi
    log "  node $cur ≠ $want: se instala el pin en $PREFIX/node"
  fi

  local sha_var="NODE_SHA_${OS}_${ARCH}"
  local sha; eval "sha=\$$sha_var"
  [ -n "$sha" ] || die "sin sha256 pineado para $OS/$ARCH (revisa manifest.json)"

  local url tarball dir
  url=$(url_for "$NODE_URL_TEMPLATE" "$want")
  tarball="$CACHE_DIR/node-v$want-$OS-$ARCH.tar.gz"
  dir="$PREFIX/node/$want"

  if [ ! -f "$tarball" ] || [ "$(sha256_of "$tarball")" != "$sha" ]; then
    log "  descargando $url"
    fetch "$url" "$tarball"
    [ "$(sha256_of "$tarball")" = "$sha" ] || die "sha256 no coincide para node-$want-$OS-$ARCH"
  else
    log "  cache válida: $tarball"
  fi

  mkdir -p "$dir"
  tar -xzf "$tarball" -C "$dir" --strip-components=1
  for b in node npm npx; do ln -sfn "$dir/bin/$b" "$PREFIX/bin/$b"; done
  ok "node $(tool_version node) → $dir"
}

install_npm_tool() {
  # install_npm_tool <id>
  local id="$1" pkg ver cmd cur
  pkg=$(mget "m.tools['$id'].package") || die "tool desconocido: $id"
  ver=$(mget "m.tools['$id'].version")
  cmd=$(node -e "const m=require('$SRC/manifest.json'); process.stdout.write(m.tools['$id'].exposes[0])")

  if have "$cmd"; then
    cur=$(tool_version "$cmd")
    if [ "${cur:-0.0.0}" = "$ver" ]; then
      ok "$cmd $cur (pin $ver) ya instalado"
      return 0
    fi
    if ver_ge "${cur:-0.0.0}" "$ver" && [ "$EXACT" != "1" ]; then
      ok "$cmd $cur ≥ pin $ver: se reutiliza"
      return 0
    fi
    log "  $cmd $cur ≠ $ver: se instala el pin vía npm"
  fi

  have npm || die "npm no disponible (node debería estar instalado antes)"
  log "  npm install -g --prefix $PREFIX $pkg@$ver"
  npm install -g --prefix "$PREFIX" "$pkg@$ver" >/dev/null 2>&1 || die "falló npm install de $pkg@$ver"
  hash -r 2>/dev/null || true
  have "$cmd" || die "$cmd no quedó en $PREFIX/bin tras instalarlo"
  ok "$cmd $(tool_version "$cmd")"
}

install_tarball_tool() {
  # install_tarball_tool <id>
  local id="$1" ver tpl sha url art cur bin
  ver=$(mget "m.tools['$id'].version")
  tpl=$(mget "m.tools['$id'].url")
  art=$(mget "m.tools['$id'].artifact")
  sha=$(node -e "const m=require('$SRC/manifest.json'); const s=m.tools['$id'].sha256['$OS-$ARCH']; if(!s) process.exit(1); process.stdout.write(s)") \
    || die "sin sha256 pineado para $id en $OS/$ARCH"
  bin="$PREFIX/bin/$art"

  if [ -x "$bin" ]; then
    cur=$(tool_version "$art")
    if [ "${cur:-0.0.0}" = "$ver" ]; then
      ok "$art $cur (pin $ver) ya instalado"
      return 0
    fi
    if ver_ge "${cur:-0.0.0}" "$ver" && [ "$EXACT" != "1" ]; then
      ok "$art $cur ≥ pin $ver: se reutiliza"
      return 0
    fi
    log "  $art $cur ≠ $ver: se instala el pin"
  fi

  TOOL_ARCH=$(tool_arch "$id") || die "no se pudo resolver arquitectura de $id"
  url=$(url_for "$tpl" "$ver")
  local tarball="$CACHE_DIR/$id-$ver-$OS-$TOOL_ARCH.tar.gz"
  if [ ! -f "$tarball" ] || [ "$(sha256_of "$tarball")" != "$sha" ]; then
    log "  descargando $url"
    fetch "$url" "$tarball"
    [ "$(sha256_of "$tarball")" = "$sha" ] || die "sha256 no coincide para $id-$ver-$OS-$TOOL_ARCH"
  else
    log "  cache válida: $tarball"
  fi

  local tmp; tmp=$(mktemp -d)
  tar -xzf "$tarball" -C "$tmp"
  local found; found=$(find "$tmp" -type f -name "$art" | head -1)
  [ -n "$found" ] || die "el tarball de $id no contiene '$art'"
  install -m 0755 "$found" "$bin"
  rm -rf "$tmp"
  hash -r 2>/dev/null || true
  ok "$art $(tool_version "$art")"
}

install_tier_tools() {
  step "binarios pineados"
  # node primero: todo lo demás depende de él
  install_node
  ensure_path
  for tool in $(mget_list "m.tiers['base']"); do
    case "$tool" in
      node) ;;
      pi|codegraph|claude-code) install_npm_tool "$tool" ;;
      gentle-ai|engram) install_tarball_tool "$tool" ;;
      *) warn "tier base: acción desconocida para '$tool'" ;;
    esac
  done
  case ",$TIERS," in
    *",tools,"*)
      for tool in $(mget_list "m.tiers['tools']"); do
        case "$tool" in
          engram|gentle-ai) install_tarball_tool "$tool" ;;
          codegraph) install_npm_tool "$tool" ;;
          *) warn "tier tools: acción desconocida para '$tool'" ;;
        esac
      done
      ;;
  esac
}

install_provider_tools() {
  # El perfil puede exigir el binario de Claude Code
  case " $PROFILE_REQUIRES " in
    *" claude "*)
      step "claude code (requerido por el perfil $PROFILE)"
      install_npm_tool claude-code
      ;;
  esac
}

# ---------------------------------------------------------------- configuración

install_pi_packages() {
  step "paquetes de pi (pineados)"
  local src base name
  for src in $(mget_list "m.pi.packages"); do
    base="$src"
    case "$src" in
      npm:*) base=$(printf '%s' "$src" | sed 's/^npm://; s/@[^@/]*$//') ;;
      git:*) base=$(printf '%s' "$src" | sed 's/^git://; s/#.*$//') ;;
    esac
    if pi list 2>/dev/null | grep -qF "$base"; then
      ok "$base ya instalado"
      continue
    fi
    log "  pi install $src"
    pi install "$src" >/dev/null 2>&1 || warn "pi install falló para $src (se reintentará al abrir pi)"
  done
}

setup_gentle_ai() {
  step "gentle-ai (skills, persona, routing)"
  if [ -f "$HOME/.gentle-ai/state.json" ] && [ "${FORCE:-0}" != "1" ]; then
    ok "gentle-ai ya configurado — sync con --force"
    return 0
  fi
  have gentle-ai || die "gentle-ai no está en PATH"
  local ga_args
  ga_args=$(node -e "
    const g = require('$SRC/manifest.json').gentleAi || {};
    const a = [];
    if (g.agent) a.push('--agent', g.agent);
    if (g.scope) a.push('--scope', g.scope);
    if (g.channel) a.push('--channel', g.channel);
    if (g.preset) a.push('--preset', g.preset);
    if (g.persona) a.push('--persona', g.persona);
    if (Array.isArray(g.components) && g.components.length) a.push('--component', g.components.join(','));
    if (g.piBackgroundSubagents) a.push('--pi-background-subagents=' + g.piBackgroundSubagents);
    process.stdout.write(a.join(' '));
  ") || die "no se pudo leer gentleAi del manifest"
  log "  gentle-ai install $ga_args"
  # Evita que gentle-ai intente instalar engram por su cuenta (brew/go): ya lo pusimos nosotros.
  export GENTLE_AI_ENGRAM_BIN="$PREFIX/bin/engram"
  # shellcheck disable=SC2086  (los valores del manifest no llevan espacios)
  gentle-ai install $ga_args >/dev/null 2>&1 \
    || warn "gentle-ai install devolvió error; corre 'gentle-ai install $ga_args' a mano"
  ok "gentle-ai $(tool_version gentle-ai) configurado"
}

apply_config() {
  step "configuración de pi"
  node "$SRC/scripts/apply-config.mjs"
}

apply_profile() {
  step "perfil de modelos: $PROFILE"
  [ -n "$PROFILE" ] || die "falta --profile (usa: pi-bootstrap profiles para ver la lista)"
  node "$SRC/scripts/apply-profile.mjs" "$PROFILE"
}

install_gentle_shell() {
  # Tier shell: gentle-shell NO viene de gentle-ai, vive en el paquete gentle-pi.
  # Su instalador oficial es un wizard de navegador; `gentle-shell setup` hace lo mismo sin navegador.
  case ",$TIERS," in *",shell,"*) ;; *) return 0 ;; esac

  step "gentle-shell (home aislado)"
  local pi_dir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
  local ver pkg_dir shim
  ver=$(node -e "const m=require('$SRC/manifest.json'); process.stdout.write(m.tools['gentle-shell'].version)")
  pkg_dir="$pi_dir/npm/node_modules/gentle-pi"

  if [ ! -f "$pkg_dir/bin/gentle-shell.mjs" ]; then
    log "  instalando npm:gentle-pi@$ver (provee el binario)"
    pi install "npm:gentle-pi@$ver" >/dev/null 2>&1 || die "no se pudo instalar gentle-pi@$ver"
  fi

  shim="$PREFIX/bin/gentle-shell"
  printf '#!/bin/sh\n# generado por pi-bootstrap: gentle-shell vive en el paquete gentle-pi\nexec node "%s/bin/gentle-shell.mjs" "$@"\n' \
    "$pkg_dir" > "$shim"
  chmod +x "$shim"
  ok "gentle-shell → $shim (paquete gentle-pi)"

  gentle-shell home isolated >/dev/null 2>&1 || true
  # Reutiliza el login de pi: home import-pi nunca sobreescribe
  if [ -f "$HOME/.pi/agent/auth.json" ] && [ ! -f "$HOME/.gentle-shell/agent/auth.json" ]; then
    gentle-shell home import-pi >/dev/null 2>&1 && log "  credenciales y MCP importados de pi"
  fi

  if [ -f "$HOME/.gentle-shell/agent/settings.json" ] && [ "${FORCE:-0}" != "1" ]; then
    ok "gentle-shell ya provisionado (usa --force para re-provisionar)"
    return 0
  fi

  log "  gentle-shell setup (provisiona el home; sin navegador)"
  GENTLE_AI_ENGRAM_BIN="$PREFIX/bin/engram" gentle-shell setup >/dev/null 2>&1 \
    || warn "gentle-shell setup devolvió error; corre 'gentle-shell setup' a mano"
  ok "gentle-shell $(tool_version gentle-shell)"
}

# ---------------------------------------------------------------- auth

auth_ready() {
  # auth_ready <provider>
  pi auth check --provider "$1" --no-refresh --json >/dev/null 2>&1
}

wait_for_auth() {
  # wait_for_auth <provider> <segundos>
  local provider="$1" limit="${2:-300}" waited=0
  while [ "$waited" -lt "$limit" ]; do
    if auth_ready "$provider"; then return 0; fi
    sleep 5; waited=$((waited + 5))
    [ $((waited % 60)) -eq 0 ] && log "  … esperando credenciales de $provider (${waited}s/${limit}s)"
  done
  return 1
}

auth_gate() {
  step "autenticación (paso humano, una sola vez)"
  if [ "${SKIP_AUTH:-0}" = "1" ]; then
    warn "--skip-auth: se omite. Cuando quieras: pi-bootstrap auth"
    return 0
  fi

  local provider
  for provider in $PROFILE_REQUIRES; do
    case "$provider" in
      deepseek)
        if auth_ready deepseek; then ok "deepseek listo"; continue; fi
        if [ -n "${DEEPSEEK_API_KEY:-}" ]; then
          node "$SRC/scripts/set-api-key.mjs" deepseek "$DEEPSEEK_API_KEY"
          ok "deepseek: key tomada de DEEPSEEK_API_KEY"
          continue
        fi
        printf 'Pega tu DEEPSEEK_API_KEY (Enter para saltar): ' >&2
        local key=""; read -r key || key=""
        if [ -n "$key" ]; then
          node "$SRC/scripts/set-api-key.mjs" deepseek "$key"
          ok "deepseek listo"
        else
          warn "deepseek sin credenciales — 'pi-bootstrap auth' cuando la tengas"
        fi
        ;;
      openai)
        if auth_ready openai; then ok "openai listo"; continue; fi
        log "  Se abrirá pi. Dentro escribe: /login  y elige OpenAI."
        if [ -t 0 ] && [ -t 1 ]; then
          pi || true
          if wait_for_auth openai 60; then ok "openai listo"; else warn "openai no quedó autenticado"; fi
        else
          warn "sin TTY: corre 'pi' y luego '/login' (OpenAI)"
        fi
        ;;
      claude)
        if auth_ready claude-bridge; then ok "claude listo"; continue; fi
        have claude || die "falta el binario claude (instala con --profile ... y tier auth:claude)"
        log "  Se abrirá Claude Code. Escribe /login y elige tu cuenta (plan Pro/Max)."
        if [ -t 0 ] && [ -t 1 ]; then
          claude || true
          if wait_for_auth claude-bridge 90; then ok "claude listo"; else warn "claude no quedó autenticado"; fi
        else
          warn "sin TTY: corre 'claude' y luego '/login'"
        fi
        ;;
      *) warn "proveedor desconocido en el perfil: $provider" ;;
    esac
  done
}

# ---------------------------------------------------------------- proyecto

init_project() {
  # init_project <dir>
  local dir="${1:-$PWD}"
  step "preparando el proyecto: $dir"
  if [ ! -f "$dir/AGENTS.md" ]; then
    cp "$SRC/project/AGENTS.md" "$dir/AGENTS.md"
    ok "AGENTS.md creado"
  else
    ok "AGENTS.md ya existe (no se toca)"
  fi
  mkdir -p "$dir/odd/tasks"
  if have codegraph && [ ! -d "$dir/.codegraph" ]; then
    log "  indexando con codegraph (puede tardar)"
    (cd "$dir" && codegraph init >/dev/null 2>&1) || warn "codegraph init falló; reintenta a mano"
  fi
  node "$SRC/scripts/trust-project.mjs" "$dir"
}
