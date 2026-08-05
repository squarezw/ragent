# ---- 构建阶段 ----
FROM node:22-alpine AS builder

WORKDIR /app

# 安装 pnpm
RUN npm install -g pnpm
    # 国内镜像（按需启用）
    # && pnpm config set registry https://mirrors.cloud.tencent.com/npm/

# 只拷贝依赖声明，利用缓存
#
# pnpm-workspace.yaml 必须一起进来：pnpm 11 起，设置只从这个文件读（package.json 的
# `pnpm` 字段被忽略）。它里面登记着 allowBuilds —— 缺了它，安装会因为"有依赖的构建
# 脚本未评审"直接失败（ERR_PNPM_IGNORED_BUILDS），而且报错不会提示文件没拷进来。
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# 安装依赖，使用更快的安装策略
RUN pnpm install --frozen-lockfile --prefer-offline

# 拷贝全部源码
COPY . .

# 构建 Next.js 产物
RUN pnpm run build

# ---- 生产阶段 ----
FROM node:22-alpine AS runner

WORKDIR /app

# 国内镜像（按需启用）
# RUN sed -i 's|https://dl-cdn.alpinelinux.org|https://mirrors.tencent.com|g' /etc/apk/repositories

# 安装 doc 文档解析所需的系统依赖
RUN apk add --no-cache antiword

# 只拷贝生产依赖和构建产物
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-lock.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/messages ./messages
COPY --from=builder /app/next.config.mjs ./next.config.mjs

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node_modules/.bin/next", "start"]
