import axios from "axios";

const EXTERNAL_API_BASE_URL = process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010";

export interface EmbeddingRequest {
  texts: string[];
  model?: "openai" | "qwen" | "e5" | "aliyun" | "aliyun-v4";
  normalize?: boolean;
  batch_size?: number;
}

export interface EmbeddingResponse {
  embeddings: number[][];
  text_count: number;
  processing_time_ms: number;
}

/**
 * 调用 Python 后台服务生成 embedding
 * @param text 单个文本
 * @param model 模型类型，默认为 'aliyun-v4'
 * @returns embedding 向量
 */
export async function getEmbedding(
  text: string,
  model: "openai" | "qwen" | "e5" | "aliyun" | "aliyun-v4" = "aliyun-v4"
): Promise<number[]> {
  try {
    console.log(`[Embedding] Starting embedding for model: ${model}, text length: ${text.length}`);

    const response = await axios.post<EmbeddingResponse>(
      `${EXTERNAL_API_BASE_URL}/api/v1/embedding/embed`,
      {
        texts: [text],
        model,
        normalize: true,
        batch_size: 1,
      },
      {
        timeout: 60000, // 60秒超时，增加超时时间
        maxRedirects: 3,
        validateStatus: (status) => status < 500, // 只接受5xx以下的错误
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.data.embeddings || response.data.embeddings.length === 0) {
      throw new Error("Embedding failed - invalid response format");
    }

    console.log(
      `[Embedding] Successfully generated embedding, vector length: ${response.data.embeddings[0].length}`
    );
    return response.data.embeddings[0];
  } catch (error: any) {
    console.error("[Embedding] Service request failed:", error.message);

    // 分类错误类型
    if (error.code === "ECONNRESET" || error.code === "ECONNREFUSED") {
      throw new Error(
        `Embedding service connection failed: ${error.message}. Please check if the Python backend service is running.`
      );
    } else if (error.code === "ETIMEDOUT" || error.message?.includes("timeout")) {
      throw new Error(
        `Embedding service request timed out: ${error.message}. The service may be overloaded.`
      );
    } else if (error.response?.status) {
      throw new Error(
        `Embedding service error (${error.response.status}): ${error.response.data?.message || error.message}`
      );
    } else {
      throw error; // 重新抛出原始错误
    }
  }
}
