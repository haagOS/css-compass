import * as vscode from "vscode";
import { ModuleCompletionProvider } from "./vscode/completion.ts";
import { ModuleDefinitionProvider } from "./vscode/definition.ts";
import { ModuleHoverProvider } from "./vscode/hover.ts";
import { ModuleFiles } from "./vscode/module-files.ts";
import { DocumentLoader, syncModuleFiles } from "./vscode/module-sync.ts";
import { disposeTiming } from "./vscode/timing.ts";

/** Same selector shape as the built-in TypeScript support, so our results come first (SPEC §10). */
const SCRIPT_LANGUAGES: vscode.DocumentFilter[] = [
  "typescript",
  "typescriptreact",
  "javascript",
  "javascriptreact",
].map((language) => ({ language, scheme: "file" }));

/** Returned from `activate` for integration tests; not a public API. */
export interface TestApi {
  readonly moduleFiles: ModuleFiles;
}

export function activate(context: vscode.ExtensionContext): TestApi {
  const loader = new DocumentLoader();
  const files = new ModuleFiles(loader);
  context.subscriptions.push(
    files,
    syncModuleFiles(files, loader),
    vscode.languages.registerDefinitionProvider(
      SCRIPT_LANGUAGES,
      new ModuleDefinitionProvider(files),
    ),
    vscode.languages.registerHoverProvider(SCRIPT_LANGUAGES, new ModuleHoverProvider(files)),
    vscode.languages.registerCompletionItemProvider(
      SCRIPT_LANGUAGES,
      new ModuleCompletionProvider(files),
      ...ModuleCompletionProvider.triggerCharacters,
    ),
    vscode.workspace.onDidCloseTextDocument((d) => files.imports.delete(d.uri.toString())),
    { dispose: disposeTiming },
  );
  return { moduleFiles: files };
}

export function deactivate(): void {}
