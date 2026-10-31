import { ensureSessionCurrent, renewSession } from "@/lib/sessionRenewal";
import axios from "@/lib/axios";
import {
  parseWorkspaceBindingWarning,
  type WorkspaceBindingWarning,
  extractSseErrorMessage,
  isSseCommentLine,
  parseToolStatusPayload,
  type ToolStatusEvent,
} from "@/lib/chatSse";
import { useCallback, useState } from "react";
import { normalizeTurnUsage, type TurnUsage } from "@/types/token-usage";

// 复用 axios 认证逻辑的辅助函数
const getAuthHeaders = () => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (typeof window !== "undefined") {
    const token = localStorage.getItem("ragent_token");
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  return headers;
};

export function useChatSession() {
  const [chatId, setChatId] = useState<number | null>(null);

  // 非流式提问
  const ask = useCallback(
    async (
      question: string,
      datasetIds: string | string[],
      otherParams: Record<string, unknown> = {}
    ) => {
      const payload: Record<string, unknown> = {
        question,
        datasetId: datasetIds, // 传递 datasetIds (兼容后端命名)
        ...otherParams,
      };

      // 如果当前会话中有 chat_id，则传递它（页面刷新后会重置）
      if (chatId) {
        payload.chat_id = String(chatId);
      }

      const res = await axios.post("/api/chat/qa", payload);

      // 如果响应中包含 chat_id，保存它
      if (res.data?.chat_id) {
        setChatId(res.data.chat_id);
      }

      return res.data;
    },
    [chatId]
  );

  // 流式提问
  const askStream = useCallback(
    async (
      question: string,
      datasetIds: string | string[],
      otherParams: Record<string, unknown> = {},
      callbacks?: {
        onChunk: (chunk: string) => void;
        onComplete: (result: {
          answer: string;
          reference?: unknown;
          segment_ids?: number[];
          detail_id?: number;
          usage?: TurnUsage;
        }) => void;
        onError: (error: Error) => void;
        /**
         * Fires on each named SSE frame `event: tool_status` whose data is
         * `{name, skill?, phase: "started"|"finished", ok?}` — emitted by
         * ragent-service around every tool execution so the UI can show an
         * in-flight indicator between token bursts.
         */
        onToolStatus?: (status: ToolStatusEvent) => void;
        onWorkspaceWarning?: (warning: WorkspaceBindingWarning) => void;
      }
    ) => {
      // 创建 AbortController 用于取消请求
      const abortController = new AbortController();
      let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
      let isAborted = false;

      const abort = () => {
        try {
          isAborted = true;
          abortController.abort();
          if (reader) {
            // 静默处理取消错误，这是预期的用户操作
            reader.cancel().catch(() => {
              // AbortError 是预期的，不需要记录
            });
          }
        } catch (error) {
          // 静默处理 abort 过程中的任何错误
          // 这些错误通常是预期的取消操作导致的
          if (error instanceof Error && error.name !== "AbortError") {
            console.warn("[Stream Hook] Abort error (non-critical):", error);
          }
        }
      };

      // 立即返回 abort 函数，不等待流式处理完成
      const streamPromise = (async () => {
        try {
          await ensureSessionCurrent();
          if (isAborted) return;
          // 使用辅助函数获取认证 headers，复用 axios 的认证逻辑
          const headers = getAuthHeaders();

          // 构建请求体，只在 otherParams 中没有 datasetId 时才使用传入的 datasetIds
          const payload: any = {
            question,
            stream: true,
            ...otherParams,
          };

          // 如果当前会话中有 chat_id，则传递它（页面刷新后会重置）
          if (chatId) {
            payload.chat_id = String(chatId);
          }

          // 如果 otherParams 中没有明确设置 datasetId，则使用传入的 datasetIds
          if (!("datasetId" in otherParams)) {
            payload.datasetId = datasetIds;
          }

          const response = await fetch("/api/chat/qa", {
            method: "POST",
            headers,
            body: JSON.stringify(payload),
            signal: abortController.signal,
          });

          if (!response.ok) {
            if (response.status === 401) {
              // Renew for the next deliberate send, but never replay this chat/tool request.
              void renewSession().catch(() => {});
            }
            throw new Error(`HTTP error! status: ${response.status}`);
          }

          if (!response.body) {
            throw new Error("No response body received");
          }

          reader = response.body.getReader();
          const decoder = new TextDecoder();
          let fullAnswer = "";
          let reference: unknown = null;
          let segmentIds: number[] = [];
          let detailId: number | undefined;
          let usage: TurnUsage | undefined;
          let workspaceWarningSent = false;
          const handleWorkspaceWarning = (parsed: unknown) => {
            const warning = parseWorkspaceBindingWarning(parsed);
            if (warning && !workspaceWarningSent && !isAborted) {
              workspaceWarningSent = true;
              callbacks?.onWorkspaceWarning?.(warning);
            }
          };
          let currentEvent: string | null = null;
          let buffer = "";

          try {
            while (true) {
              if (isAborted) {
                break;
              }

              const { done, value } = await reader.read();

              if (done || isAborted) {
                break;
              }

              const chunk = decoder.decode(value, { stream: true });
              buffer += chunk;
              const lines = buffer.split("\n");
              // 保留最后一个不完整的行在 buffer 中
              buffer = lines.pop() || "";

              for (const line of lines) {
                if (isAborted) break;
                const trimmedLine = line.trim();
                if (!trimmedLine) continue;

                // SSE 注释行（心跳 `: ping`）直接跳过
                if (isSseCommentLine(trimmedLine)) continue;

                // 处理 event: 行
                if (trimmedLine.startsWith("event: ")) {
                  currentEvent = trimmedLine.slice(7).trim();
                  continue;
                }

                // 处理 data: 行
                if (trimmedLine.startsWith("data: ")) {
                  const data = trimmedLine.slice(6);

                  if (data === "[DONE]") {
                    // 流式响应完成
                    if (!isAborted) {
                      callbacks?.onComplete({
                        answer: fullAnswer,
                        reference,
                        segment_ids: segmentIds,
                        detail_id: detailId,
                        usage,
                      });
                    }
                    return;
                  }

                  try {
                    const parsed = JSON.parse(data);

                    if (currentEvent === "workspace_warning") {
                      handleWorkspaceWarning(parsed);
                      currentEvent = null;
                      continue;
                    }
                    if (currentEvent === "tool_status") {
                      if (!isAborted) {
                        const toolStatus = parseToolStatusPayload(parsed);
                        if (toolStatus) {
                          try {
                            callbacks?.onToolStatus?.(toolStatus);
                          } catch (cbErr) {
                            console.warn("[Stream Hook] onToolStatus callback error", cbErr);
                          }
                        } else {
                          console.warn("[Stream Hook] tool_status malformed payload", parsed);
                        }
                      }
                      currentEvent = null;
                    }
                    // Named SSE event: error — surface through the existing
                    // onError path and stop consuming the stream.
                    else if (currentEvent === "error") {
                      currentEvent = null;
                      if (!isAborted) {
                        const err = new Error(extractSseErrorMessage(parsed));
                        // 把服务端给的 code 带上（目前只有 insufficient_balance）。
                        // 不带的话调用方只能靠文案匹配来区分「故障」和「余额不足」，
                        // 而文案改一个字就失效 —— 失效的表现是用户重新看到
                        // 「发生了错误」，没人会注意到。
                        const code = (parsed as { code?: string })?.code;
                        if (code) (err as Error & { code?: string }).code = code;
                        if (Number.isSafeInteger(parsed.detail_id) && parsed.detail_id > 0)
                          (err as Error & { detail_id?: number }).detail_id = parsed.detail_id;
                        callbacks?.onError(err);
                      }
                      return;
                    }
                    // 如果 data 包含 "v" 字段，说明是消息内容（无论 event 是什么）
                    else if (parsed.v !== undefined && !isAborted) {
                      const content = parsed.v;
                      fullAnswer += content;
                      callbacks?.onChunk(content);
                    } else if (currentEvent === "finish") {
                      // event: finish 包含最终结果
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
                      if (parsed.usage) {
                        // 后端随 finish 一起给，省一次为了显示「共消耗」的往返
                        usage = normalizeTurnUsage(parsed.usage);
                      }
                      if (!isAborted && parsed.chat_id) {
                        setChatId(parsed.chat_id);
                      }
                    } else if (currentEvent === "update_session") {
                      // update_session 事件，不做处理
                      // 但检查是否有其他有用的数据
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
                      if (!isAborted && parsed.chat_id) {
                        setChatId(parsed.chat_id);
                      }
                    } else {
                      // 兼容旧格式：choices 格式
                      if (parsed.choices?.[0]?.delta && !isAborted) {
                        const content = parsed.choices[0].delta.content;
                        if (content) {
                          fullAnswer += content;
                          callbacks?.onChunk(content);
                        }
                      }

                      // 检查是否有最终结果信息（兼容旧格式）
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
                      if (!isAborted && parsed.chat_id) {
                        setChatId(parsed.chat_id);
                      }
                    }
                  } catch (parseError) {
                    // error 帧的 data 可能不是 JSON（裸字符串），同样要走 onError
                    if (currentEvent === "error") {
                      currentEvent = null;
                      if (!isAborted) {
                        callbacks?.onError(new Error(data));
                      }
                      return;
                    }
                    console.warn("[Stream Hook] Failed to parse chunk:", data, parseError);
                  }
                }
              }
            }

            // 处理 buffer 中剩余的数据
            if (!isAborted && buffer.trim()) {
              const trimmedLine = buffer.trim();
              if (trimmedLine.startsWith("event: ")) {
                currentEvent = trimmedLine.slice(7).trim();
              } else if (trimmedLine.startsWith("data: ")) {
                const data = trimmedLine.slice(6);
                try {
                  const parsed = JSON.parse(data);
                  if (currentEvent === "workspace_warning") {
                    handleWorkspaceWarning(parsed);
                    currentEvent = null;
                  }
                  // 如果 data 包含 "v" 字段，说明是消息内容
                  else if (parsed.v !== undefined && !isAborted) {
                    const content = parsed.v;
                    fullAnswer += content;
                    callbacks?.onChunk(content);
                  } else if (currentEvent === "finish") {
                    if (parsed.references) reference = parsed.references;
                    if (parsed.reference) reference = parsed.reference;
                    if (parsed.segment_ids) segmentIds = parsed.segment_ids;
                    if (parsed.detail_id) detailId = parsed.detail_id;
                    if (!isAborted && parsed.chat_id) {
                      setChatId(parsed.chat_id);
                    }
                  }
                } catch (parseError) {
                  console.warn("[Stream Hook] Failed to parse buffer:", data, parseError);
                }
              }
            }
          } catch (streamError: unknown) {
            // 如果是用户主动取消，不调用任何回调，让调用方处理
            if ((streamError instanceof Error && streamError.name === "AbortError") || isAborted) {
              return;
            }
            console.error("[Stream Hook] Stream reading error:", streamError);
            const errorMessage =
              streamError instanceof Error ? streamError.message : String(streamError);
            callbacks?.onError(new Error(`Stream reading failed: ${errorMessage}`));
            return;
          } finally {
            if (reader) {
              reader.releaseLock();
            }
          }

          // 如果没有收到 [DONE] 标记，手动调用完成回调
          if (!isAborted) {
            callbacks?.onComplete({
              answer: fullAnswer,
              reference,
              segment_ids: segmentIds,
              detail_id: detailId,
              // 这条兜底路径同样要带 usage：流正常结束但没收到 [DONE] 时走这里。
              // 漏了的话那一轮的「共消耗」凭空消失，而对话本身一切正常 ——
              // 只在某些结束形态下缺失，最难被发现。
              usage,
            });
          }
        } catch (error: unknown) {
          // 如果是用户主动取消，不调用错误回调
          if ((error instanceof Error && error.name === "AbortError") || isAborted) {
            return;
          }
          console.error("[Stream Hook] Error in askStream:", error);
          callbacks?.onError(error instanceof Error ? error : new Error(String(error)));
        }
      })();

      // 处理后台 promise 的错误，避免未处理的 promise 警告
      streamPromise.catch((error) => {
        // 错误已经在内部处理，这里只是防止未处理的 promise 警告
        // AbortError 是预期的用户取消操作，不需要记录
        if (error instanceof Error && error.name !== "AbortError" && !isAborted) {
          console.error("[Stream Hook] Unhandled promise error:", error);
        }
      });

      // 立即返回 abort 函数，不等待流式处理完成
      return { abort };
    },
    [chatId]
  );

  // 反馈
  const sendFeedback = useCallback(
    async (detailId: number, voteGood: boolean, voteBad: boolean, feedback: string) => {
      await axios.post("/api/chat/feedback", {
        detail_id: detailId,
        vote_good: voteGood,
        vote_bad: voteBad,
        feedback,
      });
    },
    []
  );

  return {
    ask,
    askStream,
    sendFeedback,
    setChatId, // 导出 setChatId，用于加载历史会话时设置 chat_id
    chatId,
  };
}
