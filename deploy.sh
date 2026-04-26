#!/bin/bash
set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# 跨平台 sed -i 兼容
sed_inplace() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "$@"
    else
        sed -i "$@"
    fi
}

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}   Hi Web Talk 一键部署脚本${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# ---------- 1. 拉取最新代码 ----------
echo -e "${YELLOW}[1/4]${NC} 更新代码..."
if git rev-parse --git-dir &>/dev/null; then
    echo "  正在从远程拉取最新代码..."
    if ! git pull; then
        echo -e "${YELLOW}  警告: git pull 失败，使用当前本地代码继续${NC}"
    fi
else
    echo -e "${YELLOW}  当前目录不是 Git 仓库，跳过代码更新${NC}"
fi

# ---------- 2. 配置 .env ----------
if [ ! -f ".env" ]; then
    echo ""
    echo -e "${YELLOW}[2/4]${NC} 未找到 .env 文件，正在引导配置..."

    if [ -f ".env.example" ]; then
        cp .env.example .env
    else
        touch .env
    fi

    # OPENAI_PORT
    read -rp "  服务端口（默认 8787）: " input_port
    PORT="${input_port:-8787}"
    if grep -q "^OPENAI_PORT=" .env 2>/dev/null; then
        sed_inplace "s/^OPENAI_PORT=.*/OPENAI_PORT=${PORT}/" .env
    else
        echo "OPENAI_PORT=${PORT}" >> .env
    fi

    # JWT_SECRET
    if command -v openssl &>/dev/null; then
        DEFAULT_JWT=$(openssl rand -hex 32)
    else
        DEFAULT_JWT=$(head -c 32 /dev/urandom 2>/dev/null | base64 | tr -dc 'a-zA-Z0-9' | head -c 32)
        DEFAULT_JWT="${DEFAULT_JWT:-change-me-$(date +%s)}"
    fi
    read -rp "  JWT_SECRET（直接回车自动生成）: " input_jwt
    JWT_SECRET="${input_jwt:-${DEFAULT_JWT}}"
    if grep -q "^JWT_SECRET=" .env 2>/dev/null; then
        sed_inplace "s/^JWT_SECRET=.*/JWT_SECRET=${JWT_SECRET}/" .env
    else
        echo "JWT_SECRET=${JWT_SECRET}" >> .env
    fi

    # OPENAI_API_KEY
    read -rp "  OPENAI_API_KEY: " OPENAI_API_KEY
    if grep -q "^OPENAI_API_KEY=" .env 2>/dev/null; then
        sed_inplace "s/^OPENAI_API_KEY=.*/OPENAI_API_KEY=${OPENAI_API_KEY}/" .env
    else
        echo "OPENAI_API_KEY=${OPENAI_API_KEY}" >> .env
    fi

    # DEEPSEEK_API_KEY (可选)
    read -rp "  DEEPSEEK_API_KEY（可选，直接回车跳过）: " DEEPSEEK_API_KEY
    if [ -n "$DEEPSEEK_API_KEY" ]; then
        if grep -q "^DEEPSEEK_API_KEY=" .env 2>/dev/null; then
            sed_inplace "s/^DEEPSEEK_API_KEY=.*/DEEPSEEK_API_KEY=${DEEPSEEK_API_KEY}/" .env
        else
            echo "DEEPSEEK_API_KEY=${DEEPSEEK_API_KEY}" >> .env
        fi
    fi

    # MODEL_CONFIG_MASTER_KEY (可选)
    read -rp "  MODEL_CONFIG_MASTER_KEY（可选，用于加密存储的 API Key，直接回车跳过）: " MASTER_KEY
    if [ -n "$MASTER_KEY" ]; then
        if grep -q "^MODEL_CONFIG_MASTER_KEY=" .env 2>/dev/null; then
            sed_inplace "s/^MODEL_CONFIG_MASTER_KEY=.*/MODEL_CONFIG_MASTER_KEY=${MASTER_KEY}/" .env
        else
            echo "MODEL_CONFIG_MASTER_KEY=${MASTER_KEY}" >> .env
        fi
    fi

    # CORS_ORIGIN
    SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
    SERVER_IP="${SERVER_IP:-your-server-ip}"
    read -rp "  服务器公网 IP 或域名（默认 ${SERVER_IP}）: " PUBLIC_IP
    PUBLIC_IP="${PUBLIC_IP:-${SERVER_IP}}"
    if grep -q "^CORS_ORIGIN=" .env 2>/dev/null; then
        sed_inplace "s|^CORS_ORIGIN=.*|CORS_ORIGIN=http://${PUBLIC_IP}:${PORT},http://localhost:5173|" .env
    else
        echo "CORS_ORIGIN=http://${PUBLIC_IP}:${PORT},http://localhost:5173" >> .env
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

# 读取端口
PORT=$(grep "^OPENAI_PORT=" .env 2>/dev/null | cut -d= -f2)
PORT="${PORT:-8787}"

# ---------- 4. 执行部署 ----------
echo ""
echo -e "${YELLOW}[4/4]${NC} 开始部署..."

if [ "$deploy_mode" = "1" ]; then
    # ===== Docker 模式 =====

    # 检查 Docker 命令
    if ! command -v docker &>/dev/null; then
        echo -e "${RED}未检测到 Docker，正在安装...${NC}"
        curl -fsSL https://get.docker.com | bash
        sudo usermod -aG docker "$USER"
        echo -e "${YELLOW}Docker 已安装。请重新登录后再次运行此脚本，或手动执行:${NC}"
        echo "  newgrp docker && bash deploy.sh"
        exit 0
    fi

    # 检查 Docker 守护进程
    if ! docker info &>/dev/null; then
        echo -e "${RED}Docker 守护进程未运行，正在启动...${NC}"
        if command -v systemctl &>/dev/null; then
            sudo systemctl start docker
        elif command -v service &>/dev/null; then
            sudo service docker start
        else
            echo -e "${RED}请手动启动 Docker 后重试${NC}"
            exit 1
        fi
        sleep 2
    fi

    # 检测 Docker Compose 版本
    if docker compose version &>/dev/null; then
        COMPOSE_CMD="docker compose"
    elif command -v docker-compose &>/dev/null; then
        COMPOSE_CMD="docker-compose"
    else
        echo -e "${RED}未检测到 Docker Compose（docker compose 或 docker-compose），请先安装${NC}"
        exit 1
    fi
    echo "  使用: ${COMPOSE_CMD}"

    # 确保 data 目录存在（Docker Compose v1 需要）
    mkdir -p ./data

    # 构建并启动
    echo "  正在构建镜像并启动容器..."
    $COMPOSE_CMD up -d --build --remove-orphans

    # 等待健康检查
    echo -n "  等待服务就绪"
    for i in $(seq 1 30); do
        if curl -sf "http://localhost:${PORT}/api/health" &>/dev/null; then
            echo ""
            echo -e "${GREEN}  服务已就绪！${NC}"
            break
        fi
        echo -n "."
        sleep 2
        if [ "$i" = "30" ]; then
            echo ""
            echo -e "${YELLOW}  服务启动超时，请检查日志: ${COMPOSE_CMD} logs${NC}"
        fi
    done

    # 显示结果
    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}  Docker 部署完成！${NC}"

    FIRST_ORIGIN=$(grep "^CORS_ORIGIN=" .env 2>/dev/null | cut -d= -f2 | cut -d, -f1)
    if [ -n "$FIRST_ORIGIN" ]; then
        echo -e "${GREEN}  访问: ${FIRST_ORIGIN}${NC}"
    else
        echo -e "${GREEN}  访问: http://localhost:${PORT}${NC}"
    fi
    echo -e "${GREEN}========================================${NC}"

    # 防火墙提示
    echo ""
    echo -e "${YELLOW}提示: 确保防火墙已开放端口 ${PORT}:${NC}"
    echo "  sudo ufw allow ${PORT}/tcp    # UFW"
    echo "  sudo firewall-cmd --add-port=${PORT}/tcp --permanent    # firewalld"

