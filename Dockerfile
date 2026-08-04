# ===== 阶段 1: 构建前端 =====
FROM node:22-bookworm-slim AS builder
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --legacy-peer-deps

COPY . .
RUN npm run build
RUN npm rebuild better-sqlite3
RUN npm prune --omit=dev --ignore-scripts --legacy-peer-deps

# ===== 阶段 2: 运行 =====
FROM node:22-bookworm-slim
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./
COPY --from=builder /app/node_modules ./node_modules

COPY --from=builder /app/dist ./dist
COPY server ./server
COPY --from=builder /app/server/services/modelCapabilities.generated.js ./server/services/modelCapabilities.generated.js

RUN mkdir -p /app/data && chown -R node:node /app/data

USER node
EXPOSE 8787

ENV NODE_ENV=production
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server/index.js"]
