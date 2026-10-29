# Entorno de prueba: Linux limpio, usuario no-root, sin TTY y sin navegador.
# Si algo del bootstrap esconde un prompt interactivo, aquí se cuelga y falla:
# exactamente lo que queremos detectar antes de tocar la máquina de un dev.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl git tar xz-utils bash coreutils findutils procps \
 && rm -rf /var/lib/apt/lists/*

RUN useradd -m -s /bin/bash dev
USER dev
WORKDIR /home/dev

# El repo se monta read-only en /src: si el bootstrap intenta escribir en el checkout, falla.
ENTRYPOINT ["/bin/bash"]
