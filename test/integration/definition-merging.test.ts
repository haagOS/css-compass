/// <reference types="mocha" />
// Spike for SPEC §10 risk 1: how TypeScript's own definitions for CSS Module usages merge with
// ours, and whether Ctrl+Click in "goto" mode lands on our result.
import * as assert from "node:assert/strict";
import * as vscode from "vscode";

const root = vscode.workspace.workspaceFolders?.[0]?.uri;
if (!root) throw new Error("integration tests need the fixture workspace folder");
const appUri = vscode.Uri.joinPath(root, "src", "app.tsx");
const cssUri = vscode.Uri.joinPath(root, "src", "a.module.css");
const shellRange = new vscode.Range(0, 1, 0, 6);

type Definition = vscode.Location | vscode.LocationLink;
const targetUri = (d: Definition) => ("targetUri" in d ? d.targetUri : d.uri);
const isFile = (d: Definition, name: string) => targetUri(d).path.endsWith(`/${name}`);
const names = (found: Definition[]) => found.map((d) => targetUri(d).path.split("/").pop());

function assertHas(found: Definition[], name: string): void {
  assert.ok(
    found.some((d) => isFile(d, name)),
    `expected ${name} in [${names(found).join(", ")}]`,
  );
}

async function definitionsAt(doc: vscode.TextDocument, offset: number): Promise<Definition[]> {
  return vscode.commands.executeCommand<Definition[]>(
    "vscode.executeDefinitionProvider",
    doc.uri,
    doc.positionAt(offset),
  );
}

async function waitFor<T>(what: string, probe: () => Promise<T | undefined>): Promise<T> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out after 60 s waiting for ${what}`);
}

suite("definition merging with TypeScript (spike)", () => {
  let doc: vscode.TextDocument;
  let text: string;
  let stub: vscode.Disposable;
  const offsetOf = (needle: string, delta: number) => {
    const index = text.indexOf(needle);
    assert.notEqual(index, -1, `fixture lacks ${needle}`);
    return index + delta;
  };

  suiteSetup(async () => {
    doc = await vscode.workspace.openTextDocument(appUri);
    text = doc.getText();
    await vscode.window.showTextDocument(doc);

    // VS Code first answers from a syntax-only TypeScript server, which resolves imports to the
    // import line. A result in util.ts means the full semantic server has loaded the project.
    const local = offsetOf("+ local", 2);
    await waitFor("the semantic TypeScript server", async () => {
      const found = await definitionsAt(doc, local);
      return found.some((d) => isFile(d, "util.ts")) ? found : undefined;
    });

    stub = vscode.languages.registerDefinitionProvider(
      { language: "typescriptreact", scheme: "file" },
      { provideDefinition: () => new vscode.Location(cssUri, shellRange) },
    );
  });

  suiteTeardown(async () => {
    stub?.dispose();
    await vscode.workspace
      .getConfiguration("editor")
      .update("gotoLocation.multipleDefinitions", undefined, vscode.ConfigurationTarget.Global);
  });

  test("TypeScript answers `styles` with the ambient declaration", async () => {
    const found = await definitionsAt(doc, offsetOf("styles.shell", 1));
    assertHas(found, "css-modules.d.ts");
    assertHas(found, "a.module.css");
  });

  test("TypeScript answers `styles.shell` with the index signature", async () => {
    const found = await definitionsAt(doc, offsetOf("styles.shell", 8));
    assertHas(found, "css-modules.d.ts");
    assertHas(found, "a.module.css");
  });

  test('TypeScript does not answer `styles["shell"]`', async () => {
    const found = await definitionsAt(doc, offsetOf('styles["shell"]', 9));
    assert.ok(
      !found.some((d) => isFile(d, "css-modules.d.ts")),
      `expected no css-modules.d.ts in [${names(found).join(", ")}]`,
    );
  });

  for (const [label, needle, delta] of [
    ["styles.shell", "styles.shell", 8],
    ["styles", "styles.shell", 1],
  ] as const) {
    test(`Go to Definition in "goto" mode lands on our result for \`${label}\``, async () => {
      // Only meaningful while TypeScript competes with a result of its own.
      const found = await definitionsAt(doc, offsetOf(needle, delta));
      assert.ok(found.length >= 2, `expected a competing result in [${names(found).join(", ")}]`);

      await vscode.workspace
        .getConfiguration("editor")
        .update("gotoLocation.multipleDefinitions", "goto", vscode.ConfigurationTarget.Global);
      const editor = await vscode.window.showTextDocument(doc);
      const position = doc.positionAt(offsetOf(needle, delta));
      editor.selection = new vscode.Selection(position, position);

      await vscode.commands.executeCommand("editor.action.revealDefinition");
      const landed = await waitFor("Go to Definition to leave app.tsx", async () => {
        const active = vscode.window.activeTextEditor;
        return active && active.document.uri.toString() !== appUri.toString() ? active : undefined;
      });
      assert.equal(landed.document.uri.toString(), cssUri.toString());
      assert.deepEqual(landed.selection.start, shellRange.start);
    });
  }
});
