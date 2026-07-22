import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import { getUserIdFromRequest } from "@/lib/auth";
import { getCompanyCodeByTenantId } from "@/lib/tenantMapping";
import { resolveTenantId } from "@/lib/tenantDepts";
import { IncomingForm } from "formidable";
import fs from "fs";
import FormData from "form-data";

const PROCESS_MGMT_BASE_URL = process.env.PROCESS_MGMT_BASE_URL || "http://localhost:8030";

export const config = {
  api: { bodyParser: false },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({ detail: "Unauthorized" });
  }

  try {
    // 从 token 派生 company_code：后端在缺参时不会按公司过滤，会跨公司返回全部数据
    const tenantId = await resolveTenantId(userId);
    const companyCode = getCompanyCodeByTenantId(tenantId);
    if (!companyCode) {
      return res.status(403).json({
        detail: `tenant_id=${tenantId} has no company_code mapping (check ZN_TENANT_MAPPING)`,
      });
    }

    if (req.method === "GET") {
      await handleGet(req, res, companyCode);
      return;
    }
    if (req.method === "POST") {
      await handleImport(req, res, companyCode);
      return;
    }
    res.setHeader("Allow", ["GET", "POST"]);
    return res.status(405).json({ detail: "Method not allowed" });
  } catch (error: any) {
    console.error("process-tree error:", error);
    if (error.response) {
      return res
        .status(error.response.status)
        .json(error.response.data || { detail: "Request failed" });
    }
    return res.status(500).json({ detail: "Internal server error" });
  }
}

/** GET /process-tree — proxy to backend */
async function handleGet(req: NextApiRequest, res: NextApiResponse, companyCode: string) {
  const { format } = req.query;

  // Determine the backend path
  let path = "/api/v1/process-tree";
  if (format) {
    path = "/api/v1/process-tree/export";
  }

  const params: Record<string, string> = { company_code: companyCode };
  if (format) params.format = format as string;

  if (format === "xlsx") {
    const response = await axios.get(`${PROCESS_MGMT_BASE_URL}${path}`, {
      params,
      responseType: "arraybuffer",
    });
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", 'attachment; filename="process-tree.xlsx"');
    return res.status(200).send(Buffer.from(response.data));
  }

  const response = await axios.get(`${PROCESS_MGMT_BASE_URL}${path}`, {
    params,
  });
  return res.status(200).json(response.data);
}

/** POST /process-tree — import XLSX (multipart/form-data) */
async function handleImport(req: NextApiRequest, res: NextApiResponse, companyCode: string) {
  const form = new IncomingForm({ keepExtensions: true });

  const { files, fields } = await new Promise<{
    files: Record<string, any>;
    fields: Record<string, any>;
  }>((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ files, fields });
    });
  });

  const file = Array.isArray(files.file) ? files.file[0] : files.file;
  if (!file) {
    return res.status(400).json({ detail: "No file provided" });
  }

  // Build multipart form for backend
  const formData = new FormData();
  formData.append("file", fs.createReadStream(file.filepath), {
    filename: file.originalFilename || "upload.xlsx",
    contentType: file.mimetype || "application/octet-stream",
  });

  // company_code 来自 token，不接受客户端覆盖
  formData.append("company_code", companyCode);

  // Forward optional fields
  for (const key of ["replace", "imported_by"]) {
    const val = fields[key];
    if (val) {
      formData.append(key, Array.isArray(val) ? val[0] : val);
    }
  }

  const response = await axios.post(
    `${PROCESS_MGMT_BASE_URL}/api/v1/process-tree/import`,
    formData,
    { headers: formData.getHeaders() }
  );

  return res.status(response.status).json(response.data);
}
