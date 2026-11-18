import { describe, expect, test } from "vitest";
import { camelCase, dashesCamelCase, exportNames } from "./locals-convention.ts";
import { moduleExports } from "./module-classes.ts";
import { scanCss } from "./scan.ts";

describe("camelCase matches lodash", () => {
  // Expected values are lodash.camelcase results.
  test.each([
    ["foo-bar", "fooBar"],
    ["Foo Bar", "fooBar"],
    ["__FOO_BAR__", "fooBar"],
    ["fooBar", "fooBar"],
    ["FOOBar", "fooBar"],
    ["XMLHttpRequest", "xmlHttpRequest"],
    ["btn--primary", "btnPrimary"],
    ["is-active", "isActive"],
    ["Button", "button"],
    ["icon-2x", "icon2X"],
    ["a1b", "a1B"],
    ["shell", "shell"],
  ])("%s → %s", (input, expected) => {
    expect(camelCase(input)).toBe(expected);
  });
});

test("dashesCamelCase only converts dashes", () => {
  expect(dashesCamelCase("btn--primary_x")).toBe("btnPrimary_x");
  expect(dashesCamelCase("Foo-bar")).toBe("FooBar");
});

test("exportNames per convention", () => {
  expect(exportNames("is-active", "asIs")).toEqual(["is-active"]);
  expect(exportNames("is-active", "camelCase")).toEqual(["is-active", "isActive"]);
  expect(exportNames("is-active", "camelCaseOnly")).toEqual(["isActive"]);
  expect(exportNames("is_active", "dashes")).toEqual(["is_active"]);
  expect(exportNames("is-active", "dashesOnly")).toEqual(["isActive"]);
  expect(exportNames("shell", "camelCase")).toEqual(["shell"]);
});

describe("moduleExports", () => {
  const symbols = scanCss(".shell {} .shell:hover {} .is-active {} :global(.page) {} .Title {}", {
    module: true,
  });

  test("asIs: every local class under its own name, rules grouped", () => {
    const ex = moduleExports(symbols, "asIs");
    expect([...ex.byName.keys()]).toEqual(["shell", "is-active", "Title"]);
    expect(ex.byName.get("shell")).toHaveLength(2);
    expect(ex.completionNames).toEqual(["shell", "is-active", "Title"]);
  });

  test("camelCase: both names resolve, only the identifier is offered", () => {
    const ex = moduleExports(symbols, "camelCase");
    expect(ex.byName.get("is-active")).toHaveLength(1);
    expect(ex.byName.get("isActive")).toHaveLength(1);
    expect(ex.completionNames).toEqual(["shell", "isActive", "Title", "title"]);
  });

  test("camelCaseOnly: the original is gone", () => {
    const ex = moduleExports(symbols, "camelCaseOnly");
    expect(ex.byName.has("is-active")).toBe(false);
    expect(ex.completionNames).toEqual(["shell", "isActive", "title"]);
  });

  test("results are cached per scan and convention", () => {
    expect(moduleExports(symbols, "dashes")).toBe(moduleExports(symbols, "dashes"));
  });
});
