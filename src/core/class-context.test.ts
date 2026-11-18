import { describe, expect, test } from "vitest";
import { classTokenAt } from "./class-context.ts";
import { parseImports } from "./ts-scan.ts";

const FUNCTIONS = ["clsx", "cn", "cx", "classnames"];
const HEAD = 'import styles from "./a.module.css";\n';

/** `|` marks the cursor; returns `name [range] prefix` or undefined. */
function token(body: string, functions = FUNCTIONS) {
  const source = HEAD + body;
  const offset = source.indexOf("|");
  const text = source.slice(0, offset) + source.slice(offset + 1);
  const t = classTokenAt(text, offset, functions, parseImports(text));
  if (!t) return undefined;
  const range = text.slice(t.start, t.end);
  return `${t.name} [${range}] "${t.prefix}"${t.completable ? "" : " (key)"}`;
}

describe("className attributes", () => {
  test("the whitespace token under the cursor", () => {
    expect(token('<div className="a font-si|ze_s b" />')).toBe(
      'font-size_s [font-size_s] "font-si"',
    );
    expect(token("<div className='a|' />")).toBe('a [a] "a"');
    expect(token('<div class="x |" />')).toBe(' [] ""');
  });

  test("an empty token between spaces can be completed", () => {
    const t = token('<div className="a | b" />');
    expect(t).toBe(' [] ""');
  });

  test("expressions inside the attribute", () => {
    expect(token('<div className={open ? "is-o|pen" : "closed"} />')).toBe(
      'is-open [is-open] "is-o"',
    );
    expect(token('<div className={open ? "a" : "clo|sed"} />')).toBe('closed [closed] "clo"');
    expect(token('<div className={open && "is-o|pen"} />')).toBe('is-open [is-open] "is-o"');
    expect(token('<div className={["a", open && "b|"].join(" ")} />')).toBe('b [b] "b"');
  });

  test("one-line template literals, static parts only", () => {
    expect(token('<div className={`card p|ad ${open ? "x" : ""}`} />')).toBe('pad [pad] "p"');
    expect(token('<div className={`card ${open ? "is-o|pen" : ""}`} />')).toBe(
      'is-open [is-open] "is-o"',
    );
    expect(token("<div className={`a ${x} b|`} />")).toBe('b [b] "b"');
  });
});

describe("class functions", () => {
  test("string arguments, also mixed with module classes", () => {
    expect(token('clsx(styles.heading, "font-size_x|l")')).toBe(
      'font-size_xl [font-size_xl] "font-size_x"',
    );
    expect(token('cn("a|")')).toBe('a [a] "a"');
  });

  test("a stray quote on an earlier line doesn't derail the scan", () => {
    expect(token('const c = clsx(\n  "a",\n  // don\'t\n  "b|",\n);')).toBe('b [b] "b"');
  });

  test("across lines", () => {
    expect(token('const c = clsx(\n  styles.root,\n  open && "is-o|pen",\n);')).toBe(
      'is-open [is-open] "is-o"',
    );
  });

  test("object keys count, values don't", () => {
    expect(token('clsx({ "font-weight_b|old": isSelected })')).toBe(
      'font-weight_bold [font-weight_bold] "font-weight_b"',
    );
    expect(token('clsx({ a: true, "b|": x })')).toBe('b [b] "b"');
    expect(token('clsx({ k: "valu|e" })')).toBeUndefined();
    expect(token('clsx({ k: c ? "a|" : "b" })')).toBeUndefined();
  });

  test("identifier keys: hover and definition, not completion", () => {
    expect(token("clsx({ hid|den: !open })")).toBe('hidden [hidden] "hid" (key)');
    expect(token("clsx({ a: hid|den })")).toBeUndefined();
  });

  test("arrays", () => {
    expect(token('clsx(["a|", open && "b"])')).toBe('a [a] "a"');
  });

  test("configured function names", () => {
    expect(token('tw("a|")', ["tw"])).toBe('a [a] "a"');
    expect(token('tw("a|")')).toBeUndefined();
  });
});

describe("not a class context", () => {
  test("other attributes and calls", () => {
    expect(token('<div title="a|" />')).toBeUndefined();
    expect(token('f("a|")')).toBeUndefined();
    expect(token('clsx(fn("a|"))')).toBeUndefined();
    expect(token('const s = "a|";')).toBeUndefined();
  });

  test("index access is not an array", () => {
    expect(token('clsx(map["a|"])')).toBeUndefined();
  });

  test("CSS Module index access stays a module class", () => {
    expect(token('clsx(styles["he|ading"])')).toBeUndefined();
  });

  test("blocks and JSX children end the scan", () => {
    expect(token('clsx(() => { return "a|"; })')).toBeUndefined();
    expect(token('<div className="x">{"a|"}</div>')).toBeUndefined();
  });

  test("a statement boundary ends the scan", () => {
    expect(token('clsx(a);\nconst s = ("b|");')).toBeUndefined();
  });

  test("comments", () => {
    expect(token('// className="a|"')).toBeUndefined();
  });

  test("the scan stops after the line limit", () => {
    const lines = Array.from({ length: 60 }, (_, i) => `  styles.c${i},`).join("\n");
    expect(token(`clsx(\n${lines}\n  "a|",\n)`)).toBeUndefined();
    expect(token(`clsx(\n${lines.split("\n").slice(0, 10).join("\n")}\n  "a|",\n)`)).toBe(
      'a [a] "a"',
    );
  });
});
