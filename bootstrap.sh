#!/bin/sh
# Entrypoint. Dos modos:
#   1) desde un checkout:  ./bootstrap.sh [opciones]        (usa este árbol)
#   2) por pipe:           curl -fsSL <url>/bootstrap.sh | sh -s -- [opciones]
#
# El modo 2 necesita que el repo sea público y tenga tags: descarga el tarball
# pineado, lo deja en ~/.cache/pi-bootstrap/src/<version> y ejecuta bin/pi-bootstrap.
set -eu

REPO="${PI_BOOTSTRAP_REPO:-https://github.com/ingamartinez/pi-bootstrap}"
VERSION="${PI_BOOTSTRAP_VERSION:-0.1.6}"

self_dir=""
if [ -f "$0" ]; then
  self_dir=$(CDPATH= cd -P "$(dirname "$0")" && pwd)
fi
if [ -n "$self_dir" ] && [ -f "$self_dir/bin/pi-bootstrap" ]; then
  exec "$self_dir/bin/pi-bootstrap" "$@"
fi

cache="${XDG_CACHE_HOME:-$HOME/.cache}/pi-bootstrap/src/$VERSION"
if [ ! -f "$cache/bin/pi-bootstrap" ]; then
  command -v curl >/dev/null 2>&1 || { printf 'bootstrap: falta curl\n' >&2; exit 1; }
  mkdir -p "$cache"
  printf 'bootstrap: descargando pi-bootstrap %s\n' "$VERSION" >&2
  curl -fsSL "$REPO/archive/refs/tags/v$VERSION.tar.gz" \
    | tar -xz -C "$cache" --strip-components=1
fi

exec "$cache/bin/pi-bootstrap" "$@"
