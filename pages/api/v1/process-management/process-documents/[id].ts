import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import { getUserIdFromRequest } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/permissions";
import { resolveCreatorName } from "@/lib/process-management/creatorName";

const PROCESS_MGMT_BASE_URL = process.env.PROCESS_MGMT_BASE_URL || "http://localhost:8030";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({ detail: "Unauthorized" });
  }

  const { id } = req.query;
  const url = `${PROCESS_MGMT_BASE_URL}/api/v1/process-documents/${id}`;

  // 写操作（PUT/DELETE）的权限：仅创建者本人或超级管理员
  // 早抛异常：拿不到 created_by 直接拒绝，不做"未知归属当成可写"的兜底
  const requireWriteAccess = async (action: "修改" | "删除") => {
    const docResp = await axios.get(url);
    const createdBy: string | null = docResp.data?.data?.created_by ?? null;
    const isOwner = createdBy != null && createdBy === String(userId);
    if (isOwner) return null;
    if (await isSuperAdmin(Number(userId))) return null;
    return res.status(403).json({ detail: `只能${action}自己创建的文件` });
  };

  try {
    if (req.method === "GET") {
      const response = await axios.get(url);
      const payload = response.data;
      const doc = payload?.data;
      if (doc?.created_by) {
        const name = await resolveCreatorName(doc.created_by);
        if (name) doc.created_by_name = name;
      }
      return res.status(200).json(payload);
    }

    if (req.method === "PUT") {
      if (await requireWriteAccess("修改")) return;
      const response = await axios.put(url, req.body, {
        headers: { "Content-Type": "application/json" },
      });
      return res.status(200).json(response.data);
    }

    if (req.method === "DELETE") {
      if (await requireWriteAccess("删除")) return;
      const response = await axios.delete(url);
      return res.status(response.status).json(response.data);
    }

    res.setHeader("Allow", ["GET", "PUT", "DELETE"]);
    return res.status(405).json({ detail: "Method not allowed" });
  } catch (error: any) {
    console.error(`process-document [${id}] error:`, error);
    if (error.response) {
      return res
        .status(error.response.status)
        .json(error.response.data || { detail: "Request failed" });
    }
    return res.status(500).json({ detail: "Internal server error" });
  }
}
