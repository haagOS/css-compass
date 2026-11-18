import { LineIndex } from "./line-index.ts";
import { scanCss, type CssSymbols } from "./scan.ts";
import { SymbolIndex } from "./symbol-index.ts";

export interface CssFile {
  readonly file: string;
  /** Change key: document version for open documents, `mtimeMs:size` on disk. */
  readonly key: string;
  readonly text: string;
  readonly symbols: CssSymbols;
  readonly lines: LineIndex;
}

/** Reads files for the store. `key` must change whenever the content may have changed. */
export interface FileLoader {
  /** The current key, or undefined if the file doesn't exist. */
  key(file: string): Promise<string | undefined>;
  read(file: string): Promise<string>;
}

/** Same rule as Vite: case-sensitive `.module.css`. */
export const isModuleFile = (file: string) => file.endsWith(".module.css");

/**
 * Parsed CSS files of one workspace folder plus their symbol index. Keys are only checked when a
 * file is first loaded or explicitly refreshed, never per request.
 */
export class CssStore {
  readonly index = new SymbolIndex();
  private readonly files = new Map<string, CssFile>();
  private readonly pending = new Map<string, Promise<CssFile | undefined>>();
  /** Bumped by every update/remove, so a slower reload can tell it is outdated. */
  private readonly generations = new Map<string, number>();

  private readonly loader: FileLoader;

  constructor(loader: FileLoader) {
    this.loader = loader;
  }

  /** The cached file, without touching the disk. */
  get(file: string): CssFile | undefined {
    return this.files.get(file);
  }

  /** Sets a file's text (e.g. from an open document). Rescans only if the key changed. */
  update(file: string, key: string, text: string): CssFile {
    const cached = this.files.get(file);
    if (cached && cached.key === key) return cached;
    this.bump(file);
    const symbols = scanCss(text, { module: isModuleFile(file) });
    let lines: LineIndex | undefined;
    const entry: CssFile = {
      file,
      key,
      text,
      symbols,
      get lines() {
        return (lines ??= new LineIndex(text));
      },
    };
    this.files.set(file, entry);
    this.index.setFile(file, symbols);
    return entry;
  }

  /** Returns the cached file, loading it on first use. */
  load(file: string): Promise<CssFile | undefined> {
    const cached = this.files.get(file);
    if (cached) return Promise.resolve(cached);
    return this.pending.get(file) ?? this.refresh(file);
  }

  /**
   * Checks the file's key and rescans if it changed; removes the file if it no longer exists.
   * A refresh during a running one checks again after it, so no change is missed.
   */
  refresh(file: string): Promise<CssFile | undefined> {
    const running = this.pending.get(file);
    const next = () => this.reload(file);
    const task: Promise<CssFile | undefined> = (
      running ? running.then(next, next) : next()
    ).finally(() => {
      if (this.pending.get(file) === task) this.pending.delete(file);
    });
    this.pending.set(file, task);
    return task;
  }

  remove(file: string): void {
    this.bump(file);
    this.files.delete(file);
    this.index.removeFile(file);
  }

  private bump(file: string): void {
    this.generations.set(file, (this.generations.get(file) ?? 0) + 1);
  }

  private async reload(file: string): Promise<CssFile | undefined> {
    const generation = this.generations.get(file);
    const outdated = () => this.generations.get(file) !== generation;
    const key = await this.loader.key(file);
    if (outdated()) return this.files.get(file);
    if (key === undefined) {
      this.remove(file);
      return undefined;
    }
    const cached = this.files.get(file);
    if (cached && cached.key === key) return cached;
    let text: string;
    try {
      text = await this.loader.read(file);
    } catch {
      // Deleted or unreadable between key() and read().
      if (outdated()) return this.files.get(file);
      this.remove(file);
      return undefined;
    }
    if (outdated()) return this.files.get(file);
    return this.update(file, key, text);
  }
}
