import type { RateRow, UsingDefaultRow } from "@/hooks/useBilling";

export const RATE_TYPE_LABEL: Record<string, string> = {
  model: "模型",
  skill: "Skill",
  tool: "工具",
};

/**
 * 表格里类型的先后。不按字母序 —— 现在三个值的字母序恰好也是这个顺序，
 * 但那是巧合：改个名或加个类型，顺序就会莫名其妙地变。
 */
const TYPE_ORDER: Record<string, number> = { model: 0, skill: 1, tool: 2 };

export const RATE_TYPE_UNIT: Record<string, string> = {
  model: "相对基准模型的价格倍率",
  skill: "每次调用的积分",
  tool: "每次调用的积分",
};

/** 表格里的一行：显式设过的和在吃默认值的，合成同一种形状 */
export interface MergedRate {
  rateType: string;
  refKey: string;
  /** 展示名。后端翻不出实体名时回退成 refKey —— 宁可显示 id 也不编造 */
  label: string;
  coefficient: number;
  /** true = 有自己的系数；false = 继承全局默认 */
  isExplicit: boolean;
  /** 人写的备注，仅显式行有 */
  note: string | null;
}

/**
 * 把「已显式设置」与「在吃默认值」两份数据合成一张表。
 *
 * 原先这是界面上的两块，用户得先理解「在吃默认值」这个说法，才能明白为什么
 * 一个条目在这块而不在那块。合成一张之后心智模型只剩一条：每个条目都有系数，
 * 要么继承要么自定义。
 *
 * 排序：先按类型（模型 → Skill → 工具），同类型里继承默认的排前面 ——
 * 需要人过一遍的是那些，每一组里都得看得见。
 */
export function mergeRates(
  explicit: RateRow[],
  usingDefault: UsingDefaultRow[],
  defaults: Record<string, number>
): MergedRate[] {
  const rows: MergedRate[] = [
    ...usingDefault.map((r) => ({
      rateType: r.rate_type,
      refKey: r.ref_key,
      label: r.name || r.ref_key,
      // 继承行没有自己的系数，显示的是它此刻实际生效的值
      coefficient: defaults[r.rate_type] ?? 1,
      isExplicit: false,
      note: null,
    })),
    ...explicit.map((r) => ({
      rateType: r.rate_type,
      refKey: r.ref_key,
      label: r.name || r.ref_key,
      coefficient: Number(r.coefficient),
      isExplicit: true,
      note: r.note,
    })),
  ];

  return rows.sort((a, b) => {
    const ta = TYPE_ORDER[a.rateType] ?? 99;
    const tb = TYPE_ORDER[b.rateType] ?? 99;
    if (ta !== tb) return ta - tb;
    // 类型之内继承的仍排在前面：需要人过一遍的是这些，每一组里都看得见
    if (a.isExplicit !== b.isExplicit) return a.isExplicit ? 1 : -1;
    return a.label.localeCompare(b.label);
  });
}

/** 类型筛选 + 名称搜索。搜索同时匹配 refKey，翻不出名字的行才搜得到 */
export function filterRates(
  rows: MergedRate[],
  type: string,
  query: string
): MergedRate[] {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => {
    if (type !== "all" && r.rateType !== type) return false;
    if (!q) return true;
    return r.label.toLowerCase().includes(q) || r.refKey.toLowerCase().includes(q);
  });
}

/** 每个类型各有多少条，用于筛选按钮上的计数 */
export function countByType(rows: MergedRate[]): Record<string, number> {
  const out: Record<string, number> = { all: rows.length };
  for (const r of rows) out[r.rateType] = (out[r.rateType] ?? 0) + 1;
  return out;
}

/**
 * 系数怎么念给人听。
 *
 * 0 单独标出来：它是「免费」，不是「没设置」。库里这两者本就不同 ——
 * 调高全局默认时明确判定免费的条目不该跟着涨价，而界面上如果都显示 0，
 * 用户没法区分自己面对的是哪一种。
 */
export function describeCoefficient(r: MergedRate): { value: string; tag: string | null } {
  const v = String(r.coefficient);
  if (!r.isExplicit) return { value: v, tag: "默认" };
  if (r.coefficient === 0) return { value: v, tag: "免费" };
  return { value: v, tag: null };
}
