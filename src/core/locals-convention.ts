// CSS Modules class name → JS export names, as Vite's `css.modules.localsConvention`
// (postcss-modules): camelCase variants use lodash's camelCase, dashes variants only convert
// dashes. The non-"Only" variants export the original name too.

export type LocalsConvention = "asIs" | "camelCase" | "camelCaseOnly" | "dashes" | "dashesOnly";

export const LOCALS_CONVENTIONS: readonly LocalsConvention[] = [
  "asIs",
  "camelCase",
  "camelCaseOnly",
  "dashes",
  "dashesOnly",
];

// ASCII form of lodash's unicode word pattern (ordinals and emoji left out).
const WORDS =
  /[A-Z]?[a-z]+(?=[^A-Za-z]|[A-Z]|$)|[A-Z]+(?=[^A-Za-z]|[A-Z][a-z]|$)|[A-Z]?[a-z]+|[A-Z]+|\d+/g;

/** lodash `camelCase` for ASCII input. */
export function camelCase(s: string): string {
  const words = s.match(WORDS) ?? [];
  return words
    .map((w, i) => {
      const lower = w.toLowerCase();
      return i === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join("");
}

/** postcss-modules `dashesCamelCase`. */
export function dashesCamelCase(s: string): string {
  return s.replace(/-+(\w)/g, (_, c: string) => c.toUpperCase());
}

/** JS names under which a class is exported. */
export function exportNames(className: string, convention: LocalsConvention): string[] {
  switch (convention) {
    case "asIs":
      return [className];
    case "camelCase":
      return unique(className, camelCase(className));
    case "camelCaseOnly":
      return [camelCase(className)];
    case "dashes":
      return unique(className, dashesCamelCase(className));
    case "dashesOnly":
      return [dashesCamelCase(className)];
  }
}

const unique = (a: string, b: string) => (a === b ? [a] : [a, b]);

export const isIdentifier = (s: string) => /^[A-Za-z_$][\w$]*$/.test(s);
