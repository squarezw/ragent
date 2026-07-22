import type { NextApiRequest, NextApiResponse } from "next";
import { getUserIdFromRequest } from "@/lib/auth";
import pool from "@/lib/db";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // 检查用户登录
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return res.status(401).json({ error: "未登录" });
    }

    const { segment_id } = req.body;

    if (!segment_id) {
      return res.status(400).json({ error: "缺少segment_id参数" });
    }

    const client = await pool.connect();

    try {
      // 检查分段是否存在
      const segmentRes = await client.query(
        "SELECT s.*, f.originalname FROM knowledge_segments s JOIN knowledge_files f ON s.file_id = f.id WHERE s.id = $1",
        [segment_id]
      );

      if (segmentRes.rows.length === 0) {
        return res.status(404).json({ error: "分段不存在" });
      }

      const segment = segmentRes.rows[0];

      // 检查用户权限：只能向量化自己上传的文件的分段
      const fileRes = await client.query("SELECT user_id FROM knowledge_files WHERE id = $1", [
        segment.file_id,
      ]);

      if (fileRes.rows.length === 0) {
        return res.status(404).json({ error: "文件不存在" });
      }

      const file = fileRes.rows[0];

      if (file.user_id !== userId) {
        return res.status(403).json({ error: "没有权限向量化此分段" });
      }

      // 更新状态为处理中
      await client.query("UPDATE knowledge_segments SET status = $1 WHERE id = $2", [
        "processing",
        segment_id,
      ]);

      // 这里应该调用实际的向量化服务
      // 暂时模拟向量化过程
      console.log(`开始向量化分段 ${segment_id}`);
      setTimeout(async () => {
        try {
          // 模拟向量化成功
          await client.query("UPDATE knowledge_segments SET status = $1 WHERE id = $2", [
            "indexed",
            segment_id,
          ]);
          console.log(`分段 ${segment_id} 向量化完成`);
        } catch (error) {
          console.error(`分段 ${segment_id} 向量化失败:`, error);
          await client.query("UPDATE knowledge_segments SET status = $1 WHERE id = $2", [
            "failed",
            segment_id,
          ]);
        }
      }, 2000); // 模拟2秒处理时间

      return res.status(200).json({
        success: true,
        message: "向量化已开始",
        status: "processing",
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("向量化失败:", error);
    return res.status(500).json({ error: "向量化失败" });
  }
}
