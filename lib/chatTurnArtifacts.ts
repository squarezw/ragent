/** Public view of one successful upload belonging to a single conversation turn. */
export interface ChatTurnArtifact {
  id: string;
  filename: string;
  url: string;
}

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function validName(name: unknown): name is string {
  return typeof name === "string" && !/[\\\u0000-\u001f\u007f]/.test(name) &&
    name.split("/").every(part => !!part && part !== "." && part !== "..");
}

/** Construct only local download URLs, never forward a stored signer URL or object key. */
export function turnArtifacts(sessionId: string | number, entries: unknown): ChatTurnArtifact[] {
  if (!/^[1-9]\d*$/.test(String(sessionId)) || !Array.isArray(entries)) return [];
  const artifacts: ChatTurnArtifact[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!entry || typeof entry.id !== "string" || !uuid.test(entry.id) ||
        seen.has(entry.id) || !validName(entry.filename)) continue;
    seen.add(entry.id);
    const name = entry.filename.split("/").pop()!;
    const url = `/api/chat/sessions/${sessionId}/artifacts/${entry.id}/download?filename=${encodeURIComponent(name)}`;
    artifacts.push({ id: entry.id, filename: entry.filename, url });
  }
  return artifacts;
}

/** undefined leaves ordinary or external links alone; null means an unresolved local filename. */
export function relativeArtifactUrl(raw: string | undefined, artifacts?: ChatTurnArtifact[]): string | null | undefined {
  if (!artifacts || !raw || /^(?:[a-z][a-z\d+.-]*:|[/#?])/i.test(raw)) return undefined;
  let name: string;
  try { name = decodeURIComponent(raw.replace(/^\.\//, "")); } catch { return null; }
  if (!/\.[a-z\d]{1,12}$/i.test(name)) return undefined;
  if (!validName(name)) return null;
  const exact = artifacts.filter(file => file.filename === name);
  const matches = exact.length || name.includes("/") ? exact : artifacts.filter(file => file.filename.split("/").pop() === name);
  return matches.length === 1 ? matches[0].url : null;
}
