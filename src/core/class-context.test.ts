import { describe, expect, test } from "vitest";
import { classNamesIn, classTokenAt } from "./class-context.ts";
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

/** Every class name found by `classNamesIn`, marked if its range doesn't match. */
const all = (body: string) => {
  const text = HEAD + body;
  return classNamesIn(text, FUNCTIONS, parseImports(text)).map(
    (n) => `${n.name}${text.slice(n.start, n.end) === n.name ? "" : " (range!)"}`,
  );
};

describe("classNamesIn", () => {
  test("names in attributes, class functions, conditionals, arrays and keys", () => {
    expect(
      all(
        [
          "<div className=\"a  b\" class='c'>",
          '  <p className={open ? "d" : `e f`} />',
          '  <p className={clsx("g", open && "h", ["i"], { "j k": open, hidden: open })} />',
          "  <p className={cn(",
          '    "l",',
          '    { "m": open },',
          "  )} />",
          "</div>",
        ].join("\n"),
      ),
    ).toEqual(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m"]);
  });

  test("other strings, CSS Module access, dynamic templates and JSX text are skipped", () => {
    expect(
      all(
        [
          'const label = "not-a-class";',
          'const x = styles["shell"] + other("q");',
          '<p title="t" className={clsx({ x: "value" })}>Don\'t "touch" this</p>;',
          "<p className={`btn-${size} fixed`} />;",
          '// <p className="in-comment" />',
          '/* className="in-block" */ <p className="after-block" />;',
          "<p className={`multi",
          'line`} data-x="y" />;',
        ].join("\n"),
      ),
    ).toEqual(["after-block"]);
  });

  test("every name found is the token classTokenAt sees there", () => {
    const text = `${HEAD}<p className={clsx("a b", { "c": x }, cond ? "d" : "")} />\n`;
    const imports = parseImports(text);
    const names = classNamesIn(text, FUNCTIONS, imports);
    expect(names).toHaveLength(4);
    for (const n of names) {
      const t = classTokenAt(text, n.start + 1, FUNCTIONS, imports);
      expect(t && [t.name, t.start, t.end]).toEqual([n.name, n.start, n.end]);
    }
  });
});

describe("comparisons", () => {
  test("a compared string is a value, not a class", () => {
    expect(token('clsx(styles.root, height === "con|tent" && "a")')).toBeUndefined();
    expect(token('clsx("con|tent" !== height && "a")')).toBeUndefined();
    expect(token('clsx(size == "s|m" ? "text-sm" : "")')).toBeUndefined();
    expect(token('clsx(size === "sm" ? "text-|sm" : "")')).toBe('text-sm [text-sm] "text-"');
    expect(
      all('<p className={clsx(height === "content" && "a", x != "b" ? "c" : "d")} />'),
    ).toEqual(["a", "c", "d"]);
  });
});
