import type { NextApiRequest, NextApiResponse } from "next";
import * as XLSX from "xlsx";
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
    const checkFilename = validFilename || "temp.xlsx";
    const ext = path.extname(checkFilename).toLowerCase();
    if (![".xls", ".xlsx"].includes(ext)) {
      return res.status(400).json({ error: "Only .xls and .xlsx files are supported" });
    }

    const buffer = await getFileBuffer(validFileId, req);
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetNames = workbook.SheetNames;

    const sheetsData = sheetNames.map((sheetName) => {
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

      let html = '<table class="border-collapse border border-border w-full">';

      if (jsonData.length > 0) {
        html += "<thead><tr>";
        const headerRow = jsonData[0] as unknown[];
        headerRow.forEach((header, index) => {
          html += `<th class="border border-border px-2 py-1 bg-secondary font-semibold">${header || `Col ${index + 1}`}</th>`;
        });
        html += "</tr></thead>";

        html += "<tbody>";
        jsonData.slice(1).forEach((row: unknown) => {
          const rowArray = Array.isArray(row) ? row : [];
          html += "<tr>";
          rowArray.forEach((cell) => {
            html += `<td class="border border-border px-2 py-1">${cell || ""}</td>`;
          });
          html += "</tr>";
        });
        html += "</tbody>";
      }

      html += "</table>";

      return {
        name: sheetName,
        html,
        data: jsonData,
      };
    });

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", "*");

    return res.status(200).json({ sheets: sheetsData });
  } catch (error) {
    console.error("Error converting Excel file:", error);
    return res.status(500).json({ error: "Failed to convert Excel file" });
  }
}
