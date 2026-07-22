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

    switch (req.method) {
      case "GET":
        await getProducts(req, res, userId);
        break;
      case "POST":
        await createProduct(req, res, userId);
        break;
      default:
        res.setHeader("Allow", ["GET", "POST"]);
        res.status(405).end(`Method ${req.method} Not Allowed`);
    }
  } catch (error) {
    console.error("Products API error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

async function getProducts(req: NextApiRequest, res: NextApiResponse, userId: number) {
  try {
    const { page = 1, limit = 30, search = "", category = "", embedding_status = "" } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let whereClause = "WHERE 1=1";
    const params: any[] = [];
    let paramIndex = 1;

    if (search) {
      whereClause += ` AND (name ILIKE $${paramIndex} OR sn ILIKE $${paramIndex} OR description ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (category) {
      whereClause += ` AND category ILIKE $${paramIndex}`;
      params.push(`%${category}%`);
      paramIndex++;
    }

    if (embedding_status) {
      whereClause += ` AND embedding_status = $${paramIndex}`;
      params.push(embedding_status);
      paramIndex++;
    }

    // 获取总数
    const countQuery = `SELECT COUNT(*) FROM products ${whereClause}`;
    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].count);

    // 获取数据
    const dataQuery = `
      SELECT * FROM products 
      ${whereClause}
      ORDER BY created_at DESC 
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    params.push(Number(limit), offset);

    const dataResult = await pool.query(dataQuery, params);

    res.status(200).json({
      data: dataResult.rows,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error("Error getting products:", error);
    res.status(500).json({ error: "Failed to get products" });
  }
}

async function createProduct(req: NextApiRequest, res: NextApiResponse, userId: number) {
  try {
    const { sn, name, category, material, spec, description, memo } = req.body;

    if (!sn || !name) {
      return res.status(400).json({ error: "SN and name are required" });
    }

    // 检查 SN 是否已存在
    const existingProduct = await pool.query("SELECT id FROM products WHERE sn = $1", [sn]);
    if (existingProduct.rows.length > 0) {
      return res.status(400).json({ error: "Product with this SN already exists" });
    }

    const query = `
      INSERT INTO products (sn, name, category, material, spec, description, memo)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;

    const result = await pool.query(query, [sn, name, category, material, spec, description, memo]);

    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    console.error("Error creating product:", error);
    res.status(500).json({ error: "Failed to create product" });
  }
}
