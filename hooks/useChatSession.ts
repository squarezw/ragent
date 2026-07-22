import axios from "@/lib/axios";
import { useCallback, useEffect, useRef, useState } from "react";

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

/**
 * Scans a chat-side accumulating buffer for `{"_workflow_run_started": {...}}`
 * markers emitted by the backend `start_long_task` tool. Each call returns
 * detected workflow-run starts and the buffer slice that has not yet been
 * scanned (the caller should pass that back next time).
 *
 * Algorithm: linear scan; when we see "_workflow_run_started", we walk back
 * to find the opening `{`, then use a brace counter (respecting JSON strings)
 * to find the matching `}` and parse.
 *
 * Tolerant of partial chunks: if no closing brace yet, we return the buffer
 * unchanged so the next chunk can complete the scan.
 */
function scanWorkflowRunStarts(buffer: string): {
  runs: Array<{ runId: number; kind: string }>;
  remaining: string;
} {
  const runs: Array<{ runId: number; kind: string }> = [];
  let scanFrom = 0;
  const marker = "_workflow_run_started";

  while (true) {
    const markerIdx = buffer.indexOf(marker, scanFrom);
    if (markerIdx === -1) break;

    // Walk back to find the opening brace before the marker.
    let openIdx = -1;
    for (let i = markerIdx; i >= 0; i--) {
      if (buffer[i] === "{") {
        openIdx = i;
        break;
      }
    }
    if (openIdx === -1) {
      // Malformed; skip past the marker to avoid infinite loop.
      scanFrom = markerIdx + marker.length;
      continue;
    }

    // Brace-counter scan forward (respecting strings).
    let depth = 0;
    let inString = false;
    let escape = false;
    let closeIdx = -1;
    for (let i = openIdx; i < buffer.length; i++) {
      const ch = buffer[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (inString) {
        if (ch === "\\") {
          escape = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          closeIdx = i;
          break;
        }
      }
    }

    if (closeIdx === -1) {
      // Incomplete JSON; keep buffer for next pass.
      // We return whatever we have, but cut nothing — caller will retry.
      return { runs, remaining: buffer.slice(scanFrom) };
    }

    const jsonStr = buffer.slice(openIdx, closeIdx + 1);
    try {
      const obj = JSON.parse(jsonStr) as {
        _workflow_run_started?: { run_id?: number; kind?: string };
      };
      const inner = obj._workflow_run_started;
      if (inner && typeof inner.run_id === "number") {
        runs.push({ runId: inner.run_id, kind: String(inner.kind ?? "") });
      }
    } catch {
      // ignore parse error and continue scanning past this point
    }

    scanFrom = closeIdx + 1;
  }

  return { runs, remaining: buffer.slice(scanFrom) };
}

/**
 * Public helper for renderers: strips a leading `_workflow_run_started` JSON
 * prefix from a ToolMessage / streaming-token blob, so the user sees only the
 * trailing natural-language portion ("已开始任务 #1234（类型 cad.review）...").
 *
 * Idempotent; safe to call on content that has no marker.
 */
export function stripWorkflowRunStartedPrefix(content: string): string {
  return content.replace(/^\s*\{\s*"_workflow_run_started"\s*:\s*\{[^}]*\}\s*\}\s*/g, "");
}

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
        }) => void;
        onError: (error: Error) => void;
        /**
         * Fires when the backend dispatches a long task. Primary trigger is the
         * named SSE event `event: workflow_run_started` whose `data` is
         * `{run_id, kind, params}` — emitted by ragent-service after a
         * `start_long_task` tool call succeeds.
         *
         * Fallback trigger: a `{"_workflow_run_started": {...}}` JSON marker
         * detected inside the chat token-buffer (legacy path; in practice the
         * LLM rewrites ToolMessage content, so this rarely fires).
         *
         * `seenRunIds` guarantees the callback fires at most once per run_id
         * regardless of which path triggers first.
         */
        onWorkflowRunStarted?: (
          runId: number,
          kind: string,
          params?: Record<string, unknown>
        ) => void;
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
          let currentEvent: string | null = null;
          let buffer = "";

          // Workflow-run dispatch state.
          //
          // Primary trigger: backend emits a typed SSE frame
          //   `event: workflow_run_started\ndata: {"run_id":..., "kind":..., "params":{}}\n\n`
          // which we handle directly when `currentEvent === "workflow_run_started"`.
          //
          // Fallback trigger (legacy v1 protocol): scan the chat token-buffer for
          // a `{"_workflow_run_started": {...}}` JSON marker emitted as a string
          // prefix by the backend `start_long_task` tool. In practice the LLM
          // rewrites ToolMessage content into markdown, so this rarely fires —
          // but we keep it as belt-and-suspenders.
          //
          // `seenRunIds` ensures the callback fires at most once per run_id
          // regardless of which path observes it first.
          let tokenScanBuffer = "";
          const seenRunIds = new Set<number>();
          const dispatchWorkflowRun = (
            runId: number,
            kind: string,
            params?: Record<string, unknown>
          ) => {
            if (!callbacks?.onWorkflowRunStarted) return;
            if (seenRunIds.has(runId)) return;
            seenRunIds.add(runId);
            try {
              callbacks.onWorkflowRunStarted(runId, kind, params);
            } catch (cbErr) {
              console.warn("[Stream Hook] onWorkflowRunStarted callback error", cbErr);
            }
          };
          const scanForWorkflowRuns = (newChunk: string) => {
            if (!callbacks?.onWorkflowRunStarted) return;
            tokenScanBuffer += newChunk;
            const { runs, remaining } = scanWorkflowRunStarts(tokenScanBuffer);
            tokenScanBuffer = remaining;
            for (const run of runs) {
              dispatchWorkflowRun(run.runId, run.kind);
            }
          };

          try {
            while (true) {
              if (isAborted) {
                break;
              }

              const { done, value } = await reader.read();

              if (done) {
                break;
              }

              const chunk = decoder.decode(value, { stream: true });
              buffer += chunk;
              const lines = buffer.split("\n");
              // 保留最后一个不完整的行在 buffer 中
              buffer = lines.pop() || "";

              for (const line of lines) {
                const trimmedLine = line.trim();
                if (!trimmedLine) continue;

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
                      });
                    }
                    return;
                  }

                  try {
                    const parsed = JSON.parse(data);

                    // 根据 event 类型处理不同的数据
                    // Named SSE event: workflow_run_started (v2 协议)
                    // Backend dispatches this once per start_long_task tool
                    // call; payload is {run_id, kind, params}. We trust this
                    // over the legacy JSON-prefix scanner — bypass `v` check.
                    if (currentEvent === "workflow_run_started" && !isAborted) {
                      const runId = parsed?.run_id;
                      const kind = parsed?.kind;
                      const params = parsed?.params as Record<string, unknown> | undefined;
                      if (typeof runId === "number" && typeof kind === "string") {
                        dispatchWorkflowRun(runId, kind, params);
                      } else {
                        console.warn(
                          "[Stream Hook] workflow_run_started missing run_id/kind",
                          parsed
                        );
                      }
                      // Reset currentEvent so the next bare `data:` token frame
                      // (no `event:` prefix per SSE spec) doesn't inherit this
                      // event type.
                      currentEvent = null;
                    }
                    // 如果 data 包含 "v" 字段，说明是消息内容（无论 event 是什么）
                    else if (parsed.v !== undefined && !isAborted) {
                      const content = parsed.v;
                      fullAnswer += content;
                      scanForWorkflowRuns(content);
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
                      if (parsed.chat_id) {
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
                      if (parsed.chat_id) {
                        setChatId(parsed.chat_id);
                      }
                    } else {
                      // 兼容旧格式：choices 格式
                      if (parsed.choices?.[0]?.delta && !isAborted) {
                        const content = parsed.choices[0].delta.content;
                        if (content) {
                          fullAnswer += content;
                          scanForWorkflowRuns(content);
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
                      if (parsed.chat_id) {
                        setChatId(parsed.chat_id);
                      }
                    }
                  } catch (parseError) {
                    console.warn("[Stream Hook] Failed to parse chunk:", data, parseError);
                  }
                }
              }
            }

            // 处理 buffer 中剩余的数据
            if (buffer.trim()) {
              const trimmedLine = buffer.trim();
              if (trimmedLine.startsWith("event: ")) {
                currentEvent = trimmedLine.slice(7).trim();
              } else if (trimmedLine.startsWith("data: ")) {
                const data = trimmedLine.slice(6);
                try {
                  const parsed = JSON.parse(data);
                  // 如果 data 包含 "v" 字段，说明是消息内容
                  if (parsed.v !== undefined && !isAborted) {
                    const content = parsed.v;
                    fullAnswer += content;
                    scanForWorkflowRuns(content);
                    callbacks?.onChunk(content);
                  } else if (currentEvent === "finish") {
                    if (parsed.references) reference = parsed.references;
                    if (parsed.reference) reference = parsed.reference;
                    if (parsed.segment_ids) segmentIds = parsed.segment_ids;
                    if (parsed.detail_id) detailId = parsed.detail_id;
                    if (parsed.chat_id) {
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
    chatId, // 暴露给 useTaskAttach 等订阅长任务进度的 hook
  };
}
