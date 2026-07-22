"use client";

import { useTranslations } from "next-intl";
import { JsonBlock } from "./JsonBlock";
import type { ObserveParams } from "./types";

interface ParamsPanelProps {
  params: ObserveParams;
}

export function ParamsPanel({ params }: ParamsPanelProps) {
  const t = useTranslations("zdObserve");
  const { previewAgent, baidu, attachments, wecom } = params;

  return (
    <div className="divide-y text-sm">
      {/* OA 入参（原文较长，折叠 JSON） */}
      <Section title={t("params.oaSubmit")}>
        <JsonBlock value={params.oaSubmit} label={t("params.viewJson")} />
      </Section>

      {/* 百度网盘 */}
      {baidu && (
        <Section title={t("params.baidu")}>
          <KV k={t("params.shareUrl")} v={baidu.shareUrl} />
          <KV k={t("params.instruction")} v={baidu.instruction} />
          <KV k={t("params.sharePwd")} v={baidu.sharePwd} />
        </Section>
      )}

      {/* 附件下载 */}
      {attachments.length > 0 && (
        <Section title={t("params.attachments")}>
          <ul className="space-y-0.5">
            {attachments.map((a) => (
              <li key={a.url} className="truncate leading-snug">
                <a
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline"
                >
                  {a.name || a.url}
                </a>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* 预审智能体 */}
      <Section title={t("params.previewAgent")}>
        <KV k={t("params.appId")} v={previewAgent.appId} />
        <KV k={t("params.salesperson")} v={previewAgent.salespersonWechatId} />
        <KV k={t("params.detailId")} v={previewAgent.detailId} />
        <KV k={t("params.finishReason")} v={previewAgent.finishReason} />
        {previewAgent.content && (
          <div className="pt-1">
            <div className="text-muted-foreground mb-1">{t("params.content")}</div>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md border bg-muted/40 p-2 text-xs">
              {previewAgent.content}
            </pre>
          </div>
        )}
      </Section>

      {/* 企微拉群 */}
      <Section title={t("params.wecom")}>
        <KV k={t("params.weChatIds")} v={wecom.weChatIds.join(", ")} />
        <KV k={t("orderColumns.productCode")} v={wecom.productCode} />
        <KV k={t("params.chatId")} v={wecom.chatId} />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="py-2 first:pt-0 last:pb-0">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string | number | null }) {
  return (
    <div className="flex gap-2 leading-snug">
      <span className="w-20 shrink-0 text-muted-foreground">{k}</span>
      <span className="break-all">{v === null || v === "" ? "—" : v}</span>
    </div>
  );
}
