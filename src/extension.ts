import * as vscode from "vscode";
import { PropertyColorProvider } from "./vscode/colors.ts";
import { ModuleCompletionProvider } from "./vscode/completion.ts";
import { CssPropertyProvider } from "./vscode/css-providers.ts";
import { ModuleDefinitionProvider } from "./vscode/definition.ts";
import { ModuleHoverProvider } from "./vscode/hover.ts";
import { ModuleFiles } from "./vscode/module-files.ts";
import { DocumentLoader, syncModuleFiles } from "./vscode/module-sync.ts";
import { Properties } from "./vscode/properties.ts";
import { SourceStores } from "./vscode/sources.ts";
import { TsPropertyProvider } from "./vscode/ts-properties.ts";
import { disposeTiming } from "./vscode/timing.ts";

/** Same selector shape as the built-in TypeScript support, so our results come first (SPEC §10). */
const SCRIPT_LANGUAGES: vscode.DocumentFilter[] = [
  "typescript",
  "typescriptreact",
  "javascript",
  "javascriptreact",
].map((language) => ({ language, scheme: "file" }));

const CSS: vscode.DocumentFilter = { language: "css", scheme: "file" };

/** Returned from `activate` for integration tests; not a public API. */
export interface TestApi {
  readonly moduleFiles: ModuleFiles;
  readonly sources: SourceStores;
}

export function activate(context: vscode.ExtensionContext): TestApi {
  const loader = new DocumentLoader();
  const files = new ModuleFiles(loader);
  const sync = syncModuleFiles(files, loader); // registers first: it tracks open documents
  const sources = new SourceStores(loader);
  const properties = new Properties(sources);
  const css = new CssPropertyProvider(properties);
  const tsProperties = new TsPropertyProvider(properties);
  context.subscriptions.push(
    files,
    sync,
    sources,
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
    vscode.languages.registerCompletionItemProvider(
      CSS,
      css,
      ...CssPropertyProvider.triggerCharacters,
    ),
    vscode.languages.registerHoverProvider(CSS, css),
    vscode.languages.registerColorProvider(
      [CSS, ...SCRIPT_LANGUAGES],
      new PropertyColorProvider(properties),
    ),
    vscode.languages.registerCompletionItemProvider(
      SCRIPT_LANGUAGES,
      tsProperties,
      ...TsPropertyProvider.triggerCharacters,
    ),
    vscode.languages.registerHoverProvider(SCRIPT_LANGUAGES, tsProperties),
    vscode.languages.registerDefinitionProvider(SCRIPT_LANGUAGES, tsProperties),
    vscode.languages.registerDefinitionProvider(CSS, css),
    vscode.workspace.onDidCloseTextDocument((d) => files.imports.delete(d.uri.toString())),
    { dispose: disposeTiming },
  );
  return { moduleFiles: files, sources };
}

export function deactivate(): void {}
