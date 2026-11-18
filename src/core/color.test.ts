import { describe, expect, test } from "vitest";
import { formatColor, parseColor } from "./color.ts";

const css = (value: string) => {
  const c = parseColor(value);
  return c && formatColor(c);
};

describe("parseColor", () => {
  test.each([
    ["#1f4e8c", "#1f4e8c"],
    ["#ABC", "#aabbcc"],
    ["#1f4e8c80", "rgba(31, 78, 140, 0.502)"],
    ["#0008", "rgba(0, 0, 0, 0.533)"],
    ["rgb(31, 78, 140)", "#1f4e8c"],
    ["rgba(31,78,140,.25)", "rgba(31, 78, 140, 0.25)"],
    ["rgb(31 78 140 / 25%)", "rgba(31, 78, 140, 0.25)"],
    ["rgb(100% 0% 0%)", "#ff0000"],
    ["hsl(0, 100%, 50%)", "#ff0000"],
    ["hsl(120deg 100% 25%)", "#008000"],
    ["hsla(0.5turn, 100%, 50%, 0.5)", "rgba(0, 255, 255, 0.5)"],
    ["RebeccaPurple", "#663399"],
    ["transparent", "rgba(0, 0, 0, 0)"],
    ["  red  ", "#ff0000"],
  ])("%s → %s", (input, expected) => {
    expect(css(input)).toBe(expected);
  });

  test.each([
    "31, 78, 140",
    "#12345",
    "#ggg",
    "rgb(1, 2)",
    "rgb(1 2 3 / 4 / 5)",
    "rgba(var(--x), 0.5)",
    "1px solid red",
    "currentColor",
    "oklch(0.7 0.1 200)",
    "",
  ])("not a colour: %s", (input) => {
    expect(parseColor(input)).toBeUndefined();
  });
});
