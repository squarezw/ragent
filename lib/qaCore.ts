import axios from "@/lib/axios";

/**
 * 402 余额不足。两条路径（流式 fetch / 非流式 axios）把状态码放在不同位置，
 * 所以两边都认 —— 只认一处的话，另一条路径上的用户会看到一句技术错误。
 */
function isInsufficientBalance(error: {
  statusCode?: number;
  response?: { status?: number };
}): boolean {
  return error?.statusCode === 402 || error?.response?.status === 402;
}

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

    // 附件以**清单**形式进 system 消息，而不是把内容塞进去。
    //
    // 上传只保存文件（见 pages/api/chat/upload-confirm.ts），所以这里通常没有内容可塞。
    // 用纯文本清单而不是 JSON.stringify 是刻意的：JSON 会把换行转义成字面 `\n`，
    // 模型转述给下游工具时分页标记全部失配（实测 16 页材料被当成 1 页）。
    // 清单只有文件名和类型，没有多行内容，也就没有这个问题。
    if (attachments && attachments.length > 0) {
      const lines = attachments.map((a: { filename: string; type?: string; content?: string }) => {
        const hasText = Boolean(a.content && a.content.trim());
        return `- ${a.filename}（${a.type || "File"}）${hasText ? "" : "：内容尚未读取"}`;
      });
      const anyPending = attachments.some(
        (a: { content?: string }) => !(a.content && a.content.trim())
      );
      messages.push({
        role: "system",
        content: [
          "用户本轮上传了以下附件：",
          ...lines,
          "",
          anyPending
            ? "需要读其中的文字时调用 extract_document_text(filename=...)（有文字层的直接抽取，" +
              "扫描件和图片走 OCR）。若只是要把文件交给 skill 处理，**不必**先抽取——" +
              "skill 拿到的是文件本身。"
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
      });

      // 内容非空的附件（历史行为 / 将来可能的即时抽取）仍单独给出，保持可读
      const withText = attachments.filter(
        (a: { content?: string }) => a.content && a.content.trim()
      );
      for (const a of withText as { filename: string; content: string }[]) {
        messages.push({
          role: "system",
          content: `附件《${a.filename}》的内容：\n\n${a.content}`,
        });
      }
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

    // 附件元信息作为**结构化字段**下发（不只是塞进 system 消息的文本）。
    // 后端据此在 skill 沙箱起容器前把原始文件取回、写进容器的 inputs/ 下——
    // skill 要处理的是文件本身（扫描件、Excel、图纸），`content` 只是抽取出的文本。
    // object_key 仅在平台侧流转，不下发给模型：模型只能按文件名引用 inputs/ 里
    // 已经放好的文件，否则就等于拿到了对象存储的任意读能力。
    if (attachments && attachments.length > 0) {
      type UploadedAttachment = {
        objectKey?: string;
        filename: string;
        type?: string;
        size?: number;
        content?: string;
      };
      const withKey = (attachments as UploadedAttachment[]).filter((a) => a?.objectKey);
      if (withKey.length > 0) {
        apiPayload.attachments = withKey.map((a) => ({
          object_key: a.objectKey,
          filename: a.filename,
          content_type: a.type,
          size: a.size,
          // 抽好的文本也发过去，后端写成 inputs/<主名>.extracted.md 让 skill 直接读。
          // 它在上面的 system 消息里也有一份，但那一份经 JSON.stringify 之后换行被
          // 转义成字面 \n——模型照着转述进 stdin_data，整份材料就成了一行，分页标记
          // 全部失配（实测：16 页的材料被当成 1 页，报告里页码全写"第1页"）。
          // 材料是数据，不该穿过模型的输出。
          extracted_text: a.content,
        }));
      }
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
        // 后端用 detail 承载给用户看的话（402 余额不足就是这条）。
        // 不解出来的话，用户看到的是
        // `External service error (402): {"detail":"余额不足 ..."}` ——
        // 一句本来写给他看的话，被包在两层技术噪音里。
        let detail = "";
        try {
          detail = JSON.parse(errorText)?.detail ?? "";
        } catch {
          /* 非 JSON 响应（网关错误页等）走下面的原文分支 */
        }
        const err = new Error(
          detail || `External service error (${response.status}): ${errorText}`
        );
        (err as Error & { statusCode?: number }).statusCode = response.status;
        throw err;
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

      // 402 余额不足：把后端写给用户的那句话原样抛出，不加包装
      if (completionRes.status === 402) {
        const err = new Error(completionRes.data?.detail || "余额不足 (insufficient balance)");
        (err as Error & { statusCode?: number }).statusCode = 402;
        throw err;
      }

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
      //
      // 402 排在最前且**原样透出**：这条是写给用户看的（「余额不足」），
      // 不是给运维看的。下面每个分支都会给它套一层前缀，而任何一层前缀都会
      // 把「你需要充值」变成「系统出错了」—— 用户的下一步动作完全不同。
      if (isInsufficientBalance(error)) {
        callbacks.onError(new Error(error.message));
      } else if (error.code === "ECONNRESET" || error.code === "ECONNREFUSED") {
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
    if (isInsufficientBalance(error)) {
      throw error;
    }
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
