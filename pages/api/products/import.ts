import { NextApiRequest, NextApiResponse } from "next";
import { requireAuth } from "@/lib/auth";
import { getUserIdFromRequest } from "@/lib/auth";
import formidable from "formidable";
import * as XLSX from "xlsx";
import pool from "@/lib/db";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  try {
    // 验证用户身份
    if (!requireAuth(req, res)) {
      return;
    }

    const userId = getUserIdFromRequest(req);

    // 测试数据库连接
    try {
      const testClient = await pool.connect();
      await testClient.query("SELECT 1");

      // 检查 products 表是否存在
      const tableCheck = await testClient.query(`
        SELECT column_name, data_type, is_nullable 
        FROM information_schema.columns 
        WHERE table_name = 'products' 
        ORDER BY ordinal_position
      `);

      if (tableCheck.rows.length === 0) {
        testClient.release();
        return res.status(500).json({ error: "Products table does not exist" });
      }

      testClient.release();
    } catch (dbError) {
      console.error("Database connection test failed:", dbError);
      return res.status(500).json({ error: "Database connection failed" });
    }

    const form = formidable({});

    form.parse(req, async (err, fields, files) => {
      if (err) {
        console.error("Form parsing error:", err);
        return res.status(400).json({ error: "Failed to parse form data" });
      }

      const file = files.file?.[0];
      if (!file) {
        console.error("No file found in upload");
        return res.status(400).json({ error: "No file uploaded" });
      }

      // 验证文件大小
      if (file.size === 0) {
        return res.status(400).json({ error: "Uploaded file is empty" });
      }

      try {
        // 验证文件格式
        if (!file.originalFilename?.match(/\.(xlsx|xls)$/i)) {
          return res
            .status(400)
            .json({ error: "Invalid file format. Only .xlsx and .xls files are supported." });
        }

        let workbook, sheetName, worksheet, data;

        try {
          workbook = XLSX.readFile(file.filepath);
          sheetName = workbook.SheetNames[0];
          worksheet = workbook.Sheets[sheetName];

          if (!worksheet) {
            return res.status(400).json({ error: "Excel file has no valid worksheets" });
          }

          // 检查工作表是否有数据
          const range = XLSX.utils.decode_range(worksheet["!ref"] || "A1");

          if (range.e.r < 1) {
            return res.status(400).json({ error: "Excel worksheet contains no data rows" });
          }

          data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        } catch (excelError) {
          console.error("Failed to read Excel file:", excelError);
          return res.status(400).json({
            error:
              "Failed to read Excel file. Please ensure the file is not corrupted and is a valid Excel file.",
            details: excelError instanceof Error ? excelError.message : "Unknown error",
          });
        }

        if (!data || data.length < 2) {
          return res
            .status(400)
            .json({ error: "Excel file must have at least a header row and one data row" });
        }

        // 检查是否有实际数据（不仅仅是空行）
        const hasActualData = data
          .slice(1)
          .some(
            (row) =>
              row &&
              Array.isArray(row) &&
              row.some((cell) => cell !== null && cell !== undefined && cell !== "")
          );

        if (!hasActualData) {
          return res.status(400).json({ error: "Excel file contains no actual data rows" });
        }

        // 验证数据结构
        if (!Array.isArray(data[0])) {
          console.error("Headers row is not an array:", data[0]);
          return res
            .status(400)
            .json({ error: "Invalid Excel file format: headers row is malformed" });
        }

        const headers = data[0] as string[];
        const rows = data.slice(1) as any[][];

        // 验证表头
        if (!headers || !Array.isArray(headers)) {
          console.error("Invalid headers:", headers);
          return res
            .status(400)
            .json({ error: "Invalid Excel file format: headers are missing or malformed" });
        }

        // 清理和验证表头
        const cleanHeaders = headers.map((header, index) => {
          if (typeof header === "string") {
            return header.trim().toLowerCase();
          } else {
            console.warn(`Header at index ${index} is not a string:`, header);
            return `column_${index}`;
          }
        });

        // 验证必需的列
        const requiredColumns = ["sn", "name"];
        const missingColumns = requiredColumns.filter((col) => !cleanHeaders.includes(col));
        if (missingColumns.length > 0) {
          console.error("Missing required columns:", missingColumns);
          return res.status(400).json({
            error: `Missing required columns: ${missingColumns.join(", ")}`,
          });
        }

        // 验证数据行
        const validRows = rows.filter((row, index) => {
          if (!row || row.length === 0) {
            return false;
          }

          // 检查是否有至少一个非空单元格
          const hasData = row.some((cell) => cell !== null && cell !== undefined && cell !== "");
          if (!hasData) {
            return false;
          }

          // 验证行数据结构
          if (!Array.isArray(row)) {
            console.warn(`Row ${index + 2} is not an array:`, row);
            return false;
          }

          return true;
        });

        console.log(`Processing ${validRows.length} valid rows from ${rows.length} total rows`);

        // 开始事务
        const client = await pool.connect();
        try {
          await client.query("BEGIN");

          const results = [];
          const errors = [];
          let hasSuccessfulImports = false;

          for (let i = 0; i < validRows.length; i++) {
            const row = validRows[i];

            try {
              // 验证行数据长度
              if (row.length < cleanHeaders.length) {
                // 填充缺失的列
                while (row.length < cleanHeaders.length) {
                  row.push("");
                }
              }

              // 确保所有单元格都是字符串
              const normalizedRow = row.map((cell, cellIndex) => {
                if (cell === null || cell === undefined) {
                  return "";
                }
                return String(cell);
              });

              const productData: { [key: string]: string } = {
                sn: normalizedRow[cleanHeaders.indexOf("sn")] || "",
                name: normalizedRow[cleanHeaders.indexOf("name")] || "",
                category: normalizedRow[cleanHeaders.indexOf("category")] || "",
                material: normalizedRow[cleanHeaders.indexOf("material")] || "",
                spec: normalizedRow[cleanHeaders.indexOf("spec")] || "",
                description: normalizedRow[cleanHeaders.indexOf("description")] || "",
                memo: normalizedRow[cleanHeaders.indexOf("memo")] || "",
              };

              // 清理数据
              Object.keys(productData).forEach((key) => {
                productData[key] = productData[key].trim();
              });

              if (!productData.sn || !productData.name) {
                errors.push({
                  row: i + 2,
                  error: "SN and name are required",
                });
                continue;
              }

              // 验证数据长度
              if (productData.sn.length > 100) {
                errors.push({
                  row: i + 2,
                  error: "SN is too long (maximum 100 characters)",
                });
                continue;
              }

              if (productData.name.length > 255) {
                errors.push({
                  row: i + 2,
                  error: "Name is too long (maximum 255 characters)",
                });
                continue;
              }

              // 检查 SN 是否已存在
              const existingProduct = await client.query("SELECT id FROM products WHERE sn = $1", [
                productData.sn,
              ]);

              if (existingProduct.rows.length > 0) {
                errors.push({
                  row: i + 2,
                  error: `Product with SN '${productData.sn}' already exists`,
                });
                continue;
              }

              // 插入产品
              const insertQuery = `
                INSERT INTO products (sn, name, category, material, spec, description, memo)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING id, sn, name
              `;

              const result = await client.query(insertQuery, [
                productData.sn,
                productData.name,
                productData.category,
                productData.material,
                productData.spec,
                productData.description,
                productData.memo,
              ]);

              results.push({
                row: i + 2,
                success: true,
                data: result.rows[0],
              });

              hasSuccessfulImports = true;
            } catch (rowError) {
              console.error(`Error processing row ${i + 2}:`, rowError);
              errors.push({
                row: i + 2,
                error: `Row processing error: ${rowError instanceof Error ? rowError.message : "Unknown error"}`,
              });
            }
          }

          console.log(`Import completed: ${results.length} successful, ${errors.length} failed`);

          // 如果有成功的导入，提交事务；否则回滚
          if (hasSuccessfulImports) {
            try {
              await client.query("COMMIT");

              // 返回结果，包含成功和失败的信息
              res.status(200).json({
                message: "Import completed",
                results,
                errors,
                totalProcessed: validRows.length,
                successful: results.length,
                failed: errors.length,
              });
            } catch (commitError) {
              console.error("Failed to commit transaction:", commitError);
              await client.query("ROLLBACK");
              return res.status(500).json({
                error: "Failed to commit transaction",
                details: commitError instanceof Error ? commitError.message : "Unknown error",
              });
            }
          } else {
            // 如果没有任何成功的导入，回滚事务
            await client.query("ROLLBACK");
            res.status(400).json({
              error: "No products were imported successfully",
              errors,
              totalProcessed: validRows.length,
              successful: 0,
              failed: errors.length,
            });
          }
        } catch (transactionError) {
          await client.query("ROLLBACK");
          console.error("Transaction error:", transactionError);
          throw transactionError;
        } finally {
          client.release();
        }
      } catch (parseError) {
        console.error("Excel parsing error:", parseError);
        res.status(400).json({ error: "Failed to parse Excel file" });
      } finally {
        // 清理上传的文件
        try {
          const fs = require("fs");
          if (file.filepath && fs.existsSync(file.filepath)) {
            fs.unlinkSync(file.filepath);
          }
        } catch (cleanupError) {
          console.warn("Failed to cleanup uploaded file:", cleanupError);
        }
      }
    });
  } catch (error) {
    console.error("Import API error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}
