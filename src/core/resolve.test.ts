import { describe, expect, test } from "vitest";
import { byPreference, findVar, MAX_STEPS, resolveValue } from "./resolve.ts";
import { scanCss } from "./scan.ts";
import { SymbolIndex } from "./symbol-index.ts";

function indexOf(files: Record<string, string>) {
  const index = new SymbolIndex();
  for (const [file, css] of Object.entries(files))
    index.setFile(file, scanCss(css, { module: false }));
  return (name: string) => index.findProperty(name);
}

describe("resolveValue", () => {
  test("a chain, one level per step", () => {
    const lookup = indexOf({ "t.css": ":root { --a: var(--b); --b: var(--c); --c: #1f4e8c; }" });
    expect(resolveValue("var(--a)", lookup)).toEqual({
      steps: ["var(--a)", "var(--b)", "var(--c)", "#1f4e8c"],
      value: "#1f4e8c",
      complete: true,
    });
  });

  test("composite values substitute every var()", () => {
    const lookup = indexOf({ "t.css": ":root { --rgb: 31, 78, 140; --w: 2px; }" });
    expect(resolveValue("0 var(--w) 8px rgba(var(--rgb), 0.25)", lookup).value).toBe(
      "0 2px 8px rgba(31, 78, 140, 0.25)",
    );
  });

  test("fallbacks are used for undefined properties, including nested ones", () => {
    const lookup = indexOf({ "t.css": ":root { --b: blue; }" });
    expect(resolveValue("var(--missing, red)", lookup).value).toBe("red");
    expect(resolveValue("var(--missing, var(--b))", lookup).value).toBe("blue");
    expect(resolveValue("var(--b, red)", lookup).value).toBe("blue");
  });

  test("undefined without fallback stays and is incomplete", () => {
    const result = resolveValue("1px var(--nope)", indexOf({}));
    expect(result).toEqual({
      steps: ["1px var(--nope)"],
      value: "1px var(--nope)",
      complete: false,
    });
  });

  test("cycles stop with the remainder", () => {
    const lookup = indexOf({ "t.css": ":root { --a: var(--b); --b: var(--a); }" });
    const result = resolveValue("var(--a)", lookup);
    expect(result.steps).toEqual(["var(--a)", "var(--b)"]);
    expect(result.complete).toBe(false);
  });

  test("depth is limited", () => {
    const chain = Array.from({ length: 20 }, (_, i) => `--v${i}: var(--v${i + 1});`).join(" ");
    const result = resolveValue("var(--v0)", indexOf({ "t.css": `:root { ${chain} }` }));
    expect(result.steps).toHaveLength(MAX_STEPS + 1);
    expect(result.complete).toBe(false);
  });

  test("a substituted value is resolved in its definition's scope", () => {
    const lookup = indexOf({
      "t.css": ":root { --c: var(--d); --d: red; } .dark { --d: black; } .dim { --c: var(--d); }",
    });
    expect(resolveValue("var(--c)", lookup, [".dark"]).value).toBe("red");
    expect(resolveValue("var(--d)", lookup, [".dark"]).value).toBe("black");
  });

  test("an unclosed var( is incomplete", () => {
    expect(resolveValue("var(--b", indexOf({})).complete).toBe(false);
    expect(resolveValue('"var(--b"', indexOf({})).complete).toBe(true);
  });

  test("lookups prefer the use's own scope", () => {
    const lookup = indexOf({
      "t.css": ":root { --c: red; --a: var(--c); } .theme-dark { --c: black; --a: var(--c); }",
    });
    expect(resolveValue("var(--c)", lookup, [".theme-dark"]).value).toBe("black");
    expect(resolveValue("var(--c)", lookup).value).toBe("red");
  });
});

const defs = (css: string) =>
  indexOf({ "t.css": css })("--c").map(
    (d) => `${d.symbol.scope}|${d.symbol.atRules.join()}|${d.symbol.value}`,
  );
const order = (css: string, scope: string[] = []) =>
  byPreference(indexOf({ "t.css": css })("--c"), scope).map((d) => d.symbol.value);

describe("byPreference", () => {
  test(":root over other scopes, base over @media, last over first", () => {
    const css = `.theme { --c: theme; }
@media (prefers-color-scheme: dark) { :root { --c: dark; } }
:root { --c: first; }
:root { --c: last; }`;
    expect(defs(css)).toHaveLength(4);
    expect(order(css)).toEqual(["last", "first", "dark", "theme"]);
    expect(order(css, [".theme"])[0]).toBe("theme");
  });

  test("selector lists match any of their parts", () => {
    expect(order(":root, .theme-default { --c: a; } .x { --c: b; }", [".theme-default"])[0]).toBe(
      "a",
    );
  });
});

test("findVar skips strings and identifiers ending in var", () => {
  expect(findVar('"var(--x)" myvar(--y) var(--z, 1)', 0)).toMatchObject({
    name: "--z",
    fallback: "1",
  });
  expect(findVar("var(--x", 0)).toBeUndefined();
});
