import { verifyWorkspaceUploadReceipt } from "@/lib/workspaceUploadReceipt";
import { withKnowledgeWorkspace, knowledgeWorkspaceContext } from "@/lib/workspaceKnowledge";
import { workspaceHeaders } from "@/lib/workspaceTenant";
import type { NextApiRequest, NextApiResponse } from "next";
import { getUserIdFromRequest } from "@/lib/auth";
import pool from "@/lib/db";
import { ossClient } from "@/lib/ossClient";
import { logError } from "@/lib/logError";
import axios from "axios";

const EXTERNAL_API_BASE_URL = process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { objectKey, originalFilename, contentType, size, datasetId, tags, replaceMap } = req.body;

  if (!objectKey || !originalFilename || !contentType || !datasetId) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const workspace = knowledgeWorkspaceContext(req);
  if (!workspace || !verifyWorkspaceUploadReceipt(workspace, req.body.uploadReceipt, objectKey, contentType)) {
    return res.status(403).json({ error: "WORKSPACE_UPLOAD_RECEIPT_INVALID" });
  }

  const replacementMap: Record<string, string[]> = Object.create(null);
  const allReplacementIds = new Set<string>();
  if (replaceMap != null) {
    if (typeof replaceMap !== "object" || Array.isArray(replaceMap)) {
      return res.status(400).json({ error: "Invalid replacement map" });
    }
    for (const [filename, values] of Object.entries(replaceMap)) {
      if (!filename || !Array.isArray(values)) {
        return res.status(400).json({ error: "Invalid replacement map" });
      }
      const ids: string[] = [];
      for (const value of values) {
        if ((typeof value !== "string" && typeof value !== "number") ||
            !/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value)) ||
            Number(value) > 2147483647) {
          return res.status(400).json({ error: "Invalid replacement file ID" });
        }
        const id = String(Number(value));
        if (allReplacementIds.has(id)) {
          return res.status(400).json({ error: "Duplicate replacement file ID" });
        }
        allReplacementIds.add(id);
        ids.push(id);
      }
      replacementMap[filename] = ids;
    }
  }

  // Contribution and replacement are separate permissions. Only the existing
  // edit rule may authorize overwriting or deleting any existing file.
  const replacementRequested = allReplacementIds.size > 0;
  try {
    const client = await pool.connect();
    try {
      const permission = await client.query("SELECT can_upload_dataset($1, $2) AS can_upload, can_edit_dataset($1, $2) AS can_edit", [
        userId,
        datasetId,
      ]);
      if (!permission.rows[0]?.can_upload || (replacementRequested && !permission.rows[0]?.can_edit)) {
        return res.status(403).json({ error: replacementRequested
          ? "No permission to replace existing files in this dataset"
          : "No permission to upload to this dataset" });
      }
      if (replacementRequested) {
        const replacements = await client.query(
          "SELECT id::text AS id, originalname FROM knowledge_files WHERE id = ANY($1::int[]) AND dataset_id = $2",
          [[...allReplacementIds], datasetId]
        );
        const filenamesById = new Map(replacements.rows.map((file: { id: string; originalname: string }) => [String(file.id), file.originalname]));
        const matches = replacements.rows.length === allReplacementIds.size &&
          Object.entries(replacementMap).every(([filename, ids]) => ids.every((id) => filenamesById.get(id) === filename));
        if (!matches) {
          return res.status(403).json({ error: "Replacement files must match this dataset and filename" });
        }
      }
    } finally {
      client.release();
    }
  } catch (error) {
    logError(error);
    return res.status(500).json({ error: "Permission check failed" });
  }

  // Build auth headers for Python backend
  const headers: Record<string, string> = { ...workspaceHeaders(req) };
  if (req.headers.authorization) {
    headers["Authorization"] = req.headers.authorization;
  }

  try {
    // Get signed download URL for the uploaded file
    const { url: downloadUrl } = await ossClient.sign({ objectKey, expiresIn: 3600 });

    // Determine if we need to replace or create new
    const replaceFileIds = replacementMap[originalFilename] || [];
    const shouldReplace = replaceFileIds.length > 0;

    interface FileServiceResponse {
      success: boolean;
      file_id?: string;
      filename?: string;
      originalname?: string;
      mimetype?: string;
      size?: number;
      path?: string;
      error?: string;
      message?: string;
    }

    let responseData: FileServiceResponse | undefined;

    if (shouldReplace) {
      // Replace mode: replace the first file, delete the rest
      const primaryFileId = replaceFileIds[0];
      const otherFileIds = replaceFileIds.slice(1);

      // Call Python backend's replace endpoint
      const response = await axios.post(
        `${EXTERNAL_API_BASE_URL}/api/v1/files/replace`,
        {
          file_id: primaryFileId,
          download_url: downloadUrl,
          object_key: objectKey,
          upload_receipt: req.body.uploadReceipt,
          original_filename: originalFilename,
          content_type: contentType,
          size: size || 0,
        },
        {
          headers: { ...workspaceHeaders(req), ...headers, "Content-Type": "application/json" },
          timeout: 300000,
        }
      );

      responseData = response.data;
      //TODO: 逻辑放在后端
      // Delete duplicate files (keep the first, remove the rest)
      for (const fileIdToDelete of responseData?.success ? otherFileIds : []) {
        try {
          await pool.query(
            "DELETE FROM knowledge_segments s USING knowledge_files f WHERE s.file_id = f.id AND f.id = $1 AND f.dataset_id = $2 AND f.originalname = $3",
            [fileIdToDelete, datasetId, originalFilename]
          );
          const deleted = await pool.query(
            "DELETE FROM knowledge_files WHERE id = $1 AND dataset_id = $2 AND originalname = $3 RETURNING object_key",
            [fileIdToDelete, datasetId, originalFilename]
          );
          if (deleted.rows.length !== 1) throw new Error("Replacement file changed before duplicate cleanup");
          if (deleted.rows[0].object_key) {
            try {
              await ossClient.delete({ objectKey: deleted.rows[0].object_key });
            } catch (deleteErr) {
              console.error(
                `[Upload Confirm] Failed to delete OSS file for ${fileIdToDelete}:`,
                deleteErr
              );
            }
          }
        } catch (deleteError: any) {
          console.error(
            `[Upload Confirm] Failed to delete duplicate file ${fileIdToDelete}:`,
            deleteError.message
          );
        }
      }
    } else {
      // New file mode: register with Python backend
      const response = await axios.post(
        `${EXTERNAL_API_BASE_URL}/api/v1/files/register`,
        {
          download_url: downloadUrl,
          object_key: objectKey,
          upload_receipt: req.body.uploadReceipt,
          original_filename: originalFilename,
          content_type: contentType,
          size: size || 0,
          dataset_id: datasetId,
          tags: tags || "",
        },
        {
          headers: { ...workspaceHeaders(req), ...headers, "Content-Type": "application/json" },
          timeout: 300000,
        }
      );

      responseData = response.data;
    }

    if (!responseData?.success) {
      return res.status(500).json({
        error:
          responseData?.error ||
          responseData?.message ||
          (shouldReplace ? "Replace failed" : "Upload failed"),
      });
    }

    // Store object_key in knowledge_files
    if (responseData.file_id) {
      try {
        await pool.query("UPDATE knowledge_files SET object_key = $1 WHERE id = $2", [
          objectKey,
          responseData.file_id,
        ]);
      } catch (updateErr) {
        console.error("[Upload Confirm] Failed to update object_key:", updateErr);
      }
    }

    // Format response to match existing upload.ts shape
    const fileList = [
      {
        id: responseData.file_id,
        filename: responseData.filename,
        originalname: responseData.originalname || originalFilename,
        mimetype: responseData.mimetype || contentType,
        size: responseData.size || size,
        path: responseData.path,
        status: "pending",
        user_id: userId,
        dataset_id: datasetId,
        upload_time: new Date(),
        isReplacement: shouldReplace,
      },
    ];

    return res.status(200).json({ files: fileList });
  } catch (error: any) {
    logError(error);

    if (error.response) {
      return res.status(500).json({
        error:
          error.response.data?.detail ||
          error.response.data?.error ||
          error.response.data?.message ||
          "Upload failed",
      });
    } else if (error.code === "ECONNREFUSED" || error.code === "ECONNRESET") {
      return res.status(500).json({ error: "Cannot connect to file service" });
    } else if (error.code === "ETIMEDOUT") {
      return res.status(500).json({ error: "Upload timeout, file may be too large" });
    }
    return res.status(500).json({ error: error.message || "Upload processing failed" });
  }
}

export default withKnowledgeWorkspace(handler, "none");
