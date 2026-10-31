/** Per-tab operation context; never writes account identity or JWT claims. */
export const WORKSPACE_HEADER = "X-Workspace-Tenant-ID";
let state = { enabled: false, tenantId: null as number | null, actorId: null as number | null, generation: 0 };
const controllers = new Set<AbortController>();
let writes = 0;
export function getWorkspaceSnapshot() { return { ...state }; }
export function workspaceRequestHeaders(): Record<string, string> {
  return state.enabled && state.tenantId ? { [WORKSPACE_HEADER]: String(state.tenantId) } : {};
}
export function workspaceBusy() { return writes > 0; }
export function setWorkspaceOperation(enabled: boolean, actorId: number | null, tenantId: number | null) {
  if (state.enabled === enabled && state.actorId === actorId && state.tenantId === tenantId) return;
  for (const controller of controllers) controller.abort();
  controllers.clear();
  state = { enabled, actorId, tenantId, generation: state.generation + 1 };
}
export function beginWorkspaceRequest(write = false, signal?: AbortSignal | null) {
  const snapshot = getWorkspaceSnapshot();
  const controller = new AbortController();
  controllers.add(controller);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  if (write) writes++;
  let ended = false;
  let writeReleased = false;
  const releaseWrite = () => {
    if (write && !writeReleased) { writes--; writeReleased = true; }
  };
  const finish = () => {
    if (ended) return;
    ended = true;
    controllers.delete(controller);
    signal?.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", finish);
    releaseWrite();
  };
  controller.signal.addEventListener("abort", finish, { once: true });
  if (controller.signal.aborted) finish();
  return {
    signal: controller.signal,
    generation: snapshot.generation,
    headers: workspaceRequestHeaders(),
    releaseWrite,
    finish,
    isCurrent: () => snapshot.generation === state.generation,
  };
}

let uninstall: (() => void) | undefined;
const WORKSPACE_FETCH_INSTALLATION = Symbol.for("ragent.workspace-fetch-installation");
interface WorkspaceFetchInstallation {
  original: typeof fetch;
  dispose: () => void;
}
export function installWorkspaceFetch() {
  if (uninstall || typeof window === "undefined") return;
  const previous = (window.fetch as unknown as Record<symbol, WorkspaceFetchInstallation | undefined>)[WORKSPACE_FETCH_INSTALLATION];
  // HMR reloads module state. Retire the old closure before installing the new
  // one so it cannot overwrite the current actor/tenant headers.
  previous?.dispose();
  const original = previous?.original || window.fetch.bind(window);
  const wrapped: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.origin);
    if (!state.enabled || url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) return original(input, init);
    const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    const request = beginWorkspaceRequest(!["GET", "HEAD"].includes(method), init?.signal || (input instanceof Request ? input.signal : undefined));
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((v, k) => headers.set(k, v));
    for (const [key, value] of Object.entries(request.headers)) headers.set(key, value);
    try {
      const response = await original(input, { ...init, cache: "no-store", headers, signal: request.signal });
      if (!request.isCurrent()) throw new DOMException("Workspace changed", "AbortError");
      // Non-streaming writes have completed when the server sends headers. Do
      // not lock switching forever when a caller only checks response.ok.
      if (!response.headers.get("content-type")?.includes("text/event-stream")) request.releaseWrite();
      // Some browser fetch wrappers expose a stream even for responses that cannot
      // carry a body. Do not reconstruct those statuses with that stream.
      if (method === "HEAD" || [204, 205, 304].includes(response.status)) {
        request.finish();
        if (response.body) {
          // Cancellation is cleanup only: a stalled/rejected source must not
          // turn a completed logout into a failure or leave its write barrier held.
          try { void response.body.cancel().catch(() => {}); } catch {}
          const guarded = new Response(null, { status: response.status, statusText: response.statusText, headers: response.headers });
          return guardConsumption(copyResponseMetadata(response, guarded), request.isCurrent);
        }
        // Reuse an already empty response so an earlier HMR guard stays chained.
        return guardConsumption(response, request.isCurrent);
      }
      // Keep response bodies guarded even after their write barrier is released.
      if (response.body) {
        const reader = response.body.getReader();
        const body = new ReadableStream({
          async pull(controller) {
            try {
              const next = await reader.read();
              if (!request.isCurrent()) throw new DOMException("Workspace changed", "AbortError");
              if (next.done) { request.finish(); controller.close(); }
              else controller.enqueue(next.value);
            } catch (error) { request.finish(); controller.error(error); }
          },
          async cancel(reason) { request.finish(); await reader.cancel(reason); },
        });
        const guarded = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
        return guardConsumption(copyResponseMetadata(response, guarded), request.isCurrent);
      }
      request.finish();
      return guardConsumption(response, request.isCurrent);
    } catch (error) { request.finish(); throw error; }
  };
  const dispose = () => {
    state = { ...state, generation: state.generation + 1 };
    for (const controller of controllers) controller.abort();
    controllers.clear();
    if (window.fetch === wrapped) window.fetch = original;
    uninstall = undefined;
  };
  Object.defineProperty(wrapped, WORKSPACE_FETCH_INSTALLATION, { value: { original, dispose } });
  window.fetch = wrapped;
  uninstall = dispose;
}

// A body may already be buffered before a caller consumes it. Check again after
// decoding so a late response cannot populate the next workspace's state.
function copyResponseMetadata(source: Response, target: Response): Response {
  for (const name of ["url", "redirected", "type"] as const)
    Object.defineProperty(target, name, { value: source[name] });
  return target;
}
function guardConsumption(response: Response, isCurrent: () => boolean): Response {
  for (const name of ["json", "text", "blob", "arrayBuffer", "formData"] as const) {
    const consume = response[name].bind(response);
    Object.defineProperty(response, name, {
      // HMR can leave another fetch guard installed on this same null-body response.
      // Preserve its bound consumer and generation check while allowing the next guard.
      configurable: true,
      value: async () => {
        const result = await consume();
        if (!isCurrent()) throw new DOMException("Workspace changed", "AbortError");
        return result;
      },
    });
  }
  const clone = response.clone.bind(response);
  Object.defineProperty(response, "clone", { configurable: true, value: () => guardConsumption(copyResponseMetadata(response, clone()), isCurrent) });
  return response;
}

export function workspaceUrl(url: string): string {
  if (!state.enabled || !state.tenantId) return url;
  const origin = typeof window === "undefined" ? "https://workspace.invalid" : window.location.origin;
  try {
    const parsed = new URL(url, origin);
    if (parsed.origin !== origin || !parsed.pathname.startsWith("/api/")) return url;
    parsed.searchParams.set("workspace_tenant_id", String(state.tenantId));
    return url.startsWith("/") ? parsed.pathname + parsed.search + parsed.hash : parsed.href;
  } catch { return url; }
}

export function workspaceHasUnsavedChanges(root: Pick<Document, "querySelectorAll"> = document): boolean {
  return Array.from(root.querySelectorAll('[role="dialog"], [role="alertdialog"], [data-workspace-dirty="true"]'))
    .some((element) => !element.hasAttribute("data-workspace-switcher") && element.getAttribute("aria-hidden") !== "true");
}

/** Persistent view state must not carry selections into another actor or tenant. */
export function workspaceStorageKey(key: string): string {
  return state.enabled ? `${key}:${state.actorId || "none"}:${state.tenantId || "none"}` : key;
}
