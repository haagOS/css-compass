import { describe, expect, test } from "vitest";
import { scanCss, type CssSymbols } from "./scan.ts";

const plain = (css: string) => scanCss(css, { module: false });
const mod = (css: string) => scanCss(css, { module: true });
const names = (s: CssSymbols) => s.classes.map((c) => c.name);
const locals = (s: CssSymbols) => s.classes.map((c) => `${c.name}:${c.local ? "local" : "global"}`);

describe("classes", () => {
  test("compound, complex and pseudo selectors", () => {
    const s = plain(".a.b > .c:hover, .d::before, :not(.e) .f:is(.g, .h) {}");
    expect(names(s)).toEqual(["a", "b", "c", "d", "e", "f", "g", "h"]);
  });

  test("ranges cover the name without the dot", () => {
    const css = "  .shell { }";
    const [c] = plain(css).classes;
    expect(c && css.slice(c.start, c.end)).toBe("shell");
  });

  test("comments, strings and url() are skipped", () => {
    const css = `/* .no1 { } */
.a { background: url(x.no2.png); content: ".no3 {"; }
.b[data-x=".no4"] {}
.c { background: url("a.no5{.png"); }`;
    expect(names(plain(css))).toEqual(["a", "b", "c"]);
  });

  test("not an identifier after the dot", () => {
    expect(names(plain(".5 {} .-1 {} .-a {} .--b {} ._c {}"))).toEqual(["-a", "--b", "_c"]);
  });

  test("escapes are decoded, ranges stay raw", () => {
    const css = String.raw`.md\:flex {} .w-1\/2 {} .\31 0 {} .a\.b {}`;
    const s = plain(css);
    expect(names(s)).toEqual(["md:flex", "w-1/2", "10", "a.b"]);
    const first = s.classes[0];
    expect(first && css.slice(first.start, first.end)).toBe(String.raw`md\:flex`);
  });

  test("@keyframes selectors are not classes", () => {
    const s = plain("@keyframes spin { 0% {} 50.5% { opacity: .5 } to {} } .after {}");
    expect(names(s)).toEqual(["after"]);
  });

  test("@font-face and @page yield no classes", () => {
    expect(
      names(plain("@font-face { src: url(a.woff2); } @page :first { margin: 0 } .x {}")),
    ).toEqual(["x"]);
  });

  test("attribute selectors are skipped", () => {
    expect(names(plain('[class~="x.y"] .z {}'))).toEqual(["z"]);
    expect(names(plain('[data-x="a]b"] .c {}'))).toEqual(["c"]);
  });
});

describe("CSS Modules scoping", () => {
  test("classes are local by default and global in plain files", () => {
    expect(locals(mod(".a {}"))).toEqual(["a:local"]);
    expect(locals(plain(".a {}"))).toEqual(["a:global"]);
  });

  test(":global() and :local() functions", () => {
    expect(locals(mod(":global(.a .b) .c :local(.d) {}"))).toEqual([
      "a:global",
      "b:global",
      "c:local",
      "d:local",
    ]);
  });

  test("bare :global switches the mode until the next comma", () => {
    expect(locals(mod(".a :global .b .c, .d {}"))).toEqual([
      "a:local",
      "b:global",
      "c:global",
      "d:local",
    ]);
  });

  test(":global inside other pseudo-classes", () => {
    expect(locals(mod(".a:not(:global(.b)) .c {}"))).toEqual(["a:local", "b:global", "c:local"]);
  });

  test(":global without classes in a plain file is ignored", () => {
    expect(locals(plain(":global(.a) {}"))).toEqual(["a:global"]);
  });
});

describe("rules", () => {
  test("selector and block ranges", () => {
    const css = "@media (x) {\n  .a, .b  { color: red; }\n}";
    const [rule] = plain(css).rules;
    expect(rule && css.slice(rule.selectorStart, rule.selectorEnd)).toBe(".a, .b");
    expect(rule && css.slice(rule.blockStart, rule.blockEnd)).toBe("{ color: red; }");
  });

  test("at-rule chain, normalized", () => {
    const css = "@layer ds.utilities {\n @media   (min-width:\n 40rem) /* c */ { .a {} } }";
    const [rule] = plain(css).rules;
    expect(rule?.atRules).toEqual(["@layer ds.utilities", "@media (min-width: 40rem)"]);
  });

  test("nested rules: a selector before `{` is a rule, before `;` a declaration", () => {
    const css = ".a { color: red; a:hover { x: y } &.b { } .c & { } .d { .e { } } }";
    const s = plain(css);
    expect(names(s)).toEqual(["a", "b", "c", "d", "e"]);
    expect(s.rules.map((r) => css.slice(r.selectorStart, r.selectorEnd))).toEqual([
      ".a",
      "a:hover",
      "&.b",
      ".c &",
      ".d",
      ".e",
    ]);
    expect(s.rules.map((r) => r.parent)).toEqual([-1, 0, 0, 0, 0, 4]);
  });

  test("a declaration that looks like a selector stays a declaration", () => {
    const s = plain(".a { a:hover; color: red }");
    expect(s.rules).toHaveLength(1);
  });

  test("at-rules nested in a style rule keep the parent", () => {
    const s = plain(".a { @media (x) { .b {} } }");
    expect(s.rules.map((r) => [r.parent, r.atRules])).toEqual([
      [-1, []],
      [0, ["@media (x)"]],
    ]);
  });
});

