#!/usr/bin/env bash
set -Eeuo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

VERSAO="0.3.11"
# Mantém a janela aberta, inclusive quando ocorre um erro.
ao_sair() {
  resultado=$?
  echo
  if (( resultado == 0 )); then
    echo "Inicialização finalizada. O contêiner continua rodando ao fechar este terminal."
  else
    echo "A inicialização não foi concluída (código: $resultado)."
  fi
  if [[ -t 0 ]]; then
    read -r -p "Pressione ENTER para fechar esta janela... " _ || true
  else
    echo "Execução sem terminal interativo; consulte as mensagens acima."
  fi
}
trap ao_sair EXIT
trap 'echo; echo "ERRO: falha na linha $LINENO. Verifique as mensagens acima."' ERR

echo "============================================"
echo "  ZimaOS Network Manager — v${VERSAO}"
echo "============================================"
if ! command -v docker >/dev/null 2>&1; then
  echo "ERRO: Docker não está instalado ou não está no PATH."
  exit 1
fi

# Verifica o daemon antes de tentar iniciar. Se faltar apenas permissão,
# usa sudo só para os comandos Docker; não altera grupos do sistema.
DOCKER=(docker)
info_erro=""
if ! info_erro=$(docker info --format '{{.ServerVersion}}' 2>&1); then
  if [[ "$info_erro" == *"permission denied"* || "$info_erro" == *"Permission denied"* ]]; then
    echo
    echo "O usuário atual não tem permissão para acessar o Docker."
    echo "Vou solicitar sua senha de administrador para iniciar o painel."
    if ! command -v sudo >/dev/null 2>&1; then
      echo "ERRO: sudo não encontrado. Instale/configure sudo ou ajuste a permissão do Docker."
      exit 1
    fi
    if ! sudo -v; then
      echo "ERRO: não foi possível obter autorização de administrador."
      exit 1
    fi
    DOCKER=(sudo docker)
    if ! "${DOCKER[@]}" info --format '{{.ServerVersion}}' >/dev/null; then
      echo "ERRO: o Docker não respondeu mesmo com autorização de administrador."
      exit 1
    fi
    echo "Acesso ao Docker autorizado para esta execução."
  else
    echo "ERRO: não foi possível acessar o serviço Docker."
    printf '%s\n' "$info_erro"
    echo "Verifique se o Docker está em execução (ex.: sudo systemctl start docker)."
    exit 1
  fi
fi

if ! "${DOCKER[@]}" compose version >/dev/null 2>&1; then
  echo "ERRO: o plugin Docker Compose não está instalado/disponível."
  exit 1
fi

if [[ ! -f .env ]]; then
  umask 077
  printf 'PANEL_BIND_HOST=127.0.0.1\nPANEL_PORT=8080\n' > .env
  echo "Configuracao inicial criada em .env."
fi

# Evita construir uma imagem com um requirements.txt malformado.
if grep -Fq '\n' requirements.txt; then
  echo "ERRO: requirements.txt contém barras \\n literais em vez de quebras de linha."
  echo "Extraia novamente o ZIP v0.3.11 antes de continuar."
  exit 1
fi

# Versões antigas usavam a pasta como nome do projeto Compose.
# Só para contêineres reconhecidos deste projeto, libera a porta antes da atualização.
legados=$("${DOCKER[@]}" ps --filter 'label=com.docker.compose.service=network-panel' \
  --format '{{.ID}} {{.Label "com.docker.compose.project"}}' 2>/dev/null || true)
while read -r antigo projeto; do
  [[ -n "${antigo:-}" ]] || continue
  case "${projeto:-}" in
    zimaos-network-manager-linux-*)
      echo "Parando contêiner antigo deste projeto ($projeto)..."
      "${DOCKER[@]}" stop "$antigo" >/dev/null
      ;;
  esac
done <<< "$legados"

echo
echo "Iniciando o contêiner..."
# Reconstroi com a base Debian 12 da v0.3.11; evita reutilizar a imagem
# antiga baseada em Debian 13, que continha nmcli 1.52.1.
"${DOCKER[@]}" compose up --build --force-recreate -d

echo
echo "============================================"
echo "  ENDEREÇO DO PAINEL"
PORTA=$(sed -nE 's/^PANEL_PORT=([0-9]+).*$/\1/p' .env | tail -1)
PORTA=${PORTA:-8080}
echo "  http://localhost:${PORTA}"
echo "============================================"
echo "Acesso no computador local; para ZimaOS use o Compose da pasta deploy/."
echo "Imagem v0.3.11: Debian 12 / nmcli 1.42.x (compatível com daemon 1.46 do Zorin)."
echo "Não reinicie o NetworkManager para resolver aviso de diferença de versão."
echo "O padrão é acesso local. No ZimaOS, use o Compose da pasta deploy/."
echo "No primeiro acesso, crie seu usuário e senha no navegador.
O código inicial aparece nos logs abaixo (somente na primeira instalação)."
echo
echo "Status do contêiner:"
"${DOCKER[@]}" compose ps

if command -v curl >/dev/null 2>&1; then
  echo
  echo "Verificando o painel (até 20 segundos)..."
  disponivel=0
  for _ in {1..20}; do
    if curl --silent --fail --max-time 2 "http://127.0.0.1:${PORTA}/api/auth/state" >/dev/null 2>&1; then
      disponivel=1; break
    fi
    sleep 1
  done
  if (( disponivel )); then
    echo "OK: painel disponível em http://localhost:${PORTA}"
  else
    echo "AVISO: painel ainda não respondeu. Verifique os logs abaixo."
  fi
fi

echo
echo "Se for a primeira execução, copie o código de instalação abaixo"
echo "e informe-o na tela de cadastro do painel."
"${DOCKER[@]}" compose logs --tail=28 || true
