import { requireAuth } from "@/lib/auth";
import { runQA } from "@/lib/qaCore";
import { logError } from "@/lib/logError";
import { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireAuth(req, res)) return;
  if (req.method !== "POST") return res.status(405).end();

  console.log("req.body", req.body);

  const { question, stream, attachments, ...rest } = req.body;
  if (!question) return res.status(400).json({ error: "Missing question" });

  try {
    // 如果是流式请求
    if (stream) {
      // 设置完整的 SSE 响应头
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no"); // 禁用 Nginx 缓冲

      // 立即刷新响应头，确保客户端知道这是流式响应
      res.flushHeaders();

      try {
        // 使用 runQA 函数直接透传流式响应
        await runQA(
          {
            question,
            attachments, // 单独传递附件，不合并到 question 中
            ...rest,
          },
          req,
          undefined,
          res
        ); // 传递响应对象给 runQA，不传递回调函数
      } catch (error: any) {
        console.error("[QA API Stream] Error:", error);
        // 发送错误信息。
        //
        // 402 额外带一个 code：余额不足**不是故障**，是一个用户可以自己解决的状态
        // （去充值）。靠文案匹配来识别它太脆 —— 文案改一个字就失效，而失效的表现是
        // 用户重新看到「发生了错误」，没人会注意到。
        const insufficient = error?.statusCode === 402;
        res.write(`event: error\n`);
        res.write(
          `data: ${JSON.stringify({
            error: error.message,
            ...(insufficient ? { code: "insufficient_balance" } : {}),
          })}\n\n`
        );
        res.end();
      }
    } else {
      // 非流式请求，使用原有逻辑
      const result = await runQA({ question, attachments, ...rest }, req);
      if (!result) throw new Error("No result returned from runQA");
      const { answer, reference, segment_ids, detail_id, chat_id } = result;
      res.json({ answer, detail_id, reference, segment_ids, chat_id });
    }
  } catch (error: any) {
    console.error(`[QA API] Error processing QA request:`, error);
    logError(error);

    // 返回用户友好的错误信息
    let errorMessage = "Internal server error";
    let statusCode = 500;

    if ((error as any).statusCode === 402) {
      // 原样透出。落到下面的兜底会变成 500「Internal server error」——
      // 一句本来写给用户的话（「余额不足」）被换成一句说明不了任何事的话，
      // 而用户的下一步动作（充值 vs 报障）完全不同。
      errorMessage = error.message;
      statusCode = 402;
    } else if (error.message?.includes("VALIDATION_ERROR:") || (error as any).statusCode === 422) {
      // 422 Unprocessable Entity - 从后端服务返回的验证错误
      errorMessage = "Request validation failed";
      statusCode = 422;
    } else if (error.message?.includes("External service connection failed")) {
      errorMessage = "AI service is temporarily unavailable. Please try again later.";
      statusCode = 503;
    } else if (error.message?.includes("timeout") || error.message?.includes("socket hang up")) {
      errorMessage = "Request timed out. Please try again.";
      statusCode = 408;
    } else if (error.message?.includes("Embedding generation failed")) {
      errorMessage = "Failed to process your question. Please try again.";
      statusCode = 500;
    }

    res.status(statusCode).json({
      error: errorMessage,
      detail: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
}
