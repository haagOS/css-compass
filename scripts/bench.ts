// Benchmarks for the pure core (SPEC §8). Prints median and p95 per case; budgets are checked by
// reading the output and recorded in docs/benchmarks.md.
import { generateStylesheet, minify } from "../src/core/bench-input.ts";
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
