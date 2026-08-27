"use client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useRecharges } from "@/hooks/useBilling";

interface Props {
  /** 只在有选中租户时挂载 —— hook 依赖 tenantId，挂着一个 undefined 的会去拉全部租户 */
  tenantId: number;
  tenantName: string;
  balance: number | null;
  onClose: () => void;
}

/** 某个租户的充值明细：这些积分哪来的、谁充的、为什么。 */
export default function RechargeHistoryDialog({
  tenantId,
  tenantName,
  balance,
  onClose,
}: Props) {
  const { items, total, loading } = useRecharges(tenantId, 1, 200);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{tenantName} · 充值明细</DialogTitle>
          <DialogDescription>
            {balance === null ? `共 ${total} 笔` : `共 ${total} 笔 · 当前余额 ${balance.toFixed(2)} 积分`}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">加载中…</p>
        ) : items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">还没有充值记录</p>
        ) : (
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">时间</th>
                  <th className="py-2 pr-4 text-right font-medium">积分</th>
                  <th className="py-2 pr-4 font-medium">操作人</th>
                  <th className="py-2 font-medium">备注</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="py-2 pr-4 whitespace-nowrap">
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">+{r.amount.toFixed(2)}</td>
                    <td className="py-2 pr-4">
                      {r.operator_name || r.operator_username || "—"}
                    </td>
                    {/* 备注是对账时「这笔钱哪来的」的唯一线索 */}
                    <td className="py-2 text-muted-foreground">{r.note || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
