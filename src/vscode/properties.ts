import * as path from "node:path";
import * as vscode from "vscode";
import { formatColor, parseColor, type Rgba } from "../core/color.ts";
import type { CssStore } from "../core/css-store.ts";
import { byPreference, resolveValue, type PropertyDefinition } from "../core/resolve.ts";
import type { SourceStore, SourceStores } from "./sources.ts";

export interface ResolvedProperty {
  readonly name: string;
  /** The definition that counts (SPEC §6), first of `byPreference`. */
  readonly counting: PropertyDefinition;
  readonly value: string;
  readonly complete: boolean;
  readonly color: Rgba | undefined;
}

/** Custom property lookups for a document, on top of its folder's sources index. */
export class Properties {
  private readonly sources: SourceStores;
  private readonly cache = new WeakMap<
    CssStore,
    { version: number; resolved: Map<string, ResolvedProperty | undefined> }
  >();

  constructor(sources: SourceStores) {
    this.sources = sources;
  }

  source(uri: vscode.Uri): Promise<SourceStore | undefined> {
    return this.sources.forUri(uri);
  }

  /** Definitions in preference order (the counting one first), then the rest by file/position. */
  definitions(source: SourceStore, name: string): PropertyDefinition[] {
    return byPreference(source.store.index.findProperty(name));
  }

  /** The counting definition with its resolved value; cached until the index changes. */
  resolve(source: SourceStore, name: string): ResolvedProperty | undefined {
    const { store } = source;
    let entry = this.cache.get(store);
    if (!entry || entry.version !== store.index.version) {
      entry = { version: store.index.version, resolved: new Map() };
      this.cache.set(store, entry);
    }
    if (entry.resolved.has(name)) return entry.resolved.get(name);
    const counting = this.definitions(source, name)[0];
    let result: ResolvedProperty | undefined;
    if (counting) {
      const r = resolveValue(
        counting.symbol.value,
        this.lookup(source),
        counting.symbol.scopeParts,
      );
      result = { name, counting, value: r.value, complete: r.complete, color: parseColor(r.value) };
    }
    entry.resolved.set(name, result);
    return result;
  }

  lookup(source: SourceStore): (name: string) => PropertyDefinition[] {
    return (name) => source.store.index.findProperty(name);
  }

  /** Hover text: one block per definition (scope, at-rules, raw value, steps, link). */
  hover(source: SourceStore, name: string): vscode.MarkdownString | undefined {
    const defs = this.definitions(source, name);
    if (defs.length === 0) return undefined;
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`\`${name}\`\n\n`);
    for (const def of defs) {
      const { symbol } = def;
      const steps = resolveValue(symbol.value, this.lookup(source), symbol.scopeParts).steps;
      const context = [...symbol.atRules, symbol.scope || "(no selector)"].join(" › ");
      md.appendMarkdown(`**${escape(context)}** · ${this.link(source, def)}\n\n`);
      md.appendCodeblock(steps.join("\n→ "), "css");
    }
    return md;
  }

  /** `style.css:12` linking to the definition, with a package name where there is one. */
  link(source: SourceStore, def: PropertyDefinition): string {
    const file = source.store.get(def.file);
    const line = file ? file.lines.positionAt(def.symbol.start).line + 1 : 1;
    const uri = vscode.Uri.file(def.file).with({ fragment: `L${line}` });
    return `[${label(def.file)}:${line}](${uri.toString()})`;
  }

  /** The completion-list form of a colour: VS Code draws a swatch for it. */
  static colorText(color: Rgba): string {
    return formatColor(color);
  }
}

/** `@scope/package` for files in node_modules, else the file name. */
export function label(file: string): string {
  const parts = file.split(/[\\/]/);
  const i = parts.lastIndexOf("node_modules");
  if (i >= 0 && parts[i + 1]) {
    const scoped = parts[i + 1]?.startsWith("@");
    return parts.slice(i + 1, i + (scoped ? 3 : 2)).join("/");
  }
  return path.basename(file);
}

const escape = (s: string) => s.replace(/[\\`*_{}[\]()#+!|<>]/g, "\\$&");
