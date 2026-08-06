# Imagem de produção do gerador de contratos societários.
#
# Debian slim (não Alpine) de propósito: o lightningcss e o LibreOffice têm
# binários nativos, e a variante glibc é a mais previsível para os dois.

# ---------- build ----------
FROM oven/bun:1-debian AS build
WORKDIR /app

COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile

COPY . .
# Alvo é servidor Node em container, não Cloudflare.
ENV NITRO_PRESET=node-server
RUN bun run build

# ---------- runtime ----------
FROM node:22-slim AS runtime
WORKDIR /app

# libreoffice-writer é o que permite aceitar modelos de contrato em .doc
# (Word 97-2003), convertidos para .docx antes do processamento. Sem ele o
# aplicativo continua funcionando, só recusa .doc.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libreoffice-writer \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/.output ./.output

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
EXPOSE 3000

# OPENAI_API_KEY precisa ser injetada em tempo de execução (secret do
# orquestrador), nunca copiada para dentro da imagem.
CMD ["node", ".output/server/index.mjs"]
