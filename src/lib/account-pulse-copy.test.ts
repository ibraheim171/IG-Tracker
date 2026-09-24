import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/components/insights/account-pulse.tsx", "utf8");

test("account pulse labels daily sums and separates follower stock from daily delta", () => {
  assert.match(source, /مجموع الوصول اليومي المقاس/);
  assert.match(source, /مجموع المشاهدات اليومية المقاسة/);
  assert.match(source, /رصيد المتابعين اليومي/);
  assert.match(source, /التغير اليومي في المتابعين/);
  assert.doesNotMatch(source, /وصول فريد|unique reach/i);
});

test("account pulse states Meta unfollow limits and never substitutes zero", () => {
  assert.match(source, /Meta لا يزوّدنا حاليًا بعدد إلغاءات المتابعة/);
  assert.match(source, /أي فجوة تبقى —/);
});
