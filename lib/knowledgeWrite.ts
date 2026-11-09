export interface KnowledgeWriteConfirmation {
  status: "confirmation_required";
  request_id: string;
  chat_id: string;
  filename: string;
  datasets: { id: string; name: string }[];
}

/** Display data only. The authenticated confirmation endpoint owns authorization. */
export function parseKnowledgeWriteConfirmation(value: unknown): KnowledgeWriteConfirmation | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (
    input.status !== "confirmation_required" ||
    typeof input.request_id !== "string" ||
    !/^[a-zA-Z0-9_-]{20,128}$/.test(input.request_id) ||
    typeof input.chat_id !== "string" ||
    !/^[1-9]\d*$/.test(input.chat_id) ||
    typeof input.filename !== "string" ||
    !input.filename ||
    input.filename.length > 1024 ||
    !Array.isArray(input.datasets) ||
    !input.datasets.length ||
    input.datasets.length > 1000
  )
    return null;
  const datasets: KnowledgeWriteConfirmation["datasets"] = [];
  for (const item of input.datasets) {
    if (
      !item ||
      typeof item.id !== "string" ||
      !/^[a-fA-F0-9-]{36}$/.test(item.id) ||
      typeof item.name !== "string" ||
      !item.name ||
      item.name.length > 1024
    )
      return null;
    datasets.push({ id: item.id, name: item.name });
  }
  return {
    status: "confirmation_required",
    request_id: input.request_id,
    chat_id: input.chat_id,
    filename: input.filename,
    datasets,
  };
}
