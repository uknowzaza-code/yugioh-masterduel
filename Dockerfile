FROM node:22-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Fetch official ProjectIgnis card database & Lua scripts at build time
RUN mkdir -p data/ygopro \
  && git clone --depth 1 https://github.com/ProjectIgnis/BabelCDB.git data/ygopro/cdb \
  && git clone --depth 1 https://github.com/ProjectIgnis/CardScripts.git data/ygopro/scripts \
  && rm -rf data/ygopro/cdb/.git data/ygopro/scripts/.git

COPY server.js ./
COPY public ./public
COPY src ./src

ENV NODE_ENV=production
ENV PORT=7860

EXPOSE 7860

CMD ["node", "server.js"]
