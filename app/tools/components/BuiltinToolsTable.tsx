"use client";

import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { BuiltinTool } from "@/hooks/useBuiltinTools";

/**
 * 内置工具清单（只读）。
 *
 * **刻意没有任何开关、编辑或删除。** 这些工具随代码发布、不在 `tools` 表里，授权判据
 * 写死在代码里（`sql_query` 仅超级管理员、`execute_skill` 看该应用绑了没绑 skill……）。
 * 摆一个改不动的开关比不摆更糟——那正是把 `app_tools` 勾选框当授权时的毛病：用户勾了
 * 以为生效了。所以这里明确写出"改这些要改代码"。
 *
 * 列里带上"依据"是有意的：判据从数据库搬进代码之后，这份清单是超管唯一能看到边界长什么
 * 样的地方，只给结论不给理由会让人无从判断该不该改。
 */
export function BuiltinToolsTable({
  builtins,
  meta,
  loading,
  error,
}: {
  builtins: BuiltinTool[];
  meta: { env_switch: string; note: string } | null;
  loading: boolean;
  error: string | null;
}) {
  const t = useTranslations("tools");

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return <div className="text-center py-12 text-destructive text-sm">{error}</div>;
  }

  if (builtins.length === 0) {
    return <div className="text-center py-12 text-muted-foreground">{t("noData")}</div>;
  }

  return (
    <div className="space-y-4">
      <div
        className="text-sm rounded-md p-3"
        style={{
          background: "var(--color-surface-subtle, rgba(0,0,0,0.03))",
          color: "var(--color-text-muted, inherit)",
        }}
      >
        {meta?.note}
        {meta?.env_switch && <> {t("builtinEnvHint", { envVar: meta.env_switch })}</>}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("name")}</TableHead>
            <TableHead>{t("builtinKind")}</TableHead>
            <TableHead>{t("builtinAuthorization")}</TableHead>
            <TableHead>{t("builtinWhy")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {builtins.map((b) => (
            <TableRow key={b.name}>
              <TableCell className="font-medium font-mono text-sm">
                <div className="flex items-center gap-2">
                  {b.name}
                  {b.disabled_by_env && (
                    <Badge variant="outline">{t("builtinDisabledByEnv")}</Badge>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <Badge variant="secondary">
                  {b.kind === "roster" ? t("builtinKindRoster") : t("builtinKindGateway")}
                </Badge>
              </TableCell>
              <TableCell className="text-sm">{b.authorization}</TableCell>
              <TableCell className="text-sm text-muted-foreground max-w-md">{b.why}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
