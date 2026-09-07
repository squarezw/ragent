/**
 * 数字员工列表的租户分组。
 *
 * 只有超管会看到多个租户的应用；其他人后端就只返回本租户那些，分组会得到
 * 一个孤零零的组头，没有信息量。所以「要不要分组」由调用方按角色决定，
 * 这里只负责分组本身。
 */

export interface GroupableApp {
  id: number;
  owner_tenant_id?: number | null;
}

export interface AppGroup<T> {
  /** 租户 id；未归属为 null */
  tenantId: number | null;
  /** 组标题。租户名查不到时回退 `租户 #<id>`，不留空 */
  label: string;
  apps: T[];
}

/** 未归属那一组排在最后：它是「待处理」而不是一个真实租户 */
const UNASSIGNED_SORT_KEY = Number.MAX_SAFE_INTEGER;

/**
 * 按租户分组。**组内顺序原样保留** —— 后端已经按「默认应用置顶 + 更新时间
 * 倒序」排好，这里再排一次就等于把那条规则复制到第二个地方，两边迟早分叉。
 *
 * 组的顺序：按该组里第一个应用在原数组中的位置。因为原数组已经是「最近更新
 * 在前」，这等价于**最近有人动过的租户排在前面** —— 比按租户名字母序有用，
 * 超管打开列表通常是来找刚才在弄的那个。
 */
export function groupAppsByTenant<T extends GroupableApp>(
  apps: T[],
  tenantNames: Map<number, string>,
  unassignedLabel: string
): AppGroup<T>[] {
  const groups = new Map<number | null, AppGroup<T>>();
  for (const app of apps) {
    const id = app.owner_tenant_id ?? null;
    let g = groups.get(id);
    if (!g) {
      g = {
        tenantId: id,
        label:
          id === null
            ? unassignedLabel
            : // 租户被删或列表没拉到时不能显示空标题——那样一组应用会挂在
              // 一个看不出归属的空白下面
              tenantNames.get(id) ?? `租户 #${id}`,
        apps: [],
      };
      groups.set(id, g);
    }
    g.apps.push(app);
  }
  return [...groups.values()].sort((a, b) => {
    const ka = a.tenantId === null ? UNASSIGNED_SORT_KEY : 0;
    const kb = b.tenantId === null ? UNASSIGNED_SORT_KEY : 0;
    return ka - kb;   // 只把未归属推到末尾，其余保持插入顺序（= 最近更新在前）
  });
}
