// Benchmarks for the pure core (SPEC §8). Prints median and p95 per case; budgets are checked by
// reading the output and recorded in docs/benchmarks.md.
import {
  generateClassComponent,
  generateComponent,
  generateModule,
  generateStylesheet,
  generateUtilities,
  minify,
} from "../src/core/bench-input.ts";
import { classTokenAt } from "../src/core/class-context.ts";
import { colorUsages } from "../src/core/color-usages.ts";
import { parseColor } from "../src/core/color.ts";
import { moduleExports } from "../src/core/module-classes.ts";
import { byPreference, resolveValue } from "../src/core/resolve.ts";
import { completionSiteAt, ImportCache, parseImports, usageAt } from "../src/core/ts-scan.ts";
import { scanCss } from "../src/core/scan.ts";
import { SymbolIndex } from "../src/core/symbol-index.ts";

function measure(name: string, fn: () => unknown, budgetMs?: number): void {
  const deadline = performance.now() + 300;
  while (performance.now() < deadline) fn();
  const times: number[] = [];
  const end = performance.now() + 2000;
  while (times.length < 50 || (performance.now() < end && times.length < 2000)) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const at = (q: number) => (times[Math.floor(q * (times.length - 1))] ?? 0).toFixed(3);
  const budget = budgetMs === undefined ? "" : `  budget ${budgetMs} ms`;
  console.log(
    `${name.padEnd(40)} median ${at(0.5)} ms  p95 ${at(0.95)} ms  n=${times.length}${budget}`,
  );
}

const css = generateStylesheet(10_000);
const minified = minify(css);
const symbols = scanCss(css, { module: false });
console.log(
  `input: ${css.split("\n").length} lines, ${css.length} chars (minified ${minified.length});`,
  `${symbols.rules.length} rules, ${symbols.classes.length} classes, ${symbols.properties.length} properties`,
);

measure("scan 10k lines", () => scanCss(css, { module: false }), 3);
measure("scan 10k lines, minified", () => scanCss(minified, { module: false }), 3);
measure("scan 10k lines as CSS Module", () => scanCss(css, { module: true }), 3);

const index = new SymbolIndex();
for (let i = 0; i < 20; i++) index.setFile(`other-${i}.css`, symbols);
measure("index: replace one 10k-line file", () => index.setFile("big.css", symbols));
measure("index: completion name lists (21 files)", () => [
  ...index.classNames(),
  ...index.propertyNames(),
]);
measure("index: find property in 21 files", () => index.findProperty("--ds-color-3"));

// Module class providers (§8 warm budget, owned by M2): the work after a keystroke in a TSX file
// once the CSS file is cached: header check, usage at the cursor, export lookup.
const component = generateComponent(1_000, 20);
const edited = component.replace("Row 0:", "Row 0!");
const moduleSymbols = scanCss(generateModule(40), { module: true });
const imports = new ImportCache();
const cursor = component.lastIndexOf(".card") + 3;
const indexCursor = component.lastIndexOf('["title-') + 4;
const memberSite = component.lastIndexOf(".card") + 1;
let flip = false;
const keystroke = () => {
  flip = !flip;
  return flip ? component : edited;
};
console.log(
  `component: ${component.split(String.fromCharCode(10)).length} lines, ${component.length} chars, 20 imports`,
);
// The cases below must measure real hits, not the cheap "nothing here" path.
for (const [name, offset] of [
  ["member", cursor],
  ["index", indexCursor],
] as const) {
  const usage = usageAt(component, offset, imports.get("doc", component));
  const hit =
    usage?.kind === "member" && moduleExports(moduleSymbols, "asIs").byName.has(usage.name);
  if (!hit) throw new Error(`bench input broken: no ${name} usage with a class at the cursor`);
}
if (completionSiteAt(component, memberSite, imports.get("doc", component))?.kind !== "member") {
  throw new Error("bench input broken: no completion site at the cursor");
}
measure(
  "definition/hover: usage + lookup",
  () => {
    const text = keystroke();
    const usage = usageAt(text, cursor, imports.get("doc", text));
    if (usage?.kind === "member") moduleExports(moduleSymbols, "asIs").byName.get(usage.name);
  },
  1,
);
measure(
  "definition: quoted index usage + lookup",
  () => {
    const text = keystroke();
    const usage = usageAt(text, indexCursor, imports.get("doc", text));
    if (usage?.kind === "member") moduleExports(moduleSymbols, "asIs").byName.get(usage.name);
  },
  1,
);
measure(
  "completion: site + names",
  () => {
    const text = keystroke();
    if (completionSiteAt(text, memberSite, imports.get("doc", text))) {
      void moduleExports(moduleSymbols, "camelCase").completionNames.length;
    }
  },
  1,
);
measure("import header parse (cold)", () => new ImportCache().get("doc", component));

