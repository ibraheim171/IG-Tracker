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
