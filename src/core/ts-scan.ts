// CSS Module imports and usages in TS/JS source, without a TypeScript AST.
// Imports are read from the file header only (imports, comments, directives), so the result can
// be cached by the header text. Usages are matched on the current line only: a file-wide
// tokenizer would be derailed by JSX text such as `<p>Don't</p>`.

export interface ModuleImport {
  /** Local binding name (`styles`). */
  readonly name: string;
  /** Range of the binding name in the import statement. */
  readonly nameStart: number;
  readonly nameEnd: number;
  /** Specifier as written (`./button.module.css`). */
  readonly specifier: string;
  /** `import * as styles`. */
  readonly namespace: boolean;
}

export type Usage =
  | {
      readonly kind: "binding";
      readonly binding: ModuleImport;
      readonly start: number;
      readonly end: number;
    }
  | {
      readonly kind: "member";
      readonly binding: ModuleImport;
      /** JS name used in the code (`shell` in `styles.shell` or `styles["shell"]`). */
      readonly name: string;
      readonly start: number;
      readonly end: number;
    };

export interface CompletionSite {
  readonly binding: ModuleImport;
  /** `member`: after `styles.`; `index`: inside `styles["…`. */
  readonly kind: "member" | "index";
  /** Text typed so far. */
  readonly prefix: string;
  /** Range to replace: the typed name (without quotes). */
  readonly start: number;
  readonly end: number;
  /** Offset of the `.` for member sites (to rewrite `.x` as `["x"]`). */
  readonly dot: number;
}

const MODULE_CSS = /\.module\.css$/;

const isSpace = (c: number) => c === 32 || c === 9 || c === 10 || c === 13 || c === 12;
const isIdentChar = (c: number) =>
  (c >= 97 && c <= 122) ||
  (c >= 65 && c <= 90) ||
  (c >= 48 && c <= 57) ||
  c === 95 ||
  c === 36 ||
  c > 127;

interface Token {
  readonly type: "ident" | "string" | "punct";
  readonly value: string;
  readonly start: number;
  readonly end: number;
}

/** Tokens of the file header; stops at the first statement that isn't an import or directive. */
class HeaderReader {
  pos = 0;
  readonly text: string;

  constructor(text: string) {
    this.text = text;
  }

  /** Skips whitespace and comments; returns false at the end of the text. */
  skipTrivia(): boolean {
    const { text } = this;
    while (this.pos < text.length) {
      const c = text.charCodeAt(this.pos);
      if (isSpace(c)) this.pos++;
      else if (c === 47 && text.charCodeAt(this.pos + 1) === 47) {
        const nl = text.indexOf("\n", this.pos);
        this.pos = nl < 0 ? text.length : nl + 1;
      } else if (c === 47 && text.charCodeAt(this.pos + 1) === 42) {
        const close = text.indexOf("*/", this.pos + 2);
        this.pos = close < 0 ? text.length : close + 2;
      } else return true;
    }
    return false;
  }

  next(): Token | undefined {
    if (!this.skipTrivia()) return undefined;
    const { text } = this;
    const start = this.pos;
    const c = text.charCodeAt(start);
    if (c === 34 || c === 39) {
      let i = start + 1;
      while (i < text.length && text.charCodeAt(i) !== c && text.charCodeAt(i) !== 10) {
        i += text.charCodeAt(i) === 92 ? 2 : 1;
      }
      this.pos = Math.min(i + 1, text.length);
      return { type: "string", value: text.slice(start + 1, i), start, end: this.pos };
    }
    if (isIdentChar(c)) {
      let i = start + 1;
      while (i < text.length && isIdentChar(text.charCodeAt(i))) i++;
      this.pos = i;
      return { type: "ident", value: text.slice(start, i), start, end: i };
    }
    this.pos = start + 1;
    return { type: "punct", value: text[start] ?? "", start, end: this.pos };
  }
}

/** End offset of the import header: imports, comments, blank lines and directives. */
export function headerEnd(text: string): number {
  const reader = new HeaderReader(text);
  let end = 0;
  for (;;) {
    if (!reader.skipTrivia()) return text.length;
    const before = reader.pos;
    const first = reader.next();
    if (!first) return end;
    if (first.type === "string") {
      // Directive such as "use client".
      const after = reader.pos;
      const semi = reader.next();
      if (semi?.value !== ";") reader.pos = after;
      end = reader.pos;
      continue;
    }
    if (first.type !== "ident" || first.value !== "import" || !skipImport(reader)) return before;
    end = reader.pos;
  }
}

