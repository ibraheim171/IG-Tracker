import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/components/insights/account-pulse.tsx", "utf8");

test("account pulse labels daily flows and observed stock without fabricating daily follower values", () => {
  assert.match(source, /مجموع الوصول اليومي المقاس/);
  assert.match(source, /مجموع المشاهدات اليومية المقاسة/);
  assert.match(source, /رصيد الحساب/);
  assert.match(source, /وقت الرصد لأحدث قيمة متابعين/);
  assert.match(source, /latestFollowers\?\.observed_at/);
  assert.match(source, /وقت الرصد لأحدث عدد مواد/);
  assert.match(source, /latestMedia\?\.observed_at/);
  assert.match(source, /وقت الرصد/);
  assert.match(source, /التغير بين الرصدين/);
  assert.doesNotMatch(source, /رصيد المتابعين اليومي|التغير اليومي في المتابعين/);
  assert.doesNotMatch(source, /وصول فريد|unique reach/i);
});

test("account pulse states Meta unfollow limits and never substitutes zero", () => {
  assert.match(source, /Meta لا يزوّدنا حاليًا بعدد إلغاءات المتابعة/);
  assert.match(source, /أي فجوة تبقى —/);
});
