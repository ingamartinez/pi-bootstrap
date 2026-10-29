#!/usr/bin/env bash
# Prueba en Linux limpio.
#   ./run.sh                 → checkout montado read-only (instala, verifica, idempotencia)
#   MODE=published ./run.sh  → el one-liner real contra el repo publicado
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
profile="${PROFILE:-full-deepseek}"

docker info >/dev/null 2>&1 || {
  echo "el daemon de Docker no está corriendo (abre Docker Desktop y reintenta)" >&2
  exit 1
}

mode="${MODE:-checkout}"
# Permite emular otra arquitectura: PLATFORM=linux/amd64 ./tests/docker/run.sh
platform_args=()
[ -n "${PLATFORM:-}" ] && platform_args=(--platform "$PLATFORM")

docker build -q ${platform_args[@]+"${platform_args[@]}"} -t pi-bootstrap-test "$here"
case "$mode" in
  checkout)  docker run --rm ${platform_args[@]+"${platform_args[@]}"} -v "$repo:/src:ro" -e PROFILE="$profile" \
               pi-bootstrap-test /src/tests/docker/scenario.sh ;;
  published) docker run --rm ${platform_args[@]+"${platform_args[@]}"} -v "$repo:/src:ro" -e PROFILE="$profile" \
               -e PI_BOOTSTRAP_VERSION="${PI_BOOTSTRAP_VERSION:-0.1.0}" \
               pi-bootstrap-test /src/tests/docker/published.sh ;;
  *) echo "MODE debe ser checkout o published" >&2; exit 2 ;;
esac
