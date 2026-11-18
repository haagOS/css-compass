import * as vscode from "vscode";
import { classNamesIn } from "../core/class-context.ts";
import { moduleExports } from "../core/module-classes.ts";
import { memberUsages, type MemberUsage } from "../core/module-usages.ts";
import type { ModuleImport } from "../core/ts-scan.ts";
import { classFunctions, diagnosticEnabled, localsConvention } from "./config.ts";
import type { ModuleFiles } from "./module-files.ts";
import type { SourceStores } from "./sources.ts";
import { timed } from "./timing.ts";

const SCRIPT_LANGUAGES = new Set([
  "typescript",
  "typescriptreact",
  "javascript",
  "javascriptreact",
]);
const DELAY_MS = 300;

function warning(
  document: vscode.TextDocument,
  start: number,
  end: number,
  message: string,
  code: string,
) {
  const range = new vscode.Range(document.positionAt(start), document.positionAt(end));
  const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Warning);
  diagnostic.source = "CSS Compass";
  diagnostic.code = code;
  return diagnostic;
}

/**
 * Warnings for open TS/JS documents (SPEC R-MC-10, R-GC-7). A document is checked after it opens
 * or changes, when CSS it depends on changes, and when settings change, always after a short
 * delay and never for documents that aren't open. Documents open at activation are checked
 * after the same delay, not during activation.
 */
export class Diagnostics implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection("css-compass");
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Document URI → what its last check read: CSS Module file keys and source folder URIs. */
  private readonly dependencies = new Map<string, Set<string>>();
  /** Document URI → number of its latest check; an older check that ends later is dropped. */
  private readonly runs = new Map<string, number>();
  private readonly disposables: vscode.Disposable[];
  private readonly files: ModuleFiles;
  private readonly sources: SourceStores;

  constructor(files: ModuleFiles, sources: SourceStores) {
    this.files = files;
    this.sources = sources;
    const dependants = (key: string) => {
      for (const document of vscode.workspace.textDocuments) {
        if (this.dependencies.get(document.uri.toString())?.has(key)) this.schedule(document);
      }
    };
    this.disposables = [
      this.collection,
      vscode.workspace.onDidOpenTextDocument((d) => this.schedule(d)),
      vscode.workspace.onDidChangeTextDocument((e) => this.schedule(e.document)),
      vscode.workspace.onDidCloseTextDocument((d) => this.forget(d)),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("cssCompass")) this.scheduleAll();
      }),
      files.onDidChange(dependants),
      sources.onDidChange(dependants),
    ];
    this.scheduleAll();
  }

  private scheduleAll(): void {
    for (const document of vscode.workspace.textDocuments) this.schedule(document);
  }

  private schedule(document: vscode.TextDocument): void {
    if (document.uri.scheme !== "file" || !SCRIPT_LANGUAGES.has(document.languageId)) return;
    const uri = document.uri.toString();
    clearTimeout(this.timers.get(uri));
    this.timers.set(
      uri,
      setTimeout(() => {
        this.timers.delete(uri);
        void this.check(document);
      }, DELAY_MS),
    );
  }

  private forget(document: vscode.TextDocument): void {
    const uri = document.uri.toString();
    clearTimeout(this.timers.get(uri));
    this.timers.delete(uri);
    this.dependencies.delete(uri);
    this.runs.delete(uri);
    this.collection.delete(document.uri);
  }

  private check(document: vscode.TextDocument): Promise<void> {
    return timed("diagnostics", async () => {
      if (document.isClosed) return;
      const uri = document.uri;
      const id = uri.toString();
      const run = (this.runs.get(id) ?? 0) + 1;
      this.runs.set(id, run);
      const version = document.version;
      // Recorded before loading, so a change during the load schedules a new check.
      const dependencies = new Set<string>();
      this.dependencies.set(id, dependencies);
      const text = document.getText();
      const imports = this.files.importsOf(document, text);
      const found = [
        ...(diagnosticEnabled(uri, "unknownModuleClass")
          ? await this.moduleClasses(document, text, imports, dependencies)
          : []),
        ...(diagnosticEnabled(uri, "unknownGlobalClass")
          ? await this.globalClasses(document, text, imports, dependencies)
          : []),
      ];
      // Edited, closed or checked again while loading: the newer state decides.
      if (document.isClosed || document.version !== version || this.runs.get(id) !== run) return;
      this.collection.set(uri, found);
    });
  }

  /** R-MC-10: `styles.x` whose class isn't in the imported file. */
  private async moduleClasses(
    document: vscode.TextDocument,
    text: string,
    imports: readonly ModuleImport[],
    dependencies: Set<string>,
  ): Promise<vscode.Diagnostic[]> {
    const byBinding = new Map<ModuleImport, MemberUsage[]>();
    for (const u of memberUsages(text, imports)) {
      const list = byBinding.get(u.binding);
      if (list) list.push(u);
      else byBinding.set(u.binding, [u]);
    }
    const convention = localsConvention(document.uri);
    const found: vscode.Diagnostic[] = [];
    for (const [binding, usages] of byBinding) {
      const key = this.files.resolve(document, binding);
      if (key === undefined) continue;
      dependencies.add(key);
      const file = await this.files.load(document, binding);
      if (!file) continue; // a missing file is the bundler's error, not one per usage
      const exports = moduleExports(file.symbols, convention).byName;
      for (const u of usages) {
        if (exports.has(u.name)) continue;
        const message = `Unknown class "${u.name}" in ${binding.specifier}`;
        found.push(warning(document, u.start, u.end, message, "unknown-module-class"));
      }
    }
    return found;
  }

  /** R-GC-7: class names in class contexts that no source defines. */
  private async globalClasses(
    document: vscode.TextDocument,
    text: string,
    imports: readonly ModuleImport[],
    dependencies: Set<string>,
  ): Promise<vscode.Diagnostic[]> {
    const names = classNamesIn(text, classFunctions(document.uri), imports);
    if (names.length === 0) return [];
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!folder) return [];
    dependencies.add(folder.uri.toString());
    // A failed build leaves the warnings out; the next change or setting edit tries again.
    const source = await this.sources.forFolder(folder).catch(() => undefined);
    if (!source) return [];
    const { index } = source.store;
    // No sources found (yet): every name would be flagged.
    if (index.classNames()[Symbol.iterator]().next().done) return [];
    const found: vscode.Diagnostic[] = [];
    for (const n of names) {
      if (index.findClass(n.name).length > 0) continue;
      const message = `Unknown class "${n.name}" (not in the CSS sources)`;
      found.push(warning(document, n.start, n.end, message, "unknown-global-class"));
    }
    return found;
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const d of this.disposables) d.dispose();
  }
}
