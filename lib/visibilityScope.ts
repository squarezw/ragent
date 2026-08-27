import pool from "./db";
import { getUserPermissions, type UserPermissions } from "./permissions";

/**
 * 「这个查看者能看到哪些人的数据」—— 全站唯一的一份阶梯。
 *
 * ## 为什么要收在一处
 *
 * 这套规则原本在 `pages/api/user/list.ts` 里写了一遍、在 chat 会话族四个接口里各写了
 * 一遍，而**只有 user/list.ts 写全了**。后果是 2026-08-27 发现的这个样子：租户管理员
 * square 在人员管理里根本看不到超管 admin 这个人，却在用量明细、会话列表、导出里
 * 读得到他每一轮问了什么。**人名藏住了，内容没藏。**
 *
 * 症状不像安全问题、像数据错乱，所以很难被当成漏洞上报 —— 这正是把它收进一个模块
 * 的理由：漏掉一档不再是「某个文件少写了两行」，而是根本没有别的地方可以写。
 *
 * ## 阶梯
 *
 * | 查看者 | 能看到 |
 * |---|---|
 * | 超级管理员 | 全部 |
 * | 租户管理员 | 本租户，**排除超管** |
 * | 部门管理员 | 本部门**子树**，**排除超管与租户管理员** |
 * | 其余 | 只有自己 |
 *
 * 两条容易漏的：
 *
 * 1. **排除更高权限者**。只做租户收窄看起来已经够安全了，漏掉的正是这一条。
 * 2. **部门是子树，不是精确部门**。技术部的管理员要看得到开发组、数据组的人。
 *    后端 `app/utils/org_scope.py` 记着同一条规则（那里还解释了为什么这个方向
 *    极易搞反），Skill 管理已经按子树在跑；人员管理原先是精确 `dept_id =`，
 *    于是同一个技术部管理员看得到开发组的 skill、看不到开发组的人。统一到子树。
 *
 * ## 缺范围数据一律收敛
 *
 * 挂着管理员角色但 tenant_id / dept_id 是空的，落到「只看自己」，**不是放开**。
 * 后端曾把「查不到租户」和「不限租户」共用一个 null 哨兵，结果一个没归属租户的
 * 普通用户看得到全平台的用量。失败方向必须朝「看不见」倒。
 *
 * ## 角色判据带 is_system
 *
 * 租户可以自建同名角色（`roles.tenant_id` 非空）。`isSuperAdmin()` 判的是
 * name + is_system，所以这里也必须带上，否则同一个人在两条代码路径上是不同角色。
 */

/** 目标数据挂在谁名下 —— 调用方必须显式说清，因为每张表的列名都不一样。 */
export interface VisibilityColumns {
  /** 该行归属人的 user id 列。如 `cs.user_id`、`u.id`、`t.user_id` */
  userIdCol: string;
  /** 该归属人的 users 行别名，用来取 tenant_id / dept_id。如 `u` */
  userAlias: string;
}

export interface VisibilityScope {
  /** 追加到 WHERE 的条件（已按 $n 编号）。可能为空数组（超管）。 */
  conditions: string[];
  /** 与 conditions 对应的位置参数，按顺序 push 到调用方的数组里。 */
  params: unknown[];
  /** 下一个可用的 $n。调用方继续用它拼自己的筛选条件。 */
  nextIndex: number;
  /** 查看者档位，供调用方校验入参（如「传了别人的 dept_id」）时复用。 */
  tier: VisibilityTier;
  perms: UserPermissions;
}

export type VisibilityTier = "super" | "tenant" | "dept" | "self";

/** 只认系统角色 —— 与 lib/permissions.ts 的 isSuperAdmin 同口径。 */
function hasSystemRole(perms: UserPermissions, name: string): boolean {
  return perms.roles.some((r) => r.name === name && r.isSystem);
}

export function resolveTier(perms: UserPermissions): VisibilityTier {
  if (hasSystemRole(perms, "超级管理员")) return "super";
  if (hasSystemRole(perms, "租户管理员") && perms.tenantId) return "tenant";
  if (hasSystemRole(perms, "部门管理员") && perms.deptId) return "dept";
  return "self";
}

/**
 * 排除比查看者权限更高的人。
 *
 * 相关子查询挂在 `userIdCol` 上，所以调用方给的必须是**归属人**的 id 列，
 * 不是当前登录者。
 */
function excludeHigherRoles(userIdCol: string, names: string[]): string {
  const quoted = names.map((n) => `'${n}'`).join(", ");
  return `NOT EXISTS (
    SELECT 1 FROM user_roles ur_v JOIN roles r_v ON r_v.id = ur_v.role_id
     WHERE ur_v.user_id = ${userIdCol} AND r_v.is_system AND r_v.name IN (${quoted})
  )`;
}

