import axios from "@/lib/axios";

export async function transcribeRecording(
  blob: Blob, signal: AbortSignal, attempts = 30, interval = 1000,
  onProcessing?: () => void
): Promise<string> {
  const form = new FormData();
  const ext = blob.type.includes("wav") ? "wav" : blob.type.includes("mp4") ? "mp4" : "webm";
  form.append("file", blob, `recording.${ext}`);
  const { data } = await axios.post("/api/stt/single-speaker", form, { signal });
  if (!data.task_id) {
    const text = data.result?.text ?? data.text;
    if (typeof text !== "string") throw new Error("Invalid transcription");
    return text;
  }
  onProcessing?.();
  for (let i = 0; i < attempts; i++) {
    signal.throwIfAborted();
    const task = (await axios.get(`/api/stt/tasks/${encodeURIComponent(data.task_id)}`, { signal })).data;
    if (task.status === "completed" || task.status === "SUCCESS") return task.result?.text ?? task.text ?? "";
    if (task.status === "failed" || task.status === "FAILURE") throw new Error("Transcription failed");
    await new Promise<void>(resolve => {
      const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
      const timer = setTimeout(finish, interval);
      signal.addEventListener("abort", finish, { once: true });
      if (signal.aborted) finish();
    });
  }
  throw new Error("Transcription timeout");
}
