// Global class names in TS/JS: the class token under the cursor when it sits in a class context
// (SPEC §5.2): a `className`/`class` attribute value or an argument of a class function such as
// `clsx`, including conditionals, arrays and object keys, also across lines.
import { usageAt, type ModuleImport } from "./ts-scan.ts";

export interface ClassToken {
  /** The class name (may be empty between spaces, for completion). */
  readonly name: string;
  /** Range of the name. */
  readonly start: number;
  readonly end: number;
  /** Typed so far (from `start` to the cursor). */
  readonly prefix: string;
  /** False for identifier object keys (`{ hidden: open }`): hover and definition only. */
  readonly completable: boolean;
}

/** Lines the backward scan may cover. */
export const MAX_SCAN_LINES = 50;

const QUOTES = new Set([34, 39, 96]); // " ' `
const isIdentChar = (c: number) =>
  (c >= 97 && c <= 122) ||
  (c >= 65 && c <= 90) ||
  (c >= 48 && c <= 57) ||
  c === 95 ||
  c === 36 ||
  c > 127;
const isSpace = (c: number) => c === 32 || c === 9 || c === 10 || c === 13;
/** Characters after which `[` starts an array and `{` an object (not index access, not a block). */
const EXPRESSION_START = new Set(["(", ",", "{", "[", "?", ":", "=", "&", "|", "!"]);

interface StringSpan {
  /** Offset of the opening quote or backtick. */
  readonly open: number;
  /** Offsets of the static text segment around the cursor. */
  readonly segmentStart: number;
  readonly segmentEnd: number;
}

/** The string literal (or one-line template's static text) containing `offset`, on its line. */
function stringAt(text: string, offset: number): StringSpan | undefined {
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  let lineEnd = text.indexOf("\n", offset);
  if (lineEnd < 0) lineEnd = text.length;
  let quote = 0;
  let open = -1;
  let segmentStart = -1;
  const templates: { open: number; depth: number }[] = [];
  let inTemplateText = false;
  let templateOpen = -1;
  for (let i = lineStart; i < offset; i++) {
    const c = text.charCodeAt(i);
    if (quote) {
      if (c === 92) i++;
      else if (c === quote) quote = 0;
    } else if (inTemplateText) {
      if (c === 92) i++;
      else if (c === 96) inTemplateText = false;
      else if (c === 36 && text.charCodeAt(i + 1) === 123) {
        templates.push({ open: templateOpen, depth: 0 });
        inTemplateText = false;
        i++;
      }
    } else if (c === 34 || c === 39) {
      quote = c;
      open = i;
      segmentStart = i + 1;
    } else if (c === 96) {
      inTemplateText = true;
      templateOpen = i;
      segmentStart = i + 1;
    } else if (c === 47 && (text.charCodeAt(i + 1) === 47 || text.charCodeAt(i + 1) === 42)) {
      return undefined; // a comment starts before the cursor
    } else if (templates.length > 0) {
      const top = templates[templates.length - 1];
      if (!top) continue;
      if (c === 123) top.depth++;
      else if (c === 125) {
        if (top.depth === 0) {
          templates.pop();
          inTemplateText = true;
          templateOpen = top.open;
          segmentStart = i + 1;
        } else top.depth--;
      }
    }
  }
  if (quote) {
    let end = offset;
    while (end < lineEnd && text.charCodeAt(end) !== quote)
      end += text.charCodeAt(end) === 92 ? 2 : 1;
    return { open, segmentStart, segmentEnd: Math.min(end, lineEnd) };
  }
  if (inTemplateText) {
    let end = offset;
    while (end < lineEnd) {
      const c = text.charCodeAt(end);
      if (c === 96 || (c === 36 && text.charCodeAt(end + 1) === 123)) break;
      end += c === 92 ? 2 : 1;
    }
    return { open: templateOpen, segmentStart, segmentEnd: Math.min(end, lineEnd) };
  }
  return undefined;
}

