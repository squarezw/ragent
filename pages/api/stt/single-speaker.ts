import type { NextApiRequest, NextApiResponse } from "next";
import { requireAuth, getUserIdFromRequest } from "@/lib/auth";
import formidable, { Fields, Files } from "formidable";
import fs from "fs";
import axios from "axios";
import FormData from "form-data";

export const config = {
  api: {
    bodyParser: false,
  },
};

const EXTERNAL_API_BASE_URL = process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!requireAuth(req, res)) {
    return;
  }

  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({ error: "未登录" });
  }

  const form = formidable({
    multiples: false,
    keepExtensions: true,
  });

  const parseForm = (): Promise<{ fields: Fields; files: Files }> => {
    return new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        else resolve({ fields, files });
      });
    });
  };

  let uploadedFiles: Files;

  try {
    const result = await parseForm();
    uploadedFiles = result.files;
  } catch (err: any) {
    console.error("[STT Upload] Parse error:", err);
    return res.status(500).json({ error: "Upload failed", details: err.message });
  }

  const fileArray = uploadedFiles.file;
  if (!fileArray || (Array.isArray(fileArray) && fileArray.length === 0)) {
    return res.status(400).json({ error: "No audio file provided" });
  }

  const file = Array.isArray(fileArray) ? fileArray[0] : fileArray;

  try {
    const formData = new FormData();
    formData.append("audio", fs.createReadStream(file.filepath), {
      filename: file.originalFilename || "recording.webm",
      contentType: file.mimetype || "audio/webm",
    });

    const response = await axios.post(
      `${EXTERNAL_API_BASE_URL}/api/v1/stt/single-speaker`,
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          Authorization: req.headers.authorization,
        },
        timeout: 60000,
        validateStatus: (status) => status < 500,
      }
    );

    // Clean up temp file
    fs.unlink(file.filepath, () => {});

    if (response.status >= 400) {
      console.error("[STT Upload] Backend error:", response.status, JSON.stringify(response.data));
      return res.status(response.status).json({
        error: response.data?.detail || response.data?.message || "STT upload failed",
        details: response.data,
      });
    }

    return res.status(200).json(response.data);
  } catch (error: any) {
    // Clean up temp file
    fs.unlink(file.filepath, () => {});

    console.error("[STT Upload] Error:", error);

    if (error.code === "ECONNRESET" || error.code === "ECONNREFUSED") {
      return res.status(500).json({
        error: "STT service connection failed",
        details: error.message,
      });
    } else if (error.code === "ETIMEDOUT" || error.message?.includes("timeout")) {
      return res.status(500).json({
        error: "STT service request timeout",
        details: error.message,
      });
    } else if (error.response?.status) {
      return res.status(error.response.status).json({
        error: error.response.data?.message || "STT upload failed",
        details: error.response.data,
      });
    } else {
      return res.status(500).json({
        error: "STT upload failed",
        details: error.message,
      });
    }
  }
}
