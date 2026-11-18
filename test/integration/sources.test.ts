/// <reference types="mocha" />
// The sources index (SPEC §7): settings, fallback, package specifiers, watchers, rebuilds.
import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import type { TestApi } from "../../src/extension.ts";
import { activateExtension, fixture, waitFor } from "./helpers.ts";

const root = vscode.workspace.workspaceFolders?.[0];
const packageCss = () =>
  vscode.Uri.joinPath(root!.uri, "node_modules", "@acme", "design-system", "lib", "style.css");

const setSources = (value: string[] | undefined) =>
  vscode.workspace
    .getConfiguration("cssCompass")
    .update("sources", value, vscode.ConfigurationTarget.Global);

suite("sources index", () => {
  let api: TestApi;
  const values = async (name: string) => {
    const source = await api.sources.forUri(fixture("app.tsx"));
    return source?.store.index.findProperty(name).map((d) => d.symbol.value) ?? [];
  };

  suiteSetup(async () => {
    api = await activateExtension();
  });

  teardown(() => setSources(undefined));

  test("without settings: src/**/*.css plus cssVariables.lookupFiles (into node_modules)", async () => {
    assert.deepEqual(await values("--app-gap"), ["4px"]);
    assert.deepEqual(await values("--ds-blue-0"), ["#1f4e8c"]);
    assert.deepEqual(await values("--ds-accent"), ["var(--ds-blue-0)", "#000000"]);
  });

  test("cssCompass.sources replaces the default; package specifiers resolve through exports", async () => {
    await setSources(["@acme/design-system/style.css"]);
    await waitFor("the rebuilt index", async () =>
      (await values("--app-gap")).length === 0 ? true : undefined,
    );
    assert.deepEqual(await values("--ds-blue-0"), ["#1f4e8c"]);
    const source = await api.sources.forUri(fixture("app.tsx"));
    const files = source?.store.index.findProperty("--ds-blue-0").map((d) => d.file) ?? [];
    assert.equal(files[0], packageCss().fsPath);
  });

  test("a settings change during a build wins", async () => {
    const building = api.sources.forUri(fixture("app.tsx"));
    await setSources(["src/tokens.css"]);
    await building;
    await waitFor("the newest settings", async () =>
      (await values("--ds-blue-0")).length === 0 ? true : undefined,
    );
    assert.deepEqual(await values("--app-gap"), ["4px"]);
  });

  test("a change to the package file is picked up", async () => {
    await setSources(["@acme/design-system/style.css"]);
    const uri = packageCss();
    const original = await vscode.workspace.fs.readFile(uri);
    try {
      const changed = `${new TextDecoder().decode(original)}\n:root { --ds-new: 1px; }\n`;
      await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(changed));
      await waitFor(
        "the package watcher",
        async () => ((await values("--ds-new")).length ? true : undefined),
        10_000,
      );
    } finally {
      await vscode.workspace.fs.writeFile(uri, original);
    }
  });

  test("a package installed after the setting is picked up", async () => {
    await setSources(["@acme/later/style.css"]);
    assert.deepEqual(await values("--later"), []);
    const dir = vscode.Uri.joinPath(root!.uri, "node_modules", "@acme", "later");
    try {
      await vscode.workspace.fs.writeFile(
        vscode.Uri.joinPath(dir, "style.css"),
        new TextEncoder().encode(":root { --later: 1; }\n"),
      );
      await vscode.workspace.fs.writeFile(
        vscode.Uri.joinPath(dir, "package.json"),
        new TextEncoder().encode('{ "name": "@acme/later" }'),
      );
      await waitFor(
        "the installed package",
        async () => ((await values("--later")).length ? true : undefined),
        10_000,
      );
    } finally {
      await vscode.workspace.fs.delete(dir, { recursive: true });
    }
  });

  test("a new file matching a glob is picked up", async () => {
    const uri = fixture("added.css");
    // The index for the default settings must exist (and its watcher be running) before the
    // file appears; otherwise the file is found by the build, not by the watcher.
    await waitFor("the default index", async () =>
      (await values("--app-gap")).length ? true : undefined,
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(":root { --added: 1; }\n"));
      await waitFor(
        "the glob watcher",
        async () => ((await values("--added")).length ? true : undefined),
        10_000,
      );
    } finally {
      await vscode.workspace.fs.delete(uri);
    }
    await waitFor(
      "the deleted file to drop out",
      async () => ((await values("--added")).length ? undefined : true),
      10_000,
    );
  });
});
