#!/usr/bin/env bash
# Prueba en Linux limpio: build + escenario (instalar, verificar, idempotencia).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
profile="${PROFILE:-full-deepseek}"

docker info >/dev/null 2>&1 || {
  echo "el daemon de Docker no está corriendo (abre Docker Desktop y reintenta)" >&2
  exit 1
}

docker build -q -t pi-bootstrap-test "$here"
docker run --rm -v "$repo:/src:ro" -e PROFILE="$profile" pi-bootstrap-test /src/tests/docker/scenario.sh
