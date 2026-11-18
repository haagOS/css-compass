import { describe, expect, test } from "vitest";
import { scanCss } from "./scan.ts";
import { SymbolIndex } from "./symbol-index.ts";

const plain = (css: string) => scanCss(css, { module: false });
const where = (defs: { file: string; symbol: { start: number } }[]) =>
  defs.map((d) => `${d.file}@${d.symbol.start}`);

describe("SymbolIndex", () => {
  test("finds global classes and custom properties", () => {
    const index = new SymbolIndex();
    index.setFile("a.css", plain(".btn {} :root { --gap: 4px; }"));
    expect(where(index.findClass("btn"))).toEqual(["a.css@1"]);
    expect(index.findProperty("--gap").map((d) => d.symbol.value)).toEqual(["4px"]);
    expect(index.findClass("missing")).toEqual([]);
  });

  test("module-local classes are not indexed, :global ones and properties are", () => {
    const index = new SymbolIndex();
    index.setFile(
      "x.module.css",
      scanCss(".local {} :global(.shared) { --v: 1; }", { module: true }),
    );
    expect(index.findClass("local")).toEqual([]);
    expect(index.findClass("shared")).toHaveLength(1);
    expect(index.findProperty("--v")).toHaveLength(1);
  });

  test("replacing a file removes its stale entries", () => {
    const index = new SymbolIndex();
    index.setFile("a.css", plain(".old {} :root { --old: 1; }"));
    index.setFile("a.css", plain(".new {}"));
    expect(index.findClass("old")).toEqual([]);
    expect(index.findProperty("--old")).toEqual([]);
    expect(index.findClass("new")).toHaveLength(1);
    expect([...index.classNames()]).toEqual(["new"]);
    expect([...index.propertyNames()]).toEqual([]);
  });

  test("removing a file removes its entries only", () => {
    const index = new SymbolIndex();
    index.setFile("a.css", plain(".x {}"));
    index.setFile("b.css", plain(".x {}"));
    index.removeFile("a.css");
    expect(where(index.findClass("x"))).toEqual(["b.css@1"]);
    index.removeFile("unknown.css");
  });

  test("definitions are sorted by file, then position, regardless of edit history", () => {
    const index = new SymbolIndex();
    index.setFile("b.css", plain(".x {} .x:hover {}"));
    index.setFile("a.css", plain(".x {}"));
    index.setFile("c.css", plain(".x {}"));
    const expected = ["a.css@1", "b.css@1", "b.css@7", "c.css@1"];
    expect(where(index.findClass("x"))).toEqual(expected);
    index.setFile("a.css", plain(".x {}"));
    expect(where(index.findClass("x"))).toEqual(expected);
  });

  test("a property defined in several scopes returns every definition", () => {
    const index = new SymbolIndex();
    index.setFile("t.css", plain(":root { --c: red; } .theme-contrast { --c: black; }"));
    expect(index.findProperty("--c").map((d) => d.symbol.scope)).toEqual([
      ":root",
      ".theme-contrast",
    ]);
  });
});
