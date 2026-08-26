"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { type UsingDefaultRow, useRates } from "@/hooks/useBilling";
import { toast } from "sonner";

const TYPE_LABEL: Record<string, string> = {
  model: "模型",
  skill: "Skill",
  tool: "工具",
};

const TYPE_UNIT: Record<string, string> = {
  model: "相对基准模型的价格倍率",
  skill: "每次调用的积分",
  tool: "每次调用的积分",
};

export default function RatesPage() {
  const { defaults, explicit, usingDefault, loading, error, save, remove } = useRates();
  const [editing, setEditing] = useState<{ type: string; key: string; name?: string } | null>(null);
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");

  const submit = async () => {
    if (!editing) return;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) {
      toast.error("系数必须是非负数");
      return;
    }
    try {
      await save(editing.type, editing.key, n, editing.name, reason);
      toast.success("已保存，变更已记入审计");
      setEditing(null);
      setValue("");
      setReason("");
    } catch {
      toast.error("保存失败");
    }
  };

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-md border border-destructive/50 text-destructive px-3 py-2 text-sm">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">计费系数</h1>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-x-6 gap-y-2 flex-wrap">
            <CardTitle className="text-base whitespace-nowrap">全局默认值</CardTitle>
            {/* 三项横排。原先一项一张卡竖着排，三行卡片占掉整屏，
                  而这里的信息量其实只有三个数字 —— 页面的主角是下面那两张表。
                  单位说明收进 title，悬停可见，不再单独占一行。 */}
            {(["model", "skill", "tool"] as const).map((t) => (
              <div key={t} className="flex items-center gap-2" title={TYPE_UNIT[t]}>
                <span className="text-sm text-muted-foreground">{TYPE_LABEL[t]}</span>
                <span className="text-lg font-semibold tabular-nums">{defaults[t] ?? "—"}</span>
                {/* outline 而不是 ghost：这一行是操作入口。无边框的按钮夹在一排
                      数字中间，读起来像普通文字，看不出可以点 */}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2.5 text-xs"
                  onClick={() => {
                    setEditing({ type: t, key: "*", name: "全局默认" });
                    setValue(String(defaults[t] ?? 1));
                  }}
                >
                  修改
                </Button>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            未显式设置系数的条目按这里的值计费。
            <span className="text-amber-600">
              开启真实扣费前，请先把下方「在吃默认值」的条目过一遍。
            </span>
          </p>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            在吃默认值的条目
            <Badge variant="outline" className="ml-2">
              {usingDefault.length}
            </Badge>
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            这些条目没有显式系数。
            <strong>「明确判定免费（设 0）」与「新绑忘了设」在库里是两回事</strong>
            —— 调高全局默认时，前者不该被误涨价。
          </p>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground py-3">加载中…</p>
          ) : usingDefault.length === 0 ? (
            <p className="text-sm text-muted-foreground py-3">全部条目都已显式设置。</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {usingDefault.map((r: UsingDefaultRow) => (
                <Button
                  key={`${r.rate_type}:${r.ref_key}`}
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditing({ type: r.rate_type, key: r.ref_key, name: r.name });
                    setValue(String(defaults[r.rate_type] ?? 1));
                  }}
                >
                  <Badge variant="secondary" className="mr-1.5 font-normal">
                    {TYPE_LABEL[r.rate_type]}
                  </Badge>
                  {r.name}
                </Button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">已显式设置</CardTitle>
        </CardHeader>
        <CardContent>
          {explicit.length === 0 ? (
            <p className="text-sm text-muted-foreground py-3">还没有显式系数。</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>类型</TableHead>
                  <TableHead>标识</TableHead>
                  <TableHead>系数</TableHead>
                  <TableHead>备注</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {explicit.map((r) => (
                  <TableRow key={`${r.rate_type}:${r.ref_key}`}>
                    <TableCell>{TYPE_LABEL[r.rate_type] ?? r.rate_type}</TableCell>
                    <TableCell className="font-mono text-xs">{r.ref_key}</TableCell>
                    <TableCell className="font-medium">{Number(r.coefficient)}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{r.note || "—"}</TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditing({ type: r.rate_type, key: r.ref_key, name: r.note ?? "" });
                          setValue(String(Number(r.coefficient)));
                        }}
                      >
                        修改
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={async () => {
                          try {
                            await remove(r.rate_type, r.ref_key);
                            // 删除 = 回落默认，不是免费。说清楚免得被误解
                            toast.success("已删除，该条目回落到全局默认值");
                          } catch {
                            toast.error("删除失败");
                          }
                        }}
                      >
                        删除
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* 编辑用 modal，不用页面底部的内联卡片。
          内联的话，点不同行只是让下方那块内容变，用户还要滚下去找 ——
          条目一多（当前「在吃默认值」有十几个）就完全失去位置感。 */}
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
            <DialogTitle>
              设置系数 — {editing ? TYPE_LABEL[editing.type] : ""} · {editing?.name || editing?.key}
            </DialogTitle>
            <DialogDescription>{editing ? TYPE_UNIT[editing.type] : ""}</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="系数"
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
