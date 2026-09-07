import jwt from "jsonwebtoken";
import {
  claimNextRunAction,
  completeRunAction,
  finalizeRunActions,
  getRunForUser,
  listRunActions,
  runActionRowToApi,
  runRowToApi,
} from "@/lib/automation/store";

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function executeEmailAction(params: {
  userId: number;
  run: any;
  action: any;
}) {
  const to = String(params.action.config?.to || "").trim();
  if (!to) throw new Error("结果接收邮箱为空");

  const jwtSecret = requiredEnv("JWT_SECRET");
  const backendUrl = requiredEnv("EXTERNAL_API_BASE_URL").replace(/\/+$/, "");
  const token = jwt.sign({ userId: params.userId }, jwtSecret, { expiresIn: "15m" });

  const finalResult = String(params.run.final_result || params.run.result || "");
  const triggerContext = params.run.trigger_context || {};

  const body =
    params.run.trigger_type === "邮件触发"
      ? [
          `原邮件发件人：${triggerContext.from || "未知"}`,
          `原邮件主题：${triggerContext.subject || "无主题"}`,
          "",
          finalResult,
        ].join("\n")
      : finalResult;

  const response = await fetch(`${backendUrl}/api/v1/email/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "Idempotency-Key": `automation-run-${params.run.id}-${params.action.action_key}`,
    },
    body: JSON.stringify({
      title: `自动化执行结果：${params.run.automation_name}`,
      body,
      to,
      is_html: false,
    }),
  });

  const raw = await response.text();
  let data: any = raw;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    // Keep raw response text when the backend is not returning JSON.
  }

  if (!response.ok) {
    const detail =
      typeof data === "object" && data?.detail
        ? data.detail
        : typeof data === "string" && data
          ? data
          : `HTTP ${response.status}`;
    throw new Error(`结果邮件发送失败：${detail}`);
  }

  return {
    target: to,
    status: response.status,
  };
}

async function executeResultUrlAction(params: {
  run: any;
  action: any;
}) {
  const rawUrl = String(params.action.config?.url || "").trim();
  if (!rawUrl) throw new Error("结果接收 URL 为空");

  const auth = String(params.action.config?.auth || "无需验证");
  if (auth !== "无需验证") {
    throw new Error("当前服务端执行暂不支持保存验证凭证，请先使用“无需验证”的结果接收 URL");
  }

  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    throw new Error("结果接收 URL 格式不正确");
  }

  if (!['http:', 'https:'].includes(target.protocol)) {
    throw new Error("结果接收 URL 仅支持 http 或 https");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(target.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": `automation-run-${params.run.id}-${params.action.action_key}`,
      },
      body: JSON.stringify({
        event: "automation.completed",
        automation_id: params.run.automation_id,
        automation_name: params.run.automation_name,
        run_id: params.run.id,
        status: "success",
        result: params.run.final_result || params.run.result || "",
        error: "",
        occurred_at: new Date().toISOString(),
      }),
      redirect: "error",
      signal: controller.signal,
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `结果接收系统返回 HTTP ${response.status}${text ? `：${text.slice(0, 300)}` : ""}`
      );
    }

    return {
      target: target.toString(),
      status: response.status,
      response: text.slice(0, 500),
    };
  } catch (error: any) {
    if (error?.name === "AbortError") {
      throw new Error("结果接收 URL 请求超时");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function executeOneAction(userId: number, run: any, action: any) {
  if (action.action_type === "email") {
    return executeEmailAction({ userId, run, action });
  }

  if (action.action_type === "result_url") {
    return executeResultUrlAction({ run, action });
  }

  throw new Error(`不支持的后续操作类型：${action.action_type}`);
}

export async function executeRunActions(params: { userId: number; runId: number }) {
  let run = await getRunForUser(params.userId, params.runId);
  if (!run) throw new Error("RUN_NOT_FOUND");

  if (run.status !== "action_running") {
    const existingActions = await listRunActions(params.userId, params.runId);
    return {
      run: runRowToApi(run),
      actions: existingActions.map(runActionRowToApi),
    };
  }

  while (true) {
    const action = await claimNextRunAction(params.userId, params.runId);
    if (!action) break;

    try {
      const result = await executeOneAction(params.userId, run, action);
      await completeRunAction(params.userId, action.id, "success", result);
    } catch (error: any) {
      const message = error?.message || "后续操作执行失败";
      await completeRunAction(
        params.userId,
        action.id,
        "failed",
        {},
        String(message)
      );
    }
  }

  run = await finalizeRunActions(params.userId, params.runId);
  const actions = await listRunActions(params.userId, params.runId);

  return {
    run: runRowToApi(run),
    actions: actions.map(runActionRowToApi),
  };
}
