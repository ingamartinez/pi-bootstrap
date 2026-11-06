#!/usr/bin/env bash
# Prueba en Linux limpio.
#   ./run.sh                 → checkout montado read-only (instala, verifica, idempotencia)
#   MODE=published ./run.sh  → el one-liner real contra el repo publicado
#   MODE=interactive ./run.sh → shell en el contenedor limpio: eliges tú, como un ambiente real
#                                (el instalador es /src/bootstrap.sh, sin flags ni respuestas guionizadas)
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
  interactive)
    # Ambiente real, sin guion: contenedor vacío + el instalador de verdad. Sirve para probar los
    # prompts (ruta de DeepSeek, perfil, método de auth) con un TTY de verdad.
    cat <<'BANNER'

  Contenedor limpio (ubuntu:24.04, usuario dev, nada instalado) con el repo en /src (read-only).

    /src/bootstrap.sh              instalador real: eliges ruta de DeepSeek y perfil
    /src/bootstrap.sh --dry-run    el plan, sin tocar nada
    pi-bootstrap profiles          perfiles disponibles (cuando ya esté instalado)

  Al terminar, `pi` queda en ~/.local/bin. Este shell no lo verá hasta que recargues:
    source ~/.bashrc      (o abre un terminal nuevo)

  El puerto 1455 está publicado y el callback escucha en 0.0.0.0, así que el OAuth de OpenAI
  se completa desde el navegador de tu máquina: al autorizar, la pestaña dice
  "Authentication successful" y la terminal sigue sola. Si pegas la URL a mano (pasa cuando
  el navegador no vuelve), la pestaña mostrará un error: eso es normal, mira la terminal.

  Para salir: exit

BANNER
    exec docker run --rm -it ${platform_args[@]+"${platform_args[@]}"} -v "$repo:/src:ro" \
      -e PI_OAUTH_CALLBACK_HOST=0.0.0.0 -p 127.0.0.1:1455:1455 pi-bootstrap-test ;;
  *) echo "MODE debe ser checkout, published o interactive" >&2; exit 2 ;;
esac
