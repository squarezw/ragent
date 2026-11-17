import assert from "node:assert/strict";
import test from "node:test";
import { mount, run } from "./helpers/chatRunPageHarness.ts";
import type { ChatRunSnapshot } from "../types/chat-run.ts";
test("actual Chat page restores history and partial once, then replaces assistant on terminal replay", async () => {
  const page = mount({ active: [run()] });
  await page.settle();
  let list = page.find("MessageList");
  assert.ok(list);
  assert.equal(list.props.messages.length, 1);
  assert.equal(list.props.streamingMessage, "partial");
  assert.deepEqual(page.calls.apps, ["7"]);
  page.emit(run({ status: "completed", cursor: 3, answer: "finished" }));
  page.emit(run({ status: "completed", cursor: 3, answer: "finished" }));
  list = page.find("MessageList");
  assert.equal(list?.props.messages.length, 2);
  assert.equal(list?.props.messages[1].content, "finished");
});
test("actual page navigation/new chat/unmount only detach while Stop explicitly requests stop", async () => {
  const page = mount({ active: [run()] });
  await page.settle();
  await page.find("ChatInputComposite")?.props.onStop();
  assert.equal(page.calls.stop, 1);
  page.events["ragent:new-conversation"]();
  page.render();
  assert.ok(page.find("WelcomeView"));
  assert.equal(page.calls.stop, 1);
  await page.settle();
  assert.ok(page.find("WelcomeView"));
  page.unmount();
  assert.equal(page.calls.stop, 1);
  assert.ok(page.calls.detach > 0);
});
test("workspace switch drops old view and stale updates without requesting cancellation", async () => {
  const page = mount({ active: [run()] });
  await page.settle();
  page.changeTenant(4);
  assert.ok(page.find("WelcomeView"));
  assert.equal(page.calls.stop, 0);
});
test("explicit URL session opens history but remembered completed runs do not reopen", async () => {
  const explicit = mount({ active: [], search: "?session_id=42" });
  await explicit.settle();
  assert.match(explicit.calls.history[0], /42\/details/);
  const completed = mount({
    remembered: { "scope:1:3": JSON.stringify({ run_id: "r1", session_id: "11" }) },
  });
  await completed.settle();
  assert.ok(completed.find("WelcomeView"));
  assert.equal(completed.calls.history.length, 0);
});
test("new conversation while entry discovery is in flight cannot be stolen by late recovery", async () => {
  let resolve!: (runs: ChatRunSnapshot[]) => void;
  const pending = new Promise<ChatRunSnapshot[]>((done) => {
    resolve = done;
  });
  const page = mount({ activePromise: pending });
  page.events["ragent:new-conversation"]();
  page.render();
  resolve([run()]);
  await page.settle();
  assert.ok(page.find("WelcomeView"));
  assert.equal(page.calls.history.length, 0);
});

test("restored employee is selected after a late app catalog arrives", async () => {
  const page = mount({ active: [run()], lateApps: true });
  await page.settle();
  assert.equal(page.calls.apps.length, 0);
  page.readyApps();
  assert.deepEqual(page.calls.apps, ["7"]);
});

test("a completed lost-response lookup does not automatically reopen history", async () => {
  const page = mount({ active: [run({ status: "completed" })] });
  await page.settle();
  assert.ok(page.find("WelcomeView"));
  assert.equal(page.calls.history.length, 0);
});
test("a session-only history pointer does not reopen a finished conversation", async () => {
  const page = mount({ remembered: { "scope:1:3": JSON.stringify({ session_id: "11" }) } });
  await page.settle();
  assert.ok(page.find("WelcomeView"));
  assert.equal(page.calls.history.length, 0);
});

test("failed live and replayed snapshots retain partial text and expose the safe error on that turn", async () => {
  const page = mount({ active: [run()] });
  await page.settle();
  const failed = run({
    status: "failed",
    cursor: 4,
    answer: "partial answer",
    error: { code: "CHAT_STREAM_FAILED", message: "DeepSeek HTTP 400: unsupported image input" },
  });
  page.emit(failed);
  page.emit(failed);
  const messages = page.find("MessageList")?.props.messages;
  assert.equal(messages.length, 2);
  assert.equal(messages[1].content, "partial answer");
  assert.equal(messages[1].error, "DeepSeek HTTP 400: unsupported image input");
  assert.equal(page.find("MessageList")?.props.isStreaming, false);
});

test("initial failed snapshot with no answer still exposes the failure", async () => {
  const page = mount({
    search: "?session_id=11",
    active: [
      run({ status: "failed", answer: "", error: { code: "MODEL_RESPONSE_TIMEOUT", message: "" } }),
    ],
  });
  await page.settle();
  const messages = page.find("MessageList")?.props.messages;
  assert.equal(messages.at(-1).content, "");
  assert.match(messages.at(-1).error, /modelResponseTimeout/);
});

test("history failures stay attached to each detail and never mark a successful answer", async () => {
  const page = mount({
    search: "?session_id=11",
    details: [
      {
        id: 1,
        question: "first",
        answer: "partial",
        error: { code: "CHAT_STREAM_FAILED", message: "DeepSeek HTTP 400" },
      },
      {
        id: 2,
        question: "second",
        answer: "",
        error: { code: "MODEL_ENDPOINT_UNREACHABLE", message: "" },
      },
      { id: 3, question: "third", answer: "success" },
    ],
  });
  await page.settle();
  const messages = page.find("MessageList")?.props.messages;
  assert.equal(messages[1].detail_id, 1);
  assert.equal(messages[1].content, "partial");
  assert.match(messages[1].error, /DeepSeek HTTP 400/);
  assert.equal(messages[3].detail_id, 2);
  assert.match(messages[3].error, /modelEndpointUnreachable/);
  assert.equal(messages[5].error, undefined);
});

test("cancelled and successful runs never inherit a failed error notice", async () => {
  for (const status of ["completed", "cancelled"] as const) {
    const page = mount({ active: [run()] });
    await page.settle();
    page.emit(run({ status, error: { code: "CHAT_STREAM_FAILED", message: "stale" } }));
    assert.equal(page.find("MessageList")?.props.messages.at(-1).error, undefined);
  }
});
