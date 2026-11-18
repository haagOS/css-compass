import * as path from "node:path";
import * as vscode from "vscode";
import { CssStore } from "../core/css-store.ts";
import { resolveSource, splitSpecifier } from "../core/sources.ts";
import { fileKey } from "./module-files.ts";
import type { DocumentLoader } from "./module-sync.ts";

const DEFAULT_SOURCES = ["src/**/*.css"];

/**
 * The `sources` entries of a folder (SPEC §7): `cssCompass.sources` if set; otherwise the default
 * plus `cssVariables.lookupFiles`. Only values somebody set count, never another extension's default.
 */
export function sourceEntries(folder: vscode.WorkspaceFolder): string[] {
  const own = explicit(
    vscode.workspace.getConfiguration("cssCompass", folder.uri).inspect("sources"),
  );
  if (own) return own;
  const legacy =
    explicit(
      vscode.workspace.getConfiguration("cssVariables", folder.uri).inspect("lookupFiles"),
    ) ?? [];
  return [...new Set([...DEFAULT_SOURCES, ...legacy])];
}

function explicit(
  inspected:
    | { workspaceFolderValue?: unknown; workspaceValue?: unknown; globalValue?: unknown }
    | undefined,
): string[] | undefined {
  const value =
    inspected?.workspaceFolderValue ?? inspected?.workspaceValue ?? inspected?.globalValue;
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : undefined;
}

const affectsSources = (e: vscode.ConfigurationChangeEvent, folder: vscode.WorkspaceFolder) =>
  e.affectsConfiguration("cssCompass.sources", folder.uri) ||
  e.affectsConfiguration("cssVariables.lookupFiles", folder.uri);

/** The package name of an entry that has a specifier's shape (no glob, no path prefix). */
function notYetInstalled(entry: string): string | undefined {
  const spec = entry.trim();
  if (/^[./]|^[a-z]:|[*?{}[\]\\]/i.test(spec)) return undefined;
  return splitSpecifier(spec)?.[0];
}

/** The indexed sources of one workspace folder. */
export class SourceStore implements vscode.Disposable {
  readonly store: CssStore;
  readonly folder: vscode.WorkspaceFolder;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(folder: vscode.WorkspaceFolder, loader: DocumentLoader) {
    this.folder = folder;
    this.store = new CssStore(loader);
  }

  /** Resolves the entries, loads every file and starts watching. */
  async build(onPackageChange: () => void): Promise<void> {
    const loads: Promise<unknown>[] = [];
    for (const entry of sourceEntries(this.folder)) {
      const source = resolveSource(entry, this.folder.uri.fsPath);
      if (source.kind === "package") {
        const file = fileKey(source.file);
        loads.push(this.store.load(file));
        this.watch(
          new vscode.RelativePattern(vscode.Uri.file(path.dirname(file)), path.basename(file)),
        );
        const manifest = this.watchFile(source.packageJson);
        manifest.onDidChange(onPackageChange);
        manifest.onDidDelete(onPackageChange);
        continue;
      }
      const awaited = notYetInstalled(entry);
      if (awaited) {
        // Looks like a package that isn't installed: rebuild once it appears.
        const manifest = this.watchFile(
          path.join(this.folder.uri.fsPath, "node_modules", ...awaited.split("/"), "package.json"),
        );
        manifest.onDidCreate(onPackageChange);
      }
      const pattern = new vscode.RelativePattern(this.folder, source.pattern);
      const exclude = source.includesNodeModules ? null : "**/node_modules/**";
      for (const uri of await vscode.workspace.findFiles(pattern, exclude)) {
        loads.push(this.store.load(fileKey(uri.fsPath)));
      }
      this.watch(pattern);
    }
    await Promise.all(loads);
  }

  /** Refreshes a file if this store holds it. */
  refreshIfKnown(file: string): void {
    if (this.store.get(file)) void this.store.refresh(file);
  }

  private watch(pattern: vscode.RelativePattern): void {
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const refresh = (uri: vscode.Uri) => void this.store.refresh(fileKey(uri.fsPath));
    this.disposables.push(
      watcher,
      watcher.onDidCreate(refresh),
      watcher.onDidChange(refresh),
      watcher.onDidDelete(refresh),
    );
  }

  private watchFile(file: string): vscode.FileSystemWatcher {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(path.dirname(file)), path.basename(file)),
    );
    this.disposables.push(watcher);
    return watcher;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}

/** One lazily built `SourceStore` per workspace folder, rebuilt when its settings change. */
export class SourceStores implements vscode.Disposable {
  private readonly loader: DocumentLoader;
  private readonly building = new Map<string, Promise<SourceStore>>();
  private readonly built = new Map<string, SourceStore>();
  private readonly generations = new Map<string, number>();
  private readonly disposables: vscode.Disposable[];

  constructor(loader: DocumentLoader) {
    this.loader = loader;
    const refresh = (document: vscode.TextDocument) => {
      const file = fileKey(document.uri.fsPath);
      for (const source of this.built.values()) source.refreshIfKnown(file);
    };
    this.disposables = [
      vscode.workspace.onDidChangeConfiguration((e) => {
        for (const folder of vscode.workspace.workspaceFolders ?? []) {
          if (affectsSources(e, folder)) this.invalidate(folder);
        }
      }),
      vscode.workspace.onDidChangeWorkspaceFolders((e) =>
        e.removed.forEach((f) => this.invalidate(f)),
      ),
      vscode.workspace.onDidChangeTextDocument((e) => refresh(e.document)),
      vscode.workspace.onDidOpenTextDocument(refresh),
      vscode.workspace.onDidCloseTextDocument(refresh),
    ];
  }

  /** The sources of the folder containing `uri`; built on first use. */
  async forUri(uri: vscode.Uri): Promise<SourceStore | undefined> {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    return folder ? this.forFolder(folder) : undefined;
  }

  async forFolder(folder: vscode.WorkspaceFolder): Promise<SourceStore> {
    const key = folder.uri.toString();
    const ready = this.built.get(key);
    if (ready) return ready;
    let pending = this.building.get(key);
    if (!pending) {
      pending = this.build(folder, key);
      this.building.set(key, pending);
    }
    return pending;
  }

  /** Drops the folder's store; the next request builds it again. */
  invalidate(folder: vscode.WorkspaceFolder): void {
    const key = folder.uri.toString();
    this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
    this.building.delete(key);
    this.built.get(key)?.dispose();
    this.built.delete(key);
  }

  private async build(folder: vscode.WorkspaceFolder, key: string): Promise<SourceStore> {
    const generation = this.generations.get(key) ?? 0;
    const source = new SourceStore(folder, this.loader);
    try {
      await source.build(() => this.invalidate(folder));
    } catch (error) {
      source.dispose();
      this.building.delete(key);
      throw error;
    }
    if ((this.generations.get(key) ?? 0) !== generation) {
      // Settings changed while building: this store is outdated.
      source.dispose();
      return this.forFolder(folder);
    }
    this.building.delete(key);
    this.built.set(key, source);
    return source;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    for (const source of this.built.values()) source.dispose();
    this.built.clear();
    this.building.clear();
  }
}
