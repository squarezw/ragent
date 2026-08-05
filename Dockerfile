# ---- 构建阶段 ----
FROM node:22-alpine AS builder

WORKDIR /app

# 只拷贝依赖声明，利用缓存
COPY package.json pnpm-lock.yaml ./

# pnpm 版本必须跟着 package.json 的 `packageManager` 走，别装最新的。
#
# 2026-08-05 CI 挂在这里：原来是 `npm install -g pnpm`（不锁版本），于是每次构建
# 装的是**当时**最新的 pnpm。8/3 构建还好，8/5 就红了 —— 中间 pnpm 发了 11.x，
# 它会校验自己的原生二进制在 lockfile 里的记录，而这份 lockfile 是 10.26.2 生成的
# （lockfileVersion 9.0），里面没有那条：
#     Cannot verify the identity of the @pnpm/exe.linux-x64 native binary:
#     it is missing from pnpm-lock.yaml
#
# 仓库一行没改也会某天突然构建失败，而且失败时间取决于上游发版 —— 这类问题最难
# 归因，因为"我什么都没动"是真的。
#
# corepack 直接读 package.json 的 packageManager（含 sha512 校验），所以版本只在
# 一处声明：升级 pnpm 时改 package.json，Dockerfile 不用动、也不会漂。
RUN corepack enable && corepack install

# 安装依赖，使用更快的安装策略
RUN pnpm install --frozen-lockfile --prefer-offline
    # 国内镜像（按需启用）
    # && pnpm config set registry https://mirrors.cloud.tencent.com/npm/

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
