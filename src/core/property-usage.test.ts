import { expect, test } from "vitest";
import { bareNameAt, propertySiteAt, propertyUsageAt } from "./property-usage.ts";

/** `|` marks the cursor. */
function at(source: string): [string, number] {
  const offset = source.indexOf("|");
  return [source.slice(0, offset) + source.slice(offset + 1), offset];
}

const usage = (source: string) => {
  const [text, offset] = at(source);
  const u = propertyUsageAt(text, offset);
  return u && `${u.kind} ${u.name} [${text.slice(u.start, u.end)}]`;
};

test("var() usages, anywhere on the name", () => {
  expect(usage("  color: var(--ds-ac|cent);")).toBe("var --ds-accent [--ds-accent]");
  expect(usage("  color: var(|--ds-accent);")).toBe("var --ds-accent [--ds-accent]");
  expect(usage("  color: var( --a|, red);")).toBe("var --a [--a]");
  expect(usage("  box-shadow: 0 0 rgba(var(--rgb|), .5);")).toBe("var --rgb [--rgb]");
});

test("declarations", () => {
  expect(usage(":root { --ds-ac|cent: red; }")).toBe("declaration --ds-accent [--ds-accent]");
  expect(usage("  --gap|: 4px;")).toBe("declaration --gap [--gap]");
  expect(usage(":root{--a:1;--b|:2}")).toBe("declaration --b [--b]");
});

test("other dashes are not usages", () => {
  expect(usage("  margin: -|-1px;")).toBeUndefined();
  expect(usage("  grid-area: x--y|;")).toBeUndefined();
  expect(usage("  color: var(--|);")).toBeUndefined();
  expect(usage("  --a: --b|;")).toBeUndefined();
});

const bare = (source: string) => {
  const [text, offset] = at(source);
  return bareNameAt(text, offset)?.name;
};

const site = (source: string) => {
  const [text, offset] = at(source);
  const s = propertySiteAt(text, offset);
  return s && `"${s.prefix}" [${text.slice(s.start, s.end)}]`;
};

test("a string that is exactly a property name", () => {
  expect(bare('style={{ "--col|umns": 3 }}')).toBe("--columns");
  expect(bare("el.style.setProperty('--x|', '1')")).toBe("--x");
  expect(bare('x = "--a|-b c"')).toBeUndefined();
  expect(bare("x = \"--a|'")).toBeUndefined();
});

test("completion sites inside var(", () => {
  expect(site("color: var(|")).toBe('"" []');
  expect(site("color: var(-|")).toBe('"-" [-]');
  expect(site("color: var(--ds-|grey);")).toBe('"--ds-" [--ds-grey]');
  expect(site("color: VAR( --a|")).toBe('"--a" [--a]');
  expect(site("color: var(x|")).toBeUndefined();
  expect(site("color: red|")).toBeUndefined();
});
