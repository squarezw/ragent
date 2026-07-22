import type { NextApiRequest, NextApiResponse } from "next";
import { getUserIdFromRequest } from "@/lib/auth";
import { getEmbedding } from "@/lib/embeddingService";
import pool from "@/lib/db";

async function fetchEmbedding(text: string, model: string): Promise<number[]> {
  let retryCount = 0;
  const maxRetries = 3;

  while (retryCount < maxRetries) {
    try {
      console.log(`Attempting SOP embedding (attempt ${retryCount + 1}/${maxRetries})`);
      // 动态映射模型到我们的服务
      let embeddingModel: "openai" | "qwen" | "e5" | "aliyun" | "aliyun-v4" | undefined;

      // 如果传入的模型是已知类型，直接使用；否则不传参数，使用默认值
      if (
        model === "openai" ||
        model === "qwen" ||
        model === "e5" ||
        model === "aliyun" ||
        model === "aliyun-v4"
      ) {
        embeddingModel = model;
      }
      // 如果不匹配已知类型，embeddingModel保持undefined，使用默认值
      const embedding = await getEmbedding(text, embeddingModel);
      console.log("SOP embedding successful, length:", embedding.length);
      return embedding;
    } catch (err: any) {
      retryCount++;
      console.error(`SOP embedding failed (attempt ${retryCount}/${maxRetries}):`, {
        error: err,
        message: err?.message,
        response: err?.response?.data,
        status: err?.response?.status,
        code: err?.code,
      });

      if (retryCount >= maxRetries) {
        throw new Error(
          `Embedding failed after ${maxRetries} attempts: ${err?.message || "Unknown error"}`
        );
      }

      // 等待一段时间后重试
      await new Promise((resolve) => setTimeout(resolve, 1000 * retryCount));
    }
  }

  throw new Error("Embedding failed - unexpected end of retry loop");
}

async function vectorizeSubcategory(subcategoryId: number) {
  // 标记子类为 processing
  const client = await pool.connect();
  // 默认使用 aliyun-v4 模型，如果数据库中有配置则使用数据库中的值
  let model = "aliyun-v4";
  try {
    const subRes = await client.query("SELECT embedding_model FROM sop_subcategory WHERE id = $1", [
      subcategoryId,
    ]);
    if (subRes.rows.length > 0 && subRes.rows[0].embedding_model) {
      model = subRes.rows[0].embedding_model;
    }
    await client.query("UPDATE sop_subcategory SET vector_status = $1 WHERE id = $2", [
      "processing",
      subcategoryId,
    ]);
    const detailRes = await client.query(
      "SELECT id, content FROM sop_detail WHERE subcategory_id = $1",
      [subcategoryId]
    );
    for (const row of detailRes.rows) {
      try {
        console.log("Embedding detail", row.id, "content:", row.content);
        const embedding = await fetchEmbedding(row.content, model);
        console.log("Embedding result for detail", row.id, "length:", embedding.length);
        await client.query(
          "UPDATE sop_detail SET embedding = $1, vector_status = $2 WHERE id = $3",
          [embedding, "indexed", row.id]
        );
      } catch (e) {
        console.error("Embedding error for detail", row.id, e);
        await client.query("UPDATE sop_detail SET vector_status = $1 WHERE id = $2", [
          "failed",
          row.id,
        ]);
      }
    }
    await client.query("UPDATE sop_subcategory SET vector_status = $1 WHERE id = $2", [
      "indexed",
      subcategoryId,
    ]);
  } catch (e) {
    console.error("Subcategory vectorize error:", e);
    await client.query("UPDATE sop_subcategory SET vector_status = $1 WHERE id = $2", [
      "failed",
      subcategoryId,
    ]);
  } finally {
    client.release();
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // 检查用户登录
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({ error: "未登录" });
  }

  const client = await pool.connect();
  try {
    const { subcategory_id } = req.body;
    if (!subcategory_id) return res.status(400).json({ error: "Missing subcategory_id" });
    vectorizeSubcategory(Number(subcategory_id)); // 异步执行
    res.status(200).json({ status: "processing" });
  } finally {
    client.release();
  }
}
