"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Pencil, Search } from "lucide-react";
import { useRates } from "@/hooks/useBilling";
import {
  RATE_TYPE_LABEL,
  RATE_TYPE_UNIT,
  countByType,
  describeCoefficient,
  filterRates,
  mergeRates,
  type MergedRate,
} from "@/lib/billingRates";
import { toast } from "sonner";

interface EditTarget {
  type: string;
  key: string;
  /** 弹窗标题里显示的名字，不写进库 */
  label: string;
  /** 库里原有的备注，原样带回去，避免一次改系数把别人写的备注冲掉 */
  note: string | null;
}

export function BillingRatesSection() {
  const { defaults, explicit, usingDefault, loading, error, save, remove } = useRates();
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [query, setQuery] = useState("");

  const rows = useMemo(
    () => mergeRates(explicit, usingDefault, defaults),
    [explicit, usingDefault, defaults]
  );
  const counts = useMemo(() => countByType(rows), [rows]);
  const visible = useMemo(() => filterRates(rows, typeFilter, query), [rows, typeFilter, query]);
  const pending = rows.filter((r) => !r.isExplicit).length;

  const submit = async () => {
    if (!editing) return;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) {
      toast.error("系数必须是非负数");
      return;
    }
    try {
      await save(editing.type, editing.key, n, editing.note ?? undefined, reason);
      toast.success("已保存，变更已记入审计");
      setEditing(null);
      setValue("");
      setReason("");
    } catch {
      toast.error("保存失败");
    }
  };

  const openEdit = (r: MergedRate) => {
    setEditing({ type: r.rateType, key: r.refKey, label: r.label, note: r.note });
    setValue(String(r.coefficient));
    setReason("");
  };

  if (error) {
    return (
      <div className="rounded-md border border-destructive/50 text-destructive px-3 py-2 text-sm">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 全局默认值：三个数字，一行放完。原先单独占一张卡，
          而它的信息量还不如下面表格的一行 */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <span className="text-muted-foreground">全局默认</span>
        {(["model", "skill", "tool"] as const).map((t) => (
          <span key={t} className="flex items-center gap-1.5" title={RATE_TYPE_UNIT[t]}>
            <span className="text-muted-foreground">{RATE_TYPE_LABEL[t]}</span>
            <span className="font-semibold tabular-nums">{defaults[t] ?? "—"}</span>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0"
              aria-label={`修改${RATE_TYPE_LABEL[t]}默认系数`}
              onClick={() => {
                setEditing({ type: t, key: "*", label: `${RATE_TYPE_LABEL[t]}全局默认`, note: null });
                setValue(String(defaults[t] ?? 1));
                setReason("");
              }}
            >
              <Pencil className="h-3 w-3" />
            </Button>
          </span>
        ))}
        {pending > 0 && (
          <span className="text-xs text-amber-600">
            {pending} 项还在用默认值，开启真实扣费前请先过一遍
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(["all", "model", "skill", "tool"] as const).map((t) => (
          <Button
            key={t}
            size="sm"
            variant={typeFilter === t ? "default" : "outline"}
            className="h-7 px-2.5 text-xs"
            onClick={() => setTypeFilter(t)}
          >
            {t === "all" ? "全部" : RATE_TYPE_LABEL[t]}
            <Badge variant="secondary" className="ml-1.5 font-normal">
              {counts[t] ?? 0}
            </Badge>
          </Button>
        ))}
        <div className="relative ml-auto">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索名称"
            className="h-7 w-48 pl-7 text-xs"
          />
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground py-3">加载中…</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-muted-foreground py-3">
          {rows.length === 0 ? "还没有可计费的条目。" : "没有匹配的条目。"}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">类型</TableHead>
              <TableHead>名称</TableHead>
              <TableHead className="w-32">系数</TableHead>
              <TableHead>备注</TableHead>
              <TableHead className="w-40 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((r) => {
              const { value: shown, tag } = describeCoefficient(r);
              return (
                <TableRow key={`${r.rateType}:${r.refKey}`}>
                  <TableCell className="text-muted-foreground">
                    {RATE_TYPE_LABEL[r.rateType] ?? r.rateType}
                  </TableCell>
                  <TableCell className="font-medium">{r.label}</TableCell>
                  <TableCell>
                    <span className="tabular-nums font-medium">{shown}</span>
                    {tag && (
                      <Badge
                        variant="outline"
                        className={`ml-2 font-normal ${
                          tag === "默认" ? "text-muted-foreground" : "text-amber-600 border-amber-300"
                        }`}
                      >
                        {tag}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">{r.note || "—"}</TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button size="sm" variant="ghost" onClick={() => openEdit(r)}>
                      {r.isExplicit ? "修改" : "设置"}
                    </Button>
                    {r.isExplicit && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground"
                        onClick={async () => {
                          try {
                            await remove(r.rateType, r.refKey);
                            // 说清楚是回落默认，不是变免费 —— 两者算出的钱可能一样，含义完全不同
                            toast.success("已恢复为全局默认值");
                          } catch {
                            toast.error("操作失败");
                          }
                        }}
                      >
                        恢复默认
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {/* 编辑用 modal，不用内联卡片：条目多时内联会让用户失去位置感 */}
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditing(null);
            setValue("");
            setReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.label}</DialogTitle>
            <DialogDescription>
              {editing ? RATE_TYPE_UNIT[editing.type] : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="系数，0 表示免费"
              autoFocus
              onKeyDown={(e) => {
                // 回车提交：改系数是高频操作，每次都去够鼠标很烦
                if (e.key === "Enter") submit();
              }}
            />
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="变更原因（进审计，用于解释「上个月为什么扣得少」）"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              取消
            </Button>
            <Button onClick={submit}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
