#!/bin/bash
set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}   Hi Web Talk 一键部署脚本${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# ---------- 1. 环境检查 ----------
if ! command -v node &>/dev/null; then
    echo -e "${RED}未检测到 Node.js，请先安装 Node.js 20+${NC}"
    echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash"
    echo "  sudo apt-get install -y nodejs"
    exit 1
fi

echo -e "${GREEN}[1/4]${NC} Node.js $(node -v) 已就绪"

# ---------- 2. 配置 .env ----------
if [ ! -f ".env" ]; then
    echo ""
    echo -e "${YELLOW}[2/4]${NC} 未找到 .env 文件，正在引导配置..."

    if [ -f ".env.example" ]; then
        cp .env.example .env
    else
        touch .env
    fi

    read -rp "  请输入 JWT_SECRET（直接回车自动生成）: " input_jwt
    JWT_SECRET="${input_jwt:-$(openssl rand -hex 32)}"

    sed -i "s/^JWT_SECRET=.*/JWT_SECRET=${JWT_SECRET}/" .env 2>/dev/null || true

    read -rp "  请输入 OPENAI_API_KEY: " OPENAI_API_KEY
    sed -i "s/^OPENAI_API_KEY=.*/OPENAI_API_KEY=${OPENAI_API_KEY}/" .env 2>/dev/null || true
    if ! grep -q "^OPENAI_API_KEY=" .env 2>/dev/null; then
        echo "OPENAI_API_KEY=${OPENAI_API_KEY}" >> .env
    fi

    read -rp "  请输入 DEEPSEEK_API_KEY（可选，直接回车跳过）: " DEEPSEEK_API_KEY
    if [ -n "$DEEPSEEK_API_KEY" ]; then
        sed -i "s/^DEEPSEEK_API_KEY=.*/DEEPSEEK_API_KEY=${DEEPSEEK_API_KEY}/" .env 2>/dev/null || true
    fi

    SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
    read -rp "  服务器公网 IP（默认 ${SERVER_IP:-your-ip}）: " PUBLIC_IP
    PUBLIC_IP="${PUBLIC_IP:-${SERVER_IP}}"

    sed -i "s|^CORS_ORIGIN=.*|CORS_ORIGIN=http://${PUBLIC_IP}:8787,http://localhost:5173|" .env 2>/dev/null || true
    if ! grep -q "^CORS_ORIGIN=" .env 2>/dev/null; then
        echo "CORS_ORIGIN=http://${PUBLIC_IP}:8787,http://localhost:5173" >> .env
    fi

    echo -e "${GREEN}  .env 配置完成${NC}"
else
    echo -e "${GREEN}[2/4]${NC} .env 已存在，跳过"
fi

# ---------- 3. 选择部署方式 ----------
echo ""
echo -e "${YELLOW}[3/4]${NC} 选择部署方式:"
echo "  1) Docker Compose（推荐，需安装 Docker）"
echo "  2) PM2（直接运行，无需 Docker）"
read -rp "  请输入 1 或 2 [1]: " deploy_mode
deploy_mode="${deploy_mode:-1}"

# ---------- 4. 执行部署 ----------
echo ""
echo -e "${YELLOW}[4/4]${NC} 开始部署..."

if [ "$deploy_mode" = "1" ]; then
    if ! command -v docker &>/dev/null; then
        echo -e "${RED}未检测到 Docker，正在安装...${NC}"
        curl -fsSL https://get.docker.com | bash
        sudo usermod -aG docker "$USER"
        echo -e "${YELLOW}Docker 已安装。请重新登录后再次运行此脚本，或手动执行:${NC}"
        echo "  newgrp docker && bash deploy.sh"
        exit 0
    fi

    docker compose up -d --build
    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}  Docker 部署完成！${NC}"
    echo -e "${GREEN}  访问: http://$(grep CORS_ORIGIN .env 2>/dev/null | head -1 | sed 's/.*http:\/\///;s/:.*//'):8787${NC}"
    echo -e "${GREEN}========================================${NC}"

elif [ "$deploy_mode" = "2" ]; then
    echo "  安装项目依赖..."
    npm ci --omit=dev
    echo "  构建前端..."
    npm run build
    echo "  启动 PM2..."
    npm install -g pm2 2>/dev/null || true
    pm2 start ecosystem.config.cjs
    pm2 save
    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}  PM2 部署完成！${NC}"
    echo -e "${GREEN}  访问: http://服务器IP:8787${NC}"
    echo -e "${GREEN}========================================${NC}"
else
    echo -e "${RED}无效选择，请重新运行脚本。${NC}"
    exit 1
fi

echo ""
echo -e "${YELLOW}提示: 第一个注册的用户自动成为管理员。${NC}"
