import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync("src/app/globals.css", "utf8");

test("admin navigation remains a single vertical column in the desktop sidebar", () => {
  const desktopCss = css.slice(css.indexOf("@media (min-width: 48rem)"));

  assert.match(
    desktopCss,
    /\.nav-links-admin\s*\{\s*grid-template-columns:\s*1fr;\s*\}/,
  );
});

test("admin dashboard is mobile-first with full-size decision actions", () => {
  assert.match(css, /\.admin-decision-list\s*\{/);
  assert.match(css, /\.admin-decision-row[^}]*min-inline-size:\s*0/);
  assert.match(css, /\.admin-decision-row\s+\.button[^}]*min-inline-size:\s*44px/);
  assert.match(css, /\.admin-week-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,/);
});

test("analytics charts and tabs stay inside the mobile viewport", () => {
  assert.match(css, /\.insights-tabs[^}]*overflow-x:\s*auto/);
  assert.match(css, /\.metric-chart[^}]*overflow:\s*hidden/);
  assert.match(css, /\.audience-grid[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
});

test("the audience view is a compact latest snapshot", () => {
  const source = readFileSync("src/components/insights/audience-snapshot.tsx", "utf8");
  assert.match(source, /أعلى 10 دول/);
  assert.match(source, /أعلى 10 مدن/);
  assert.match(source, /لقطة تراكمية/);
  assert.match(source, /أقل من 100 متابع/);
  assert.doesNotMatch(source, /<table/);
});
