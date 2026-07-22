import { NextApiRequest, NextApiResponse } from "next";
import { requireAuth } from "@/lib/auth";
import { getUserIdFromRequest } from "@/lib/auth";
import pool from "@/lib/db";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // 验证用户身份
    if (!requireAuth(req, res)) {
      return;
    }

    const userId = getUserIdFromRequest(req);
    const { id } = req.query;

    if (!id || typeof id !== "string") {
      return res.status(400).json({ error: "Product ID is required" });
    }

    switch (req.method) {
      case "GET":
        await getProduct(req, res, id);
        break;
      case "PUT":
        await updateProduct(req, res, id);
        break;
      case "DELETE":
        await deleteProduct(req, res, id);
        break;
      default:
        res.setHeader("Allow", ["GET", "PUT", "DELETE"]);
        res.status(405).end(`Method ${req.method} Not Allowed`);
    }
  } catch (error) {
    console.error("Product API error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

async function getProduct(req: NextApiRequest, res: NextApiResponse, id: string) {
  try {
    const result = await pool.query("SELECT * FROM products WHERE id = $1", [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Product not found" });
    }

    res.status(200).json({ data: result.rows[0] });
  } catch (error) {
    console.error("Error getting product:", error);
    res.status(500).json({ error: "Failed to get product" });
  }
}

async function updateProduct(req: NextApiRequest, res: NextApiResponse, id: string) {
  try {
    const { sn, name, category, material, spec, description, memo } = req.body;

    if (!sn || !name) {
      return res.status(400).json({ error: "SN and name are required" });
    }

    // 检查 SN 是否已被其他产品使用
    const existingProduct = await pool.query("SELECT id FROM products WHERE sn = $1 AND id != $2", [
      sn,
      id,
    ]);
    if (existingProduct.rows.length > 0) {
      return res.status(400).json({ error: "Product with this SN already exists" });
    }

    const query = `
      UPDATE products 
      SET sn = $1, name = $2, category = $3, material = $4, spec = $5, description = $6, memo = $7, updated_at = CURRENT_TIMESTAMP
      WHERE id = $8
      RETURNING *
    `;

    const result = await pool.query(query, [
      sn,
      name,
      category,
      material,
      spec,
      description,
      memo,
      id,
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Product not found" });
    }

    res.status(200).json({ data: result.rows[0] });
  } catch (error) {
    console.error("Error updating product:", error);
    res.status(500).json({ error: "Failed to update product" });
  }
}

async function deleteProduct(req: NextApiRequest, res: NextApiResponse, id: string) {
  try {
    const result = await pool.query("DELETE FROM products WHERE id = $1 RETURNING *", [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Product not found" });
    }

    res.status(200).json({ message: "Product deleted successfully" });
  } catch (error) {
    console.error("Error deleting product:", error);
    res.status(500).json({ error: "Failed to delete product" });
  }
}
