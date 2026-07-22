import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import { getUserIdFromRequest } from "@/lib/auth";
import { buildCreatorNameMap } from "@/lib/process-management/creatorName";

const PROCESS_MGMT_BASE_URL = process.env.PROCESS_MGMT_BASE_URL || "http://localhost:8030";

type BackendDoc = { created_by?: string | null; created_by_name?: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({ detail: "Unauthorized" });
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ detail: "Method not allowed" });
  }

  const { id, page, page_size, status } = req.query;

  try {
    const params: Record<string, string> = {};
    if (page) params.page = page as string;
    if (page_size) params.page_size = page_size as string;
    if (status) params.status = status as string;

    const response = await axios.get(
      `${PROCESS_MGMT_BASE_URL}/api/v1/process-nodes/${id}/documents`,
      { params }
    );

    const payload = response.data;
    const docs: BackendDoc[] = Array.isArray(payload?.data) ? payload.data : [];
    const ids = docs.map((d) => d.created_by).filter((v): v is string => !!v);
    const nameMap = await buildCreatorNameMap(ids);
    for (const d of docs) {
      if (d.created_by) {
        const name = nameMap.get(d.created_by);
        if (name) d.created_by_name = name;
      }
    }

    return res.status(200).json(payload);
  } catch (error: any) {
    console.error(`process-node [${id}] documents error:`, error);
    if (error.response) {
      return res
        .status(error.response.status)
        .json(error.response.data || { detail: "Request failed" });
    }
    return res.status(500).json({ detail: "Internal server error" });
  }
}
