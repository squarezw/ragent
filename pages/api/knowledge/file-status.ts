import { NextApiRequest, NextApiResponse } from "next";
import pool from "@/lib/db";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { id, filename } = req.query;

  if ((!id || typeof id !== "string") && (!filename || typeof filename !== "string")) {
    return res.status(400).json({ error: "File ID or filename is required" });
  }

  try {
    // 查询单个文件的状态，JOIN users表获取上传者信息
    // 支持通过 id 或 filename 查询
    const whereClause = id ? "kf.id = $1" : "kf.filename = $1";
    const queryParam = id || filename;
    const result = await pool.query(
      `SELECT
        kf.id,
        kf.filename,
        kf.originalname,
        kf.mimetype,
        kf.size,
        kf.upload_time,
        kf.status,
        u.username as uploader_name
       FROM knowledge_files kf
       LEFT JOIN users u ON kf.user_id = u.id
       WHERE ${whereClause}`,
      [queryParam]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "File not found" });
    }

    const file = result.rows[0];

    // 获取文件的标签（使用查询到的 file.id）
    const tagResult = await pool.query(
      `SELECT t.id, t.name, t.color
       FROM knowledge_tags t
       JOIN knowledge_file_tags ft ON t.id = ft.tag_id
       WHERE ft.file_id = $1`,
      [file.id]
    );

    const tags = tagResult.rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      color: row.color,
    }));

    return res.status(200).json({
      success: true,
      file: {
        ...file,
        tags,
      },
    });
  } catch (error) {
    console.error("获取文件状态失败:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
