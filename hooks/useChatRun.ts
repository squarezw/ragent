"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import axios from "@/lib/axios";
import { ensureSessionCurrent } from "@/lib/sessionRenewal";
import { ChatRunClient } from "@/lib/chatRunClient";
import { getWorkspaceSnapshot } from "@/lib/workspaceBrowser";
import type { ChatRunSnapshot } from "@/types/chat-run";
import type { RunConnection } from "@/lib/chatRunClient";
import type { RunEvent } from "@/lib/chatRun";

export function chatRunStorageKey() {
  const scope = getWorkspaceSnapshot();
  return `ragent:chat-run:${scope.actorId}:${scope.tenantId}`;
}
export function useChatRun() {
  const [chatId, setChatId] = useState<string | null>(null);
  const [connection, setConnection] = useState<RunConnection>("detached");
  const client = useRef<ChatRunClient | null>(null);
  const viewEpoch = useRef(0);
  if (!client.current)
    client.current = new ChatRunClient({
      get: async (path) => (await axios.get(path, { suppressErrorToast: true } as never)).data,
      post: async (path, body) =>
        (await axios.post(path, body, { suppressErrorToast: true } as never)).data,
      stream: async (path, signal) => {
        await ensureSessionCurrent();
        const token = localStorage.getItem("ragent_token");
        return fetch(path, {
          signal,
          cache: "no-store",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
      },
    });
  const getClient = useCallback(() => {
    if (!client.current) throw new Error("Chat client unavailable");
    return client.current;
  }, []);
  const detach = useCallback(() => {
    viewEpoch.current++;
    client.current?.detach();
    setConnection("detached");
  }, []);
  useEffect(() => () => client.current?.detach(), []);
  const remember = useCallback((run: ChatRunSnapshot) => {
    try {
      const key = chatRunStorageKey();
      const value = JSON.stringify({ run_id: run.run_id, session_id: run.session_id });
      sessionStorage.setItem(key, value);
      localStorage.setItem(key, value);
    } catch {}
  }, []);
  const subscribe = useCallback(
    (
      run: ChatRunSnapshot,
      update: (snapshot: ChatRunSnapshot) => void,
      event?: (event: RunEvent) => void
    ) => {
      const key = chatRunStorageKey();
      remember(run);
      setChatId(run.session_id);
      setConnection("connected");
      return getClient().subscribe(
        run,
        (next) => {
          if (key !== chatRunStorageKey()) return;
          remember(next);
          update(next);
        },
        event,
        (state) => {
          if (key === chatRunStorageKey()) setConnection(state);
        }
      );
    },
    [remember, getClient]
  );
  const start = useCallback(
    async (question: string, datasetIds: string[], params: Record<string, unknown>) => {
      const epoch = viewEpoch.current;
      const requestId = crypto.randomUUID();
      const key = chatRunStorageKey();
      try {
        sessionStorage.setItem(`${key}:pending`, requestId);
      } catch {}
      const run = await getClient().start(
        {
          question,
          ...params,
          chat_id: chatId,
          datasetId: "datasetId" in params ? params.datasetId : datasetIds,
        },
        requestId
      );
      // Do not write another actor/workspace's storage when an old admission completes late.
      if (key === chatRunStorageKey() && epoch === viewEpoch.current) {
        remember(run);
        try {
          sessionStorage.removeItem(`${key}:pending`);
        } catch {}
      }
      return run;
    },
    [chatId, remember, getClient]
  );
  return {
    chatId,
    setChatId,
    connection,
    start,
    subscribe,
    detach,
    stop: useCallback(() => getClient().stop(), [getClient]),
    active: useCallback(
      (session?: string, request?: string) => getClient().active(session, request),
      [getClient]
    ),
    snapshot: useCallback((id: string) => getClient().snapshot(id), [getClient]),
  };
}
