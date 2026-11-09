import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import { withKnowledgeWorkspace } from "@/lib/workspaceKnowledge";
import { workspaceHeaders } from "@/lib/workspaceTenant";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  }
  const { request_id, dataset_id, chat_id } = req.body || {};
  if (
    typeof request_id !== "string" ||
    !/^[a-zA-Z0-9_-]{20,128}$/.test(request_id) ||
    typeof dataset_id !== "string" ||
    !/^[a-fA-F0-9-]{36}$/.test(dataset_id) ||
    typeof chat_id !== "string" ||
    !/^[1-9]\d*$/.test(chat_id)
  ) {
    return res.status(400).json({ error: "INVALID_SELECTION" });
  }
  try {
    // The backend rechecks creator, tenant, conversation, source, expiry and replay.
    const response = await axios.post(
      `${process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010"}/api/v1/files/knowledge-write/${request_id}/confirm`,
      { dataset_id, chat_id },
      {
        headers: { ...workspaceHeaders(req), Authorization: req.headers.authorization },
        timeout: 60000,
        maxRedirects: 0,
      }
    );
    if (response.data?.status !== "processing") {
      return res.status(502).json({ error: "KNOWLEDGE_WRITE_FAILED" });
    }
    return res
      .status(200)
      .json({
        status: "processing",
        file_id: response.data.file_id,
        task_id: response.data.task_id,
      });
  } catch (error: unknown) {
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;
    return res
      .status(status && [400, 401, 403, 404, 409, 410, 422, 503].includes(status) ? status : 502)
      .json({ error: "KNOWLEDGE_WRITE_FAILED" });
  }
}

export default withKnowledgeWorkspace(handler, "none");
