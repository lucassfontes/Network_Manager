#!/usr/bin/env bash
set -Eeuo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

pausar() {
  resultado=$?
  echo
  if [[ -t 0 ]]; then
    read -r -p "Pressione ENTER para fechar esta janela... " _ || true
  fi
  exit "$resultado"
}
trap pausar EXIT

echo "ZimaOS Network Manager — v0.3.9 | Parar contêiner"
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker não encontrado."
  exit 1
fi
DOCKER=(docker)
info_erro=""
if ! info_erro=$(docker info --format '{{.ServerVersion}}' 2>&1); then
  if [[ "$info_erro" == *"permission denied"* || "$info_erro" == *"Permission denied"* ]]; then
    echo "Solicitando autorização para acessar o Docker..."
    if ! command -v sudo >/dev/null 2>&1 || ! sudo -v; then
      echo "Não foi possível obter autorização."
      exit 1
    fi
    DOCKER=(sudo docker)
  else
    echo "$info_erro"
    exit 1
  fi
fi
"${DOCKER[@]}" compose down
echo "Contêiner parado."
