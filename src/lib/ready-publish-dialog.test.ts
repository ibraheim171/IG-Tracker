import assert from "node:assert/strict";
import test from "node:test";
import { executeInstagramPublish } from "./operational-ui.ts";
import { resetReadyPublishDialogState } from "./ready-publish-dialog.ts";

test("لا يرث عنصر النشر الثاني رابطًا أو حالةً من حوار ملغى أو فاشل", async () => {
  const itemA = {
    ...resetReadyPublishDialogState(),
    permalink: "https://www.instagram.com/p/item-a",
    message: "تعذر تسجيل النشر.",
    overrideReason: "سبب سابق",
    blocked: true,
  };
  assert.equal(itemA.permalink, "https://www.instagram.com/p/item-a");

  const itemBAfterCancel = resetReadyPublishDialogState();
  assert.deepEqual(itemBAfterCancel, { permalink: "", message: null, overrideReason: "", blocked: false });

  let publishCalls = 0;
  await assert.rejects(executeInstagramPublish(itemA.permalink, async () => {
    publishCalls += 1;
    throw new Error("فشل النشر");
  }));

  const itemBAfterFailure = resetReadyPublishDialogState();
  assert.deepEqual(itemBAfterFailure, { permalink: "", message: null, overrideReason: "", blocked: false });
  const publish = await executeInstagramPublish(itemBAfterFailure.permalink, async () => {
    publishCalls += 1;
  });
  assert.deepEqual(publish, { started: false });
  assert.equal(publishCalls, 1);
});