elif [ "$deploy_mode" = "2" ]; then
    # ===== PM2 模式 =====

    # 检查 Node.js
    if ! command -v node &>/dev/null; then
        echo -e "${RED}未检测到 Node.js，请先安装 Node.js 20+${NC}"
        echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash"
        echo "  sudo apt-get install -y nodejs"
        exit 1
    fi

    NODE_VER=$(node -v 2>/dev/null | sed 's/v//;s/\..*//')
    if [ "${NODE_VER:-0}" -lt 18 ]; then
        echo -e "${RED}Node.js 版本过低（当前 $(node -v)），需要 >= 18${NC}"
        exit 1
    fi
    echo "  Node.js $(node -v) 已就绪"

    # 检查 better-sqlite3 编译依赖
    echo "  检查编译依赖..."
    MISSING=""
    command -v python3 &>/dev/null || MISSING="${MISSING} python3"
    command -v make &>/dev/null || MISSING="${MISSING} make"
    command -v g++ &>/dev/null || command -v gcc &>/dev/null || MISSING="${MISSING} gcc/g++"
    if [ -n "$MISSING" ]; then
        echo -e "${RED}缺少 better-sqlite3 编译依赖:${MISSING}${NC}"
        echo "  Debian/Ubuntu: sudo apt install build-essential python3"
        echo "  RHEL/CentOS:   sudo yum install gcc-c++ make python3"
        exit 1
    fi
    echo -e "${GREEN}  编译依赖已就绪${NC}"

    echo "  安装项目依赖..."
    npm ci

    echo "  构建前端..."
    npm run build

    echo "  清理开发依赖（节省空间）..."
    npm prune --omit=dev || true

    echo "  启动 PM2..."
    if ! command -v pm2 &>/dev/null; then
        npm install -g pm2 2>/dev/null || {
            echo -e "${YELLOW}全局安装 pm2 失败，尝试使用 npx...${NC}"
            npx -y pm2 start ecosystem.config.cjs
            npx pm2 save
        }
    fi

    if command -v pm2 &>/dev/null; then
        pm2 delete hi-web-talk 2>/dev/null || true
        pm2 start ecosystem.config.cjs
        pm2 save
    fi

    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}  PM2 部署完成！${NC}"

    FIRST_ORIGIN=$(grep "^CORS_ORIGIN=" .env 2>/dev/null | cut -d= -f2 | cut -d, -f1)
    if [ -n "$FIRST_ORIGIN" ]; then
        echo -e "${GREEN}  访问: ${FIRST_ORIGIN}${NC}"
    else
        echo -e "${GREEN}  访问: http://localhost:${PORT}${NC}"
    fi
    echo -e "${GREEN}========================================${NC}"

    # 防火墙提示
    echo ""
    echo -e "${YELLOW}提示: 确保防火墙已开放端口 ${PORT}:${NC}"
    echo "  sudo ufw allow ${PORT}/tcp    # UFW"
    echo "  sudo firewall-cmd --add-port=${PORT}/tcp --permanent    # firewalld"

else
    echo -e "${RED}无效选择，请重新运行脚本。${NC}"
    exit 1
fi

echo ""
echo -e "${YELLOW}提示: 第一个注册的用户自动成为管理员。${NC}"
