import { useTranslations } from "next-intl";
import type { SessionToolUsage } from "@/lib/sessionToolUsage";

export function SessionToolSummary({ usage }: { usage?: SessionToolUsage }) {
  const t = useTranslations("chatSessions");
  const tools = usage?.tools ?? [];
  const calls = tools.reduce((sum, tool) => sum + tool.calls, 0);
  const failures = tools.reduce((sum, tool) => sum + tool.failures, 0);
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">{t("toolCallsHeading")}</h3>
      {usage?.coverage === "partial" && <p className="text-sm text-muted-foreground">{t("toolCallsPartial")}</p>}
      {calls > 0 ? (
        <>
          <p className="text-sm">{t("toolCallsTotals", { count: calls, failed: failures })}</p>
          <table className="w-full table-fixed text-sm">
            <thead className="text-muted-foreground">
              <tr>
                <th scope="col" className="text-left">{t("toolCallsName")}</th>
                <th scope="col" className="w-20 text-right">{t("toolCallsCount")}</th>
                <th scope="col" className="w-20 text-right">{t("toolCallsFailed")}</th>
              </tr>
            </thead>
            <tbody>
              {tools.map(tool => (
                <tr key={tool.name} className="border-t">
                  <td className="break-all py-1 pr-2 font-mono">{tool.name}</td>
                  <td className="text-right tabular-nums">{tool.calls}</td>
                  <td className={`text-right tabular-nums ${tool.failures ? "text-destructive" : ""}`}>{tool.failures}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : usage?.coverage !== "partial" && (
        <p className="text-sm text-muted-foreground">{t(usage?.coverage === "complete" ? "toolCallsNone" : "toolCallsUnavailable")}</p>
      )}
    </section>
  );
}