// Custom properties (§8 warm budget, owned by M3), on the generated stylesheet's tokens.
const tokenIndex = new SymbolIndex();
tokenIndex.setFile("tokens.css", symbols);
const lookup = (name: string) => tokenIndex.findProperty(name);
const names = [...tokenIndex.propertyNames()];
console.log(`tokens: ${names.length} properties`);
const chainHead = names.find((n) => resolveValue(`var(${n})`, lookup).steps.length >= 3);
if (!chainHead) throw new Error("bench input broken: no var() chain of 3 steps");
measure("resolve a 3-step var() chain", () => resolveValue(`var(${chainHead})`, lookup), 1);
const resolveAll = () => {
  const resolved = new Map<string, unknown>();
  for (const name of names) {
    const counting = byPreference(lookup(name))[0];
    if (!counting) continue;
    const r = resolveValue(counting.symbol.value, lookup, counting.symbol.scopeParts);
    resolved.set(name, parseColor(r.value));
  }
  return resolved;
};
measure("completion list: resolve all (cold cache)", resolveAll);
const cached = resolveAll();
measure(
  "completion list: cached values + same-file check (warm)",
  () => {
    let kept = 0;
    for (const name of names) {
      if (!cached.has(name)) continue;
      if (lookup(name).every((d) => d.file === "current.css")) continue;
      kept++;
    }
    return kept;
  },
  1,
);
const usageCss = Array.from(
  { length: 300 },
  (_, i) =>
    `.u${i} { color: var(--ds-color-${(i * 3) % 600}); box-shadow: 0 0 rgba(var(--ds-color-${(i * 3) % 600}), .5); }`,
).join("\n");
if (colorUsages(usageCss).length !== 600) throw new Error("bench input broken: colour usages");
measure("colour usages + resolution in a 300-use CSS file", () => {
  for (const usage of colorUsages(usageCss))
    parseColor(resolveValue(usage.expression, lookup).value);
});

// Global classes (§8 warm budget, owned by M4): class context detection plus lookups.
const classComponent = generateClassComponent(1_000);
const classImports = parseImports(classComponent);
const functions = ["clsx", "cn", "cx", "classnames"];
const utilities = new SymbolIndex();
utilities.setFile("utilities.css", scanCss(generateUtilities(400), { module: false }));
const lastClsx = classComponent.lastIndexOf('open && "util-') + 15;
const lastAttribute = classComponent.lastIndexOf('className="util-') + 14;
for (const [what, offset] of [
  ["clsx", lastClsx],
  ["attribute", lastAttribute],
] as const) {
  const token = classTokenAt(classComponent, offset, functions, classImports);
  if (!token || utilities.findClass(token.name).length === 0) {
    throw new Error(`bench input broken: no ${what} class token at the cursor`);
  }
}
console.log(`class component: ${classComponent.split("\n").length} lines, 400 utility classes`);
measure(
  "class context in multi-line clsx + lookup",
  () => {
    const token = classTokenAt(classComponent, lastClsx, functions, classImports);
    if (token) utilities.findClass(token.name);
  },
  1,
);
measure(
  "class context in className attribute + lookup",
  () => {
    const token = classTokenAt(classComponent, lastAttribute, functions, classImports);
    if (token) utilities.findClass(token.name);
  },
  1,
);
measure(
  "global class completion list (400 classes)",
  () => {
    let n = 0;
    for (const name of utilities.classNames()) {
      const defs = utilities.findClass(name);
      if (defs.filter((d) => !d.file.includes("node_modules")).concat(defs)[0]) n++;
    }
    return n;
  },
  1,
);