describe("custom properties", () => {
  test("name, value, ranges and scope", () => {
    const css = ":root, .theme-default {\n  --ds-accent:  var(--ds-blue-0) ;\n}";
    const [p] = plain(css).properties;
    expect(p).toMatchObject({
      name: "--ds-accent",
      value: "var(--ds-blue-0)",
      scope: ":root, .theme-default",
      scopeParts: [":root", ".theme-default"],
      rule: 0,
    });
    expect(p && css.slice(p.start, p.end)).toBe("--ds-accent");
    expect(p && css.slice(p.valueStart, p.valueEnd)).toBe("var(--ds-blue-0)");
  });

  test("last declaration without `;`", () => {
    expect(plain(":root { --a: 1 }").properties.map((p) => p.value)).toEqual(["1"]);
  });

  test("`;` and `}` inside strings, url() and parentheses", () => {
    const css = `:root {
  --s: "a;b}c";
  --u: url(data:image/svg+xml;base64,AAA=);
  --f: calc(1px + (2px;3px));
  --next: 1;
}`;
    expect(plain(css).properties.map((p) => [p.name, p.value])).toEqual([
      ["--s", '"a;b}c"'],
      ["--u", "url(data:image/svg+xml;base64,AAA=)"],
      ["--f", "calc(1px + (2px;3px))"],
      ["--next", "1"],
    ]);
  });

  test("scope and at-rules in themes and nested rules", () => {
    const css = `@media (prefers-color-scheme: dark) { :root { --a: 1; } }
.x { .dark & { --b: 2; } @media (y) { --c: 3; } }`;
    expect(plain(css).properties.map((p) => [p.name, p.scope, p.atRules])).toEqual([
      ["--a", ":root", ["@media (prefers-color-scheme: dark)"]],
      ["--b", ".dark .x", []],
      ["--c", ".x", ["@media (y)"]],
    ]);
  });

  test("nested scopes resolve `&` against the parent, lists are combined", () => {
    const css = ":root { &.dark { --a: 1; } } .a, .b { &:hover, .c & { --b: 2; } .d { --c: 3; } }";
    expect(plain(css).properties.map((p) => [p.name, p.scopeParts])).toEqual([
      ["--a", [":root.dark"]],
      ["--b", [".a:hover", ".c .a", ".b:hover", ".c .b"]],
      ["--c", [".a .d", ".b .d"]],
    ]);
  });

  test("custom properties in module files are found too", () => {
    expect(mod(".a { --x: 1; }").properties.map((p) => p.name)).toEqual(["--x"]);
  });

  test("ordinary declarations are not recorded", () => {
    expect(plain(".a { color: red; -webkit-x: y; }").properties).toEqual([]);
  });

  test("braces inside a custom property value do not open rules", () => {
    const s = plain(":root { --x: { a: b }; } .after {}");
    expect(s.properties.map((p) => p.value)).toEqual(["{ a: b }"]);
    expect(names(s)).toEqual(["after"]);
  });
});

describe("partial input (R-SC-8)", () => {
  test("unclosed comment", () => {
    expect(names(plain(".a {} /* .b {}"))).toEqual(["a"]);
  });

  test("unclosed string ends at the newline", () => {
    const s = plain('.a { content: "oops\n} .b {}');
    expect(names(s)).toEqual(["a", "b"]);
  });

  test("unclosed blocks end at the end of the text", () => {
    const css = ".a { .b { color: red";
    const s = plain(css);
    expect(names(s)).toEqual(["a", "b"]);
    expect(s.rules.map((r) => r.blockEnd)).toEqual([css.length, css.length]);
  });

  test("unfinished nested rule while typing", () => {
    expect(names(plain(".a { .b"))).toEqual(["a"]);
  });

  test("unfinished custom property", () => {
    expect(plain(":root { --a: var(--b").properties.map((p) => p.value)).toEqual(["var(--b"]);
  });

  test("unclosed paren in a custom property ends at the block", () => {
    const s = plain(":root { --a: var(--b } .c {}");
    expect(s.properties.map((p) => p.value)).toEqual(["var(--b"]);
    expect(names(s)).toEqual(["c"]);
  });

  test("unclosed unquoted url() ends at the newline", () => {
    expect(names(plain(".a { background: url(x\n}\n.b {} .c { x: (1) }"))).toEqual(["a", "b", "c"]);
  });

  test("stray closing braces and parens", () => {
    expect(names(plain("} ) .a { color: rgb(1 } .b {}"))).toEqual(["a", "b"]);
  });

  test("never throws on arbitrary prefixes of a stylesheet", () => {
    const css = String.raw`@layer x { :root { --a: "v;}"; } .m\:a:not(:global(.b)) { c: url(d;e) } }`;
    for (let i = 0; i <= css.length; i++) {
      expect(() => scanCss(css.slice(0, i), { module: true })).not.toThrow();
    }
  });
});
