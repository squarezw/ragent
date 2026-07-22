import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import { getUserIdFromRequest } from "@/lib/auth";
import { getLeafDepartmentNames, resolveTenantId } from "@/lib/tenantDepts";

const PROCESS_MGMT_BASE_URL = process.env.PROCESS_MGMT_BASE_URL || "http://localhost:8030";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ detail: "Unauthorized" });

  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ detail: "Method not allowed" });
  }

  try {
    const tenantId = await resolveTenantId(userId);
    const departments = await getLeafDepartmentNames(tenantId);
    if (departments.length === 0) {
      return res.status(409).json({
        detail: `当前租户(id=${tenantId}) 没有 active 的叶子部门，无法生成手册封面接收部门列表，请先在组织管理中创建部门`,
      });
    }

    const response = await axios.post(
      `${PROCESS_MGMT_BASE_URL}/api/v1/handbook/generate`,
      { ...req.body, departments },
      { headers: { "Content-Type": "application/json" } }
    );
    return res.status(response.status).json(response.data);
  } catch (error: any) {
    if (error.response) {
      return res
        .status(error.response.status)
        .json(error.response.data || { detail: "Request failed" });
    }
    return res.status(500).json({ detail: "Internal server error" });
  }
}
