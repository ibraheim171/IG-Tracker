import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createSingleFlight, executeInstagramPublish, isInstagramPermalink } from "./operational-ui.ts";

test("يتحقق من رابط منشور إنستغرام قبل إتاحة تسجيل النشر", () => {
  assert.equal(isInstagramPermalink(" https://www.instagram.com/p/ABC123/ "), true);
  assert.equal(isInstagramPermalink("https://www.instagram.com/reel/ABC123"), true);
  assert.equal(isInstagramPermalink("https://www.instagram.com/tv/ABC123?utm_source=test"), true);
  assert.equal(isInstagramPermalink("https://instagram.com/p/ABC123"), true);
  assert.equal(isInstagramPermalink("https://instagram.com/reel/ABC123"), true);
  assert.equal(isInstagramPermalink("https://instagram.com/tv/ABC123"), true);
  assert.equal(isInstagramPermalink("https://www.instagram.com/stories/example"), false);
  assert.equal(isInstagramPermalink("https://example.com/p/ABC123"), false);
  assert.equal(isInstagramPermalink("http://www.instagram.com/p/ABC123"), false);
  assert.equal(isInstagramPermalink("https://www.instagram.com/p/ABC123/extra"), false);
});

test("لا ينفذ مسار النشر في الدرج رابط HTTPS ليس رابط منشور إنستغرام", async () => {
  let publishCalls = 0;
  const result = await executeInstagramPublish("https://example.com/p/ABC123", async () => {
    publishCalls += 1;
  });

  assert.deepEqual(result, { started: false });
  assert.equal(publishCalls, 0);
  const drawerSource = readFileSync(new URL("../components/item-drawer.tsx", import.meta.url), "utf8");
  assert.match(drawerSource, /if \(!item \|\| !isInstagramPermalink\(publishPermalink\)\) return;/);
  assert.match(drawerSource, /executeInstagramPublish\(publishPermalink/);
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
