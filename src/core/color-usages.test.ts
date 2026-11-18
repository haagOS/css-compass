import { expect, test } from "vitest";
import { colorUsages } from "./color-usages.ts";

const found = (text: string) => colorUsages(text).map((u) => u.expression);

test("var() calls and colour functions with var() arguments", () => {
  const css = `.a {
  color: var(--ds-accent);
  background: rgba(var(--ds-blue-0-rgb), 0.25);
  border: 1px solid var(--line, var(--fallback));
  box-shadow: 0 0 4px hsl(var(--h) 50% 50%);
}`;
  expect(found(css)).toEqual([
    "var(--ds-accent)",
    "rgba(var(--ds-blue-0-rgb), 0.25)",
    "var(--line, var(--fallback))",
    "hsl(var(--h) 50% 50%)",
  ]);
});

test("literal colours and look-alikes are not reported", () => {
  expect(found(".a { color: rgb(1, 2, 3); --myvar(x): 1; }")).toEqual([]);
  expect(found("no variables here")).toEqual([]);
});

test("unclosed calls are skipped, closed ones inside still count", () => {
  // The unclosed rgba( is skipped; the closed var(--y) inside it still counts.
  expect(found(".a { color: var(--x; } .b { color: rgba(var(--y), .5 }")).toEqual(["var(--y)"]);
});

test("ranges point into the text", () => {
  const text = 'x = "var(--a)"';
  const [u] = colorUsages(text);
  expect(u && text.slice(u.start, u.end)).toBe("var(--a)");
});
