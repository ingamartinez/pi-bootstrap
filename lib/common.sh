#!/usr/bin/env bash
# Utilidades comunes. Compatible con bash 3.2 (macOS): sin arrays asociativos ni mapfile.

PREFIX="${PI_BOOTSTRAP_PREFIX:-$HOME/.local}"
# EXACT=1 (lo usa `upgrade --rollback`) obliga a dejar la versión EXACTA del pin,
# incluso si la instalada es más nueva: sin esto un rollback restaura los pins pero no baja binarios.
EXACT="${PI_BOOTSTRAP_EXACT:-0}"
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/pi-bootstrap"
STATE_DIR="$HOME/.pi-bootstrap"
BACKUP_ROOT="$HOME/.pi/backups"

log()  { printf '%s\n' "$*" >&2; }
step() { printf '\n\033[1m▸ %s\033[0m\n' "$*" >&2; }
warn() { printf '\033[33m⚠ %s\033[0m\n' "$*" >&2; }
ok()   { printf '\033[32m✔ %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[31m✖ %s\033[0m\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

# El bootstrap corre sin node en la primera pasada: nada de esto puede depender de él.
detect_platform() {
  case "$(uname -s)" in
    Darwin) OS=darwin ;;
    Linux)  OS=linux ;;
    *) die "sistema no soportado: $(uname -s) (sólo macOS y Linux)" ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64) ARCH=x64 ;;
    arm64|aarch64) ARCH=arm64 ;;
    *) die "arquitectura no soportada: $(uname -m)" ;;
  esac
  export OS ARCH
}

sha256_of() {
  if have shasum; then shasum -a 256 "$1" | awk '{print $1}'
  elif have sha256sum; then sha256sum "$1" | awk '{print $1}'
  else die "no hay shasum ni sha256sum para verificar descargas"
  fi
}

# Compara versiones semver de 3 campos: ver_ge 24.21.0 22.19.0 → 0 (cierto)
ver_ge() {
  awk -v a="$1" -v b="$2" 'BEGIN{
    sub(/^v/,"",a); sub(/^v/,"",b);
    split(a,x,"."); split(b,y,".");
    for(i=1;i<=3;i++){ if (x[i]+0 > y[i]+0) exit 0; if (x[i]+0 < y[i]+0) exit 1 }
    exit 0
  }'
}

# PATH del proceso + persistencia idempotente en los rc del shell.
ensure_path() {
  case ":$PATH:" in
    *":$PREFIX/bin:"*) ;;
    *) PATH="$PREFIX/bin:$PATH"; export PATH ;;
  esac
  local marker="# >>> pi-bootstrap >>>"
  for rc in "$HOME/.zprofile" "$HOME/.profile" "$HOME/.bashrc"; do
    [ "$rc" = "$HOME/.bashrc" ] && [ ! -f "$rc" ] && continue
    if [ -f "$rc" ] && grep -qF "$marker" "$rc" 2>/dev/null; then continue; fi
    # ~/.zprofile sólo si el shell por defecto es zsh; si no, ya está ~/.profile
    if [ "$rc" = "$HOME/.zprofile" ] && [ "${SHELL##*/}" != "zsh" ]; then continue; fi
    { printf '\n%s\ncase ":$PATH:" in *":%s/bin:"*) ;; *) PATH="%s/bin:$PATH" ;; esac\nexport PATH\n' \
        "$marker" "$PREFIX" "$PREFIX"; } >> "$rc"
    log "PATH añadido a $rc"
  done
}

fetch() {
  # fetch <url> <destino>
  mkdir -p "$(dirname "$2")"
  if have curl; then curl -fsSL --retry 3 --connect-timeout 15 "$1" -o "$2"
  elif have wget; then wget -q -O "$2" "$1"
  else die "no hay curl ni wget"
  fi
}

backup_file() {
  # backup_file <ruta>
  [ -e "$1" ] || return 0
  local dir="$BACKUP_ROOT/pi-bootstrap-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$dir"
  cp -R "$1" "$dir/$(basename "$1")"
  log "backup: $1 → $dir/$(basename "$1")"
}

manifest_get() {
  # manifest_get <expr JS sobre el objeto m>  — requiere node (post-instalación)
  node -e "const m=require('$SRC/manifest.json'); const v=$1; console.log(typeof v==='string'?v:JSON.stringify(v))"
}

# ¿podemos preguntar? Sólo con stdin y stdout de terminal.
# PI_BOOTSTRAP_ASSUME_TTY=1 fuerza "sí hay terminal" para poder probar los prompts con respuestas
# pipeadas (hook de test; no usar en producción).
# Con `curl ... | sh` stdin es el script: se pregunta igual si hay terminal de control (/dev/tty).
tty_available() { ( : < /dev/tty ) 2>/dev/null; }

interactive() {
  [ "${ASSUME_YES:-0}" = "1" ] && return 1
  [ "${PI_BOOTSTRAP_ASSUME_TTY:-0}" = "1" ] && return 0
  [ -t 1 ] || return 1
  [ -t 0 ] && return 0
  tty_available
}

prompt_read() {
  # prompt_read <nombre-de-variable>
  # Hook de test: con ASSUME_TTY las respuestas vienen pipeadas por stdin (no hay /dev/tty).
  if [ "${PI_BOOTSTRAP_ASSUME_TTY:-0}" = "1" ]; then read -r "$1" || return 1; return 0; fi
  if [ -t 0 ]; then read -r "$1" || return 1
  elif tty_available; then read -r "$1" < /dev/tty || return 1
  else return 1; fi
}

confirm() {
  # confirm <pregunta>: 0 = sí, 1 = no.
  # --yes ⇒ sí sin preguntar. Sin TTY y sin --yes ⇒ NO (nunca se asume un sí).
  [ "${ASSUME_YES:-0}" = "1" ] && return 0
  interactive || return 1
  printf '%s [s/N] ' "$1" >&2
  local reply=""
  prompt_read reply || reply=""
  case "$reply" in s|S|si|sí|y|Y|yes) return 0 ;; *) return 1 ;; esac
}

ask_yes_no() {
  # ask_yes_no <pregunta> <default: s|n>
  local def="$2" prompt
  [ "${ASSUME_YES:-0}" = "1" ] && { [ "$def" = "s" ]; return; }
  interactive || { [ "$def" = "s" ]; return; }
  if [ "$def" = "s" ]; then prompt="$1 [S/n] "; else prompt="$1 [s/N] "; fi
  printf '%s' "$prompt" >&2
  local reply=""; prompt_read reply || reply=""
  [ -z "$reply" ] && { [ "$def" = "s" ]; return; }
  case "$reply" in s|S|si|sí|y|Y|yes) return 0 ;; *) return 1 ;; esac
}
