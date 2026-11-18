import * as assert from "node:assert/strict";
import * as vscode from "vscode";

const root = vscode.workspace.workspaceFolders?.[0]?.uri;
if (!root) throw new Error("integration tests need the fixture workspace folder");

export const fixture = (...segments: string[]) => vscode.Uri.joinPath(root, "src", ...segments);

export type Definition = vscode.Location | vscode.LocationLink;
export const targetUri = (d: Definition) => ("targetUri" in d ? d.targetUri : d.uri);
export const targetSelection = (d: Definition) =>
  "targetUri" in d ? (d.targetSelectionRange ?? d.targetRange) : d.range;
export const isFile = (d: Definition, name: string) => targetUri(d).path.endsWith(`/${name}`);
export const names = (found: Definition[]) =>
  found.map((d) => targetUri(d).path.split("/").pop()).join(", ");

export function assertHas(found: Definition[], name: string): void {
  assert.ok(
    found.some((d) => isFile(d, name)),
    `expected ${name} in [${names(found)}]`,
  );
}

export async function definitionsAt(
  doc: vscode.TextDocument,
  offset: number,
): Promise<Definition[]> {
  return vscode.commands.executeCommand<Definition[]>(
    "vscode.executeDefinitionProvider",
    doc.uri,
    doc.positionAt(offset),
  );
}

/** Offset of `needle` in the document plus `delta`. */
export function offsetOf(doc: vscode.TextDocument, needle: string, delta: number): number {
  const index = doc.getText().indexOf(needle);
  assert.notEqual(index, -1, `fixture lacks ${needle}`);
  return index + delta;
}

export async function waitFor<T>(
  what: string,
  probe: () => Promise<T | undefined> | T | undefined,
  timeoutMs = 60_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out after ${timeoutMs / 1000} s waiting for ${what}`);
}

/**
 * VS Code first answers from a syntax-only TypeScript server, which resolves imports to the
 * import line. A result in util.ts means the full semantic server has loaded the project.
 */
export async function waitForTypeScript(): Promise<void> {
  const app = await vscode.workspace.openTextDocument(fixture("app.tsx"));
  const local = offsetOf(app, "+ local", 2);
  await waitFor("the semantic TypeScript server", async () => {
    const found = await definitionsAt(app, local);
    return found.some((d) => isFile(d, "util.ts")) ? found : undefined;
  });
}

/** Opening a document starts activation without waiting for it; tests need it done. */
export async function activateExtension(): Promise<void> {
  const extension = vscode.extensions.getExtension("local.css-compass");
  assert.ok(extension, "extension under test not found");
  await extension.activate();
}
