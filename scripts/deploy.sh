#!/usr/bin/env bash

clear

set -e

# =========================
# CONFIGURAÇÕES DO PROJETO
# =========================

APP_NAME="gaulke-lovable-contrato-social"
CONTAINER_NAME="gaulke-sc-contrato-lovable"

INTERNAL_PORT="80"
EXTERNAL_PORT="2004"

IMAGE_NAME="${APP_NAME}"
IMAGE_TAG="$(date +%Y%m%d-%H%M%S)"

TAR_DIR="./docker-images"
TAR_FILE="${TAR_DIR}/${IMAGE_NAME}_${IMAGE_TAG}.tar"

DIST_DOCKER_DIR="./dist-docker"

# =========================
# CONFIGURAÇÕES DE PRODUÇÃO
# =========================

PROD_USER="gaulke"
PROD_HOST="192.168.0.204"
PROD_DIR="/home/gaulke/gaulke-lovable-contrato-societario"

# =========================
# EXPORTA PARA DOCKER COMPOSE LOCAL
# =========================

export IMAGE_NAME
export IMAGE_TAG
export CONTAINER_NAME
export INTERNAL_PORT
export EXTERNAL_PORT

# =========================
# INÍCIO
# =========================

echo "=========================================="
echo " App: ${APP_NAME}"
echo " Container: ${CONTAINER_NAME}"
echo " Imagem: ${IMAGE_NAME}:${IMAGE_TAG}"
echo " Porta interna: ${INTERNAL_PORT}"
echo " Porta externa: ${EXTERNAL_PORT}"
echo " Tar: ${TAR_FILE}"
echo " Pasta de envio: ${DIST_DOCKER_DIR}"
echo " Produção: ${PROD_USER}@${PROD_HOST}:${PROD_DIR}"
echo "=========================================="

echo ""
echo "Limpando builds antigos..."
rm -rf dist build .output
rm -rf "${DIST_DOCKER_DIR}"
mkdir -p "${TAR_DIR}"
mkdir -p "${DIST_DOCKER_DIR}"

echo ""
echo "1/6 - Buildando imagem Docker..."
#docker build -t "${IMAGE_NAME}:${IMAGE_TAG}" .
docker build \
  --build-arg ENV_FILE=.env.prod \
  -t "${IMAGE_NAME}:${IMAGE_TAG}" .

echo ""
echo "2/6 - Salvando imagem em TAR..."
docker save -o "${TAR_FILE}" "${IMAGE_NAME}:${IMAGE_TAG}"

echo ""
echo "3/6 - Preparando pasta dist-docker..."
cp "${TAR_FILE}" "${DIST_DOCKER_DIR}/"

cp -f ".env.prod" "${DIST_DOCKER_DIR}/.env.prod"

cat >> "${DIST_DOCKER_DIR}/.env.prod" <<EOF

IMAGE_NAME=${IMAGE_NAME}
IMAGE_TAG=${IMAGE_TAG}
CONTAINER_NAME=${CONTAINER_NAME}
INTERNAL_PORT=${INTERNAL_PORT}
EXTERNAL_PORT=${EXTERNAL_PORT}
EOF

cp -f "docker-compose.yml" "${DIST_DOCKER_DIR}/docker-compose.yml"

cat > "${DIST_DOCKER_DIR}/load-and-up.sh" <<'EOF'
#!/usr/bin/env bash

set -e

echo "=========================================="
echo "Carregando variáveis..."
echo "=========================================="

if [ ! -f .env.prod ]; then
    echo "Arquivo .env.prod não encontrado."
    exit 1
fi

set -a
source .env.prod
set +a

TAR_FILE="$(ls -1 ${IMAGE_NAME}_*.tar | tail -n 1)"

if [ -z "$TAR_FILE" ]; then
    echo "Nenhum arquivo TAR encontrado para ${IMAGE_NAME}."
    exit 1
fi

echo ""
echo "Imagem: ${IMAGE_NAME}:${IMAGE_TAG}"
echo "Container: ${CONTAINER_NAME}"
echo "Porta: ${EXTERNAL_PORT}:${INTERNAL_PORT}"
echo "TAR: ${TAR_FILE}"

echo ""
echo "1/4 - Carregando imagem Docker..."
docker load -i "$TAR_FILE"

echo ""
echo "2/4 - Parando container antigo..."
docker compose --env-file .env.prod down || true

echo ""
echo "3/4 - Subindo container..."
docker compose --env-file .env.prod up -d

echo ""
echo "4/4 - Status:"
docker ps --filter "name=${CONTAINER_NAME}"

echo ""
echo "Logs recentes:"
docker logs --tail=80 "${CONTAINER_NAME}" || true

echo ""
echo "Deploy em produção concluído."
EOF

chmod +x "${DIST_DOCKER_DIR}/load-and-up.sh"

echo ""
echo "4/6 - Subindo container local..."
echo ""
echo ""
read -rp "Deseja subir ou atualizar LOCAL(s/N): " RESPOSTA


if [[ "$RESPOSTA" =~ ^[sS]$ ]]; then
    docker compose down || true
    docker compose up -d

    echo ""
    echo "5/6 - Status local:"
    docker ps --filter "name=${CONTAINER_NAME}"

    echo ""
    echo "Logs recentes local:"
    docker logs --tail=80 "${CONTAINER_NAME}" || true

else
    echo
    echo "........."
    echo "...seguindo..."
fi

echo ""
echo "6/6 - Artefatos gerados:"
echo "${DIST_DOCKER_DIR}/"
ls -lah "${DIST_DOCKER_DIR}"

echo ""
echo "=========================================="
echo "Build local concluído."
echo "Acesse localmente em:"
echo "http://localhost:${EXTERNAL_PORT}"
echo "=========================================="

echo ""
read -rp "Enviar os arquivos para Produção?? Deseja continuar? (s/N): " RESPOSTA

if [[ "$RESPOSTA" =~ ^[sS]$ ]]; then
    echo ""
    echo "Criando pasta em produção..."
    ssh "${PROD_USER}@${PROD_HOST}" "mkdir -p '${PROD_DIR}'"

    echo ""
    echo "Enviando arquivos para produção..."
    rsync -avh --progress "${DIST_DOCKER_DIR}/" "${PROD_USER}@${PROD_HOST}:${PROD_DIR}/"

    echo ""
    read -rp "Executar deploy em Produção agora? (s/N): " RESPOSTA_DEPLOY

    if [[ "$RESPOSTA_DEPLOY" =~ ^[sS]$ ]]; then
        echo ""
        echo "Executando deploy em produção..."
        ssh -t "${PROD_USER}@${PROD_HOST}" "cd '${PROD_DIR}' && ./load-and-up.sh"
    else
        echo ""
        echo "Arquivos enviados, mas deploy em produção não executado."
        echo "Para executar manualmente:"
        echo "ssh ${PROD_USER}@${PROD_HOST}"
        echo "cd ${PROD_DIR}"
        echo "./load-and-up.sh"
    fi
else
    echo ""
    echo "Deploy para produção não executado."
    echo "Imagem gerada em: ${TAR_FILE}"
    echo "Pasta pronta para envio: ${DIST_DOCKER_DIR}"
fi

echo ""
read -rp "Deseja Logar em Produção ??? (s/N): " RESPOSTA

if [[ "$RESPOSTA" =~ ^[sS]$ ]]; then
    ssh -t "${PROD_USER}@${PROD_HOST}" "cd '${PROD_DIR}' && exec bash"
else
    echo ""
    echo "........."
    echo "Processo Concluído"
    rm -rf docker-images
fi
