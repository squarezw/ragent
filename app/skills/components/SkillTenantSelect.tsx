"use client";

import React, { useEffect, useState } from "react";
import axios from "@/lib/axios";
import { AlertTriangle, Building2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * 跨租户迁移 Skill —— **只给超级管理员看**，调用方负责不渲染给别人。
 *
 * ## 为什么需要它
 *
 * `owner_tenant_id` 是创建时的快照。用户被调去别的租户时它不跟着走，于是内容留在
 * 旧租户：旧租户的管理员还管得着，新租户的管理员管不了自己人的东西。这个下拉把
 * 「搬家」做成一次显式操作。
 *
 * 做成显式而不是挂在人事变动上自动跟随，是因为自动跟随会让 `visibility=tenant`
 * 的内容**突然对另一个租户全体可见**——那是一次没人按下同意的数据搬迁。
 *
 * ## 为什么自带一个保存按钮
 *
 * 迁移改的是**归属**，不是内容：它不该跟着正文一起走保存/审核那条路。已发布的
 * skill 迁完还是那份内容，退回草稿重审一遍只会让线上少一个能用的技能。所以这里
 * 单独存、单独提示，对应后端独立端点 `PUT /skills/{id}/tenant`。
 *
 * ⚠️ 这里只管**显示**。真正的边界在后端：非超管一律 403，目标租户不存在 400，
 * 目标租户重名 409。藏起下拉不构成任何安全保证。
 */

interface Tenant {
  id: number;
  name: string;
}

interface Props {
  /** skill 当前归属；null = 无主租户（历史数据，只有超管看得见） */
  currentTenantId: number | null;
  /** 执行迁移。抛错由调用方 toast，这里只负责把按钮从 loading 里放出来 */
  onTransfer: (tenantId: number) => Promise<void>;
}

export default function SkillTenantSelect({ currentTenantId, onTransfer }: Props) {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState<number | null>(currentTenantId);
  const [saving, setSaving] = useState(false);

  // 迁移成功后父组件会刷新 skill，currentTenantId 随之变化 —— 把选中值跟上，
  // 否则保存完按钮还亮着，看起来像没存进去
  useEffect(() => {
    setSelected(currentTenantId);
  }, [currentTenantId]);

  useEffect(() => {
    let cancelled = false;
    axios
      .get("/api/organization/tenants")
      .then((res) => {
        if (!cancelled) setTenants(res.data?.tenants || []);
      })
      .catch(() => {
        // 拉不到时显示错误而不是一个空下拉：空下拉看起来像"没有别的租户可选"，
        // 会让人以为迁移不可用，而不是"这次没加载出来"
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const changed = selected != null && selected !== currentTenantId;

  const handleSave = async () => {
    if (!changed || selected == null) return;
    setSaving(true);
    try {
      await onTransfer(selected);
    } finally {
      // 失败也要放出来，否则用户改完名想重试却点不动
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium flex items-center gap-2">
        <Building2 className="h-4 w-4" />
        所属租户
        <span className="text-xs font-normal text-muted-foreground">（仅超级管理员可改）</span>
      </label>

      {loadError ? (
        <p className="text-sm text-destructive">租户列表加载失败，请刷新页面重试。</p>
      ) : (
        <div className="flex items-center gap-2">
          <Select
            value={selected != null ? String(selected) : undefined}
            onValueChange={(v) => setSelected(Number(v))}
            disabled={saving}
          >
            <SelectTrigger className="w-full max-w-sm">
              <SelectValue
                placeholder={currentTenantId == null ? "无主租户（未归属）" : "选择租户"}
              />
            </SelectTrigger>
            <SelectContent>
              {tenants.map((tn) => (
                <SelectItem key={tn.id} value={String(tn.id)}>
                  {tn.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* 没改时禁用而不是隐藏：按钮凭空出现会让人以为刚才的选择没被记住 */}
          <Button size="sm" onClick={handleSave} disabled={!changed || saving}>
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            保存租户
          </Button>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        用户被调到其它租户时，他已创建的 Skill 不会自动跟着走。这里可以把它迁到正确的租户。
        <span className="ml-1">迁移单独保存，不影响正文，也不需要重新审核。</span>
      </p>

      {changed && (
        <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-medium">点「保存租户」后这个 Skill 会归属到新租户，请确认：</p>
            <ul className="list-disc pl-4 space-y-0.5">
              <li>原租户的管理员将不再能编辑或删除它</li>
              <li>可见范围为「租户共享」时，内容会对新租户全体可见</li>
              <li>所属部门会被清空；可见范围为「部门共享」时需要重新选择</li>
              <li>新租户里已有同名 Skill 会保存失败，需要先改名</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
