import * as vscode from "vscode";
import { diskLoader } from "./core/disk-loader.ts";
import { ModuleDefinitionProvider } from "./vscode/definition.ts";
import { ModuleFiles } from "./vscode/module-files.ts";
import { disposeTiming } from "./vscode/timing.ts";

/** Same selector shape as the built-in TypeScript support, so our results come first (SPEC §10). */
const SCRIPT_LANGUAGES: vscode.DocumentFilter[] = [
  "typescript",
  "typescriptreact",
  "javascript",
  "javascriptreact",
].map((language) => ({ language, scheme: "file" }));

export function activate(context: vscode.ExtensionContext): void {
  const files = new ModuleFiles(diskLoader);
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(
      SCRIPT_LANGUAGES,
      new ModuleDefinitionProvider(files),
    ),
    vscode.workspace.onDidCloseTextDocument((d) => files.imports.delete(d.uri.toString())),
    { dispose: disposeTiming },
  );
}

export function deactivate(): void {}
