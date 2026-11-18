import { describe, expect, test } from "vitest";
import {
  completionSiteAt,
  headerEnd,
  ImportCache,
  parseImports,
  usageAt,
  type ModuleImport,
} from "./ts-scan.ts";

const names = (imports: ModuleImport[]) =>
  imports.map((i) => `${i.namespace ? "* as " : ""}${i.name} <- ${i.specifier}`);

describe("parseImports", () => {
  test("default, namespace and combined imports of .module.css files", () => {
    const text = `"use client";
// comment
import React from "react";
import styles from "./a.module.css";
import * as ns from './b.module.css'
import tool, { x } from "../c.module.css";
import "./side-effect.css";
import global from "./plain.css";

export function App() {}`;
    expect(names(parseImports(text))).toEqual([
      "styles <- ./a.module.css",
      "* as ns <- ./b.module.css",
      "tool <- ../c.module.css",
    ]);
  });

  test("binding range points at the name", () => {
    const text = 'import  styles from "./a.module.css";';
    const [i] = parseImports(text);
    expect(i && text.slice(i.nameStart, i.nameEnd)).toBe("styles");
  });

  test("type-only imports and imports after code are ignored", () => {
    const text = `import type T from "./a.module.css";
const x = 1;
import late from "./late.module.css";`;
    expect(parseImports(text)).toEqual([]);
  });

  test("multi-line imports and block comments", () => {
    const text = `/* header
 */
import {
  a,
  b,
} from "./x";
import styles
  from "./a.module.css";`;
    expect(names(parseImports(text))).toEqual(["styles <- ./a.module.css"]);
  });

  test("the header ends at the first non-import statement", () => {
    const text = 'import a from "./a.module.css";\nconst x = import("./lazy");';
    expect(text.slice(0, headerEnd(text)).trimEnd()).toBe('import a from "./a.module.css";');
    const dynamic = 'import("./x.module.css");\nimport b from "./b.module.css";';
    expect(headerEnd(dynamic)).toBe(0);
  });
});

describe("ImportCache", () => {
  test("reuses the parse while only the body changes", () => {
    const cache = new ImportCache();
    const header = 'import styles from "./a.module.css";\n';
    const first = cache.get("doc", `${header}const a = styles.x;`);
    expect(cache.get("doc", `${header}const a = styles.xy;`)).toBe(first);
    const changed = cache.get("doc", 'import s from "./b.module.css";\nconst a = 1;');
    expect(names(changed)).toEqual(["s <- ./b.module.css"]);
  });
});

/** `|` marks the cursor. */
function at(source: string) {
  const offset = source.indexOf("|");
  const text = source.slice(0, offset) + source.slice(offset + 1);
  return { text, offset, imports: parseImports(text) };
}
const head = 'import styles from "./a.module.css";\nimport * as ns from "./b.module.css";\n';

function usage(body: string) {
  const { text, offset, imports } = at(head + body);
  const u = usageAt(text, offset, imports);
  if (!u) return undefined;
  const range = text.slice(u.start, u.end);
  return u.kind === "member" ? `member ${u.binding.name}.${u.name} [${range}]` : `binding ${range}`;
}

function site(body: string) {
  const { text, offset, imports } = at(head + body);
  const s = completionSiteAt(text, offset, imports);
  if (!s) return undefined;
  const dot = s.dot < 0 ? "-" : text[s.dot];
  return `${s.kind} ${s.binding.name} "${s.prefix}" [${text.slice(s.start, s.end)}] dot=${dot}`;
}

describe("usageAt", () => {
  test("member access", () => {
    expect(usage("<div className={styles.sh|ell} />")).toBe("member styles.shell [shell]");
    expect(usage("x = styles.shell|;")).toBe("member styles.shell [shell]");
    expect(usage("x = ns.|title")).toBe("member ns.title [title]");
    expect(usage("x = styles ?. shell|")).toBe("member styles.shell [shell]");
  });

  test("quoted index access", () => {
    expect(usage('x = styles["a-|b"]')).toBe("member styles.a-b [a-b]");
    expect(usage("x = styles[ 'cl|s' ]")).toBe("member styles.cls [cls]");
    expect(usage("x = styles[\"a-b']")).toBeUndefined();
  });

  test("the binding itself", () => {
    expect(usage("x = sty|les.shell")).toBe("binding styles");
    expect(usage("x = clsx(sty|les)")).toBe("binding styles");
    expect(usage("return sty|les")).toBe("binding styles");
  });

  test("after keywords and operators", () => {
    expect(usage("return styles.sh|ell")).toBe("member styles.shell [shell]");
    expect(usage("cond && styles.sh|ell")).toBe("member styles.shell [shell]");
    expect(usage('return styles["sh|ell"]')).toBe("member styles.shell [shell]");
  });

  test("bindings after a dot are someone else's", () => {
    expect(usage("x = props.styles.sh|ell")).toBeUndefined();
    expect(usage("x = props.sty|les")).toBeUndefined();
  });

  test("unknown names and non-identifiers", () => {
    expect(usage("x = other.sh|ell")).toBeUndefined();
    expect(usage("x = 1.5|")).toBeUndefined();
    expect(usage("x = sty|lesheet")).toBeUndefined();
  });

  test("not in comments, strings or template text on the same line", () => {
    expect(usage("// see styles.sh|ell")).toBeUndefined();
    expect(usage('x = "styles.sh|ell"')).toBeUndefined();
    expect(usage("x = `styles.sh|ell`")).toBeUndefined();
    expect(usage("<p>Don't use styles.sh|ell</p>")).toBeUndefined();
    expect(usage("/* c */ styles.sh|ell")).toBe("member styles.shell [shell]");
    expect(usage("x = `${styles.sh|ell}`")).toBe("member styles.shell [shell]");
    expect(usage("x = `a ${f({ a: 1 })} ${styles.sh|ell}`")).toBe("member styles.shell [shell]");
    expect(usage('x = "a"; y = styles.sh|ell')).toBe("member styles.shell [shell]");
    expect(usage("// sty|les")).toBeUndefined();
  });

  test("no imports, no work", () => {
    expect(usageAt("styles.shell", 8, [])).toBeUndefined();
  });

  test("on the import statement itself", () => {
    const { text, imports } = at(head + "|");
    const offset = text.indexOf("styles") + 2;
    expect(usageAt(text, offset, imports)?.kind).toBe("binding");
  });
});

describe("completionSiteAt", () => {
  test("after the dot", () => {
    expect(site("x = styles.|")).toBe('member styles "" [] dot=.');
    expect(site("return styles.|")).toBe('member styles "" [] dot=.');
    expect(site("x = styles.sh|")).toBe('member styles "sh" [sh] dot=.');
    expect(site("x = styles.sh|ell;")).toBe('member styles "sh" [shell] dot=.');
  });

  test("inside a quoted index", () => {
    expect(site('x = styles["|')).toBe('index styles "" [] dot=-');
    expect(site('x = styles["a-|b"]')).toBe('index styles "a-" [a-b] dot=-');
  });

  test("not in comments or strings", () => {
    expect(site("// styles.|")).toBeUndefined();
    expect(site('x = "styles.|')).toBeUndefined();
    expect(site("x = `${styles.|")).toBe('member styles "" [] dot=.');
  });

  test("not ours", () => {
    expect(site("x = props.styles.|")).toBeUndefined();
    expect(site('x = props.styles["|')).toBeUndefined();
    expect(site("x = other.|")).toBeUndefined();
    expect(site("x = styles|")).toBeUndefined();
  });
});
