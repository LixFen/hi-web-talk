# Contributing

## 分支管理

本项目通过 `master-branch` → `deploy` / `electron` 的单向分支模型管理三种发布形态：

```
master-branch  ─── 所有开发在此进行
    │
    ├── 生成 ──→ deploy   （服务器部署版）
    │
    └── 生成 ──→ electron （桌面客户端版）
```

- **`master-branch`**：完整源码，包含前端、后端、Electron 客户端、CI、Docker 配置。**所有功能开发和 Bug 修复在此进行**。
- **`deploy`**：服务器部署分支。从 master-branch 中移除 Electron 客户端、CI 配置、开发文档等，仅保留服务端和 Web 前端。
- **`electron`**：桌面客户端分支。从 master-branch 中移除服务端、前端源码、CI、Docker 配置等，仅保留 Electron 壳。

### 原则

- **永不**在 `deploy` 或 `electron` 分支上直接开发（部署脚本类除外）。
- 所有修改在 `master-branch` 完成，然后通过生成脚本重建 deploy / electron 分支。
- deploy 和 electron 分支只做减法，不做加法。

## 开发流程

### 日常开发

```bash
git checkout master-branch
# 开发、测试、提交
```

### 发布 deploy / electron 分支

```bash
bash scripts/generate-branches.sh all
```

此脚本会：
1. 从 `master-branch` 创建（或覆盖）`deploy` 和 `electron` 分支
2. 自动应用各分支的专属模板文件
3. 剔除不属于该分支的文件和目录

也可以单独生成：

```bash
bash scripts/generate-branches.sh deploy     # 仅生成 deploy
bash scripts/generate-branches.sh electron   # 仅生成 electron
```

## 分支专属模板

`templates/` 目录存放各分支的专属文件模板。当 master-branch 中这些文件无法直接共用时，在此维护分支版本：

```
templates/
├── deploy/
│   └── .env.example      # deploy 版：完整服务端配置，不含 Electron 段
└── electron/
    ├── .env.example      # electron 版：仅客户端配置
    └── package.json      # electron 版：纯 Electron 项目依赖
```

### 何时修改模板

| 场景 | 操作 |
|------|------|
| `.env` 新增服务端配置项 | 更新 `templates/deploy/.env.example` |
| 升级 Electron 版本 | 更新 `templates/electron/package.json` |
| 新增 Electron 打包配置 | 更新 `templates/electron/package.json` |
| 修改 deploy 的 `package.json` | **无需改模板**，脚本自动从 master-branch 剥离 Electron 字段 |

### 生成脚本行为

**生成 deploy 时：**
1. 删除 `electron/`、`.github/`、`README.md` 等客户端/CI 文件
2. 从 `package.json` 中移除 `"main"`、`electron:*` 脚本、`electron`/`electron-builder` 依赖
3. 用 `templates/deploy/.env.example` 覆盖 `.env.example`
4. 删除开发工具目录（`scripts/`、`templates/`）

**生成 electron 时：**
1. 用 `templates/electron/` 中的 `.env.example` 和 `package.json` 覆盖项目文件
2. 删除除 `electron/`、`electron-builder.yml`、`.env.example`、`.gitignore`、`package.json` 外的所有文件

## 目录约定

| 目录 | 是否进入 deploy | 是否进入 electron | 说明 |
|------|:---:|:---:|------|
| `src/` | ✅ | — | React 前端源码 |
| `server/` | ✅ | — | Express 后端 |
| `electron/` | — | ✅ | Electron 客户端 |
| `templates/` | — | — | 分支模板，仅 master-branch |
| `scripts/` | — | — | 开发工具，仅 master-branch |
| `.github/` | — | — | CI 配置，仅 master-branch |
| `Dockerfile` | ✅ | — | Docker 构建 |
| `nginx.conf` | ✅ | — | Nginx 配置 |
| `deploy.sh` | ✅ | — | 一键部署脚本 |
| `electron-builder.yml` | — | ✅ | Electron 打包配置 |

添加新文件到 `master-branch` 时，确认它是否应该进入 deploy / electron 分支。如需排除，更新 `scripts/generate-branches.sh` 中的删除列表。
