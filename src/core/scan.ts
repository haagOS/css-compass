// Single-pass CSS scanner. Collects style rules, class names and custom properties with UTF-16
// offsets. It never throws and recovers from partial input (comments, strings and blocks left
// open while the user types).

export interface CssRule {
  /** Trimmed selector text range. */
  readonly selectorStart: number;
  readonly selectorEnd: number;
  /** From `{` to just after the matching `}` (or the end of the text if unclosed). */
  readonly blockStart: number;
  readonly blockEnd: number;
  /** Enclosing at-rule preludes, outermost first, e.g. `["@layer ds.utilities"]`. */
  readonly atRules: readonly string[];
  /** Index of the enclosing style rule (CSS nesting), or -1. */
  readonly parent: number;
}

export interface CssClass {
  /** Decoded name without the dot (`md:flex` for `.md\:flex`). */
  readonly name: string;
  /** Raw source range of the name, without the dot. */
  readonly start: number;
  readonly end: number;
  /** True for CSS Modules local classes; false for global ones. */
  readonly local: boolean;
  /** Index into `rules`. */
  readonly rule: number;
}

export interface CssProperty {
  /** Name including the leading `--`. */
  readonly name: string;
  readonly start: number;
  readonly end: number;
  /** Raw value text, trimmed. */
  readonly value: string;
  readonly valueStart: number;
  readonly valueEnd: number;
  /** Selector of the nearest enclosing style rule, whitespace-normalized; "" if none. */
  readonly scope: string;
  /** `scope` split at top-level commas. */
  readonly scopeParts: readonly string[];
  readonly atRules: readonly string[];
  /** Index of the nearest enclosing style rule, or -1. */
  readonly rule: number;
}

export interface CssSymbols {
  readonly rules: readonly CssRule[];
  readonly classes: readonly CssClass[];
  readonly properties: readonly CssProperty[];
}

export interface ScanOptions {
  /** CSS Modules file: classes are local unless marked `:global`. */
  readonly module: boolean;
}

const FRAME_STYLE = 0;
const FRAME_AT_RULE = 1;
const FRAME_KEYFRAMES = 2;

