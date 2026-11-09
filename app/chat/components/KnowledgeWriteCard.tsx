"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import axios from "@/lib/axios";
import type { KnowledgeWriteConfirmation } from "@/lib/knowledgeWrite";

export default function KnowledgeWriteCard({
  selection,
}: {
  selection: KnowledgeWriteConfirmation;
}) {
  const t = useTranslations("chat");
  const [datasetId, setDatasetId] = useState("");
  const [state, setState] = useState<
    "pending" | "submitting" | "processing" | "cancelled" | "error"
  >("pending");
  const submitting = useRef(false);

  const confirm = async () => {
    if (!datasetId || submitting.current || state !== "pending") return;
    submitting.current = true;
    setState("submitting");
    try {
      const response = await axios.post(
        "/api/knowledge/write-selection",
        {
          request_id: selection.request_id,
          chat_id: selection.chat_id,
          dataset_id: datasetId,
        },
        { suppressErrorToast: true }
      );
      setState(response.data?.status === "processing" ? "processing" : "error");
    } catch {
      // Do not replay an uncertain mutation; the server also consumes confirmation once.
      setState("error");
    }
  };

  return (
    <section
      className="rounded-lg border bg-card p-4 space-y-3"
      aria-label={t("knowledgeWriteTitle")}
    >
      <p className="font-medium">{t("knowledgeWriteTitle")}</p>
      <p className="text-sm break-words">
        {t("knowledgeWriteChoose", { filename: selection.filename })}
      </p>
      {(state === "pending" || state === "submitting") && (
        <>
          <label className="block text-sm">
            {t("knowledgeWriteDataset")}
            <select
              className="mt-1 block w-full rounded border bg-background p-2"
              value={datasetId}
              disabled={state === "submitting"}
              onChange={(event) => setDatasetId(event.target.value)}
            >
              <option value="">{t("knowledgeWritePlaceholder")}</option>
              {selection.datasets.map((dataset) => (
                <option key={dataset.id} value={dataset.id}>
                  {dataset.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
              disabled={!datasetId || state === "submitting"}
              onClick={confirm}
            >
              {t(state === "submitting" ? "knowledgeWriteSubmitting" : "knowledgeWriteConfirm")}
            </button>
            <button
              type="button"
              className="rounded border px-3 py-2 text-sm"
              disabled={state === "submitting"}
              onClick={() => setState("cancelled")}
            >
              {t("knowledgeWriteCancel")}
            </button>
          </div>
        </>
      )}
      {state === "processing" && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("knowledgeWriteProcessing")}
        </p>
      )}
      {state === "cancelled" && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("knowledgeWriteCancelled")}
        </p>
      )}
      {state === "error" && (
        <p role="alert" className="text-sm text-destructive">
          {t("knowledgeWriteError")}
        </p>
      )}
    </section>
  );
}
