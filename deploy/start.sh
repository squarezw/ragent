#!/bin/bash

# PM2 部署脚本
# 用于构建和启动应用

echo "🚀 开始 PM2 部署..."

# 检查是否安装了 pnpm
if ! command -v pnpm &> /dev/null; then
    echo "❌ pnpm 未安装，正在安装..."
    npm install -g pnpm
    if [ $? -ne 0 ]; then
        echo "❌ pnpm 安装失败，请手动安装：npm install -g pnpm"
        exit 1
    fi
fi

# 检查是否安装了 PM2
if ! command -v pm2 &> /dev/null; then
    echo "❌ PM2 未安装，正在安装..."
    pnpm install -g pm2
fi

# 安装依赖
echo "📦 安装依赖..."
pnpm install

# 构建应用
echo "🔨 构建应用..."
pnpm run build

# 检查构建是否成功
if [ $? -ne 0 ]; then
    echo "❌ 构建失败"
    exit 1
fi

# 停止现有进程（如果存在）
echo "🛑 停止现有进程..."
pm2 stop ragent 2>/dev/null || true
pm2 delete ragent 2>/dev/null || true

# 启动应用
echo "▶️ 启动应用..."
pm2 start pnpm --name ragent -- start

# 检查启动状态
if [ $? -eq 0 ]; then
    echo "✅ 应用启动成功！"
    echo "📊 查看状态: pm2 status"
    echo "📋 查看日志: pm2 logs ragent"
    echo "🔄 重启应用: pm2 restart ragent"
else
    echo "❌ 应用启动失败"
    exit 1
fi 