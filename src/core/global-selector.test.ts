import { expect, test } from "vitest";
import { globalSelectorAt } from "./global-selector.ts";

const at = (source: string) => {
  const offset = source.indexOf("|");
  const text = source.slice(0, offset) + source.slice(offset + 1);
  const t = globalSelectorAt(text, offset);
  return t && `${t.name} [${text.slice(t.start, t.end)}] "${t.prefix}"`;
};

test("class names inside :global(…)", () => {
  expect(at(":global(.app-sh|ell) .local {")).toBe('app-shell [app-shell] "app-sh"');
  expect(at(".a :global(.x .te|) {")).toBe('te [te] "te"');
  expect(at(":global(.|) {")).toBe(' [] ""');
  expect(at(":GLOBAL(.a|)")).toBe('a [a] "a"');
});

test("not inside :global(…)", () => {
  expect(at(".app-sh|ell {")).toBeUndefined();
  expect(at(":global(.a) .lo|cal {")).toBeUndefined();
  expect(at(":local(.a|)")).toBeUndefined();
  expect(at(":global(di|v)")).toBeUndefined();
});