/** Consumes the rest of an import statement; false if it isn't one we understand. */
function skipImport(reader: HeaderReader): boolean {
  let braces = 0;
  for (let token = reader.next(); token; token = reader.next()) {
    if (token.value === "{") braces++;
    else if (token.value === "}") braces--;
    else if (token.value === "(" && braces === 0) return false; // import("x") expression
    else if (token.type === "string" && braces === 0) {
      const after = reader.pos;
      const semi = reader.next();
      if (semi?.value !== ";") reader.pos = after;
      return true;
    }
  }
  return false;
}

/** CSS Module imports in the header (`text.slice(0, end)`). Type-only imports are skipped. */
export function parseImports(text: string, end = headerEnd(text)): ModuleImport[] {
  const reader = new HeaderReader(text.slice(0, end));
  const imports: ModuleImport[] = [];
  for (let token = reader.next(); token; token = reader.next()) {
    if (token.type !== "ident" || token.value !== "import") continue;
    const clause: Token[] = [];
    let braces = 0;
    let specifier: Token | undefined;
    for (let t = reader.next(); t; t = reader.next()) {
      if (t.value === "{") braces++;
      else if (t.value === "}") braces--;
      if (t.type === "string" && braces === 0) {
        specifier = t;
        break;
      }
      clause.push(t);
    }
    if (!specifier || !MODULE_CSS.test(specifier.value)) continue;
    const binding = clauseBinding(clause);
    if (binding) {
      imports.push({
        name: binding.token.value,
        nameStart: binding.token.start,
        nameEnd: binding.token.end,
        specifier: specifier.value,
        namespace: binding.namespace,
      });
    }
  }
  return imports;
}

/** The default or namespace binding of an import clause (tokens between `import` and `from`). */
function clauseBinding(clause: Token[]): { token: Token; namespace: boolean } | undefined {
  const [first, second, third] = clause;
  if (!first) return undefined;
  if (first.value === "type" && second && second.value !== "from" && second.value !== ",") {
    return undefined;
  }
  if (first.value === "*" && second?.value === "as" && third?.type === "ident") {
    return { token: third, namespace: true };
  }
  if (first.type === "ident" && first.value !== "from") return { token: first, namespace: false };
  return undefined;
}

/** Parsed imports per document, reused while the header text is unchanged. */
export class ImportCache {
  private readonly entries = new Map<string, { header: string; imports: ModuleImport[] }>();

  get(document: string, text: string): ModuleImport[] {
    const end = headerEnd(text);
    const cached = this.entries.get(document);
    if (cached && cached.header.length === end && text.startsWith(cached.header)) {
      return cached.imports;
    }
    const imports = parseImports(text, end);
    this.entries.set(document, { header: text.slice(0, end), imports });
    return imports;
  }

  delete(document: string): void {
    this.entries.delete(document);
  }
}

