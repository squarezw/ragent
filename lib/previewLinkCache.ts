/** Memory-only hints. Every use must still be authorized by stream-url. */
export class PreviewLinkCache {
  private entries = new Map<string, { token: string; expiresAt: number }>();
  private scope = "";
  private generation = 0;
  private readonly capacity: number;
  constructor(capacity = 20) {
    this.capacity = capacity;
  }

  setScope(scope: string) {
    if (scope !== this.scope) {
      this.clear();
      this.scope = scope;
    }
    return this.generation;
  }

  clear() {
    this.entries.clear();
    ++this.generation;
  }

  isCurrent(generation: number) {
    return generation === this.generation;
  }

  get(fileId: string, now = Date.now()) {
    const entry = this.entries.get(fileId);
    if (!entry) return undefined;
    if (entry.expiresAt - now <= 120_000) {
      this.entries.delete(fileId);
      return undefined;
    }
    return entry.token;
  }

  put(fileId: string, url: string, expiresIn: number, requestedAt: number, generation: number) {
    if (!this.isCurrent(generation)) return;
    this.entries.delete(fileId);
    if (!url.startsWith("/api/file-preview/stream?")) return;
    const parsed = new URL(url, "https://preview.invalid");
    const token = parsed.searchParams.get("token");
    if (!token || !Number.isFinite(expiresIn) || expiresIn <= 120) return;
    const expiresAt = requestedAt + expiresIn * 1000;
    this.entries.set(fileId, { token, expiresAt });
    while (this.entries.size > this.capacity) {
      const first = this.entries.keys().next().value;
      if (first === undefined) break;
      this.entries.delete(first);
    }
  }
}
