import type { CssClass, CssProperty, CssSymbols } from "./scan.ts";

export interface Definition<T> {
  /** Identifies the source file (a URI string in the extension). */
  readonly file: string;
  readonly symbol: T;
}

/**
 * Global classes and custom properties across the source files of one workspace folder.
 * Module-local classes are not indexed: they are only reachable through their file's import.
 */
export class SymbolIndex {
  private readonly files = new Map<string, CssSymbols>();
  private readonly classes = new NameTable<CssClass>();
  private readonly properties = new NameTable<CssProperty>();
  private changes = 0;

  /** Changes with every add, replace or remove, so derived data can be cached against it. */
  get version(): number {
    return this.changes;
  }

  /** Adds a file or replaces its previous symbols. */
  setFile(file: string, symbols: CssSymbols): void {
    this.removeFile(file);
    this.changes++;
    this.files.set(file, symbols);
    for (const c of symbols.classes) if (!c.local) this.classes.add(c.name, file, c);
    for (const p of symbols.properties) this.properties.add(p.name, file, p);
  }

  removeFile(file: string): void {
    const old = this.files.get(file);
    if (!old) return;
    this.changes++;
    this.files.delete(file);
    for (const c of old.classes) if (!c.local) this.classes.remove(c.name, file);
    for (const p of old.properties) this.properties.remove(p.name, file);
  }

  /** Definitions of a global class, sorted by file, then position. */
  findClass(name: string): Definition<CssClass>[] {
    return this.classes.find(name);
  }

  /** Definitions of a custom property, sorted by file, then position. */
  findProperty(name: string): Definition<CssProperty>[] {
    return this.properties.find(name);
  }

  classNames(): Iterable<string> {
    return this.classes.names();
  }

  propertyNames(): Iterable<string> {
    return this.properties.names();
  }
}

class NameTable<T> {
  /** name → file → symbols in source order. */
  private readonly byName = new Map<string, Map<string, T[]>>();

  add(name: string, file: string, symbol: T): void {
    let files = this.byName.get(name);
    if (!files) this.byName.set(name, (files = new Map()));
    const list = files.get(file);
    if (list) list.push(symbol);
    else files.set(file, [symbol]);
  }

  remove(name: string, file: string): void {
    const files = this.byName.get(name);
    if (!files) return;
    files.delete(file);
    if (files.size === 0) this.byName.delete(name);
  }

  find(name: string): Definition<T>[] {
    const files = this.byName.get(name);
    if (!files) return [];
    const result: Definition<T>[] = [];
    for (const file of [...files.keys()].toSorted()) {
      for (const symbol of files.get(file) ?? []) result.push({ file, symbol });
    }
    return result;
  }

  names(): Iterable<string> {
    return this.byName.keys();
  }
}
