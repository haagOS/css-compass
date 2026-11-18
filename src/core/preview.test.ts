import { expect, test } from "vitest";
import { declarations, ruleSnippet } from "./preview.ts";
import { scanCss } from "./scan.ts";

const first = (css: string) => {
  const rule = scanCss(css, { module: true }).rules[0];
  if (!rule) throw new Error("no rule");
  return rule;
};

test("ruleSnippet keeps the rule as written, dedented", () => {
  const css = "@media (x) {\n  .a {\n    color: red;\n  }\n}";
  expect(ruleSnippet(css, first(css))).toBe(".a {\n  color: red;\n}");
});

test("ruleSnippet cuts long rules", () => {
  const body = Array.from({ length: 30 }, (_, i) => `  --v${i}: ${i};`).join("\n");
  const css = `.a {\n${body}\n}`;
  const lines = ruleSnippet(css, first(css), 5).split("\n");
  expect(lines).toEqual([".a {", "  --v0: 0;", "  --v1: 1;", "  --v2: 2;", "  /* … */", "}"]);
});

test("declarations: own block only, comments dropped, limited", () => {
  const css = `.a {
  color: red; /* note */
  content: "a;b";
  &:hover { color: blue; }
  background: url(x;y);
  margin: 0
}`;
  expect(declarations(css, first(css))).toEqual([
    "color: red",
    'content: "a;b"',
    "background: url(x;y)",
    "margin: 0",
  ]);
  expect(declarations(css, first(css), 2)).toEqual(["color: red", 'content: "a;b"']);
});

test("declarations of an empty or unclosed rule", () => {
  expect(declarations(".a {}", first(".a {}"))).toEqual([]);
  expect(declarations(".a { color: red", first(".a { color: red"))).toEqual(["color: red"]);
  const stray = ".a { width: calc(1px)); color: red; }";
  expect(declarations(stray, first(stray))).toEqual(["width: calc(1px))", "color: red"]);
});
