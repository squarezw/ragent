import type { NextApiRequest, NextApiResponse } from "next";
import jwt from "jsonwebtoken";
import axios from "axios";
import { saveDraft } from "@/lib/documentFileVersions";
import { parseOnlyOfficeKey } from "@/lib/onlyofficeKey";
import { requireEnv } from "@/lib/env";

const PROCESS_MGMT_BASE_URL = process.env.PROCESS_MGMT_BASE_URL || "http://localhost:8030";
const ONLYOFFICE_SECRET = requireEnv("ONLYOFFICE_JWT_SECRET");

// OnlyOffice returns file URLs using the public-facing address (e.g. http://localhost:8443).
// Inside Docker, the callback handler can't reach localhost:8443 — it must use the
// Docker-internal hostname instead.
const ONLYOFFICE_INTERNAL_URL =
  process.env.ONLYOFFICE_INTERNAL_URL ||
  process.env.NEXT_PUBLIC_ONLYOFFICE_URL ||
  "http://localhost:8443";
const ONLYOFFICE_PUBLIC_URL = process.env.NEXT_PUBLIC_ONLYOFFICE_URL || "http://localhost:8443";

/**
 * POST /api/internal/onlyoffice/callback
 *
 * Called by OnlyOffice Document Server when a document is saved.
 * Must always return { "error": 0 } on success, otherwise OO shows an error.
 *
 * Key statuses:
 *  1 - being edited (user connected/disconnected)
 *  2 - ready for saving (all users closed, changes assembled)
 *  4 - closed with no changes
 *  6 - force save completed
 */

interface CallbackPayload {
  key: string;
  status: number;
  url?: string;
  changesurl?: string;
  users?: string[];
  actions?: Array<{ type: number; userid: string }>;
  forcesavetype?: number;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: 1 });
  }

  // Verify JWT from OnlyOffice
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
    try {
      jwt.verify(token, ONLYOFFICE_SECRET);
    } catch {
      console.error("onlyoffice callback: invalid JWT");
      return res.status(403).json({ error: 1 });
    }
  }

  const body: CallbackPayload = req.body;
  const { key, status, url } = body;

  console.log(`onlyoffice callback: key=${key}, status=${status}, url=${url?.slice(0, 80)}`);

  try {
    // Status 2 (ready for saving) or 6 (force save)
    if ((status === 2 || status === 6) && url) {
      // Rewrite the download URL to use the Docker-internal address
      const internalUrl = url.replace(ONLYOFFICE_PUBLIC_URL, ONLYOFFICE_INTERNAL_URL);

      // Download the saved file from OnlyOffice
      const fileResponse = await axios.get(internalUrl, {
        responseType: "arraybuffer",
        timeout: 300000,
      });
      const buffer = Buffer.from(fileResponse.data);

      const { type: keyType, id: keyId, version: sourceVersion } = parseOnlyOfficeKey(key);

      if (keyType === "session") {
        // Upload back to handbook session
        await axios.put(`${PROCESS_MGMT_BASE_URL}/api/v1/handbook/upload/${keyId}`, buffer, {
          headers: {
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          },
          timeout: 300000,
        });
      } else if (keyType === "doc") {
        // 命名规则 v1.1：编辑期（草稿/已发布直接修改）所有保存都只写 draft；
        // createVersion 推迟到审核通过瞬间，由 OA callback post-processing 统一触发。
        // saveDraft 强制 sourceVersion >= latest：session key 里缺 version 直接拒绝
        // （legacy/被篡改），stale session 的延迟 save 也会因版本小于 latest 被拒。
        if (sourceVersion == null) {
          console.warn(
            `onlyoffice callback: doc key missing version segment, drop save key=${key}`,
          );
        } else {
          const saved = await saveDraft(keyId, sourceVersion, buffer);
          if (saved) {
            console.log(
              `onlyoffice callback: doc ${keyId} v${sourceVersion} draft saved (status=${status})`,
            );
          }
        }
      } else {
        console.warn(`onlyoffice callback: unknown key type: ${keyType}`);
      }

      console.log(`onlyoffice callback: saved file for key=${key}`);
    }

    // Must return { error: 0 } — any other response causes OO to show an error
    return res.status(200).json({ error: 0 });
  } catch (error: any) {
    console.error(
      `onlyoffice callback failed: key=${key} status=${status} url=${url?.slice(0, 120)} ` +
        `msg=${error?.message} stack=${error?.stack?.split("\n").slice(0, 3).join(" | ")}`
    );
    // Still return error: 0 to prevent OO from retrying endlessly
    return res.status(200).json({ error: 0 });
  }
}
