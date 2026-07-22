/**
 * 读取必填环境变量；缺失时立刻抛错。
 * 密钥类变量禁止代码内默认值——默认值随源码公开后等于无密钥。
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Environment variable ${name} is required but not set (see env.example)`);
  }
  return value;
}
