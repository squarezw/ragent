import assert from "node:assert/strict";
import test from "node:test";
import { mount, run } from "./helpers/chatRunPageHarness.ts";

test("actual restored run preserves partial answer exactly once and never resends on failure", async () => {
  const page = mount({ active: [run({ answer: "first second" })] });
  await page.settle();
  const failed = run({
    cursor: 2,
    status: "failed",
    answer: "first second",
    error: { code: "MODEL_STREAM_INTERRUPTED", message: "raw upstream detail" },
  });
  page.emit(failed);
  page.emit(failed);
  const list = page.find("MessageList");
  assert.equal(list?.props.messages.length, 2);
  assert.equal(list?.props.messages[1].content, "first second\n\nstreamInterrupted");
  assert.equal(list?.props.messages[1].detail_id, 12);
  assert.equal(page.calls.starts, 0);
});
test("failure before output shows friendly message rather than upstream details", async () => {
  const page = mount({ active: [run()] });
  await page.settle();
  page.emit(
    run({
      status: "failed",
      cursor: 2,
      answer: "",
      error: { code: "CHAT_STREAM_FAILED", message: "incomplete chunked read" },
    })
  );
  assert.equal(page.find("MessageList")?.props.messages[1].content, "streamFailed");
});
test("conversation switch rejects callbacks captured from previous run", async () => {
  const page = mount({ active: [run()] });
  await page.settle();
  const late = page.captureUpdate();
  page.events["ragent:new-conversation"]();
  page.render();
  late?.(run({ status: "failed", cursor: 2, answer: "stale" }));
  page.render();
  assert.ok(page.find("WelcomeView"));
  assert.equal(page.calls.starts, 0);
});
test("billing and tenant model failures stay localized with committed partial output", async () => {
  for (const [code, expected] of [
    ["insufficient_balance", "insufficientBalance"],
    ["user_credit_account_busy", "creditAccountBusy"],
    ["user_credit_reconciliation_required", "creditReconciliationRequired"],
    ["MODEL_ENDPOINT_UNREACHABLE", "modelEndpointUnreachable"],
    ["MODEL_RESPONSE_TIMEOUT", "modelResponseTimeout"],
  ]) {
    for (const partial of ["", "received content"]) {
      const page = mount({ active: [run()] });
      await page.settle();
      page.emit(
        run({
          status: "failed",
          cursor: 2,
          answer: partial,
          error: { code, message: "raw internal endpoint" },
        })
      );
      assert.equal(
        page.find("MessageList")?.props.messages[1].content,
        partial ? `${partial}\n\n${expected}` : expected
      );
      assert.equal(page.calls.starts, 0);
    }
  }
});
