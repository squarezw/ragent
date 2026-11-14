/** biome-ignore-all lint/suspicious/noExplicitAny: VM test harness models heterogeneous React and HTTP interfaces. */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { terminalRun, chatRunErrorMessageKey } from "../../lib/chatRun.ts";
import { parseKnowledgeWriteConfirmation } from "../../lib/knowledgeWrite.ts";
import type { ChatRunSnapshot } from "../../types/chat-run.ts";
interface Node {
  type: unknown;
  props: Record<string, any>;
}
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
export const run = (patch: Partial<ChatRunSnapshot> = {}): ChatRunSnapshot => ({
  run_id: "r1",
  session_id: "11",
  detail_id: 12,
  app_id: 7,
  status: "running",
  cursor: 1,
  answer: "partial",
  tool_steps: [],
  pending_confirmations: [],
  usage: null,
  result: null,
  error: null,
  updated_at: "2026-11-14T00:00:00Z",
  ...patch,
});
export function mount(
  options: {
    active?: ChatRunSnapshot[];
    search?: string;
    remembered?: Record<string, string>;
    activePromise?: Promise<ChatRunSnapshot[]>;
    lateApps?: boolean;
  } = {}
) {
  const state: any[] = [];
  let cursor = 0;
  let pending: (() => void)[] = [];
  let dirty = false;
  let tree: Node;
  const events: Record<string, () => void> = {};
  const storage = new Map(Object.entries(options.remembered ?? {}));
  const calls = { stop: 0, detach: 0, starts: 0, apps: [] as string[], history: [] as string[] };
  let tenant = 3;
  let catalog = options.lateApps ? [] : [{ id: 7 }];
  const actor = 1;
  let update: ((run: ChatRunSnapshot) => void) | undefined;
  const react = {
    useState(initial: any) {
      const i = cursor++;
      if (!(i in state)) state[i] = typeof initial === "function" ? initial() : initial;
      return [
        state[i],
        (value: any) => {
          const next = typeof value === "function" ? value(state[i]) : value;
          if (next !== state[i]) {
            state[i] = next;
            dirty = true;
          }
        },
      ];
    },
    useRef(initial: any) {
      const i = cursor++;
      if (!state[i]) state[i] = { current: initial };
      return state[i];
    },
    useCallback(fn: any, deps: any[]) {
      const i = cursor++;
      if (!state[i] || deps.some((v, j) => v !== state[i].deps[j])) state[i] = { fn, deps };
      return state[i].fn;
    },
    useEffect(fn: any, deps: any[]) {
      const i = cursor++;
      if (!state[i] || deps.some((v, j) => v !== state[i].deps[j])) {
        const old = state[i];
        state[i] = { deps, cleanup: old?.cleanup };
        pending.push(() => {
          old?.cleanup?.();
          state[i].cleanup = fn();
        });
      }
    },
  };
  const no = () => {};
  const setAttachments = no;
  const scrollToBottom = no;
  const focusRef = { current: null };
  const translator = (key: string) => key;
  const useRun = {
    setChatId: no,
    connection: "connected",
    detach: () => {
      calls.detach++;
      update = undefined;
    },
    start: async () => {
      calls.starts++;
      return run();
    },
    stop: async () => {
      calls.stop++;
      return run({ status: "stopping" });
    },
    active: async () => options.activePromise ?? options.active ?? [],
    snapshot: async () => run({ status: "completed", answer: "done" }),
    subscribe: (snapshot: ChatRunSnapshot, callback: (run: ChatRunSnapshot) => void) => {
      update = callback;
      callback(snapshot);
      return () => {
        calls.detach++;
        update = undefined;
      };
    },
  };
  const imports: Record<string, any> = {
    react,
    "react/jsx-runtime": {
      jsx: (type: any, props: any) => ({ type, props }),
      jsxs: (type: any, props: any) => ({ type, props }),
    },
    "next-intl": { useTranslations: () => translator },
    sonner: { toast: { error: no, warning: no } },
    "@/hooks/useChatRun": {
      useChatRun: () => useRun,
      chatRunStorageKey: () => `scope:${actor}:${tenant}`,
    },
    "@/hooks/useChatSession": { useChatSession: () => ({ sendFeedback: no }) },
    "@/app/components/WorkspaceProvider": { useWorkspace: () => ({ ready: true }) },
    "@/hooks/useCurrentUser": { useCurrentUser: () => ({ user: { id: actor } }) },
    "@/lib/chatRun": { terminalRun, chatRunErrorMessageKey },
    "@/lib/chatSse": { parseWorkspaceBindingWarning: () => null },
    "@/lib/knowledgeWrite": { parseKnowledgeWriteConfirmation },
    "@/types/token-usage": { normalizeTurnUsage: (value: any) => value },
    "@/hooks/useDatasets": { useDatasets: () => ({ datasets: [] }) },
    "@/hooks/useOrganization": {
      useOrganization: () => ({ organizedDatasets: [], loading: false }),
    },
    "@/hooks/useChatHistory": { useChatHistory: () => ({ history: [], loading: false }) },
    "@/hooks/useChatSegments": { useChatSegments: () => ({ segments: {}, fetchSegments: no }) },
    "@/hooks/useVoiceRecorder": {
      useVoiceRecorder: () => ({ startRecording: no, stopRecording: no, cancelRecording: no }),
    },
    "@/hooks/useSpeechToText": { useSpeechToText: () => ({ transcribe: no }) },
    "@/app/chat/hooks/useFileAttachments": {
      useFileAttachments: () => ({
        attachments: [],
        pendingAttachments: [],
        setAttachments,
        previewFile: null,
        setPreviewFile: no,
        handleFileSelect: no,
        handleFileDrop: no,
        removeAttachment: no,
        handlePreviewAttachment: no,
      }),
    },
    "@/app/chat/hooks/useAppDatasets": {
      useAppDatasets: () => ({
        apps: catalog,
        selectedAppId: "7",
        selectedDatasetIds: [],
        appDatasetIds: [],
        optionalDatasetSelections: new Set(),
        handleAppSelect: (id: string) => {
          if (catalog.some((app) => String(app.id) === id)) calls.apps.push(id);
        },
        operationTenantId: tenant,
      }),
    },
    "@/app/chat/hooks/useMessageScroll": {
      useMessageScroll: () => ({
        messagesContainerRef: focusRef,
        messagesEndRef: focusRef,
        scrollToBottom,
      }),
    },
    "@/lib/axios": {
      default: {
        get: async (path: string) => {
          calls.history.push(path);
          return {
            data: {
              appId: 7,
              details: [{ id: 12, question: "question", answer: "saved partial", attachments: [] }],
            },
          };
        },
      },
    },
    "@/lib/workspaceBrowser": { workspaceUrl: (url: string) => url },
    "@/lib/ossUpload": { getFileUrl: (key: string) => key },
  };
  const module = { exports: {} as { default: () => Node } };
  vm.runInNewContext(
    ts.transpileModule(readFileSync(new URL("../../app/chat/page.tsx", import.meta.url), "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText,
    {
      module,
      exports: module.exports,
      require: (name: string) =>
        imports[name] ?? { default: name.split("/").pop(), FilePreviewDialog: "FilePreviewDialog" },
      window: {
        location: { search: options.search ?? "" },
        addEventListener: (name: string, fn: () => void) => {
          events[name] = fn;
        },
        removeEventListener: (name: string) => {
          delete events[name];
        },
      },
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        removeItem: (key: string) => storage.delete(key),
      },
      URLSearchParams,
      requestAnimationFrame: (fn: () => void) => fn(),
      setTimeout: (fn: () => void) => fn(),
      console,
      alert: no,
    }
  );
  function render() {
    let n = 0;
    do {
      dirty = false;
      cursor = 0;
      pending = [];
      tree = module.exports.default();
      for (const effect of pending) effect();
      if (++n > 30) throw Error("render loop");
    } while (dirty);
  }
  function nodes(node: unknown): Node[] {
    if (Array.isArray(node)) return node.flatMap(nodes);
    if (!node || typeof node !== "object" || !("props" in node)) return [];
    const e = node as Node;
    return [e, ...nodes(e.props.children)];
  }
  const find = (name: string) => nodes(tree).find((node) => node.type === name);
  render();
  return {
    calls,
    events,
    render,
    find,
    emit: (next: ChatRunSnapshot) => {
      update?.(next);
      render();
    },
    settle: async () => {
      for (let i = 0; i < 5; i++) {
        await tick();
        render();
      }
    },
    readyApps: () => {
      catalog = [{ id: 7 }];
      render();
    },
    captureUpdate: () => update,
    changeTenant: (id: number) => {
      tenant = id;
      render();
    },
    unmount: () => {
      for (const slot of state) slot?.cleanup?.();
    },
    storage,
  };
}
