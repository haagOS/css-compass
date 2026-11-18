import * as path from "node:path";
import * as vscode from "vscode";
import type { FileLoader } from "../core/css-store.ts";
import { diskLoader } from "../core/disk-loader.ts";
import { fileKey, type ModuleFiles } from "./module-files.ts";

/**
 * Loads open CSS documents from the editor (unsaved text wins) and everything else from disk.
 * The key of an open document changes with every edit and every reopen.
 */
export class DocumentLoader implements FileLoader {
  private readonly open = new Map<string, { document: vscode.TextDocument; seq: number }>();
  private seq = 0;

  track(document: vscode.TextDocument): string | undefined {
    if (!isCssFile(document)) return undefined;
    const file = fileKey(document.uri.fsPath);
    this.open.set(file, { document, seq: ++this.seq });
    return file;
  }

  untrack(document: vscode.TextDocument): string | undefined {
    if (!isCssFile(document)) return undefined;
    const file = fileKey(document.uri.fsPath);
    this.open.delete(file);
    return file;
  }

  isOpen(file: string): boolean {
    return this.open.has(file);
  }

  async key(file: string): Promise<string | undefined> {
    const entry = this.open.get(file);
    return entry ? `doc:${entry.seq}:${entry.document.version}` : diskLoader.key(file);
  }

  async read(file: string): Promise<string> {
    const entry = this.open.get(file);
    return entry ? entry.document.getText() : diskLoader.read(file);
  }
}

const isCssFile = (document: vscode.TextDocument) =>
  document.uri.scheme === "file" && document.uri.fsPath.toLowerCase().endsWith(".css");

/**
 * Keeps cached CSS Module files current. Only files that are already cached are refreshed, so
 * opening an unrelated CSS file loads nothing.
 */
export function syncModuleFiles(files: ModuleFiles, loader: DocumentLoader): vscode.Disposable {
  const { store } = files;
  const refreshIfCached = (file: string | undefined) => {
    if (file !== undefined && store.get(file)) void store.refresh(file);
  };
  const fromDisk = (uri: vscode.Uri) => {
    const file = fileKey(uri.fsPath);
    if (!loader.isOpen(file)) refreshIfCached(file);
  };

  // Files outside the workspace folders get a watcher of their own once they are cached.
  const outside = new Map<string, vscode.Disposable>();
  const watchOutside = (file: string) => {
    if (outside.has(file) || vscode.workspace.getWorkspaceFolder(vscode.Uri.file(file))) return;
    const pattern = new vscode.RelativePattern(
      vscode.Uri.file(path.dirname(file)),
      path.basename(file),
    );
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    watcher.onDidChange(fromDisk);
    watcher.onDidCreate(fromDisk);
    watcher.onDidDelete(fromDisk);
    outside.set(file, watcher);
  };

  for (const document of vscode.workspace.textDocuments) loader.track(document);
  const watcher = vscode.workspace.createFileSystemWatcher("**/*.module.css");
  const disposables = [
    watcher,
    watcher.onDidChange(fromDisk),
    watcher.onDidCreate(fromDisk),
    watcher.onDidDelete(fromDisk),
    vscode.workspace.onDidOpenTextDocument((d) => refreshIfCached(loader.track(d))),
    vscode.workspace.onDidCloseTextDocument((d) => refreshIfCached(loader.untrack(d))),
    vscode.workspace.onDidChangeTextDocument((e) =>
      refreshIfCached(isCssFile(e.document) ? fileKey(e.document.uri.fsPath) : undefined),
    ),
    files.onDidLoad(watchOutside),
  ];
  return vscode.Disposable.from(...disposables, {
    dispose: () => {
      for (const d of outside.values()) d.dispose();
      outside.clear();
    },
  });
}
