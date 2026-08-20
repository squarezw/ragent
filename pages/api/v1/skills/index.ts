import type { NextApiRequest, NextApiResponse } from "next";
import { proxySkillsApi } from "@/lib/skillsProxy";

// GET /api/v1/skills（?q= 搜索，?tenant_id=/?dept_id= 组织筛选）· POST /api/v1/skills
//
// ⚠️ passQuery 是**白名单**：不在里面的查询参数会被静默丢掉 —— 不报错、不警告，
// 前端发了、后端没收到，表现为「筛选了但列表没变」。加后端筛选参数时必须同步
// 这一行，否则那个参数从头到尾都不会生效。
// （2026-08-20 就是这么漏的：tenant_id/dept_id 加到了 hook 和后端，忘了这里。）
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  return proxySkillsApi(req, res, {
    path: "/api/v1/skills",
    allow: ["GET", "POST"],
    passQuery: ["q", "tenant_id", "dept_id"],
  });
}
