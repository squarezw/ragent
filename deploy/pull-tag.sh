#!/usr/bin/env bash
# 按指定 tag 拉取 squarezw/ragent，并重命名为 :latest
# 用途：绕开第三方 registry mirror（xuanyuan.* 等）对 :latest 的缓存

set -euo pipefail

IMAGE="squarezw/ragent"

if [ $# -lt 1 ] || [ -z "${1:-}" ]; then
  cat <<'EOF'
用法: ./pull-tag.sh <tag>

如何获取 tag（三选一，都能拿到最新发布版的短 SHA，7 位）:

1. Docker Hub tags 页面（最直观）:
   https://hub.docker.com/r/squarezw/ragent/tags
   取 "Last pushed" 最新那条非 latest 的 tag（形如 971a4cc）。

2. 本地 git（开发机上 clone 过代码）:
   git fetch origin dev && git rev-parse --short=7 origin/dev

3. CircleCI 构建成功的飞书通知:
   群消息里的 "Version: xxxxxxx" 就是 tag。

示例: ./pull-tag.sh 971a4cc
EOF
  exit 1
fi

TAG="$1"

echo "📥 拉取 ${IMAGE}:${TAG} ..."
docker pull "${IMAGE}:${TAG}"

echo "🏷  重命名为 ${IMAGE}:latest ..."
docker tag "${IMAGE}:${TAG}" "${IMAGE}:latest"

echo ""
echo "✅ 完成。${IMAGE}:latest 现在指向 ${TAG}"
docker image inspect "${IMAGE}:latest" \
  --format '   Image ID : {{.Id}}
   Created  : {{.Created}}'

echo ""
echo "下一步: cd ~/ragent && ./deploy/start-docker.sh"
echo "       （start-docker.sh 检测到本地已有 :latest 会直接复用，不会再去拉）"
