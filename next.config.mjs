import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["ragent-oss"],
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  webpack: (config, { isServer }) => {
    // 忽略 CLAUDE.md 文件（symlink 在 Docker 中会导致 EINVAL 错误）
    config.watchOptions = {
      ...config.watchOptions,
      ignored: ["**/node_modules/**", "**/CLAUDE.md"],
    };

    if (isServer) {
      // 排除 playwright 和其他测试工具从服务器端打包
      config.externals = config.externals || [];
      config.externals.push({
        "@playwright/test": "commonjs @playwright/test",
        playwright: "commonjs playwright",
        jsdom: "commonjs jsdom",
        "isomorphic-dompurify": "commonjs isomorphic-dompurify",
      });
    }
    return config;
  },
  serverExternalPackages: ["@playwright/test", "playwright", "jsdom", "isomorphic-dompurify"],
};

export default withNextIntl(nextConfig);
