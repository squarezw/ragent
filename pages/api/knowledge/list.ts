import type { NextApiRequest, NextApiResponse } from "next";
import { getUserIdFromRequest } from "@/lib/auth";
import axios from "axios";
import pool from "@/lib/db";

const EXTERNAL_API_BASE_URL = process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({ error: "未登录" });
  }

  const { tag_id, page = "1", page_size, dataset_id, status, search } = req.query;

  if (!dataset_id) {
    return res.status(400).json({ error: "dataset_id 是必需参数" });
  }

  const client = await pool.connect();
  try {
    const access = await client.query(
      "SELECT can_access_dataset($1, $2) AS can_access",
      [userId, dataset_id]
    );
    if (!access.rows[0]?.can_access) {
      return res.status(403).json({ error: "没有权限访问此数据集" });
    }

    const queryParams = new URLSearchParams();
    queryParams.append("page", page as string);
    if (page_size) queryParams.append("page_size", page_size as string);
    if (tag_id && tag_id !== "all") queryParams.append("tag_id", tag_id as string);
    if (status) queryParams.append("status", status as string);
    if (search) queryParams.append("search", search as string);

    const response = await axios.get(
      `${EXTERNAL_API_BASE_URL}/api/v1/datasets/${dataset_id}/files?${queryParams}`,
      {
        headers: {
          Authorization: req.headers.authorization,
        },
        timeout: 30000,
      }
    );

    const data = response.data;
    const files = data?.files || data?.data?.files;
    if (Array.isArray(files) && files.length > 0) {
      const fileIds = files.map((f: any) => f.id).filter(Boolean);
      if (fileIds.length > 0) {
        try {
          const dbResult = await client.query(
            "SELECT id, object_key FROM knowledge_files WHERE id = ANY($1::int[])",
            [fileIds.map(Number)]
          );
          const keyMap = new Map(
            dbResult.rows.map((r: { id: number; object_key: string | null }) => [r.id, r.object_key])
          );
          for (const file of files) {
            const objectKey = keyMap.get(Number(file.id));
            if (objectKey) file.object_key = objectKey;
          }
        } catch (dbErr) {
          console.error("[knowledge/list] Failed to enrich object_key:", dbErr);
        }
      }
    }

    return res.status(200).json(data);
  } catch (error: any) {
    console.error("通过后端接口获取文件列表错误:", error?.response?.data || error?.message);
    const statusCode = error?.response?.status || 500;
    return res.status(statusCode).json(error?.response?.data || { error: "获取文件列表失败" });
  } finally {
    client.release();
  }
}
