import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import { getUserIdFromRequest } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/permissions";
import { sanitizeHtml, validateHtmlLength, getMaxHtmlLength } from "@/lib/htmlSanitizer";
import pool from "@/lib/db";
import { isValidHexColor } from "@/lib/theme";

const EXTERNAL_API_BASE_URL = process.env.EXTERNAL_API_BASE_URL || "http://localhost:8010";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = getUserIdFromRequest(req);

  try {
    // 构建透传的 headers
    const headers: any = {
      "Content-Type": "application/json",
      accept: "application/json",
    };

    // 透传前端传来的所有相关 headers
    if (req.headers.authorization) {
      headers["Authorization"] = req.headers.authorization;
    }
    if (req.headers["content-type"]) {
      headers["Content-Type"] = req.headers["content-type"];
    }
    if (req.headers.accept) {
      headers["accept"] = req.headers.accept;
    }

    if (req.method === "GET") {
      // GET 请求：未登录用户直接从数据库获取公开信息（登录页面需要），已登录用户从 Python 后端获取完整信息
      if (!userId) {
        // 未登录用户：直接从数据库查询公开信息，绕过 Python 后端
        try {
          const client = await pool.connect();
          try {
            // 先检查各字段是否存在
            const columnCheck = await client.query(`
              SELECT column_name
              FROM information_schema.columns
              WHERE table_name = 'system_settings'
              AND column_name IN ('login_left_panel_html', 'theme_primary_color', 'theme_secondary_color')
            `);
            const existingColumns = columnCheck.rows.map((r: any) => r.column_name);
            const hasLoginPanelHtml = existingColumns.includes("login_left_panel_html");
            const hasThemePrimaryColor = existingColumns.includes("theme_primary_color");
            const hasThemeSecondaryColor = existingColumns.includes("theme_secondary_color");
            // 根据字段是否存在构建查询
            let selectFields = "platform_name, platform_logo, platform_subtitle, llm_model";
            if (hasLoginPanelHtml) selectFields += ", login_left_panel_html";
            if (hasThemePrimaryColor) selectFields += ", theme_primary_color";
            if (hasThemeSecondaryColor) selectFields += ", theme_secondary_color";

            const result = await client.query(`
              SELECT ${selectFields}
              FROM system_settings
              ORDER BY id DESC
              LIMIT 1
            `);

            if (result.rows.length > 0) {
              const row = result.rows[0];
              const publicData: any = {
                platform_name: row.platform_name || null,
                platform_logo: row.platform_logo || null,
                platform_subtitle: row.platform_subtitle || null,
                login_left_panel_html: hasLoginPanelHtml ? row.login_left_panel_html || null : null,
                theme_primary_color: hasThemePrimaryColor ? row.theme_primary_color || null : null,
                theme_secondary_color: hasThemeSecondaryColor
                  ? row.theme_secondary_color || null
                  : null,
              };
              // 如果请求了 full_data，也返回 llm_model
              if (req.query.full_data) {
                publicData.llm_model = row.llm_model || null;
              }
              return res.status(200).json(publicData);
            } else {
              // 没有系统设置记录，返回空数据
              return res.status(200).json({
                platform_name: null,
                platform_logo: null,
                platform_subtitle: null,
                login_left_panel_html: null,
                theme_primary_color: null,
                theme_secondary_color: null,
                ...(req.query.full_data ? { llm_model: null } : {}),
              });
            }
          } finally {
            client.release();
          }
        } catch (dbError: any) {
          console.error("数据库查询失败:", dbError);
          // 数据库查询失败，返回空数据而不是错误（避免登录页面崩溃）
          return res.status(200).json({
            platform_name: null,
            platform_logo: null,
            platform_subtitle: null,
            login_left_panel_html: null,
            theme_primary_color: null,
            theme_secondary_color: null,
            ...(req.query.full_data ? { llm_model: null } : {}),
          });
        }
      }

      // 已登录用户：从 Python 后端获取完整信息（包括 SMTP 配置等），同时从数据库获取 login_left_panel_html
      const queryParams = new URLSearchParams();
      if (req.query.full_data) {
        queryParams.append("full_data", req.query.full_data as string);
      }
      const queryString = queryParams.toString();
      const url = `${EXTERNAL_API_BASE_URL}/api/v1/system/${queryString ? `?${queryString}` : ""}`;

      // 调用 Python 后端获取系统设置（已登录用户）
      const response = await axios.get(url, {
        headers,
        timeout: 30000,
        validateStatus: (status) => status < 500,
      });

      if (response.status >= 400) {
        return res.status(response.status).json({
          error: response.data?.message || "获取系统设置失败",
          details: response.data,
        });
      }

      // 从数据库获取扩展字段（Python 后端可能没有这些字段）
      let loginLeftPanelHtml: string | null = null;
      let themePrimaryColor: string | null = null;
      let themeSecondaryColor: string | null = null;
      try {
        const client = await pool.connect();
        try {
          // 检查字段是否存在
          const columnCheck = await client.query(`
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'system_settings'
            AND column_name IN ('login_left_panel_html', 'theme_primary_color', 'theme_secondary_color')
          `);
          const existingColumns = columnCheck.rows.map((r: any) => r.column_name);
          const hasLoginPanelHtml = existingColumns.includes("login_left_panel_html");
          const hasThemePrimaryColor = existingColumns.includes("theme_primary_color");
          const hasThemeSecondaryColor = existingColumns.includes("theme_secondary_color");
          // 构建动态查询
          const fieldsToSelect: string[] = [];
          if (hasLoginPanelHtml) fieldsToSelect.push("login_left_panel_html");
          if (hasThemePrimaryColor) fieldsToSelect.push("theme_primary_color");
          if (hasThemeSecondaryColor) fieldsToSelect.push("theme_secondary_color");

          if (fieldsToSelect.length > 0) {
            const result = await client.query(`
              SELECT ${fieldsToSelect.join(", ")}
              FROM system_settings
              ORDER BY id DESC
              LIMIT 1
            `);
            if (result.rows.length > 0) {
              const row = result.rows[0];
              if (hasLoginPanelHtml) loginLeftPanelHtml = row.login_left_panel_html || null;
              if (hasThemePrimaryColor) themePrimaryColor = row.theme_primary_color || null;
              if (hasThemeSecondaryColor) themeSecondaryColor = row.theme_secondary_color || null;
            }
          }
        } finally {
          client.release();
        }
      } catch (dbError: any) {
        console.error("获取扩展字段失败:", dbError);
        // 数据库查询失败不影响整体流程
      }

      // 合并 Python 后端和数据库的数据
      const finalResponse = { ...response.data };
      if (loginLeftPanelHtml !== null) {
        finalResponse.login_left_panel_html = loginLeftPanelHtml;
      }
      if (themePrimaryColor !== null) {
        finalResponse.theme_primary_color = themePrimaryColor;
      }
      if (themeSecondaryColor !== null) {
        finalResponse.theme_secondary_color = themeSecondaryColor;
      }

      return res.status(200).json(finalResponse);
    } else if (req.method === "POST" || req.method === "PUT") {
      // PUT/POST 请求需要登录和超级管理员权限
      if (!userId) {
        return res.status(401).json({ error: "未登录" });
      }

      // 检查是否为超级管理员
      const isSuper = await isSuperAdmin(userId);
      if (!isSuper) {
        return res.status(403).json({ error: "权限不足，只有超级管理员可以修改系统设置" });
      }

      // 验证和清理 login_left_panel_html 字段
      let cleanedLoginPanelHtml: string | null = null;
      if (req.body.login_left_panel_html !== undefined) {
        const html = req.body.login_left_panel_html;

        // 验证长度
        if (html && !validateHtmlLength(html)) {
          return res.status(400).json({
            error: `登录页左侧面板 HTML 内容超过最大长度限制 (${getMaxHtmlLength()} 字节)`,
          });
        }

        // 清理 HTML
        cleanedLoginPanelHtml = html ? sanitizeHtml(html) : null;
        req.body.login_left_panel_html = cleanedLoginPanelHtml;
      }

      // 获取主题设置
      let themePrimaryColor: string | null | undefined;
      if (req.body.theme_primary_color !== undefined) {
        const color = req.body.theme_primary_color;
        if (color && !isValidHexColor(color)) {
          return res.status(400).json({
            error: "无效的主色调格式，请使用 HEX 格式（如 #2563eb）",
          });
        }
        themePrimaryColor = color || null;
      }

      let themeSecondaryColor: string | null | undefined;
      if (req.body.theme_secondary_color !== undefined) {
        const color = req.body.theme_secondary_color;
        if (color && !isValidHexColor(color)) {
          return res.status(400).json({
            error: "无效的次要色调格式，请使用 HEX 格式（如 #6b7280）",
          });
        }
        themeSecondaryColor = color || null;
      }

      // 检查是否有需要保存到数据库的字段
      const hasDbFields =
        req.body.login_left_panel_html !== undefined ||
        themePrimaryColor !== undefined ||
        themeSecondaryColor !== undefined;

      // 先更新数据库（确保扩展字段被保存）
      if (hasDbFields) {
        try {
          const client = await pool.connect();
          try {
            // 检查各字段是否存在
            const columnCheck = await client.query(`
              SELECT column_name
              FROM information_schema.columns
              WHERE table_name = 'system_settings'
              AND column_name IN ('login_left_panel_html', 'theme_primary_color', 'theme_secondary_color')
            `);
            const existingColumns = columnCheck.rows.map((r: any) => r.column_name);

            // 如果字段不存在，先创建字段
            if (!existingColumns.includes("login_left_panel_html")) {
              console.log("[系统设置] 创建 login_left_panel_html 字段");
              await client.query(`
                ALTER TABLE system_settings
                ADD COLUMN login_left_panel_html TEXT
              `);
            }
            if (!existingColumns.includes("theme_primary_color")) {
              console.log("[系统设置] 创建 theme_primary_color 字段");
              await client.query(`
                ALTER TABLE system_settings
                ADD COLUMN theme_primary_color VARCHAR(20)
              `);
            }
            if (!existingColumns.includes("theme_secondary_color")) {
              console.log("[系统设置] 创建 theme_secondary_color 字段");
              await client.query(`
                ALTER TABLE system_settings
                ADD COLUMN theme_secondary_color VARCHAR(20)
              `);
            }

            // 先检查是否有记录
            const checkResult = await client.query(
              "SELECT id FROM system_settings ORDER BY id DESC LIMIT 1"
            );
            const recordId = checkResult.rows.length > 0 ? checkResult.rows[0].id : null;

            // 构建动态更新语句
            const updateFields: string[] = [];
            const updateValues: any[] = [];
            let paramIndex = 1;

            if (req.body.login_left_panel_html !== undefined) {
              updateFields.push(`login_left_panel_html = $${paramIndex++}`);
              updateValues.push(cleanedLoginPanelHtml);
            }
            if (themePrimaryColor !== undefined) {
              updateFields.push(`theme_primary_color = $${paramIndex++}`);
              updateValues.push(themePrimaryColor);
            }
            if (themeSecondaryColor !== undefined) {
              updateFields.push(`theme_secondary_color = $${paramIndex++}`);
              updateValues.push(themeSecondaryColor);
            }

            if (recordId === null) {
              // 如果没有记录，创建一条
              const insertFields = ["updated_at"];
              const insertValues = ["CURRENT_TIMESTAMP"];
              const insertParams: any[] = [];
              let insertParamIndex = 1;

              if (req.body.login_left_panel_html !== undefined) {
                insertFields.push("login_left_panel_html");
                insertValues.push(`$${insertParamIndex++}`);
                insertParams.push(cleanedLoginPanelHtml);
              }
              if (themePrimaryColor !== undefined) {
                insertFields.push("theme_primary_color");
                insertValues.push(`$${insertParamIndex++}`);
                insertParams.push(themePrimaryColor);
              }
              if (themeSecondaryColor !== undefined) {
                insertFields.push("theme_secondary_color");
                insertValues.push(`$${insertParamIndex++}`);
                insertParams.push(themeSecondaryColor);
              }

              console.log("[系统设置] 创建新记录");
              await client.query(
                `
                INSERT INTO system_settings (${insertFields.join(", ")})
                VALUES (${insertValues.join(", ")})
              `,
                insertParams
              );
            } else if (updateFields.length > 0) {
              // 更新现有记录
              updateFields.push("updated_at = CURRENT_TIMESTAMP");
              updateValues.push(recordId);

              console.log("[系统设置] 更新记录 ID:", recordId);
              await client.query(
                `
                UPDATE system_settings
                SET ${updateFields.join(", ")}
                WHERE id = $${paramIndex}
              `,
                updateValues
              );
            }

            console.log("[系统设置] 数据库更新成功");
          } finally {
            client.release();
          }
        } catch (dbError: any) {
          console.error("[系统设置] 更新数据库失败:", dbError);
          console.error("[系统设置] 错误详情:", dbError.message, dbError.stack);
          // 数据库更新失败时返回错误，不要静默失败
          return res.status(500).json({
            error: "保存系统设置失败",
            details: dbError.message,
          });
        }
      }

      // 构建发送给 Python 后端的请求体（排除数据库专属字段）
      const dbOnlyFields = [
        "login_left_panel_html",
        "theme_primary_color",
        "theme_secondary_color",
      ];
      const pythonRequestBody: Record<string, any> = {};
      for (const key of Object.keys(req.body)) {
        if (!dbOnlyFields.includes(key)) {
          pythonRequestBody[key] = req.body[key];
        }
      }

      // 只有当有需要发送给 Python 后端的字段时才调用
      let pythonResponse: any = null;
      if (Object.keys(pythonRequestBody).length > 0) {
        // 转发给 Python 后端（其他字段）
        const response = await axios.put(
          `${EXTERNAL_API_BASE_URL}/api/v1/system/`,
          pythonRequestBody,
          {
            headers,
            timeout: 30000,
            validateStatus: (status) => status < 500,
          }
        );

        if (response.status >= 400) {
          return res.status(response.status).json({
            error: response.data?.message || "更新系统设置失败",
            details: response.data,
          });
        }
        pythonResponse = response.data;
      }

      // 合并数据库和 Python 后端的响应
      const finalResponse = { ...(pythonResponse || {}) };
      if (req.body.login_left_panel_html !== undefined) {
        finalResponse.login_left_panel_html = cleanedLoginPanelHtml;
      }
      if (themePrimaryColor !== undefined) {
        finalResponse.theme_primary_color = themePrimaryColor;
      }
      if (themeSecondaryColor !== undefined) {
        finalResponse.theme_secondary_color = themeSecondaryColor;
      }

      return res.status(200).json(finalResponse);
    } else {
      res.setHeader("Allow", ["GET", "POST", "PUT"]);
      return res.status(405).json({ error: "Method not allowed" });
    }
  } catch (error: any) {
    console.error("系统设置 API 调用失败:", error);

    if (error.code === "ECONNRESET" || error.code === "ECONNREFUSED") {
      return res.status(503).json({
        error: "无法连接到后端服务",
        details: error.message,
      });
    } else if (error.code === "ETIMEDOUT" || error.message?.includes("timeout")) {
      return res.status(504).json({
        error: "请求超时",
        details: error.message,
      });
    } else if (error.response) {
      return res.status(error.response.status || 500).json({
        error: error.response.data?.message || "系统设置操作失败",
        details: error.response.data,
      });
    }

    return res.status(500).json({
      error: "内部服务器错误",
      details: error.message,
    });
  }
}
