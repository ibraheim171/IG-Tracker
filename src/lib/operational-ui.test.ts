import assert from "node:assert/strict";
import test from "node:test";
import { createSingleFlight, isInstagramPermalink } from "./operational-ui.ts";

test("يتحقق من رابط منشور إنستغرام قبل إتاحة تسجيل النشر", () => {
  assert.equal(isInstagramPermalink(" https://www.instagram.com/p/ABC123/ "), true);
  assert.equal(isInstagramPermalink("https://www.instagram.com/reel/ABC123"), true);
  assert.equal(isInstagramPermalink("https://instagram.com/p/ABC123"), false);
  assert.equal(isInstagramPermalink("https://www.instagram.com/stories/example"), false);
});

test("يمنع الإرسال المكرر حتى تنتهي العملية الأولى", async () => {
  const runOnce = createSingleFlight();
  let calls = 0;
  let finish: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });

  const first = runOnce(async () => {
    calls += 1;
    await pending;
  });
  const second = await runOnce(async () => {
    calls += 1;
  });

  assert.deepEqual(second, { started: false });
  assert.equal(calls, 1);
  finish?.();
  assert.deepEqual(await first, { started: true, value: undefined });

  const third = await runOnce(async () => {
    calls += 1;
  });
  assert.deepEqual(third, { started: true, value: undefined });
  assert.equal(calls, 2);
});
