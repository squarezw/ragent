#!/bin/bash

# Docker 启动脚本
# 支持构建和推送镜像

echo "🐳 开始 Docker 部署..."

# 检查是否安装了 Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Docker 未安装，请先安装 Docker"
    exit 1
fi

# 检查是否安装了 Docker Compose
if ! docker compose version &> /dev/null; then
    echo "❌ Docker Compose 未安装或版本过低，请安装 Docker Compose V2"
    echo "💡 提示：Docker Desktop 已包含 Docker Compose V2"
    exit 1
fi

echo "✅ 检测到 Docker Compose V2"

# 解析命令行参数
BUILD=false
PUSH=false
TRAEFIK=false
HAS_BUILD_OR_PUSH=false
while [[ $# -gt 0 ]]; do
    case $1 in
        --build)
            BUILD=true
            HAS_BUILD_OR_PUSH=true
            shift
            ;;
        --push)
            PUSH=true
            HAS_BUILD_OR_PUSH=true
            shift
            ;;
        --traefik)
            TRAEFIK=true
            shift
            ;;
        *)
            echo "⚠️  未知参数: $1"
            shift
            ;;
    esac
done

# 注意：无参数时只拉取镜像并启动，不构建

# 获取项目根目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DOCKER_DIR="$PROJECT_ROOT/docker"

# 进入 docker 目录
echo "📁 进入 docker 目录..."
cd "$DOCKER_DIR"

# 检查是否使用 Traefik 配置
COMPOSE_FILE="docker-compose.yml"
if [ -f "docker-compose-traefik.yml" ] && [ "$TRAEFIK" = true ]; then
    COMPOSE_FILE="docker-compose-traefik.yml"
    echo "✅ 使用 Traefik 配置: $COMPOSE_FILE"
fi

# 检查 docker-compose 文件是否存在
if [ ! -f "$COMPOSE_FILE" ]; then
    echo "❌ $COMPOSE_FILE 文件不存在"
    exit 1
fi

# 如果需要构建，先构建镜像
if [ "$BUILD" = true ]; then
    echo "🔨 构建镜像..."
    if ! docker compose -f "$COMPOSE_FILE" build web; then
        echo "❌ 镜像构建失败"
        exit 1
    fi
    echo "✅ 镜像构建成功"
fi

# 如果需要推送，推送镜像到 Docker Hub
if [ "$PUSH" = true ]; then
    # 从 docker-compose.yml 中提取镜像名称
    IMAGE_NAME=$(grep -E "^[[:space:]]*image:" "$COMPOSE_FILE" | head -1 | sed 's/.*image:[[:space:]]*//' | tr -d '"' | tr -d "'")
    if [ -z "$IMAGE_NAME" ]; then
        echo "❌ 无法从 $COMPOSE_FILE 中提取镜像名称"
        exit 1
    fi
    
    # 处理镜像标签（如果没有标签，默认使用 latest）
    IMAGE_TAG="${IMAGE_NAME##*:}"
    if [ "$IMAGE_TAG" = "$IMAGE_NAME" ]; then
        IMAGE_NAME_WITH_TAG="${IMAGE_NAME}:latest"
    else
        IMAGE_NAME_WITH_TAG="$IMAGE_NAME"
    fi
    
    echo "📤 推送镜像到 Docker Hub: $IMAGE_NAME_WITH_TAG"
    if ! docker push "$IMAGE_NAME_WITH_TAG"; then
        echo "❌ 镜像推送失败"
        exit 1
    fi
    echo "✅ 镜像推送成功"
fi

# 只有在没有 --build 或 --push 参数时才启动服务（无参数时启动，优先使用本地镜像）
if [ "$HAS_BUILD_OR_PUSH" = false ]; then
    # 检查本地是否有镜像，如果没有再拉取
    IMAGE_NAME=$(grep -E "^[[:space:]]*image:" "$COMPOSE_FILE" | head -1 | sed 's/.*image:[[:space:]]*//' | tr -d '"' | tr -d "'")
    if [ -z "$IMAGE_NAME" ]; then
        IMAGE_NAME="squarezw/ragent"
    fi
    
    # 处理镜像标签（如果没有标签，默认使用 latest）
    IMAGE_TAG="${IMAGE_NAME##*:}"
    if [ "$IMAGE_TAG" = "$IMAGE_NAME" ]; then
        IMAGE_NAME_WITH_TAG="${IMAGE_NAME}:latest"
    else
        IMAGE_NAME_WITH_TAG="$IMAGE_NAME"
    fi
    
    # 检查本地是否有镜像
    if docker image inspect "$IMAGE_NAME_WITH_TAG" &>/dev/null; then
        echo "✅ 使用本地镜像: $IMAGE_NAME_WITH_TAG"
    else
        echo "📥 本地没有镜像，拉取最新镜像..."
        docker compose -f "$COMPOSE_FILE" pull web
    fi

    # 启动 web 服务容器
    echo "▶️ 启动服务容器（web + kkfileview）..."
    docker compose -f "$COMPOSE_FILE" up -d

    # 检查启动状态
    if [ $? -eq 0 ]; then
        echo "✅ 服务部署成功！"
        echo ""
        echo "📊 查看容器状态: docker compose -f $COMPOSE_FILE ps"
        echo "📋 查看 web 服务日志: docker compose -f $COMPOSE_FILE logs -f web"
        echo "📋 查看 kkfileview 服务日志: docker compose -f $COMPOSE_FILE logs -f kkfileview"
        echo ""
        echo "🛑 停止所有服务: docker compose -f $COMPOSE_FILE stop"
        echo "🔄 重启所有服务: docker compose -f $COMPOSE_FILE restart"
        echo "🔄 重启 web 服务: docker compose -f $COMPOSE_FILE restart web"
        echo "🔄 重启 kkfileview 服务: docker compose -f $COMPOSE_FILE restart kkfileview"
        echo ""
        echo "🌐 Web 访问地址: http://localhost:3000"
        echo "🌐 kkFileView 访问地址: http://localhost:8012"
    else
        echo "❌ 服务启动失败"
        exit 1
    fi
else
    echo "✅ 操作完成（未启动服务）"
fi
