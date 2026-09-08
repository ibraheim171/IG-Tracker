import assert from "node:assert/strict";
import test from "node:test";
import { nextDialogFocusIndex, restoreCapturedDialogFocus } from "./dialog-focus.ts";

test("يحصر انتقال Tab داخل الحوار في أول وآخر عنصر", () => {
  assert.equal(nextDialogFocusIndex(3, 2, false), 0);
  assert.equal(nextDialogFocusIndex(3, 0, true), 2);
  assert.equal(nextDialogFocusIndex(3, 1, false), 2);
  assert.equal(nextDialogFocusIndex(3, 1, true), 0);
  assert.equal(nextDialogFocusIndex(0, 0, false), -1);
});

test("يعيد التركيز إلى اللقطة حتى لو مسح الإغلاق المرجع أو فتح حوار أحدث", () => {
  let firstFocuses = 0;
  let secondFocuses = 0;
  const first = { isConnected: true, focus: () => { firstFocuses += 1; } };
  const second = { isConnected: true, focus: () => { secondFocuses += 1; } };
  const ref: { current: typeof first | null } = { current: first };
  const captured = ref.current;

  ref.current = null;
  restoreCapturedDialogFocus(captured, ref);
  assert.equal(firstFocuses, 1);
  assert.equal(ref.current, null);

  ref.current = second;
  restoreCapturedDialogFocus(captured, ref);
  assert.equal(firstFocuses, 2);
  assert.equal(secondFocuses, 0);
  assert.equal(ref.current, second);
});
