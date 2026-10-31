import { withProcessWorkspace } from "@/lib/workspaceProcess";
import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import { getUserIdFromRequest } from "@/lib/auth";

const PROCESS_MGMT_BASE_URL = process.env.PROCESS_MGMT_BASE_URL || "http://localhost:8030";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ detail: "Unauthorized" });

  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ detail: "Method not allowed" });
  }

  const { node_id } = req.query;

  try {
    const response = await axios.get(`${PROCESS_MGMT_BASE_URL}/api/v1/handbook/sessions`, {
      params: { node_id },
    });
    if (process.env.WORKSPACE_TENANT_ENABLED === "true") {
      const ctx = await (await import("@/lib/workspaceTenant")).requireWorkspaceTenant(req, res);
      if (!ctx) return;
      const pool = (await import("@/lib/db")).default;
      const rows = await pool.query("SELECT external_id FROM external_workspace_resources WHERE kind='process_handbook' AND operation_tenant_id=$1 AND ($2::boolean OR created_by=$3)", [ctx.tenantId,ctx.isSuperAdmin,ctx.actorUserId]);
      const allowed = new Set(rows.rows.map((row) => row.external_id));
      const payload = response.data;
      const sessions = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
      const filtered = sessions.filter((session: any) => allowed.has(String(session.sessionId || session.session_id || session.id)));
      return res.status(200).json(Array.isArray(payload) ? filtered : { ...payload, data: filtered });
    }
    return res.status(200).json(response.data);
  } catch (error: any) {
    if (error.response) {
      return res
        .status(error.response.status)
        .json(error.response.data || { detail: "Request failed" });
    }
    return res.status(500).json({ detail: "Internal server error" });
  }
}

export default withProcessWorkspace(handler);
