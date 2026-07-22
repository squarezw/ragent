import type { NextApiRequest, NextApiResponse } from "next";
import { requireAuth } from "@/lib/auth";
import { getUserIdFromRequest } from "@/lib/auth";
import pool from "@/lib/db";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "DELETE") {
    res.setHeader("Allow", ["DELETE"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  try {
    // 验证用户身份
    if (!requireAuth(req, res)) {
      return;
    }

    const userId = getUserIdFromRequest(req);
    console.log("User ID from request:", userId);

    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "产品ID列表不能为空" });
    }

    // 验证ID格式
    const validIds = ids.filter((id) => Number.isInteger(id) && id > 0);
    if (validIds.length !== ids.length) {
      return res.status(400).json({ error: "包含无效的产品ID" });
    }

    console.log("Deleting products with IDs:", validIds);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // 检查产品是否存在
      const existingProducts = await client.query(
        `
        SELECT id, sn, name 
        FROM products 
        WHERE id = ANY($1::int[])
      `,
        [validIds]
      );

      if (existingProducts.rows.length !== validIds.length) {
        const foundIds = existingProducts.rows.map((p) => p.id);
        const missingIds = validIds.filter((id) => !foundIds.includes(id));
        console.log("Missing product IDs:", missingIds);
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: `部分产品不存在: ${missingIds.join(", ")}`,
        });
      }

      // 删除产品
      const deleteResult = await client.query(
        `
        DELETE FROM products 
        WHERE id = ANY($1::int[])
        RETURNING id, sn, name
      `,
        [validIds]
      );

      await client.query("COMMIT");

      console.log("Successfully deleted products:", deleteResult.rows);

      res.json({
        message: `成功删除 ${deleteResult.rows.length} 个产品`,
        deleted_count: deleteResult.rows.length,
        deleted_products: deleteResult.rows,
      });
    } catch (transactionError) {
      await client.query("ROLLBACK");
      console.error("Transaction error:", transactionError);
      throw transactionError;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("批量删除产品失败:", error);
    res.status(500).json({ error: "批量删除产品失败" });
  }
}
