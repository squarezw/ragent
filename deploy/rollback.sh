#!/bin/bash

# 回滚脚本
# 用法:
#   ./deploy/rollback.sh              # 列出可用版本
#   ./deploy/rollback.sh <commit-sha> # 回滚到指定版本

IMAGE="squarezw/ragent"
COMPOSE_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../docker" && pwd)/docker-compose.yml"

# 无参数时列出可用版本
if [ -z "$1" ]; then
  echo "可用的本地镜像版本:"
  echo ""
  docker images "$IMAGE" --format "table {{.Tag}}\t{{.CreatedAt}}\t{{.Size}}" | head -20
  echo ""
  echo "用法: $0 <tag>"
  echo "示例: $0 abc1234"
  exit 0
fi

TAG="$1"

# 先尝试本地，没有则从 Docker Hub 拉取
if ! docker image inspect "$IMAGE:$TAG" &>/dev/null; then
  echo "本地没有 $IMAGE:$TAG，从 Docker Hub 拉取..."
  if ! docker pull "$IMAGE:$TAG"; then
    echo "拉取失败，请检查 tag 是否正确"
    exit 1
  fi
fi

echo "回滚到 $IMAGE:$TAG ..."

# 更新 docker-compose 使用指定 tag 启动
TAG="$TAG" docker compose -f "$COMPOSE_FILE" up -d web

# docker-compose.yml 里 image 写的是 squarezw/ragent (无tag)，
# 所以需要手动 tag 成 latest 让 compose 识别
docker tag "$IMAGE:$TAG" "$IMAGE:latest"
docker compose -f "$COMPOSE_FILE" up -d web

echo "回滚完成! 当前版本: $TAG"
echo ""
echo "验证: docker ps | grep ragent"
