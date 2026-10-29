#!/usr/bin/env bash
# Release: el tag y la versión que bootstrap.sh descarga deben ser el mismo número.
# Si no, `curl .../raw/v0.1.1/bootstrap.sh` instalaría silenciosamente el árbol de v0.1.0.
#
#   ./scripts/release.sh 0.1.2
set -euo pipefail

cd "$(dirname "$0")/.."
version="${1:?uso: release.sh <major.minor.patch>}"

case "$version" in
  [0-9]*.[0-9]*.[0-9]*) ;;
  *) echo "versión inválida: $version (esperado X.Y.Z)" >&2; exit 2 ;;
esac

if [ -n "$(git status --porcelain)" ]; then
  echo "hay cambios sin commitear; commitea antes de cortar un release" >&2
  exit 1
fi

sed -i.bak -E "s|^VERSION=\"\\\$\{PI_BOOTSTRAP_VERSION:-[0-9.]+\}\"|VERSION=\"\${PI_BOOTSTRAP_VERSION:-$version}\"|" bootstrap.sh
rm -f bootstrap.sh.bak
grep -q "PI_BOOTSTRAP_VERSION:-$version" bootstrap.sh || { echo "no se pudo fijar la versión" >&2; exit 1; }

git add bootstrap.sh
git commit -q -m "release: v$version"
git tag -a "v$version" -m "v$version"
git push -q origin HEAD "refs/tags/v$version"
echo "publicado v$version"
echo "  curl -fsSL https://github.com/ingamartinez/pi-bootstrap/raw/v$version/bootstrap.sh | sh -s -- --profile hybrid-openai --yes"