// Line-local patterns. A binding must not follow a `.` (so `props.styles.x` is not ours).
const BINDING_BEFORE_DOT = /(?<![\w$])(?<!\.\s*)([A-Za-z_$][\w$]*)\s*\??\.\s*$/;
const AFTER_DOT = /\.\s*$/;
const INDEX_OPEN = /(?<![\w$])(?<!\.\s*)([A-Za-z_$][\w$]*)\s*\[\s*(["'])([^"'\\\n]*)$/;
const INDEX_CLOSE = /^([^"'\\\n]*)(["'])\s*\]/;
const WORD_LEFT = /[\w$]*$/;
const WORD_RIGHT = /^[\w$]*/;

/**
 * True if `line[index]` is code rather than inside a string, template text or comment that
 * starts on this line. Comments and templates opened on earlier lines are not seen.
 */
function isCode(line: string, index: number): boolean {
  let quote = 0;
  const templates: number[] = []; // brace depth inside each `${`
  let inTemplateText = false;
  for (let i = 0; i < index; i++) {
    const c = line.charCodeAt(i);
    if (quote) {
      if (c === 92) i++;
      else if (c === quote) quote = 0;
    } else if (inTemplateText) {
      if (c === 92) i++;
      else if (c === 96) inTemplateText = false;
      else if (c === 36 && line.charCodeAt(i + 1) === 123) {
        templates.push(0);
        inTemplateText = false;
        i++;
      }
    } else if (c === 34 || c === 39) quote = c;
    else if (c === 96) inTemplateText = true;
    else if (c === 47 && line.charCodeAt(i + 1) === 47) return false;
    else if (c === 47 && line.charCodeAt(i + 1) === 42) {
      const close = line.indexOf("*/", i + 2);
      if (close < 0 || close + 2 > index) return false;
      i = close + 1;
    } else if (templates.length > 0) {
      const top = templates.length - 1;
      if (c === 123) templates[top] = (templates[top] ?? 0) + 1;
      else if (c === 125) {
        if (templates[top] === 0) {
          templates.pop();
          inTemplateText = true;
        } else templates[top] = (templates[top] ?? 0) - 1;
      }
    }
  }
  return quote === 0 && !inTemplateText;
}

function lineAround(
  text: string,
  offset: number,
): { start: number; prefix: string; suffix: string } {
  const start = text.lastIndexOf("\n", offset - 1) + 1;
  let end = text.indexOf("\n", offset);
  if (end < 0) end = text.length;
  return { start, prefix: text.slice(start, offset), suffix: text.slice(offset, end) };
}

/** The CSS Module usage at `offset`, if any. */
export function usageAt(
  text: string,
  offset: number,
  imports: readonly ModuleImport[],
): Usage | undefined {
  if (imports.length === 0) return undefined;
  const byName = (name: string) => imports.find((i) => i.name === name);
  const { start: lineStart, prefix, suffix } = lineAround(text, offset);

  const open = INDEX_OPEN.exec(prefix);
  if (open) {
    const close = INDEX_CLOSE.exec(suffix);
    const binding = byName(open[1] ?? "");
    if (binding && close && close[2] === open[2] && isCode(prefix, open.index)) {
      const start = offset - (open[3] ?? "").length;
      const name = (open[3] ?? "") + (close[1] ?? "");
      return { kind: "member", binding, name, start, end: start + name.length };
    }
  }

  const left = WORD_LEFT.exec(prefix)?.[0] ?? "";
  const right = WORD_RIGHT.exec(suffix)?.[0] ?? "";
  const word = left + right;
  if (word === "" || /^\d/.test(word)) return undefined;
  const start = lineStart + prefix.length - left.length;
  const before = prefix.slice(0, prefix.length - left.length);

  const member = BINDING_BEFORE_DOT.exec(before);
  if (member && isCode(before, member.index)) {
    const binding = byName(member[1] ?? "");
    if (binding) return { kind: "member", binding, name: word, start, end: start + word.length };
  }
  const binding = byName(word);
  if (binding && !AFTER_DOT.test(before) && isCode(before, before.length)) {
    return { kind: "binding", binding, start, end: start + word.length };
  }
  return undefined;
}

const MEMBER_SITE = /(?<![\w$])(?<!\.\s*)([A-Za-z_$][\w$]*)\s*\??(\.)\s*([\w$]*)$/;

/** Where a class name can be completed at `offset`, if anywhere. */
export function completionSiteAt(
  text: string,
  offset: number,
  imports: readonly ModuleImport[],
): CompletionSite | undefined {
  if (imports.length === 0) return undefined;
  const { start: lineStart, prefix, suffix } = lineAround(text, offset);
  const byName = (name: string) => imports.find((i) => i.name === name);

  const open = INDEX_OPEN.exec(prefix);
  if (open) {
    const binding = byName(open[1] ?? "");
    if (!binding || !isCode(prefix, open.index)) return undefined;
    const typed = open[3] ?? "";
    const rest = /^[^"'\\\n]*/.exec(suffix)?.[0] ?? "";
    return {
      binding,
      kind: "index",
      prefix: typed,
      start: offset - typed.length,
      end: offset + rest.length,
      dot: -1,
    };
  }

  const member = MEMBER_SITE.exec(prefix);
  if (!member || !isCode(prefix, member.index)) return undefined;
  const binding = byName(member[1] ?? "");
  if (!binding) return undefined;
  const typed = member[3] ?? "";
  const rest = WORD_RIGHT.exec(suffix)?.[0] ?? "";
  const dot = lineStart + prefix.lastIndexOf(".", prefix.length - typed.length);
  return {
    binding,
    kind: "member",
    prefix: typed,
    start: offset - typed.length,
    end: offset + rest.length,
    dot,
  };
}
