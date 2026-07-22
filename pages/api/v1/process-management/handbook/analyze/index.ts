import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import { getUserIdFromRequest } from "@/lib/auth";
import { ossClient } from "@/lib/ossClient";
import pool from "@/lib/db";
import { getLeafDepartmentNames, resolveTenantId } from "@/lib/tenantDepts";

const PROCESS_MGMT_BASE_URL = process.env.PROCESS_MGMT_BASE_URL || "http://localhost:8030";
const EXTERNAL_API_BASE_URL = process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ detail: "Unauthorized" });

  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ detail: "Method not allowed" });
  }

  try {
    const {
      source_file_ids,
      source_file_keys,
      source_file_names: clientNames,
      l1_owner_name,
      ...rest
    } = req.body;

    console.log(
      "[handbook/analyze] source_file_ids:",
      JSON.stringify(source_file_ids?.slice(0, 2)),
      "source_file_keys:",
      JSON.stringify(source_file_keys?.slice(0, 2))
    );

    // Resolve file URLs and owner department in parallel
    const fileIds: string[] = Array.isArray(source_file_ids) ? source_file_ids : [];
    const fileKeys: string[] = Array.isArray(source_file_keys) ? source_file_keys : [];
    const clientNamesArr: string[] = Array.isArray(clientNames) ? clientNames : [];

    const resolveFilesWithNames = async (): Promise<{ urls: string[]; names: string[] }> => {
      if (fileIds.length > 0) {
        const result = await pool.query(
          "SELECT id, object_key, originalname FROM knowledge_files WHERE id = ANY($1::int[])",
          [fileIds.map(Number)]
        );
        const metaMap = new Map<string, { object_key: string | null; originalname: string | null }>(
          result.rows.map((r: { id: number; object_key: string | null; originalname: string | null }) => [
            String(r.id),
            { object_key: r.object_key, originalname: r.originalname },
          ])
        );
        const urls = await Promise.all(
          fileIds.map(async (fileId: string) => {
            const meta = metaMap.get(String(fileId));
            if (meta?.object_key) {
              const { url } = await ossClient.sign({ objectKey: meta.object_key });
              return url;
            }
            return `${EXTERNAL_API_BASE_URL}/api/v1/files/${fileId}/download`;
          })
        );
        const names = fileIds.map((fileId: string, i: number) => {
          return (
            clientNamesArr[i] ||
            metaMap.get(String(fileId))?.originalname ||
            ""
          );
        });
        return { urls, names };
      }
      if (fileKeys.length > 0) {
        const urls = await Promise.all(
          fileKeys.map(async (objectKey: string) => {
            const { url } = await ossClient.sign({ objectKey });
            return url;
          })
        );
        const names = fileKeys.map((objectKey: string, i: number) => {
          return clientNamesArr[i] || objectKey.split("/").pop() || "";
        });
        return { urls, names };
      }
      return { urls: [], names: [] };
    };

    const resolveDepartment = async (): Promise<string> => {
      if (!l1_owner_name) return "";
      const deptResult = await pool.query(
        `SELECT d.name as dept_name
         FROM users u
         LEFT JOIN dept d ON u.dept_id = d.id
         WHERE u.nickname = $1 OR u.username = $1
         LIMIT 1`,
        [l1_owner_name]
      );
      return deptResult.rows[0]?.dept_name || "";
    };

    const tenantId = await resolveTenantId(userId);
    const [{ urls: source_file_urls, names: source_file_names }, primary_department, departments] = await Promise.all([
      resolveFilesWithNames(),
      resolveDepartment(),
      getLeafDepartmentNames(tenantId),
    ]);

    if (!primary_department && l1_owner_name) {
      console.warn(`[handbook/analyze] 无法解析 owner "${l1_owner_name}" 的部门，primary_department 为空`);
    }

    if (departments.length === 0) {
      return res.status(409).json({
        detail: `当前租户(id=${tenantId}) 没有 active 的叶子部门，无法生成手册封面接收部门列表，请先在组织管理中创建部门`,
      });
    }

    // Forward to zn-process-management with resolved URLs + original filenames
    const response = await axios.post(
      `${PROCESS_MGMT_BASE_URL}/api/v1/handbook/analyze`,
      {
        ...rest,
        source_file_urls,
        source_file_names,
        primary_department,
        departments,
        created_by: String(userId),
      },
      { headers: { "Content-Type": "application/json" } }
    );
    return res.status(response.status).json(response.data);
  } catch (error: any) {
    console.error("handbook analyze error:", error?.response?.data || error);
    if (error.response) {
      return res
        .status(error.response.status)
        .json(error.response.data || { detail: "Request failed" });
    }
    return res.status(500).json({ detail: "Internal server error" });
  }
}
