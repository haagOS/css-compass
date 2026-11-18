import * as path from "node:path";
import * as vscode from "vscode";
import { CssStore, type CssFile, type FileLoader } from "../core/css-store.ts";
import { ImportCache, type ModuleImport } from "../core/ts-scan.ts";

/**
 * CSS Module files imported from TS/JS, for the whole window. Keyed by normalised file system
 * path. Not part of any global index: local classes are only reachable through their import.
 */
export class ModuleFiles {
  readonly imports = new ImportCache();
  readonly store: CssStore;
  private readonly loaded = new vscode.EventEmitter<string>();
  /** Fires with the file key when a file is cached for the first time. */
  readonly onDidLoad = this.loaded.event;
  private readonly changed = new vscode.EventEmitter<string>();
  /**
   * Fires with the file key after a CSS file may have changed: edited, saved, created or
   * deleted. Fires for files that aren't cached too, so a dependant can notice a new file.
   */
  readonly onDidChange = this.changed.event;

  constructor(loader: FileLoader) {
    this.store = new CssStore(loader, { index: false });
  }

  importsOf(document: vscode.TextDocument, text = document.getText()): ModuleImport[] {
    return this.imports.get(document.uri.toString(), text);
  }

  /** The CSS file an import refers to; relative specifiers only. */
  resolve(document: vscode.TextDocument, binding: ModuleImport): string | undefined {
    if (document.uri.scheme !== "file" || !binding.specifier.startsWith(".")) return undefined;
    return fileKey(path.resolve(path.dirname(document.uri.fsPath), binding.specifier));
  }

  async load(document: vscode.TextDocument, binding: ModuleImport): Promise<CssFile | undefined> {
    const file = this.resolve(document, binding);
    if (file === undefined) return undefined;
    const known = this.store.get(file);
    if (known) return known;
    const loaded = await this.store.load(file);
    if (loaded) this.loaded.fire(file);
    return loaded;
  }

  /** Refreshes `file` if it is cached, then fires `onDidChange`. */
  refresh(file: string): void {
    const fire = () => this.changed.fire(file);
    if (this.store.get(file)) void this.store.refresh(file).then(fire, fire);
    else fire();
  }

  dispose(): void {
    this.loaded.dispose();
    this.changed.dispose();
  }
}

/** Normalised file system path, with a lower-case drive letter like `Uri.fsPath`. */
export function fileKey(fsPath: string): string {
  return vscode.Uri.file(path.normalize(fsPath)).fsPath;
}
