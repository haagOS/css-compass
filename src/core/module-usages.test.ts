import { expect, test } from "vitest";
import { memberUsages } from "./module-usages.ts";
import { parseImports, usageAt } from "./ts-scan.ts";

const header = `import styles from "./a.module.css";\nimport * as $s from "./b.module.css";\n`;

const found = (body: string) => {
  const text = header + body;
  return memberUsages(text, parseImports(text)).map(
    (u) => `${u.binding.name}:${u.name}:${text.slice(u.start, u.end)}`,
  );
};

test("member, optional and index access", () => {
  expect(
    found(`const a = styles.shell + styles?.title + styles["is-active"] + styles[ 'x' ];`),
  ).toEqual([
    "styles:shell:shell",
    "styles:title:title",
    "styles:is-active:is-active",
    "styles:x:x",
  ]);
  expect(found("<div className={$s.box} />")).toEqual(["$s:box:box"]);
});

test("strings, comments, other objects and dynamic access are skipped", () => {
  expect(
    found(
      [
        `const s = "styles.inString";`,
        "// styles.inComment",
        "const t = `styles.inTemplate`;",
        "/* styles.inBlock */ const u = props.styles.notOurs;",
        'const v = mystyles.notOurs + styles[key] + styles[`x`] + styles[""];',
        "const w = `${styles.inside}`;",
      ].join("\n"),
    ),
  ).toEqual(["styles:inside:inside"]);
});

test("every usage found agrees with usageAt at the same place", () => {
  const text = `${header}const a = styles.shell;\nexport const b = <p className={styles["is-active"]}>{$s?.box}</p>;\n`;
  const imports = parseImports(text);
  const usages = memberUsages(text, imports);
  expect(usages).toHaveLength(3);
  for (const u of usages) {
    const at = usageAt(text, u.start + 1, imports);
    expect(at?.kind === "member" && [at.name, at.start, at.end]).toEqual([u.name, u.start, u.end]);
  }
});

test("no imports, no work", () => {
  expect(memberUsages("styles.x", [])).toEqual([]);
});
