import { NextApiRequest, NextApiResponse } from "next";
import { requireAuth } from "@/lib/auth";
import axios from "@/lib/axios";
import pool from "@/lib/db";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // 验证认证
    if (!requireAuth(req, res)) {
      return;
    }

    const { query, limit = 20, embedding_status, model } = req.body;

    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "Query is required and must be a string" });
    }

    // 获取模型：优先使用请求参数，否则使用默认值 aliyun-v4
    const embeddingModel = model || "aliyun-v4";

    // 获取查询文本的embedding
    const embedding = await getQueryEmbedding(query, embeddingModel);
    if (!embedding) {
      return res.status(500).json({ error: "Failed to get query embedding" });
    }

    // 将JavaScript数组转换为PostgreSQL向量格式
    const vectorString = `[${embedding.join(",")}]`;

    // 构建搜索查询
    let searchQuery = `
      SELECT 
        p.id,
        p.sn,
        p.name,
        p.category,
        p.material,
        p.spec,
        p.description,
        p.memo,
        p.embedding_status,
        p.embedding_text,
        p.created_at,
        p.updated_at,
        1 - (p.embedding_vector <=> $1::vector) as similarity
      FROM products p
      WHERE p.embedding_vector IS NOT NULL
        AND p.embedding_status = 'completed'
    `;

    const queryParams = [vectorString];
    let paramIndex = 2;

    // 添加embedding_status过滤
    if (embedding_status && embedding_status !== "all") {
      searchQuery += ` AND p.embedding_status = $${paramIndex}`;
      queryParams.push(embedding_status);
      paramIndex++;
    }

    // 添加相似性排序和限制
    searchQuery += `
      ORDER BY similarity DESC
      LIMIT $${paramIndex}
    `;
    queryParams.push(limit);

    // 执行搜索
    const result = await pool.query(searchQuery, queryParams);

    // 格式化结果
    const products = result.rows.map((row) => ({
      id: row.id,
      sn: row.sn,
      name: row.name,
      category: row.category,
      material: row.material,
      spec: row.spec,
      description: row.description,
      memo: row.memo,
      embedding_status: row.embedding_status,
      embedding_text: row.embedding_text,
      created_at: row.created_at,
      updated_at: row.updated_at,
      similarity: parseFloat(row.similarity),
    }));

    return res.status(200).json({
      success: true,
      products,
      total: products.length,
      query: query,
      search_type: "vector_similarity",
    });
  } catch (error: unknown) {
    console.error("Vector search error:", error);
    return res.status(500).json({
      error: "Internal server error",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

// 获取查询文本的embedding
async function getQueryEmbedding(
  text: string,
  model: "openai" | "e5" | "aliyun" | "aliyun-v4"
): Promise<number[] | null> {
  try {
    const EXTERNAL_API_BASE_URL = process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010";
    const embedUrl = `${EXTERNAL_API_BASE_URL}/api/v1/embedding/embed`;

    const response = await axios.post(
      embedUrl,
      {
        texts: [text],
        model,
        normalize: true,
        batch_size: 32,
        text_type: "query",
      },
      {
        timeout: 30000,
      }
    );

    if (response.status !== 200) {
      throw new Error(`Embedding API error: ${response.status}`);
    }

    const data = response.data;

    if (!data.embeddings || !data.embeddings[0]) {
      throw new Error("Invalid embedding response format from embedding API");
    }

    const embedding = data.embeddings[0];
    return embedding;
  } catch (error: unknown) {
    console.error("❌ getQueryEmbedding失败:", error);
    if (error instanceof Error) {
      console.error("❌ 错误详情:", error.message);
    }
    if (error && typeof error === "object" && "response" in error) {
      const axiosError = error as any;
      if (axiosError.response) {
        console.error("❌ 响应状态:", axiosError.response.status);
        console.error("❌ 响应数据:", axiosError.response.data);
      }
    }
    return null;
  }
}
