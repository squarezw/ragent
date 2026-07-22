import { NextApiRequest, NextApiResponse } from "next";
import { requireAuth } from "@/lib/auth";
import * as XLSX from "xlsx";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  try {
    // 验证用户身份
    if (!requireAuth(req, res)) {
      return;
    }

    // 创建示例数据
    const headers = ["sn", "name", "category", "material", "spec", "description", "memo"];
    const sampleData = [
      [
        "YKH001",
        "YKH离心泵",
        "卫生泵->YKH离心泵->成品",
        "不锈钢",
        "DN25",
        "高性能离心泵，适用于食品行业",
        "标准配置",
      ],
      [
        "YKH002",
        "YKH离心泵",
        "卫生泵->YKH离心泵->成品",
        "不锈钢",
        "DN32",
        "高性能离心泵，适用于食品行业",
        "标准配置",
      ],
      [
        "YKH003",
        "YKH离心泵",
        "卫生泵->YKH离心泵->成品",
        "不锈钢",
        "DN40",
        "高性能离心泵，适用于食品行业",
        "标准配置",
      ],
      [
        "YKH004",
        "YKH离心泵",
        "卫生泵->YKH离心泵->成品",
        "不锈钢",
        "DN50",
        "高性能离心泵，适用于食品行业",
        "标准配置",
      ],
      [
        "YKH005",
        "YKH离心泵",
        "卫生泵->YKH离心泵->成品",
        "不锈钢",
        "DN65",
        "高性能离心泵，适用于食品行业",
        "标准配置",
      ],
    ];

    // 创建工作簿
    const workbook = XLSX.utils.book_new();

    // 创建工作表
    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...sampleData]);

    // 设置列宽
    const colWidths = [
      { wch: 15 }, // sn
      { wch: 20 }, // name
      { wch: 35 }, // category
      { wch: 15 }, // material
      { wch: 15 }, // spec
      { wch: 40 }, // description
      { wch: 20 }, // memo
    ];
    worksheet["!cols"] = colWidths;

    // 添加工作表到工作簿
    XLSX.utils.book_append_sheet(workbook, worksheet, "产品导入模板");

    // 生成 Excel 文件
    const excelBuffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    // 设置响应头
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", 'attachment; filename="products_template.xlsx"');
    res.setHeader("Content-Length", excelBuffer.length.toString());

    // 发送文件
    res.send(excelBuffer);
  } catch (error) {
    console.error("Template download error:", error);
    res.status(500).json({ error: "Failed to generate template" });
  }
}
