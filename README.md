# Hi Web Talk

基于 `React + Vite` 的 AI 对话应用，支持 OpenAI / DeepSeek 多模型，提供三种运行形态：

| 形态 | 分支 | 说明 |
|------|------|------|
| 全栈开发 | `master-branch` | 前端 + 后端 + Electron，开发主分支 |
| 服务器部署 | `deploy` | 纯服务端 + Web 前端，Docker/PM2 一键部署 |
| 桌面客户端 | `electron` | Electron 壳，连接远端服务器 |

## 快速开始（开发）

```bash
npm install
cp .env.example .env
# 编辑 .env 填入 API Key
npm run dev:full
```

浏览器打开 `http://localhost:5173`。

## 部署方式

### 服务器一键部署

```bash
chmod +x deploy.sh
sudo bash deploy.sh
```

自动完成：系统依赖安装 → Node.js 环境 → 项目构建 → Nginx 反向代理 → PM2 进程守护。

### Docker 部署

```bash
docker compose up -d
```

### Electron 桌面客户端

```bash
npm run electron:dev        # 开发运行
npm run electron:build:win  # 打包 Windows
```

客户端连接 `.env` 中配置的 `HI_WEB_TALK_SERVER`。

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `OPENAI_API_KEY` | 否 | OpenAI API 密钥 |
| `DEEPSEEK_API_KEY` | 否 | DeepSeek API 密钥 |
| `JWT_SECRET` | 生产必填 | JWT 签名密钥（长度 ≥ 16） |
| `JWT_EXPIRES_IN` | 否 | JWT 过期时间，默认 `7d` |
| `CORS_ORIGIN` | 否 | 允许的前端来源 |
| `OPENAI_PORT` | 否 | 服务端口，默认 `8787` |
| `HI_WEB_TALK_SERVER` | Electron | 远端服务器地址 |

## 项目结构

```
├── src/                 # React 前端
│   ├── components/      # UI 组件（ChatComposer、MessageList、Sidebar 等）
│   ├── lib/             # API 客户端、Token 存储
│   └── styles/          # 样式文件
├── server/              # Express 后端
│   ├── index.js         # 主入口
│   ├── constants.js     # 常量配置
│   ├── middleware/       # 认证中间件
│   ├── lib/             # 数据库、文件存储
│   ├── services/        # 业务服务（LLM、会话、用户、模型配置）
│   └── scripts/         # 数据迁移脚本
├── electron/            # Electron 桌面客户端
├── templates/           # 分支专属模板文件
│   ├── deploy/          # deploy 分支 .env 模板
│   └── electron/        # electron 分支 .env / package.json 模板
├── scripts/             # 开发工具脚本
├── deploy.sh            # 服务器一键部署
├── Dockerfile
├── docker-compose.yml
├── nginx.conf
└── vite.config.js
```

## 脚本速查

| 命令 | 说明 |
|------|------|
| `npm run dev` | 仅启动 Vite 前端 |
| `npm run server` | 仅启动后端 |
| `npm run dev:full` | 前后端同时启动 |
| `npm run build` | 构建前端静态文件 |
| `npm run start` | 生产模式启动服务端 |
| `npm run pm2` | PM2 进程守护启动 |
| `npm run electron:dev` | Electron 开发模式 |
| `npm run electron:build` | 打包 Electron 应用 |
| `bash deploy.sh` | 服务器一键部署 |
| `bash scripts/generate-branches.sh` | 从 master-branch 生成 deploy / electron 分支 |
