<div align="center">

# Hi Web Talk

**自托管、多模型、分支对话的 AI 聊天应用**

[![Version](https://img.shields.io/badge/version-1.16.1-blue.svg)](#)
[![Node](https://img.shields.io/badge/Node.js-%3E%3D18-green.svg)](#)
[![License](https://img.shields.io/badge/license-MIT-lightgrey.svg)](#)

[English](#english) · [中文](#中文)

</div>

---

<a id="中文"></a>

## 中文

### ✨ 项目简介

Hi Web Talk 是一个自托管的多模型 AI 聊天应用，灵感来自 Git 的分支模型。对话以**有向图（Block Graph）**的形式存储，支持分支、重新生成和聚焦导航，提供传统线性聊天界面之外的全新交互体验。

### 🖼️ 核心特性

| 特性 | 说明 |
|---|---|
| **多模型支持** | OpenAI、Anthropic Claude、Google Gemini、DeepSeek、豆包、智谱 GLM、KIMI、通义千问，以及任意 OpenAI 兼容接口 |
| **分支对话** | 每条消息是一个 Block（SHA1 寻址），支持从任意节点分支、重新生成，像 Git 一样管理对话 |
| **三种视图** | 聊天视图（流式对话）、卡片链视图（Block 链）、图视图（可视化 Block 树） |
| **SSE 流式响应** | 实时流式输出，支持推理/思考过程展示 |
| **多模态输入** | 支持文件和图片附件上传 |
| **Block 适应系统** | 忽略上下文、偏好摘要、固定摘要、重要/待整理标签 |
| **AI 摘要** | 自动生成对话摘要，支持固定和偏好控制 |
| **会话搜索** | 全文搜索所有历史对话 |
| **用户认证** | JWT 鉴权，注册/登录，首个用户自动成为管理员 |
| **深色模式** | 支持亮色 / 暗色 / 跟随系统 |
| **国际化** | 中文 / English 双语支持 |
| **模型管理** | UI 界面管理模型凭证，支持环境变量或本地加密存储 |
| **提供商管理** | 创建、编辑、删除自定义 LLM 提供商 |
| **桌面客户端** | 基于 Electron 的 Windows 桌面应用 |
| **PWA 支持** | 可安装为渐进式 Web 应用 |
| **响应式设计** | 完美适配桌面和移动端 |

### 🛠️ 技术栈

| 层级 | 技术 |
|---|---|
| **前端** | React 18、React Router 7、Vite 5、Marked、KaTeX、highlight.js、纯 CSS |
| **后端** | Node.js ≥ 18、Express 4、SQLite（better-sqlite3）、WebSocket（ws） |
| **认证** | JWT（jsonwebtoken）、bcryptjs |
| **安全** | helmet、express-rate-limit、Zod 校验 |
| **LLM SDK** | `openai`、`@anthropic-ai/sdk`、`@google/genai` |
| **部署** | Docker Compose、PM2、Nginx |

### 📦 快速开始

#### 环境要求

- **Node.js** ≥ 18（推荐 20，见 `.nvmrc`）
- **npm** ≥ 9

#### 安装与运行

```bash
# 克隆项目
git clone https://github.com/LixFen/hi-web-talk.git
cd hi-web-talk

# 安装依赖
npm ci

# 配置环境变量
cp .env.example .env
# 编辑 .env，填入至少一个 LLM API Key

# 启动开发环境（前端 + 后端）
npm run dev:full
```

启动后访问 http://localhost:8787，首次注册的用户自动成为管理员。

#### 仅启动前端

```bash
npm run dev        # Vite 开发服务器，代理到后端
```

#### 仅启动后端

```bash
npm run server     # Express 服务器
```

### ⚙️ 环境变量

在项目根目录创建 `.env` 文件（参考 `.env.example`）：

| 变量 | 必需 | 默认值 | 说明 |
|---|---|---|---|
| `OPENAI_API_KEY` | 是* | - | OpenAI API 密钥 |
| `DEEPSEEK_API_KEY` | 否 | - | DeepSeek API 密钥 |
| `ANTHROPIC_API_KEY` | 否 | - | Anthropic API 密钥 |
| `GOOGLE_API_KEY` | 否 | - | Google Gemini API 密钥 |
| `DOUBAO_API_KEY` | 否 | - | 豆包 API 密钥 |
| `GLM_API_KEY` | 否 | - | 智谱 GLM API 密钥 |
| `KIMI_API_KEY` | 否 | - | KIMI API 密钥 |
| `QWEN_API_KEY` | 否 | - | 通义千问 API 密钥 |
| `JWT_SECRET` | 是 | `hi-web-talk-jwt-secret-change-in-production` | JWT 签名密钥 |
| `JWT_EXPIRES_IN` | 否 | `7d` | JWT 过期时间 |
| `CORS_ORIGIN` | 是 | `http://localhost:5173` | 允许的 CORS 来源 |
| `OPENAI_PORT` | 否 | `8787` | 服务器端口 |
| `MODEL_CONFIG_MASTER_KEY` | 否 | - | 加密存储 API Key 的主密钥 |

> \* 至少需要配置一个 LLM 提供商的 API Key。

### 🚀 生产部署

#### 方式一：Docker Compose（推荐）

```bash
docker compose up -d --build
```

- 健康检查：`GET /api/health`
- 数据持久化：`./data` 目录挂载到容器内

#### 方式二：PM2

```bash
npm run build       # 构建前端
npm run pm2         # PM2 启动
```

- 进程管理模式，512MB 内存限制
- 日志：`logs/pm2-error.log`、`logs/pm2-out.log`

#### 方式三：一键部署脚本

```bash
bash deploy.sh
```

交互式引导，支持 Docker Compose 或 PM2 部署，自动配置环境变量。

#### Nginx 反向代理

参考 [nginx.conf](nginx.conf) 进行配置，关键点：

- SSE 流式响应需关闭 proxy_buffering
- SPA 路由回退配置
- Gzip 压缩和静态资源缓存

### 📂 项目结构

```
hi-web-talk/
├── server/                  # Express 后端
│   ├── index.js             # 服务入口（路由定义）
│   ├── constants.js         # 提供商定义、默认模型、应用设置
│   ├── lib/                 # 数据库、缓存、校验
│   ├── middleware/          # 认证、校验中间件
│   └── services/            # 业务逻辑
│       └── providerAdapters/  # LLM 提供商适配器
├── src/                     # React 前端
│   ├── components/          # UI 组件
│   ├── contexts/            # React Context 状态管理
│   ├── hooks/               # 自定义 Hooks
│   ├── lib/                 # API 客户端、i18n、工具函数
│   ├── pages/               # 页面组件
│   └── styles/              # 样式文件
├── data/                    # 运行时数据（SQLite、附件等，已 gitignore）
├── docs/                    # 项目文档
├── Dockerfile               # Docker 构建文件
├── docker-compose.yml       # Docker Compose 配置
├── deploy.sh                # 一键部署脚本
└── ecosystem.config.cjs     # PM2 配置
```

### 🔌 支持的 LLM 提供商

| 提供商 | 类型 | 特性 |
|---|---|---|
| **OpenAI** | `openai-responses` | 原生 Responses API，推理强度控制 |
| **OpenAI 兼容** | `openai-chat-completions` | 通用 Chat Completions，兼容 DeepSeek、OpenRouter、本地模型等 |
| **Anthropic Claude** | `anthropic-messages` | Messages API，思维预算控制 |
| **Google Gemini** | `google-generative-ai` | 思考级别控制 |
| **豆包（字节跳动）** | `doubao` | - |
| **智谱 GLM** | `glm` | clear_thinking 支持 |
| **KIMI（月之暗面）** | `kimi` | 思维预算控制 |
| **通义千问（阿里）** | `qwen` | 思维开关 + 预算控制 |

### 📖 分支对话模型

Hi Web Talk 的核心创新是**基于 Block 的分支对话模型**：

1. **Block**：每条消息（用户输入或 AI 回复）都是一个 Block，由 SHA1 哈希唯一标识
2. **分支**：从任意 Block 可以生成新的回复分支，形成有向无环图（DAG）
3. **导航**：三种视图模式帮助用户理解和导航对话树
4. **适应**：每个 Block 可以标记为"忽略上下文"、"偏好摘要"、"固定摘要"等，精细控制上下文构建
5. **摘要**：AI 自动生成 Block 摘要，支持手动固定和偏好设置

```
用户输入 A
  └── AI 回复 B
        ├── AI 回复 C（主线）
        └── AI 回复 D（分支：重新生成）
              └── 用户输入 E（新分支）
                    └── AI 回复 F
```

### 🤝 参与贡献

欢迎贡献代码、报告 Bug 或提出功能建议！

1. Fork 本仓库
2. 创建特性分支：`git checkout -b feature/amazing-feature`
3. 提交更改：`git commit -m 'feat: add amazing feature'`
4. 推送分支：`git push origin feature/amazing-feature`
5. 创建 Pull Request

### 📄 许可证

本项目基于 [MIT 许可证](LICENSE) 开源。

---

<a id="english"></a>

## English

### ✨ Overview

Hi Web Talk is a self-hosted, multi-model AI chat application inspired by Git's branching model. Conversations are stored as a **directed graph of Blocks**, enabling branching, regeneration, and focused navigation — offering a fundamentally different interaction paradigm from traditional linear chat interfaces.

### 🖼️ Key Features

| Feature | Description |
|---|---|
| **Multi-Model Support** | OpenAI, Anthropic Claude, Google Gemini, DeepSeek, Doubao, GLM, KIMI, Qwen, and any OpenAI-compatible endpoint |
| **Branching Conversations** | Each message is a SHA1-addressed Block; branch and regenerate from any point, like Git for conversations |
| **Three View Modes** | Chat view (streaming), Card Chain view (Block chain), Graph view (visual Block tree) |
| **SSE Streaming** | Real-time streaming responses with reasoning/thinking display |
| **Multimodal Input** | File and image attachment support |
| **Block Adaptation** | Ignore context, prefer summary, pin summary, important/review labels |
| **AI Summaries** | Auto-generated block summaries with pin/prefer controls |
| **Session Search** | Full-text search across all conversations |
| **User Auth** | JWT-based authentication; first user becomes admin |
| **Dark Mode** | Light / Dark / System themes |
| **i18n** | Chinese and English localization |
| **Model Management** | UI-based credential management with env var or local encrypted storage |
| **Provider Management** | Create, edit, and delete custom LLM providers |
| **Desktop Client** | Electron-based Windows desktop app |
| **PWA Support** | Installable as a Progressive Web App |
| **Responsive Design** | Desktop and mobile friendly |

### 🛠️ Tech Stack

| Layer | Technologies |
|---|---|
| **Frontend** | React 18, React Router 7, Vite 5, Marked, KaTeX, highlight.js, Pure CSS |
| **Backend** | Node.js ≥ 18, Express 4, SQLite (better-sqlite3), WebSocket (ws) |
| **Auth** | JWT (jsonwebtoken), bcryptjs |
| **Security** | helmet, express-rate-limit, Zod validation |
| **LLM SDKs** | `openai`, `@anthropic-ai/sdk`, `@google/genai` |
| **Deployment** | Docker Compose, PM2, Nginx |

### 📦 Quick Start

#### Prerequisites

- **Node.js** ≥ 18 (recommended: 20, see `.nvmrc`)
- **npm** ≥ 9

#### Install & Run

```bash
# Clone the repository
git clone https://github.com/LixFen/hi-web-talk.git
cd hi-web-talk

# Install dependencies
npm ci

# Configure environment variables
cp .env.example .env
# Edit .env and add at least one LLM API key

# Start full dev environment (frontend + backend)
npm run dev:full
```

Visit http://localhost:8787 — the first registered user automatically becomes admin.

#### Frontend Only

```bash
npm run dev        # Vite dev server with API proxy
```

#### Backend Only

```bash
npm run server     # Express server
```

### ⚙️ Environment Variables

Create a `.env` file at the project root (see `.env.example`):

| Variable | Required | Default | Description |
|---|---|---|---|
| `OPENAI_API_KEY` | Yes* | - | OpenAI API key |
| `DEEPSEEK_API_KEY` | No | - | DeepSeek API key |
| `ANTHROPIC_API_KEY` | No | - | Anthropic API key |
| `GOOGLE_API_KEY` | No | - | Google Gemini API key |
| `DOUBAO_API_KEY` | No | - | Doubao (ByteDance) API key |
| `GLM_API_KEY` | No | - | Zhipu GLM API key |
| `KIMI_API_KEY` | No | - | KIMI (Moonshot) API key |
| `QWEN_API_KEY` | No | - | Qwen (Alibaba) API key |
| `JWT_SECRET` | Yes | `hi-web-talk-jwt-secret-change-in-production` | JWT signing secret |
| `JWT_EXPIRES_IN` | No | `7d` | JWT expiration time |
| `CORS_ORIGIN` | Yes | `http://localhost:5173` | Allowed CORS origins |
| `OPENAI_PORT` | No | `8787` | Server port |
| `MODEL_CONFIG_MASTER_KEY` | No | - | Master key for encrypting stored API keys |

> \* At least one LLM provider API key is required.

### 🚀 Production Deployment

#### Option 1: Docker Compose (Recommended)

```bash
docker compose up -d --build
```

- Health check: `GET /api/health`
- Data persistence: `./data` volume mount

#### Option 2: PM2

```bash
npm run build       # Build frontend
npm run pm2         # Start with PM2
```

- Fork mode, 512MB memory limit
- Logs: `logs/pm2-error.log`, `logs/pm2-out.log`

#### Option 3: One-Click Deploy Script

```bash
bash deploy.sh
```

Interactive guided setup supporting Docker Compose or PM2, with automatic environment configuration.

#### Nginx Reverse Proxy

See [nginx.conf](nginx.conf) for reference. Key points:

- Disable `proxy_buffering` for SSE streaming
- SPA fallback routing
- Gzip compression and static asset caching

### 📂 Project Structure

```
hi-web-talk/
├── server/                  # Express backend
│   ├── index.js             # Server entry (route definitions)
│   ├── constants.js         # Provider definitions, default models, app settings
│   ├── lib/                 # Database, cache, validation
│   ├── middleware/          # Auth & validation middleware
│   └── services/            # Business logic
│       └── providerAdapters/  # LLM provider adapters
├── src/                     # React frontend
│   ├── components/          # UI components
│   ├── contexts/            # React Context state management
│   ├── hooks/               # Custom hooks
│   ├── lib/                 # API client, i18n, utilities
│   ├── pages/               # Page components
│   └── styles/              # Stylesheets
├── data/                    # Runtime data (SQLite, attachments, gitignored)
├── docs/                    # Documentation
├── Dockerfile               # Docker build file
├── docker-compose.yml       # Docker Compose config
├── deploy.sh                # One-click deploy script
└── ecosystem.config.cjs     # PM2 config
```

### 🔌 Supported LLM Providers

| Provider | Type | Features |
|---|---|---|
| **OpenAI** | `openai-responses` | Native Responses API, reasoning effort control |
| **OpenAI Compatible** | `openai-chat-completions` | Generic Chat Completions (DeepSeek, OpenRouter, local models, etc.) |
| **Anthropic Claude** | `anthropic-messages` | Messages API, thinking budget control |
| **Google Gemini** | `google-generative-ai` | Thinking level control |
| **Doubao (ByteDance)** | `doubao` | - |
| **Zhipu GLM** | `glm` | clear_thinking support |
| **KIMI (Moonshot)** | `kimi` | Thinking budget control |
| **Qwen (Alibaba)** | `qwen` | Thinking toggle + budget control |

### 📖 Branching Conversation Model

Hi Web Talk's core innovation is the **Block-based branching conversation model**:

1. **Block**: Each message (user input or AI response) is a Block, uniquely identified by a SHA1 hash
2. **Branching**: New reply branches can be generated from any Block, forming a directed acyclic graph (DAG)
3. **Navigation**: Three view modes help users understand and navigate the conversation tree
4. **Adaptation**: Each Block can be labeled as "ignore context", "prefer summary", "pin summary", etc., for fine-grained context control
5. **Summaries**: AI auto-generates Block summaries with manual pin and prefer controls

```
User Input A
  └── AI Response B
        ├── AI Response C (main thread)
        └── AI Response D (branch: regenerate)
              └── User Input E (new branch)
                    └── AI Response F
```

### 🤝 Contributing

Contributions, bug reports, and feature requests are welcome!

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'feat: add amazing feature'`
4. Push the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

### 📄 License

This project is open source under the [MIT License](LICENSE).
