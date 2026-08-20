"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Building2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import DeptSelect from "@/components/DeptSelect";
import { useOrganization } from "@/hooks/useOrganization";

/**
 * Skill 列表的「租户 / 部门」两级筛选。
 *
 * ## 只收窄，不放宽
 *
 * 这两个下拉是**视图收窄**手段，不是授权入口。后端先按 RBAC 算出这个人允许
 * 看到的集合，再套这里选的条件。普通用户就算手改请求传别人的租户 id，拿到的
 * 也是空列表。所以这里藏不藏选项都不构成安全边界 —— 藏起来只是为了别让人
 * 面对一堆选了也没结果的选项。
 *
 * ## 默认值按角色，让人打开就看到对自己有用的范围
 *
 * | 角色 | 租户 | 部门 |
 * |---|---|---|
 * | 超级管理员 | 全部 | 全部 |
 * | 租户管理员 | 本租户（锁定） | 全部 |
 * | 部门管理员 | 本租户（锁定） | 本部门（含下级） |
 * | 普通用户 | 不显示这个组件 |
 *
 * 部门管理员默认落在自己部门，是因为他打开这个页面最常是想看「我们部门有什么」；
 * 想看更大范围把部门清空即可。反过来默认全部、让他每次自己选，是把一步操作
 * 摊到每一次打开。
 *
 * ## 为什么部门是「含下级」
 *
 * 选`技术部`会连`开发组`、`数据组`一起显示。子树展开在后端按 `dept.path` 做，
 * 前端不重复实现一遍层级规则 —— 同一条规矩写在两处，一定会长成两个样子。
 */

export interface SkillOrgFilterValue {
  tenantId: number | null;
  deptId: number | null;
}

interface Props {
  value: SkillOrgFilterValue;
  onChange: (v: SkillOrgFilterValue) => void;
  /** 超管：可跨租户选择；其余人租户锁定在自己的 */
  isSuperAdmin: boolean;
  /** 当前用户的租户 / 部门，用于锁定与默认值 */
  userTenantId: number | null;
  userDeptId: number | null;
  /** 文案由调用方给，避免这个组件自己再引一套 i18n 命名空间 */
  labels: {
    allTenants: string;
    allDepts: string;
    tenant: string;
    dept: string;
    reset: string;
    deptIncludesChildren: string;
  };
}

const ALL = "__all__";

export default function SkillOrgFilter({
  value,
  onChange,
  isSuperAdmin,
  userTenantId,
  userDeptId,
  labels,
}: Props) {
  const { tenants, departments } = useOrganization();

  // 只列出所选租户下的部门。不过滤的话，超管切到租户 B 之后，部门下拉里
  // 还留着租户 A 的部门 —— 选中它得到的是空列表，而原因完全看不出来。
  const deptsOfTenant = useMemo(() => {
    const tid = isSuperAdmin ? value.tenantId : userTenantId;
    if (tid == null) return departments;
    return departments.filter((d) => d.tenant_id === tid);
  }, [departments, isSuperAdmin, value.tenantId, userTenantId]);

  const handleTenant = (raw: string) => {
    const next = raw === ALL ? null : Number(raw);
    // 换租户必须清掉部门：留着上一个租户的部门 id，筛出来一定是空的。
    onChange({ tenantId: next, deptId: null });
  };

  const showReset = value.tenantId != null || value.deptId != null;

  return (
    <div className="flex items-center gap-2">
      <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />

      {isSuperAdmin && (
        <Select value={value.tenantId == null ? ALL : String(value.tenantId)} onValueChange={handleTenant}>
          <SelectTrigger className="w-40" aria-label={labels.tenant}>
            <SelectValue placeholder={labels.allTenants} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{labels.allTenants}</SelectItem>
            {tenants.map((tn) => (
              <SelectItem key={tn.id} value={String(tn.id)}>
                {tn.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <div className="w-48" title={labels.deptIncludesChildren}>
        <DeptSelect
          depts={deptsOfTenant}
          value={value.deptId}
          onChange={(deptId) => onChange({ ...value, deptId })}
          placeholder={labels.allDepts}
        />
      </div>

      {showReset && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange({ tenantId: null, deptId: null })}
          title={labels.reset}
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

/**
 * 算这个角色打开页面时该落在哪 —— 与组件分开，好单测。
 *
 * 返回 null 表示「不该显示筛选器」（普通用户：他能看到的本来就只有自己那点，
 * 再给两个下拉只是噪音）。
 */
export function defaultOrgFilter(opts: {
  isSuperAdmin: boolean;
  isTenantAdmin: boolean;
  isDeptAdmin: boolean;
  userTenantId: number | null;
  userDeptId: number | null;
}): SkillOrgFilterValue | null {
  const { isSuperAdmin, isTenantAdmin, isDeptAdmin, userTenantId, userDeptId } = opts;
  if (isSuperAdmin) return { tenantId: null, deptId: null };
  if (isTenantAdmin) return { tenantId: userTenantId, deptId: null };
  if (isDeptAdmin) return { tenantId: userTenantId, deptId: userDeptId };
  return null;
}
