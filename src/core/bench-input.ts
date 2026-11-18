// Generated stylesheets for benchmarks, shaped like a design-system package plus app CSS.
// Deterministic, so runs are comparable.

const hex = (i: number) => ((i * 2654435761) >>> 8).toString(16).padStart(6, "0").slice(0, 6);

/** A stylesheet of at least `lines` lines. */
export function generateStylesheet(lines: number): string {
  const out: string[] = ["@layer ds.base, ds.components, ds.utilities;", ""];

  out.push("/* Tokens */", ":root {");
  for (let i = 0; i < 600; i++) {
    if (i % 3 === 0) out.push(`  --ds-color-${i}: #${hex(i)};`);
    else if (i % 3 === 1) out.push(`  --ds-color-${i}: var(--ds-color-${i - 1});`);
    else out.push(`  --ds-space-${i}: calc(${i % 8} * 0.25rem);`);
  }
  out.push("  --ds-icon: url(data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=);", "}", "");

  for (const theme of ["theme-default", "theme-contrast"]) {
    out.push(`.${theme} {`);
    for (let i = 0; i < 100; i++) out.push(`  --ds-accent-${i}: var(--ds-color-${i * 3});`);
    out.push("}", "");
  }

  out.push("@layer ds.utilities {");
  for (let i = 0; i < 40; i++) {
    out.push(
      `  .text-${i} {`,
      `    font-size: ${0.5 + i / 10}rem;`,
      "    line-height: 1.25;",
      "  }",
    );
    out.push(`  .md\\:flex-${i} {`, "    display: flex;", "  }");
  }
  out.push("}", "");

  for (let i = 0; out.length < lines; i++) {
    const media = i % 6 === 0;
    if (media) out.push("@media (min-width: 40rem) {");
    out.push(
      `/* Component ${i}: { not a rule } */`,
      `.card-${i} .header_${i}:hover > .title-${i % 13}, .card-${i}::before {`,
      `  color: var(--ds-color-${(i * 3) % 600});`,
      `  background: url("img/card-${i}.png") no-repeat;`,
      '  content: "a;b}c";',
      `  padding: var(--ds-space-${(i * 3 + 2) % 600}) 1rem;`,
      "  &.is-active {",
      "    outline: 1px solid currentColor;",
      "  }",
      `  .icon-${i} { inline-size: 1rem; }`,
      "}",
    );
    if (media) out.push("}");
  }
  return out.join("\n") + "\n";
}

/** Rough minification: no comments, collapsed whitespace. Fine for generated input only. */
export function minify(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([{};,>])\s*/g, "$1");
}
