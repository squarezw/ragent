import type { NextApiRequest, NextApiResponse } from "next";
import { getUserIdFromRequest } from "@/lib/auth";
import axios from "axios";
import pool from "@/lib/db";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "PUT") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // 检查用户登录
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return res.status(401).json({ error: "未登录" });
    }

    const { segment_id, segment_text } = req.body;

    if (!segment_id || !segment_text) {
      return res.status(400).json({ error: "缺少必要参数" });
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

      // 检查用户是否有权限访问该文件（能访问就能编辑）
      const permissionRes = await client.query(
        "SELECT can_access_knowledge_file($1, $2) as can_access",
        [userId, segment.file_id]
      );

      if (!permissionRes.rows[0]?.can_access) {
        return res.status(403).json({ error: "没有权限编辑此分段" });
      }

      // 更新分段内容
      const updateRes = await client.query(
        "UPDATE knowledge_segments SET segment_text = $1, status = $2 WHERE id = $3 RETURNING *",
        [segment_text, "pending", segment_id]
      );

      // 自动触发向量化
      try {
        // 获取分段记录的 embedding_model
        const segmentModel = segment.embedding_model;
        if (!segmentModel) {
          return res.status(200).json({
            success: true,
            segment: updateRes.rows[0],
            message: "分段内容已更新，但未配置 embedding_model，跳过向量化",
          });
        }

        // 从 embedding_model 中提取模型前缀
        // 例如：aliyun-text-embedding-v2 -> aliyun, e5-large -> e5
        const embeddingModel = segmentModel.split("-")[0];

        // 调用 embedding API
        const EXTERNAL_API_BASE_URL = process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010";
        const embedUrl = `${EXTERNAL_API_BASE_URL}/api/v1/embedding/embed`;

        const vectorizeResponse = await axios.post(
          embedUrl,
          {
            texts: [segment_text],
            model: embeddingModel,
            normalize: true,
            batch_size: 1,
            text_type: "query",
          },
          {
            timeout: 30000,
          }
        );

        if (
          vectorizeResponse.status === 200 &&
          vectorizeResponse.data.embeddings &&
          vectorizeResponse.data.embeddings[0]
        ) {
          // 获取 embedding 向量
          const embedding = vectorizeResponse.data.embeddings[0];
          const vectorString = `[${embedding.join(",")}]`;

          // 更新 knowledge_segments 的 embedding_vector
          await client.query(
            "UPDATE knowledge_segments SET embedding_vector = $1::vector, status = $2 WHERE id = $3",
            [vectorString, "indexed", segment_id]
          );

          return res.status(200).json({
            success: true,
            segment: { ...updateRes.rows[0], status: "indexed" },
            message: "分段内容已更新，向量化完成",
          });
        } else {
          throw new Error("向量化API响应格式无效");
        }
      } catch (vectorizeError) {
        console.error("向量化失败:", vectorizeError);
        // 更新状态为失败
        await client.query("UPDATE knowledge_segments SET status = $1 WHERE id = $2", [
          "failed",
          segment_id,
        ]);
        return res.status(200).json({
          success: true,
          segment: { ...updateRes.rows[0], status: "failed" },
          message: "分段内容已更新，但向量化失败",
        });
      }
    } finally {
      client.release();
    }
  } catch (error) {
    return res.status(500).json({ error: "更新分段失败" });
  }
}
