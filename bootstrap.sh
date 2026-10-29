#!/bin/sh
# Entrypoint. Dos modos:
#   1) desde un checkout:  ./bootstrap.sh [opciones]        (usa este árbol)
#   2) por pipe:           curl -fsSL <url>/bootstrap.sh | sh -s -- [opciones]
#
# El modo 2 necesita que el repo sea público y tenga tags: descarga el tarball
# pineado, lo deja en ~/.cache/pi-bootstrap/src/<version> y ejecuta bin/pi-bootstrap.
set -eu

REPO="${PI_BOOTSTRAP_REPO:-https://github.com/ingamartinez/pi-bootstrap}"
VERSION="${PI_BOOTSTRAP_VERSION:-0.1.9}"

# Con `curl ... | sh`, stdin es el propio script y llega agotado. Si hay terminal de control,
# se reabre como stdin del instalador para que los prompts funcionen igual que desde un checkout.
exec_entry() {
    entry="$1"
    shift
    if [ ! -t 0 ] && ( : < /dev/tty ) 2>/dev/null; then
        exec "$entry" "$@" < /dev/tty
    fi
    exec "$entry" "$@"
}

# Hook de desarrollo: ejecutar el árbol local con la misma mecánica que el camino publicado.
if [ -n "${PI_BOOTSTRAP_SRC:-}" ]; then
    [ -f "$PI_BOOTSTRAP_SRC/bin/pi-bootstrap" ] || { printf 'PI_BOOTSTRAP_SRC no tiene bin/pi-bootstrap\n' >&2; exit 1; }
    exec_entry "$PI_BOOTSTRAP_SRC/bin/pi-bootstrap" "$@"
fi

self_dir=""
if [ -f "$0" ]; then
  self_dir=$(CDPATH= cd -P "$(dirname "$0")" && pwd)
fi
if [ -n "$self_dir" ] && [ -f "$self_dir/bin/pi-bootstrap" ]; then
  exec_entry "$self_dir/bin/pi-bootstrap" "$@"
fi

cache="${XDG_CACHE_HOME:-$HOME/.cache}/pi-bootstrap/src/$VERSION"
if [ ! -f "$cache/bin/pi-bootstrap" ]; then
  command -v curl >/dev/null 2>&1 || { printf 'bootstrap: falta curl\n' >&2; exit 1; }
  mkdir -p "$cache"
  printf 'bootstrap: descargando pi-bootstrap %s\n' "$VERSION" >&2
  curl -fsSL "$REPO/archive/refs/tags/v$VERSION.tar.gz" \
    | tar -xz -C "$cache" --strip-components=1
fi

exec_entry "$cache/bin/pi-bootstrap" "$@"