interface Frame {
  readonly kind: number;
  /** Rule index if this frame is a style rule, else -1. */
  readonly rule: number;
  /** Nearest style rule at or above this frame, or -1. */
  readonly styleRule: number;
  readonly atRules: readonly string[];
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const NO_AT_RULES: readonly string[] = [];
const ROOT: Frame = { kind: FRAME_AT_RULE, rule: -1, styleRule: -1, atRules: NO_AT_RULES };

const C = {
  tab: 9,
  lf: 10,
  ff: 12,
  cr: 13,
  space: 32,
  quote: 34,
  apostrophe: 39,
  lparen: 40,
  rparen: 41,
  star: 42,
  comma: 44,
  hyphen: 45,
  dot: 46,
  slash: 47,
  colon: 58,
  semicolon: 59,
  at: 64,
  lbracket: 91,
  backslash: 92,
  rbracket: 93,
  underscore: 95,
  lbrace: 123,
  rbrace: 125,
} as const;

const isWhitespace = (c: number) =>
  c === C.space || c === C.lf || c === C.tab || c === C.cr || c === C.ff;
const isNewline = (c: number) => c === C.lf || c === C.cr || c === C.ff;
const isHex = (c: number) => (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);
const isNameStart = (c: number) =>
  (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || c === C.underscore || c >= 0x80;
const isNameChar = (c: number) => isNameStart(c) || (c >= 48 && c <= 57) || c === C.hyphen;

export function scanCss(text: string, options: ScanOptions): CssSymbols {
  return new Scanner(text, options.module).run();
}

class Scanner {
  private pos = 0;
  private readonly len: number;
  private readonly rules: Mutable<CssRule>[] = [];
  private readonly classes: CssClass[] = [];
  private readonly properties: CssProperty[] = [];
  private readonly stack: Frame[] = [ROOT];
  private readonly scopes = new Map<number, { scope: string; parts: readonly string[] }>();

  private readonly text: string;
  private readonly module: boolean;

  constructor(text: string, module: boolean) {
    this.text = text;
    this.module = module;
    this.len = text.length;
  }

  run(): CssSymbols {
    const { text, len } = this;
    let stmt = -1;
    let depth = 0;
    while (this.pos < len) {
      const c = text.charCodeAt(this.pos);
      if (c === C.slash && text.charCodeAt(this.pos + 1) === C.star) {
        this.skipComment();
        continue;
      }
      if (stmt < 0) {
        if (isWhitespace(c)) {
          this.pos++;
          continue;
        }
        if (c !== C.rbrace && c !== C.semicolon && c !== C.lbrace) {
          stmt = this.pos;
          depth = 0;
          if (this.frame().kind !== FRAME_KEYFRAMES && this.atCustomProperty()) {
            this.scanCustomProperty();
            stmt = -1;
            continue;
          }
        }
      }
      if (c === C.quote || c === C.apostrophe) {
        this.skipString(c);
      } else if (c === C.backslash) {
        this.pos += 2;
      } else if (c === C.lparen || c === C.lbracket) {
        if (c === C.lparen && this.isUnquotedUrl()) this.skipUrl();
        else {
          depth++;
          this.pos++;
        }
      } else if (c === C.rparen || c === C.rbracket) {
        if (depth > 0) depth--;
        this.pos++;
      } else if (c === C.semicolon && depth === 0) {
        stmt = -1;
        this.pos++;
      } else if (c === C.lbrace && depth === 0) {
        this.openBlock(stmt < 0 ? this.pos : stmt, this.pos);
        stmt = -1;
        this.pos++;
      } else if (c === C.rbrace) {
        // Closes the block even inside unbalanced parens: recovery while typing.
        this.closeBlock(this.pos + 1);
        stmt = -1;
        depth = 0;
        this.pos++;
      } else {
        this.pos++;
      }
    }
    for (let i = this.stack.length - 1; i > 0; i--) this.closeBlock(len);
    return { rules: this.rules, classes: this.classes, properties: this.properties };
  }

  private frame(): Frame {
    return this.stack[this.stack.length - 1] ?? ROOT;
  }

  private openBlock(preludeStart: number, brace: number): void {
    const parent = this.frame();
    let end = brace;
    while (end > preludeStart && isWhitespace(this.text.charCodeAt(end - 1))) end--;

    if (this.text.charCodeAt(preludeStart) === C.at) {
      const prelude = normalize(this.text.slice(preludeStart, end));
      const name = /^@[\w-]*/.exec(prelude)?.[0].toLowerCase() ?? "@";
      const kind = name.endsWith("keyframes") ? FRAME_KEYFRAMES : FRAME_AT_RULE;
      this.stack.push({
        kind,
        rule: -1,
        styleRule: parent.styleRule,
        atRules: [...parent.atRules, prelude],
      });
      return;
    }
    if (parent.kind === FRAME_KEYFRAMES) {
      this.stack.push({ ...parent, rule: -1 });
      return;
    }
    const rule = this.rules.length;
    this.rules.push({
      selectorStart: preludeStart,
      selectorEnd: end,
      blockStart: brace,
      blockEnd: this.len,
      atRules: parent.atRules,
      parent: parent.styleRule,
    });
    this.stack.push({ kind: FRAME_STYLE, rule, styleRule: rule, atRules: parent.atRules });
    this.scanSelector(preludeStart, end, rule);
  }

  private closeBlock(end: number): void {
    if (this.stack.length <= 1) return;
    const frame = this.stack.pop();
    if (frame && frame.rule >= 0) {
      const rule = this.rules[frame.rule];
      if (rule) rule.blockEnd = end;
    }
  }

  private skipComment(): void {
    const close = this.text.indexOf("*/", this.pos + 2);
    this.pos = close < 0 ? this.len : close + 2;
  }

  private skipString(quote: number): void {
    this.pos = stringEnd(this.text, this.pos, quote);
  }

  /** At `(`: true if preceded by `url` and the argument is not quoted. */
  private isUnquotedUrl(): boolean {
    const { text, pos } = this;
    if (
      pos < 3 ||
      (text.charCodeAt(pos - 3) | 0x20) !== 117 ||
      (text.charCodeAt(pos - 2) | 0x20) !== 114 ||
      (text.charCodeAt(pos - 1) | 0x20) !== 108
    ) {
      return false;
    }
    if (pos > 3 && isNameChar(text.charCodeAt(pos - 4))) return false;
    let i = pos + 1;
    while (i < this.len && isWhitespace(text.charCodeAt(i))) i++;
    const c = text.charCodeAt(i);
    return c !== C.quote && c !== C.apostrophe;
  }

  /** Skips `(...)` of an unquoted url; it cannot contain a newline, so one ends it early. */
  private skipUrl(): void {
    const { text, len } = this;
    let i = this.pos + 1;
    while (i < len) {
      const c = text.charCodeAt(i);
      if (c === C.rparen) {
        this.pos = i + 1;
        return;
      }
      if (isNewline(c)) break;
      i++;
    }
    this.pos = i;
  }

  private atCustomProperty(): boolean {
    const { text } = this;
    if (text.charCodeAt(this.pos) !== C.hyphen || text.charCodeAt(this.pos + 1) !== C.hyphen) {
      return false;
    }
    let i = this.identEnd(this.pos);
    while (i < this.len && isWhitespace(text.charCodeAt(i))) i++;
    return text.charCodeAt(i) === C.colon;
  }

  /** Reads `--name: value` up to `;` or the enclosing `}`; values may hold balanced blocks. */
  private scanCustomProperty(): void {
    const { text, len } = this;
    const start = this.pos;
    const nameEnd = this.identEnd(start);
    let i = text.indexOf(":", nameEnd) + 1;
    while (i < len && isWhitespace(text.charCodeAt(i))) i++;
    const valueStart = i;
    let depth = 0;
    let braces = 0;
    this.pos = i;
    while (this.pos < len) {
      const c = text.charCodeAt(this.pos);
      if (c === C.slash && text.charCodeAt(this.pos + 1) === C.star) {
        this.skipComment();
      } else if (c === C.quote || c === C.apostrophe) {
        this.skipString(c);
      } else if (c === C.backslash) {
        this.pos += 2;
      } else if (c === C.lparen && this.isUnquotedUrl()) {
        this.skipUrl();
      } else if (c === C.lparen || c === C.lbracket) {
        depth++;
        this.pos++;
      } else if (c === C.lbrace) {
        braces++;
        this.pos++;
      } else if (c === C.rparen || c === C.rbracket) {
        if (depth > 0) depth--;
        this.pos++;
      } else if (c === C.rbrace) {
        // An unclosed paren must not keep the value open past its block.
        if (braces === 0) break;
        braces--;
        this.pos++;
      } else if (c === C.semicolon && depth === 0 && braces === 0) {
        break;
      } else {
        this.pos++;
      }
    }
    let valueEnd = Math.min(this.pos, len);
    while (valueEnd > valueStart && isWhitespace(text.charCodeAt(valueEnd - 1))) valueEnd--;
    if (text.charCodeAt(this.pos) === C.semicolon) this.pos++;

    const frame = this.frame();
    const { scope, parts } = this.scopeOf(frame.styleRule);
    this.properties.push({
      name: decodeIdent(text, start, nameEnd),
      start,
      end: nameEnd,
      value: text.slice(valueStart, valueEnd),
      valueStart,
      valueEnd,
      scope,
      scopeParts: parts,
      atRules: frame.atRules,
      rule: frame.styleRule,
    });
  }

  private scopeOf(rule: number): { scope: string; parts: readonly string[] } {
    const known = this.scopes.get(rule);
    if (known) return known;
    const r = this.rules[rule];
    const scope = r ? normalize(this.text.slice(r.selectorStart, r.selectorEnd)) : "";
    const result = { scope, parts: scope === "" ? [] : splitTopLevel(scope) };
    this.scopes.set(rule, result);
    return result;
  }

  /** End of an identifier starting at `start` (escapes included). */
  private identEnd(start: number): number {
    const { text, len } = this;
    let i = start;
    while (i < len) {
      const c = text.charCodeAt(i);
      if (isNameChar(c)) i++;
      else if (c === C.backslash && i + 1 < len && !isNewline(text.charCodeAt(i + 1))) {
        i = escapeEnd(text, i);
      } else break;
    }
    return i;
  }

  /** True if an identifier starts at `i` (CSS Syntax §4.3.9). */
  private startsIdent(i: number): boolean {
    const { text } = this;
    const c = text.charCodeAt(i);
    if (isNameStart(c)) return true;
    if (c === C.backslash) return i + 1 < this.len && !isNewline(text.charCodeAt(i + 1));
    if (c === C.hyphen) {
      const n = text.charCodeAt(i + 1);
      if (isNameStart(n) || n === C.hyphen) return true;
      return n === C.backslash && i + 2 < this.len && !isNewline(text.charCodeAt(i + 2));
    }
    return false;
  }

  /** Collects `.class` tokens in a selector, tracking `:global` / `:local` for modules. */
  private scanSelector(start: number, end: number, rule: number): void {
    const { text } = this;
    const fallback = this.module;
    let local = fallback;
    // Mode to restore at each `)`; :global(...) and :local(...) set the mode inside.
    const parens: boolean[] = [];
    let i = start;
    while (i < end) {
      const c = text.charCodeAt(i);
      if (c === C.slash && text.charCodeAt(i + 1) === C.star) {
        const close = text.indexOf("*/", i + 2);
        i = close < 0 || close >= end ? end : close + 2;
      } else if (c === C.quote || c === C.apostrophe) {
        i = stringEnd(text, i, c);
      } else if (c === C.backslash) {
        i = escapeEnd(text, i);
      } else if (c === C.lbracket) {
        i = bracketEnd(text, i, end);
      } else if (c === C.dot && this.startsIdent(i + 1)) {
        const nameEnd = this.identEnd(i + 1);
        this.classes.push({
          name: decodeIdent(text, i + 1, nameEnd),
          start: i + 1,
          end: nameEnd,
          local: this.module && local,
          rule,
        });
        i = nameEnd;
      } else if (c === C.colon && this.module) {
        const nameEnd = this.identEnd(i + 1);
        const pseudo = text.slice(i + 1, nameEnd).toLowerCase();
        if (pseudo === "global" || pseudo === "local") {
          const isLocal = pseudo === "local";
          if (text.charCodeAt(nameEnd) === C.lparen) {
            parens.push(local);
            local = isLocal;
            i = nameEnd + 1;
          } else {
            local = isLocal;
            i = nameEnd;
          }
        } else {
          i = nameEnd > i + 1 ? nameEnd : i + 1;
        }
      } else if (c === C.lparen) {
        parens.push(local);
        i++;
      } else if (c === C.rparen) {
        local = parens.pop() ?? local;
        i++;
      } else if (c === C.comma && parens.length === 0) {
        local = fallback;
        i++;
      } else {
        i++;
      }
    }
  }
}

/** End of the string opening at `i`; an unescaped newline ends it (CSS bad-string recovery). */
function stringEnd(text: string, i: number, quote: number): number {
  let j = i + 1;
  while (j < text.length) {
    const c = text.charCodeAt(j);
    if (c === C.backslash) j += 2;
    else if (c === quote) return j + 1;
    else if (isNewline(c)) return j;
    else j++;
  }
  return text.length;
}

/** End of the attribute selector opening at `i`, skipping strings inside it. */
function bracketEnd(text: string, i: number, limit: number): number {
  let j = i + 1;
  while (j < limit) {
    const c = text.charCodeAt(j);
    if (c === C.rbracket) return j + 1;
    if (c === C.quote || c === C.apostrophe) j = stringEnd(text, j, c);
    else if (c === C.backslash) j += 2;
    else j++;
  }
  return limit;
}

/** End of the escape starting at the backslash at `i`. */
function escapeEnd(text: string, i: number): number {
  let j = i + 1;
  if (j >= text.length) return j;
  if (!isHex(text.charCodeAt(j))) return j + 1;
  const limit = j + 6;
  while (j < limit && j < text.length && isHex(text.charCodeAt(j))) j++;
  const c = text.charCodeAt(j);
  if (c === C.cr && text.charCodeAt(j + 1) === C.lf) return j + 2;
  return isWhitespace(c) ? j + 1 : j;
}

/** Identifier text with CSS escapes resolved. */
export function decodeIdent(text: string, start: number, end: number): string {
  let escaped = false;
  for (let k = start; k < end && !escaped; k++) escaped = text.charCodeAt(k) === C.backslash;
  if (!escaped) return text.slice(start, end);
  let out = "";
  let i = start;
  while (i < end) {
    const c = text.charCodeAt(i);
    if (c !== C.backslash) {
      out += text[i];
      i++;
      continue;
    }
    const next = escapeEnd(text, i);
    const body = text.slice(i + 1, next).trim();
    if (body.length > 0 && isHex(body.charCodeAt(0))) {
      const code = Number.parseInt(body, 16);
      const valid = code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff);
      out += String.fromCodePoint(valid ? code : 0xfffd);
    } else {
      out += text.slice(i + 1, next);
    }
    i = next;
  }
  return out;
}

/** Strips comments and collapses whitespace. */
function normalize(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?(\*\/|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Splits at commas outside parentheses, brackets and strings. */
function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = 0;
  let from = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (quote) {
      if (c === C.backslash) i++;
      else if (c === quote) quote = 0;
    } else if (c === C.quote || c === C.apostrophe) quote = c;
    else if (c === C.lparen || c === C.lbracket) depth++;
    else if ((c === C.rparen || c === C.rbracket) && depth > 0) depth--;
    else if (c === C.comma && depth === 0) {
      parts.push(s.slice(from, i).trim());
      from = i + 1;
    }
  }
  parts.push(s.slice(from).trim());
  return parts.filter((p) => p !== "");
}
