#!/bin/bash
# 从 master-branch 一键生成 deploy 和 electron 分支
# 用法: bash scripts/generate-branches.sh [deploy|electron|all]

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

MASTER="master-branch"
START_BRANCH=$(git branch --show-current)

log_info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

cleanup() {
  if [ "$(git branch --show-current)" != "$START_BRANCH" ]; then
    log_info "切回 $START_BRANCH"
    git checkout "$START_BRANCH" 2>/dev/null || true
  fi
}
trap cleanup EXIT

check_clean() {
  if [ -n "$(git status --porcelain)" ]; then
    log_error "工作区不干净，请先提交或暂存更改"
    exit 1
  fi
}

generate_deploy() {
  log_info "===== 生成 deploy 分支 ====="

  git checkout "$MASTER"
  git checkout -B deploy

  # 删除 Electron/CI/文档/开发工具
  log_info "删除 Electron/CI/文档/开发工具"
  rm -rf electron/
  rm -f electron-builder.yml
  rm -rf .github/
  rm -f .tmp-reply-body.json README.md README.tmp

  # 修改 .dockerignore: 追加 deploy.sh
  if ! grep -q "^deploy\.sh$" .dockerignore 2>/dev/null; then
    echo "deploy.sh" >> .dockerignore
    log_info ".dockerignore: 追加 deploy.sh"
  fi

  # 从 package.json 移除 Electron 相关字段
  log_info "package.json: 移除 Electron 字段"
  node -e "
    const pkg = require('./package.json');
    delete pkg.main;
    const keep = {};
    for (const [k,v] of Object.entries(pkg.scripts || {})) {
      if (!k.startsWith('electron:')) keep[k] = v;
    }
    pkg.scripts = keep;
    if (pkg.devDependencies) {
      delete pkg.devDependencies.electron;
      delete pkg.devDependencies['electron-builder'];
    }
    require('fs').writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
  "

  # 覆盖 .env.example 为 deploy 版本（无 Electron 配置段）
  log_info ".env.example: 使用 deploy 模板"
  cp templates/deploy/.env.example .env.example

  # 删除开发工具目录
  rm -rf scripts/ templates/

  git add -A
  git commit -m "deploy: 从 master-branch 生成 — 移除 Electron/CI/文档" --allow-empty
  log_info "deploy 分支生成完成 ✅"
}

generate_electron() {
  log_info "===== 生成 electron 分支 ====="

  git checkout "$MASTER"
  git checkout -B electron

  # 先从模板覆盖专属文件（必须在删除循环前，因为 templates/ 后续会被删掉）
  log_info "应用 electron 模板文件"
  cp templates/electron/.env.example .env.example
  cp templates/electron/package.json package.json

  # 只保留 Electron 相关的 5 个文件/目录
  # electron-builder.yml, electron/, package.json, .env.example, .gitignore
  local KEEP="electron-builder.yml electron/ package.json .env.example .gitignore"

  log_info "删除所有非 Electron 文件"
  shopt -s dotglob
  for item in *; do
    [ "$item" = "." ] || [ "$item" = ".." ] || [ "$item" = ".git" ] || [ "$item" = "node_modules" ] && continue
    should_keep=false
    for k in $KEEP; do
      if [ "$item" = "$k" ]; then should_keep=true; break; fi
    done
    if [ "$should_keep" = false ]; then
      rm -rf "$item"
    fi
  done
  shopt -u dotglob

  git add -A
  git commit -m "electron: 从 master-branch 生成 — 纯桌面客户端壳" --allow-empty
  log_info "electron 分支生成完成 ✅"
}

# ========== 主流程 ==========
check_clean

TARGET="${1:-all}"

case "$TARGET" in
  deploy)
    generate_deploy
    ;;
  electron)
    generate_electron
    ;;
  all)
    generate_deploy
    generate_electron
    ;;
  *)
    log_error "用法: bash scripts/generate-branches.sh [deploy|electron|all]"
    exit 1
    ;;
esac

git checkout "$START_BRANCH"
log_info "已切回 $START_BRANCH"
