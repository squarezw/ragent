import { Pool } from "pg";

// 使用 globalThis 缓存，避免热重载时重复创建连接池
declare global {
  // eslint-disable-next-line no-var
  var pgPool: Pool | undefined;
}

// 单例 Pool 实例
let pool: Pool;

if (process.env.NODE_ENV === "production") {
  // 生产环境直接创建
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
} else {
  // 开发环境使用 globalThis 缓存，避免热重载时重复创建
  if (!global.pgPool) {
    global.pgPool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  pool = global.pgPool;
}

// 优雅关闭
process.on("SIGINT", async () => {
  await pool.end();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await pool.end();
  process.exit(0);
});

export default pool;
