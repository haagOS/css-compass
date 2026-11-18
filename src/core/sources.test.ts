import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { resolveExports, resolveSource, splitSpecifier } from "./sources.ts";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "css-compass-sources-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function pkg(dir: string, name: string, manifest: object, files: string[]): string {
  const packageDir = join(dir, "node_modules", ...name.split("/"));
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(join(packageDir, "package.json"), JSON.stringify({ name, ...manifest }));
  for (const file of files) {
    mkdirSync(join(packageDir, file, ".."), { recursive: true });
    writeFileSync(join(packageDir, file), ":root {}");
  }
  return packageDir;
}

describe("resolveExports", () => {
  test("exact subpaths with conditions in object order", () => {
    const exports = {
      "./style.css": { types: "./t.d.ts", default: "./lib/style.css" },
      "./tokens.css": { style: "./a.css", default: "./b.css" },
      "./other.css": { import: "./x.css" },
    };
    expect(resolveExports(exports, "./style.css")).toBe("./lib/style.css");
    expect(resolveExports(exports, "./tokens.css")).toBe("./a.css");
    expect(resolveExports(exports, "./other.css")).toBeUndefined();
    expect(resolveExports(exports, "./missing.css")).toBeUndefined();
  });

  test("patterns, longest prefix first", () => {
    const exports = { "./*": "./dist/*", "./css/*.css": { style: "./styles/*.css" } };
    expect(resolveExports(exports, "./css/button.css")).toBe("./styles/button.css");
    expect(resolveExports(exports, "./index.js")).toBe("./dist/index.js");
  });

  test("sugar for the main export, and arrays", () => {
    expect(resolveExports("./main.css", ".")).toBe("./main.css");
    expect(resolveExports({ style: "./s.css", default: "./d.js" }, ".")).toBe("./s.css");
    expect(resolveExports({ ".": ["../escape.css", "./ok.css"] }, ".")).toBe("./ok.css");
  });
});

test("splitSpecifier", () => {
  expect(splitSpecifier("@acme/ds/style.css")).toEqual(["@acme/ds", "./style.css"]);
  expect(splitSpecifier("tokens/dist/a.css")).toEqual(["tokens", "./dist/a.css"]);
  expect(splitSpecifier("tokens")).toEqual(["tokens", "."]);
  expect(splitSpecifier("@acme")).toBeUndefined();
});

describe("resolveSource", () => {
  test("a package specifier through exports, found from a nested folder", () => {
    const packageDir = pkg(
      root,
      "@acme/design-system",
      { exports: { "./style.css": { default: "./lib/style.css" } } },
      ["lib/style.css"],
    );
    const folder = join(root, "apps", "web");
    mkdirSync(folder, { recursive: true });
    expect(resolveSource("@acme/design-system/style.css", folder)).toEqual({
      kind: "package",
      specifier: "@acme/design-system/style.css",
      file: join(packageDir, "lib", "style.css"),
      packageJson: join(packageDir, "package.json"),
    });
  });

  test("without exports: the plain path, or the style field for the package itself", () => {
    const packageDir = pkg(root, "tokens", { style: "dist/all.css" }, [
      "dist/all.css",
      "dist/a.css",
    ]);
    expect(resolveSource("tokens/dist/a.css", root)).toMatchObject({
      file: join(packageDir, "dist", "a.css"),
    });
    expect(resolveSource("tokens", root)).toMatchObject({
      file: join(packageDir, "dist", "all.css"),
    });
  });

  test("a missing file or unexported subpath is not a package source", () => {
    pkg(root, "@acme/ds", { exports: { "./style.css": "./style.css" } }, []);
    expect(resolveSource("@acme/ds/style.css", root).kind).toBe("glob");
    expect(resolveSource("@acme/ds/secret.css", root).kind).toBe("glob");
  });

  test("globs and plain paths", () => {
    expect(resolveSource("src/**/*.css", root)).toEqual({
      kind: "glob",
      pattern: "src/**/*.css",
      includesNodeModules: false,
    });
    expect(resolveSource("./src/index.css", root)).toMatchObject({ pattern: "src/index.css" });
    expect(resolveSource("src/index.css", root)).toMatchObject({
      kind: "glob",
      pattern: "src/index.css",
    });
    expect(resolveSource("node_modules/@acme/ds/lib/style.css", root)).toMatchObject({
      kind: "glob",
      includesNodeModules: true,
    });
    expect(resolveSource("node_modules\\x\\a.css", root)).toMatchObject({
      pattern: "node_modules/x/a.css",
    });
  });

  test("targets cannot escape the package", () => {
    pkg(root, "evil", { exports: { "./a.css": "./../../outside.css" } }, []);
    writeFileSync(join(root, "outside.css"), "");
    expect(resolveSource("evil/a.css", root).kind).toBe("glob");
  });
});
