// 支持带扩展名的路径，如 /api/file-preview/file.doc?token=...
// 这个路由会捕获所有 /api/file-preview/*.* 的请求（包括 file.doc, file.pdf 等）
// 同时也支持 /api/file-preview/file?token=... （向后兼容）
import type { NextApiRequest, NextApiResponse } from "next";
import handler from "./file";

export default function fileWithExtensionHandler(req: NextApiRequest, res: NextApiResponse) {
  // 将请求转发到主文件处理函数
  // Next.js 会自动处理路径参数 [filename]，可以通过 req.query.filename 访问
  return handler(req, res);
}