/**
 * 部门子树。
 *
 * 用一条相关子查询而不是先查一遍 id 列表，是为了让调用方只多一个位置参数、
 * 不用改成 `= ANY($n)`。`d_v.id = dv.id` 那一支保证「部门没有 path」时退化成
 * 它自己而不是塌成空集 —— 与后端 `dept_ids_at_or_below` 的退化规则一致。
 *
 * path 前缀必须带分隔符：`'TECHOPS'` 以 `'TECH'` 开头，但它是同级的另一个部门。
 */
const DEPT_SUBTREE_SELECT = `
    SELECT d_v.id FROM dept d_v, dept dv
     WHERE dv.id = $1
       AND (d_v.id = dv.id
            OR (dv.path IS NOT NULL
                AND (d_v.path = dv.path OR d_v.path LIKE dv.path || '/%')))`;

/** 把上面那段里的 `$1` 换成调用方的实际编号。只有一份定义，改一处即全站生效。 */
function deptSubtreeSelect(idx: number): string {
  return DEPT_SUBTREE_SELECT.replaceAll("$1", `$${idx}`);
}

function deptSubtree(userAlias: string, idx: number): string {
  return `${userAlias}.dept_id IN (${deptSubtreeSelect(idx)}\n  )`;
}

/**
 * 算出这次查询的可见范围。
 *
 * @param startIndex 调用方当前的 `$n` 计数（第一个可用编号，通常是 1）
 * @returns null 表示查不到这个用户 —— 调用方应当 404/401，**不要当成超管放行**
 */
export async function buildVisibilityScope(
  viewerId: number,
  cols: VisibilityColumns,
  startIndex: number
): Promise<VisibilityScope | null> {
  const perms = await getUserPermissions(viewerId);
  if (!perms) return null;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = startIndex;
  const tier = resolveTier(perms);

  if (tier === "tenant") {
    conditions.push(`${cols.userAlias}.tenant_id = $${idx}`);
    params.push(perms.tenantId);
    idx++;
    conditions.push(excludeHigherRoles(cols.userIdCol, ["超级管理员"]));
  } else if (tier === "dept") {
    conditions.push(deptSubtree(cols.userAlias, idx));
    params.push(perms.deptId);
    idx++;
    conditions.push(excludeHigherRoles(cols.userIdCol, ["超级管理员", "租户管理员"]));
  } else if (tier === "self") {
    conditions.push(`${cols.userIdCol} = $${idx}`);
    params.push(viewerId);
    idx++;
  }
  // tier === "super"：不加任何条件

  return { conditions, params, nextIndex: idx, tier, perms };
}

/**
 * 某部门及其全部下级的 id。部门没有 path 时退化成「只有它自己」，不猜。
 *
 * 与后端 `app/utils/org_scope.py:dept_ids_at_or_below` 同一条规则。**两边要一起改。**
 *
 * 用途是校验筛选入参（「部门管理员传的 dept_id 在不在自己管得着的范围里」）——
 * 那些校验只决定返回 403 还是空列表，真正的边界始终是 buildVisibilityScope 拼进
 * WHERE 的条件。即便如此也要按子树判：否则会出现「看得到开发组的会话、
 * 却不许按开发组筛」这种自相矛盾。
 */
export async function deptIdsAtOrBelow(deptId: number | null): Promise<number[]> {
  if (!deptId) return [];
  // 与 buildVisibilityScope 用的是**同一段** SQL（DEPT_SUBTREE_SELECT）。
  // 早先这里抄了一份，两份都对的时候看不出问题 —— 直到变异验证把其中一份改坏、
  // 断言却照样通过，才暴露出「改一处不等于改了全部」。
  const { rows } = await pool.query(DEPT_SUBTREE_SELECT, [deptId]);
  return rows.map((r: { id: number }) => r.id);
}

/** 某人是否持有指定的**系统**角色。用于 JS 层的单行鉴权。 */
async function holdsSystemRole(userId: number, names: string[]): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = $1 AND r.is_system AND r.name = ANY($2::text[]) LIMIT 1`,
    [userId, names]
  );
  return rows.length > 0;
}

/**
 * 单行鉴权：这个查看者能不能看这一条（已知它归属于谁）。
 *
 * 与 buildVisibilityScope 是**同一张梯子的两种形态** —— 一个拼进 WHERE 批量收窄，
 * 一个对已取出的行做判定。两者必须给出一致的答案：如果列表里看不到某条、
 * 详情却打得开（或者反过来），那就是授权漏洞。改一个必须改另一个。
 */
export async function canViewOwner(
  scope: VisibilityScope,
  owner: { userId: number; tenantId: number | null; deptId: number | null }
): Promise<boolean> {
  const { tier, perms } = scope;
  if (tier === "super") return true;
  if (tier === "tenant") {
    if (owner.tenantId !== perms.tenantId) return false;
    return !(await holdsSystemRole(owner.userId, ["超级管理员"]));
  }
  if (tier === "dept") {
    const scopeDepts = await deptIdsAtOrBelow(perms.deptId);
    if (!owner.deptId || !scopeDepts.includes(owner.deptId)) return false;
    return !(await holdsSystemRole(owner.userId, ["超级管理员", "租户管理员"]));
  }
  return owner.userId === perms.userId;
}
