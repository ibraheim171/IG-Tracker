import assert from "node:assert/strict";
import test from "node:test";
import { nextDialogFocusIndex } from "./dialog-focus.ts";

test("يحصر انتقال Tab داخل الحوار في أول وآخر عنصر", () => {
  assert.equal(nextDialogFocusIndex(3, 2, false), 0);
  assert.equal(nextDialogFocusIndex(3, 0, true), 2);
  assert.equal(nextDialogFocusIndex(3, 1, false), 2);
  assert.equal(nextDialogFocusIndex(3, 1, true), 0);
  assert.equal(nextDialogFocusIndex(0, 0, false), -1);
});
