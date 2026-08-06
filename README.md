<div align="center">

# Hi Web Talk

**自托管、多模型、支持分支对话的 AI 聊天应用**

[![Version](https://img.shields.io/badge/version-2.1.0-blue.svg)](#)
[![Node](https://img.shields.io/badge/Node.js-%3E%3D22-green.svg)](#)
[![License](https://img.shields.io/badge/license-MIT-lightgrey.svg)](#)

[English](#english) · [中文](#中文)

</div>

---

<a id="中文"></a>

## 中文

Hi Web Talk 是一个自托管的多模型 AI 聊天应用。它可以直接部署成网页，也提供 Windows Electron 桌面版本。对话以可分支的 Block 图保存，适合管理多条思路和不同版本的回答。

### 直接部署成网页

使用 Docker Compose 部署后，通过浏览器访问即可：

```bash
git clone https://github.com/LixFen/hi-web-talk.git
cd hi-web-talk
cp .env.example .env
```

编辑 `.env`，至少设置生产环境使用的 `JWT_SECRET`（长度不少于 16 个字符），然后启动：

```bash
docker compose up -d --build
```

打开 <http://localhost:8787>。数据默认保存在项目下的 `data/` 目录。

LLM API Key **不是启动必需项**。没有 API Key 时服务仍可启动和登录；需要调用模型时，再在网页的模型设置中配置凭证，或设置对应的环境变量，例如 `OPENAI_API_KEY`、`DEEPSEEK_API_KEY`。

### Electron 桌面版本

Electron 支持本地模式和远程模式：

```bash
# 开发：启动 Vite 与 Electron
npm run electron:dev:full

# 连接已经部署好的网页实例
npm run electron:remote

# 构建 Windows 安装包和便携版，输出到 release/
npm run electron:build
```

本地模式会自动启动内置后端，并将数据保存到 Electron 的用户数据目录；远程模式直接连接已有的 Web/Docker 实例。

### 核心功能

- 支持 OpenAI、Anthropic Claude、Google Gemini、DeepSeek、豆包、GLM、KIMI、通义千问及 OpenAI 兼容接口
- 基于 Block 图的分支对话：从任意消息继续、分支或重新生成
- 聊天视图、卡片链视图和图视图
- SSE 流式输出、推理过程展示，以及文件和图片输入
- 对话摘要、上下文适应、历史会话搜索
- 模型和自定义提供商管理，凭证可使用环境变量或本地加密存储
- 用户注册登录、深色模式、中英文界面、响应式布局和 PWA 支持

### 本地开发

要求 Node.js 22 或更高版本。安装依赖后运行：

```bash
npm ci
npm run dev:full
```

开发环境通常使用 <http://localhost:5173>；后端运行在 `8787` 端口。也可以分别运行 `npm run dev` 和 `npm run server`。

### 主要环境变量

| 变量 | 说明 |
|---|---|
| `JWT_SECRET` | 生产环境必填，建议使用随机字符串，长度不少于 16 个字符 |
| `OPENAI_API_KEY`、`DEEPSEEK_API_KEY` 等 | 可选；用于调用对应的 LLM 提供商 |
| `OPENAI_PORT` | 服务端口，默认 `8787` |
| `MODEL_CONFIG_MASTER_KEY` | 可选；用于加密保存模型凭证 |

更多变量和示例见 [.env.example](.env.example)。

### 许可证

本项目基于 [MIT 许可证](LICENSE) 开源。

---

<a id="english"></a>

## English

Hi Web Talk is a self-hosted, multi-model AI chat application. It can be deployed directly as a web app and also provides a Windows Electron desktop version. Conversations are stored as a branching Block graph, making it easy to explore multiple ideas and answer versions.

### Deploy as a web app

Deploy with Docker Compose and open it in a browser:

```bash
git clone https://github.com/LixFen/hi-web-talk.git
cd hi-web-talk
cp .env.example .env
```

Set `JWT_SECRET` in `.env` for production (at least 16 characters), then start the service:

```bash
docker compose up -d --build
```

Open <http://localhost:8787>. Runtime data is stored in the project’s `data/` directory by default.

An LLM API key is **not required to start the application**. The app can start and users can log in without one. Add provider credentials in Model Settings, or set environment variables such as `OPENAI_API_KEY` or `DEEPSEEK_API_KEY` when you want to call a model.

### Electron desktop version

Electron supports both local and remote modes:

```bash
# Development: start Vite and Electron
npm run electron:dev:full

# Connect to an already deployed web instance
npm run electron:remote

# Build Windows installer and portable package into release/
npm run electron:build
```

Local mode starts the bundled backend and stores data in Electron’s user data directory. Remote mode connects directly to an existing Web/Docker instance.

### Core features

- OpenAI, Anthropic Claude, Google Gemini, DeepSeek, Doubao, GLM, KIMI, Qwen, and OpenAI-compatible endpoints
- Block-graph branching conversations: continue, branch, or regenerate from any message
- Chat, Card Chain, and Graph views
- SSE streaming, reasoning display, and file/image inputs
- Conversation summaries, context adaptation, and full-text session search
- Model and custom provider management with environment-based or locally encrypted credentials
- User registration and login, dark mode, Chinese/English UI, responsive layout, and PWA support

### Local development

Requires Node.js 22 or later:

```bash
npm ci
npm run dev:full
```

The development frontend is normally available at <http://localhost:5173>, with the backend on port `8787`. You can also run `npm run dev` and `npm run server` separately.

### Main environment variables

| Variable | Description |
|---|---|
| `JWT_SECRET` | Required in production; use a random string of at least 16 characters |
| `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, etc. | Optional; used to call the corresponding LLM provider |
| `OPENAI_PORT` | Server port, defaulting to `8787` |
| `MODEL_CONFIG_MASTER_KEY` | Optional; encrypts stored model credentials |

See [.env.example](.env.example) for more variables and examples.

### License

This project is released under the [MIT License](LICENSE).