/** The global class token at `offset`, if it is in a class context. */
export function classTokenAt(
  text: string,
  offset: number,
  classFunctions: readonly string[],
  imports: readonly ModuleImport[] = [],
): ClassToken | undefined {
  // `styles["x"]` is a CSS Module class, never a global one (SPEC §10, risk 4).
  if (usageAt(text, offset, imports)?.kind === "member") return undefined;

  const span = stringAt(text, offset);
  if (span) {
    const left = /[^\s"'`{}$]*$/.exec(text.slice(span.segmentStart, offset))?.[0] ?? "";
    const right = /^[^\s"'`{}$]*/.exec(text.slice(offset, span.segmentEnd))?.[0] ?? "";
    const start = offset - left.length;
    if (!inClassContext(text, span.open, classFunctions, isKey(text, span.open))) return undefined;
    return {
      name: left + right,
      start,
      end: offset + right.length,
      prefix: left,
      completable: true,
    };
  }

  // An identifier object key: `clsx({ hidden: open })`.
  const before = /[\w$]*$/.exec(text.slice(Math.max(0, offset - 200), offset))?.[0] ?? "";
  const after = /^[\w$]*/.exec(text.slice(offset, offset + 200))?.[0] ?? "";
  const name = before + after;
  if (!/^[A-Za-z_$][\w$-]*$/.test(name)) return undefined;
  const start = offset - before.length;
  if (!isKeyAt(text, start, start + name.length)) return undefined;
  if (!inClassContext(text, start, classFunctions, true)) return undefined;
  return { name, start, end: start + name.length, prefix: before, completable: false };
}

/** The string opening at `open` is an object key: after `{` or `,`, and followed by `:`. */
function isKey(text: string, open: number): boolean {
  const quote = text.charCodeAt(open);
  let close = open + 1;
  while (close < text.length && text.charCodeAt(close) !== quote) {
    if (text.charCodeAt(close) === 10) return false;
    close += text.charCodeAt(close) === 92 ? 2 : 1;
  }
  return isKeyAt(text, open, close + 1);
}

function isKeyAt(text: string, start: number, end: number): boolean {
  let after = end;
  while (after < text.length && isSpace(text.charCodeAt(after))) after++;
  if (text[after] !== ":") return false;
  let before = start - 1;
  while (before >= 0 && isSpace(text.charCodeAt(before))) before--;
  return text[before] === "{" || text[before] === ",";
}

/**
 * Scans backward from `from` (the string's opening quote or the key's start) for the construct
 * the value belongs to. `key` tells whether the value is an object key, which the innermost
 * object requires.
 */
function inClassContext(
  text: string,
  from: number,
  classFunctions: readonly string[],
  key: boolean,
): boolean {
  if (isAttributeValue(text, from)) return true;
  const limit = lineStartBefore(text, from, MAX_SCAN_LINES);
  let depth = 0;
  let innermost = true;
  let insideTemplate = false;
  for (let i = from - 1; i >= limit; i--) {
    const ch = text[i] ?? "";
    const c = text.charCodeAt(i);
    if (QUOTES.has(c)) {
      if (c === 96 && insideTemplate && depth === 0) {
        insideTemplate = false; // the opening backtick of the template we came out of
        continue;
      }
      i = previousQuote(text, i, c, limit);
      continue;
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      depth++;
      continue;
    }
    if (ch === ";" && depth === 0) return false;
    if (ch !== "(" && ch !== "[" && ch !== "{") continue;
    if (depth > 0) {
      depth--;
      continue;
    }
    // An enclosing opener.
    const prev = previousNonSpace(text, i - 1);
    if (ch === "(") {
      const name = identifierBefore(text, i);
      if (name) return classFunctions.includes(name);
      innermost = false; // grouping parens
      continue;
    }
    if (ch === "[") {
      if (!EXPRESSION_START.has(text[prev] ?? "") && prev >= 0) return false; // index access
      if (innermost && key) return false;
      innermost = false;
      continue;
    }
    // `{`
    if (text[prev] === "$") {
      insideTemplate = true; // `${` of a template literal
      innermost = false;
      continue;
    }
    if (text[prev] === "=" && isAttributeName(text, prev)) return !innermost || !key;
    if (!EXPRESSION_START.has(text[prev] ?? "")) return false; // a block or JSX child
    if (innermost && !key) return false; // object values aren't classes
    innermost = false;
  }
  return false;
}

/** `className="…"` / `class='…'`: the string directly follows the attribute's `=`. */
function isAttributeValue(text: string, open: number): boolean {
  const eq = previousNonSpace(text, open - 1);
  return text[eq] === "=" && isAttributeName(text, eq);
}

function isAttributeName(text: string, eq: number): boolean {
  const end = previousNonSpace(text, eq - 1) + 1;
  const name = /[\w$-]*$/.exec(text.slice(Math.max(0, end - 40), end))?.[0];
  return name === "className" || name === "class";
}

function identifierBefore(text: string, paren: number): string | undefined {
  const end = previousNonSpace(text, paren - 1) + 1;
  let start = end;
  while (start > 0 && isIdentChar(text.charCodeAt(start - 1))) start--;
  const name = text.slice(start, end);
  return name === "" || /^\d/.test(name) ? undefined : name;
}

function previousNonSpace(text: string, from: number): number {
  let i = from;
  while (i >= 0 && isSpace(text.charCodeAt(i))) i--;
  return i;
}

/** Index of the quote opening the string that ends at `close`, or `limit` if not found. */
function previousQuote(text: string, close: number, quote: number, limit: number): number {
  for (let i = close - 1; i >= limit; i--) {
    const c = text.charCodeAt(i);
    // Quoted strings end at the line; a lone quote there is stray text (JSX `Don't`).
    if (c === 10 && quote !== 96) return close;
    if (c !== quote) continue;
    let backslashes = 0;
    for (let j = i - 1; j >= 0 && text.charCodeAt(j) === 92; j--) backslashes++;
    if (backslashes % 2 === 0) return i;
  }
  return limit;
}

function lineStartBefore(text: string, offset: number, lines: number): number {
  let i = offset;
  for (let n = 0; n < lines && i > 0; n++) i = text.lastIndexOf("\n", i - 1);
  return Math.max(0, i);
}
