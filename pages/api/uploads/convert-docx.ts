import type { NextApiRequest, NextApiResponse } from "next";
import mammoth from "mammoth";
import path from "path";
import axios from "axios";

const EXTERNAL_API_BASE_URL = process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010";

async function getFileBuffer(fileId: string, req: NextApiRequest): Promise<Buffer> {
  const headers: Record<string, string> = {};
  if (req.headers?.authorization) {
    headers["Authorization"] = req.headers.authorization;
  }

  const response = await axios.get(`${EXTERNAL_API_BASE_URL}/api/v1/files/${fileId}/download`, {
    headers,
    responseType: "arraybuffer",
    timeout: 300000,
  });

  return Buffer.from(response.data);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { filename, file_id } = req.query;

  const validFileId =
    file_id && file_id !== "undefined" && !Array.isArray(file_id) ? file_id : undefined;
  const validFilename = filename && !Array.isArray(filename) ? filename : undefined;

  if (!validFileId) {
    return res.status(400).json({ error: "file_id is required" });
  }

  try {
    const checkFilename = validFilename || "temp.docx";
    const ext = path.extname(checkFilename).toLowerCase();
    if (ext !== ".docx") {
      return res.status(400).json({ error: "Only .docx files are supported" });
    }

    const buffer = await getFileBuffer(validFileId, req);
    const result = await mammoth.convertToHtml({ buffer });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", "*");

    return res.status(200).send(result.value);
  } catch (error) {
    console.error("Error converting docx to HTML:", error);
    return res.status(500).json({ error: "Failed to convert document" });
  }
}
