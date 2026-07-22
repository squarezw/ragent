import axios from "@/lib/axios";
import { ossClient } from "@/lib/ossClient";

export async function runQA(
  params: any,
  req?: any,
  callbacks?: {
    onChunk: (chunk: string) => void;
    onComplete: (result: any) => void;
    onError: (error: any) => void;
  },
  res?: any // 添加响应对象用于直接转发流式数据
) {
  const { question, datasetId, enableWebSearch, attachments, app_id, chat_id } = params || {};
  if (!question) throw new Error("Missing question");

  try {
    const headers: any = {
      "Content-Type": "application/json",
    };

    // 从请求中获取认证 token 并透传
    if (req && req.headers && req.headers.authorization) {
      headers["Authorization"] = req.headers.authorization;
    }

    // 构建消息数组，只包含当前问题，系统提示词及历史对话由后台服务处理
    const messages = [];

    // 如果有附件，将附件内容作为 system 消息添加到 messages 中
    if (attachments && attachments.length > 0) {
      const attachmentContents = await Promise.all(
        attachments.map(async (attachment: any) => {
          const item: any = {
            filename: attachment.filename,
            type: attachment.type,
            content: attachment.content,
          };

          // 从代理路径 /api/oss/{objectKey} 提取 objectKey，通过 OSS SDK 获取签名下载链接
          if (attachment.url) {
            const objectKey = attachment.url.replace(/^\/api\/oss\//, "");
            try {
              const { url } = await ossClient.sign({ objectKey });
              item.url = url;
            } catch (e) {
              console.warn("[QA Core] Failed to sign OSS URL for:", objectKey, e);
            }
          }

          return item;
        })
      );

      messages.push({
        role: "system",
        content: `这是附件内容: ${JSON.stringify(attachmentContents, null, 2)}`,
      });
    }

    // 添加当前用户问题（不包含附件内容）
    messages.push({ role: "user", content: question });

    // 构建 API 请求参数
    const apiPayload: any = {
      messages: messages,
    };

    // 如果有 app_id，添加到请求中
    if (app_id) {
      apiPayload.app_id = app_id;
    }

    // 如果有 datasetId，添加到请求中（转换为数组格式）
    if (datasetId) {
      // 如果已经是数组，直接使用；否则转换为数组
      apiPayload.dataset_id = Array.isArray(datasetId) ? datasetId : [datasetId];
    }

    // 保留 enableWebSearch 参数
    if (enableWebSearch !== undefined) {
      apiPayload.enableWebSearch = enableWebSearch;
    }

    // 如果有 chat_id，传递给后台服务
    if (chat_id) {
      apiPayload.chat_id = chat_id;
    }
    console.log("[QA Core] API payload:", JSON.stringify(apiPayload, null, 2));

    // 如果有回调函数或响应对象，说明是流式请求
    if (callbacks || res) {
      const externalApiUrl = `${process.env.EXTERNAL_API_BASE_URL}/api/v1/chat/completions`;

      // 使用 fetch 进行流式请求
      const response = await fetch(externalApiUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(apiPayload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`External service error (${response.status}): ${errorText}`);
      }

      if (!response.body) {
        throw new Error("No response body received");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      // 如果有响应对象但没有回调函数，说明需要完全透传
      if (res && !callbacks) {
        try {
          while (true) {
            const { done, value } = await reader.read();

            if (done) {
              break;
            }

            // 解码并直接透传数据，不做任何处理
            const chunk = decoder.decode(value, { stream: true });
            res.write(chunk);

            // 立即刷新，确保数据及时发送
            if (typeof (res as any).flush === "function") {
              (res as any).flush();
            }
          }
          // 流式响应完成
          res.end();
        } catch (error: any) {
          // 发送错误信息
          res.write(`event: error\n`);
          res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
          res.end();
          throw error;
        } finally {
          reader.releaseLock();
        }
        return;
      }

      // 如果有回调函数，使用原有逻辑进行解析和处理
      let fullAnswer = "";
      let reference: any = null;
      let segmentIds: number[] = [];
      let detailId: number | undefined;

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);

              if (data === "[DONE]") {
                // 流式响应完成
                if (res) {
                  // 如果有响应对象，直接转发原始数据
                  res.write(line + "\n");
                  res.end();
                }
                callbacks?.onComplete({ reference, segment_ids: segmentIds, detail_id: detailId });
                return;
              }

              try {
                const parsed = JSON.parse(data);
                if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta) {
                  const content = parsed.choices[0].delta.content;
                  if (content) {
                    fullAnswer += content;
                    callbacks?.onChunk(content);
                  }
                }

                // 检查是否有最终结果信息
                if (parsed.references) {
                  reference = parsed.references;
                }
                if (parsed.reference) {
                  reference = parsed.reference;
                }
                if (parsed.segment_ids) {
                  segmentIds = parsed.segment_ids;
                }
                if (parsed.detail_id) {
                  detailId = parsed.detail_id;
                }
              } catch (parseError) {
                console.warn("[QA Core Stream] Failed to parse chunk:", data);
              }
            }

            // 如果有响应对象，直接转发原始数据
            if (res && line.trim()) {
              res.write(line + "\n");
              if (res.flush) {
                res.flush();
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      // 如果没有收到 [DONE] 标记，手动调用完成回调
      callbacks?.onComplete({ reference, segment_ids: segmentIds, detail_id: detailId });
    } else {
      // 非流式请求，使用原有逻辑
      console.log("[QA Core] Calling backend API service (non-stream mode)...");
      const externalApiUrl = `${process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010"}/api/v1/chat/completions`;

      const completionRes = await axios.post(externalApiUrl, apiPayload, {
        headers,
        timeout: 120000, // 2分钟超时
        maxRedirects: 3,
        validateStatus: (status) => status < 500, // 只接受5xx以下的错误
      });

      // 检查响应状态码
      if (completionRes.status === 422) {
        const error = new Error("VALIDATION_ERROR: Request validation failed");
        (error as any).statusCode = 422;
        throw error;
      }

      if (
        !completionRes.data ||
        !completionRes.data.choices ||
        !completionRes.data.choices[0] ||
        !completionRes.data.choices[0].message
      ) {
        throw new Error("Invalid response format from external LLM API");
      }

      const answer = completionRes.data.choices[0].message.content.trim();
      // 从后台服务响应中获取 reference 信息（注意是复数形式 references）
      const responseReference =
        completionRes.data.references || completionRes.data.reference || null;

      // 从后台服务响应中获取 segment_ids
      const segmentIds = completionRes.data.segment_ids || null;

      // 从后台服务响应中获取 detail_id
      const detailId = completionRes.data.detail_id || null;

      // 从后台服务响应中获取 chat_id
      const chatId = completionRes.data.chat_id || null;

      return {
        answer,
        reference: responseReference,
        segment_ids: segmentIds,
        detail_id: detailId,
        chat_id: chatId,
      };
    }
  } catch (error: any) {
    console.error("[QA Core] Error in runQA:", error);

    // 如果有回调函数，调用错误回调
    if (callbacks) {
      // 分类错误类型
      if (error.code === "ECONNRESET" || error.code === "ECONNREFUSED") {
        const errorMsg = `External service connection failed: ${error.message}. Please check if the Python backend service is running.`;
        callbacks.onError(new Error(errorMsg));
      } else if (error.code === "ETIMEDOUT" || error.message?.includes("timeout")) {
        const errorMsg = `External service request timed out: ${error.message}. The service may be overloaded.`;
        callbacks.onError(new Error(errorMsg));
      } else if (error.response?.status === 422) {
        const errorMsg =
          error.response.data?.message || error.response.data?.detail || error.message;
        callbacks.onError(new Error(`VALIDATION_ERROR: ${errorMsg}`));
      } else if (error.response?.status) {
        const errorMsg = `External service error (${error.response.status}): ${error.response.data?.message || error.message}`;
        callbacks.onError(new Error(errorMsg));
      } else {
        const errorMsg = `QA processing failed: ${error.message || "Unknown error"}`;
        callbacks.onError(new Error(errorMsg));
      }
      return;
    }

    // 非流式请求的错误处理
    if (error.code === "ECONNRESET" || error.code === "ECONNREFUSED") {
      throw new Error(
        `External service connection failed: ${error.message}. Please check if the Python backend service is running.`
      );
    } else if (error.code === "ETIMEDOUT" || error.message?.includes("timeout")) {
      throw new Error(
        `External service request timed out: ${error.message}. The service may be overloaded.`
      );
    } else if (error.response?.status === 422) {
      // 422 Unprocessable Entity - 请求格式正确但无法处理
      const errorMsg = error.response.data?.message || error.response.data?.detail || error.message;
      throw new Error(`VALIDATION_ERROR: ${errorMsg}`);
    } else if (error.response?.status) {
      throw new Error(
        `External service error (${error.response.status}): ${error.response.data?.message || error.message}`
      );
    } else {
      throw new Error(`QA processing failed: ${error.message || "Unknown error"}`);
    }
  }
}
