# ===== 阶段 1: 构建前端 =====
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --legacy-peer-deps

COPY . .
RUN npm run build

# ===== 阶段 2: 运行 =====
FROM node:20-alpine
WORKDIR /app

RUN apk add --no-cache tini

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --legacy-peer-deps && npm rebuild better-sqlite3

COPY --from=builder /app/dist ./dist
COPY server ./server
COPY --from=builder /app/server/services/modelCapabilities.generated.js ./server/services/modelCapabilities.generated.js

RUN mkdir -p /app/data && chown -R node:node /app/data

USER node
EXPOSE 8787

ENV NODE_ENV=production
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server/index.js"]
