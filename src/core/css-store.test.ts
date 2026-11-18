import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CssStore, isModuleFile, type FileLoader } from "./css-store.ts";
import { diskLoader } from "./disk-loader.ts";
import { LineIndex } from "./line-index.ts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "css-compass-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** The disk loader with call counting. */
function countingLoader() {
  const loader = {
    key: vi.fn<FileLoader["key"]>((file) => diskLoader.key(file)),
    read: vi.fn<FileLoader["read"]>((file) => diskLoader.read(file)),
  };
  return loader;
}

async function write(name: string, text: string, mtime?: Date): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, text, "utf8");
  if (mtime) await utimes(path, mtime, mtime);
  return path;
}

describe("CssStore with the disk loader", () => {
  test("loads and scans a file once", async () => {
    const path = await write("a.css", ".btn {}");
    const loader = countingLoader();
    const store = new CssStore(loader);
    const first = await store.load(path);
    const second = await store.load(path);
    expect(second).toBe(first);
    expect(loader.read).toHaveBeenCalledTimes(1);
    expect(loader.key).toHaveBeenCalledTimes(1);
    expect(store.index.findClass("btn")).toHaveLength(1);
  });

  test("concurrent loads read the file once", async () => {
    const path = await write("a.css", ".btn {}");
    const loader = countingLoader();
    const store = new CssStore(loader);
    const [a, b] = await Promise.all([store.load(path), store.load(path)]);
    expect(a).toBe(b);
    expect(loader.read).toHaveBeenCalledTimes(1);
  });

  test("refresh with an unchanged key does not read or rescan", async () => {
    const path = await write("a.css", ".btn {}", new Date(2026, 0, 1));
    const loader = countingLoader();
    const store = new CssStore(loader);
    const first = await store.load(path);
    expect(await store.refresh(path)).toBe(first);
    expect(loader.read).toHaveBeenCalledTimes(1);
  });

  test("refresh with a changed key rescans and the index follows", async () => {
    const path = await write("a.css", ".old {}", new Date(2026, 0, 1));
    const store = new CssStore(diskLoader);
    await store.load(path);
    await write("a.css", ".new {}", new Date(2026, 0, 2));
    await store.refresh(path);
    expect(store.index.findClass("old")).toEqual([]);
    expect(store.index.findClass("new").map((d) => d.file)).toEqual([path]);
    expect(store.get(path)?.text).toBe(".new {}");
  });

  test("refresh of a deleted file removes it", async () => {
    const path = await write("a.css", ".btn {}");
    const store = new CssStore(diskLoader);
    await store.load(path);
    await rm(path);
    expect(await store.refresh(path)).toBeUndefined();
    expect(store.get(path)).toBeUndefined();
    expect(store.index.findClass("btn")).toEqual([]);
  });

  test("a missing file loads as undefined", async () => {
    const store = new CssStore(diskLoader);
    expect(await store.load(join(dir, "missing.css"))).toBeUndefined();
  });

  test("a BOM is dropped, so offsets match the editor", async () => {
    const path = await write("bom.css", "\uFEFF.a {}");
    const file = await new CssStore(diskLoader).load(path);
    expect(file?.symbols.classes[0]?.start).toBe(1);
  });

  test(".module.css files are scanned as CSS Modules", async () => {
    const path = await write("x.module.css", ".local {} :global(.shared) {}");
    const store = new CssStore(diskLoader);
    await store.load(path);
    expect(store.index.findClass("local")).toEqual([]);
    expect(store.index.findClass("shared")).toHaveLength(1);
  });
});

/** A loader whose calls wait until released. */
function gatedLoader(files: Record<string, { key: string; text: string } | undefined>) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const loader: FileLoader = {
    key: async (file) => {
      await gate;
      return files[file]?.key;
    },
    read: async (file) => {
      const entry = files[file];
      if (!entry) throw new Error("ENOENT");
      return entry.text;
    },
  };
  return { loader, release, files };
}

describe("CssStore races", () => {
  test("an update during a running reload wins", async () => {
    const { loader, release } = gatedLoader({ "a.css": { key: "disk", text: ".disk {}" } });
    const store = new CssStore(loader);
    const reload = store.refresh("a.css");
    store.update("a.css", "v2", ".editor {}");
    release();
    await reload;
    expect(store.get("a.css")?.text).toBe(".editor {}");
    expect(store.index.findClass("disk")).toEqual([]);
  });

  test("a remove during a running reload is not undone", async () => {
    const { loader, release } = gatedLoader({ "a.css": { key: "disk", text: ".disk {}" } });
    const store = new CssStore(loader);
    const reload = store.refresh("a.css");
    store.remove("a.css");
    release();
    await reload;
    expect(store.get("a.css")).toBeUndefined();
  });

  test("a refresh during a running one checks again afterwards", async () => {
    const { loader, release, files } = gatedLoader({ "a.css": { key: "k1", text: ".one {}" } });
    const store = new CssStore(loader);
    const first = store.refresh("a.css");
    files["a.css"] = { key: "k2", text: ".two {}" };
    const second = store.refresh("a.css");
    release();
    await Promise.all([first, second]);
    expect(store.get("a.css")?.text).toBe(".two {}");
  });

  test("a file deleted between key() and read() is removed, not thrown", async () => {
    const loader: FileLoader = {
      key: async () => "k",
      read: async () => Promise.reject(new Error("ENOENT")),
    };
    const store = new CssStore(loader);
    await expect(store.load("gone.css")).resolves.toBeUndefined();
  });
});

describe("CssStore.update (open documents)", () => {
  test("same key returns the cached file, a new key rescans", () => {
    const store = new CssStore(diskLoader);
    const v1 = store.update("doc.css", "v1", ".a {}");
    expect(store.update("doc.css", "v1", ".ignored {}")).toBe(v1);
    store.update("doc.css", "v2", ".b {}");
    expect(store.index.findClass("a")).toEqual([]);
    expect(store.index.findClass("b")).toHaveLength(1);
  });

  test("remove drops the file and its index entries", () => {
    const store = new CssStore(diskLoader);
    store.update("doc.css", "v1", ".a {}");
    store.remove("doc.css");
    expect(store.get("doc.css")).toBeUndefined();
    expect(store.index.findClass("a")).toEqual([]);
  });
});

test("isModuleFile", () => {
  expect(isModuleFile("/x/button.module.css")).toBe(true);
  expect(isModuleFile("C:\\x\\Button.Module.CSS")).toBe(false);
  expect(isModuleFile("/x/module.css")).toBe(false);
  expect(isModuleFile("/x/a.css")).toBe(false);
});

describe("LineIndex", () => {
  test("LF, CRLF and CR line ends", () => {
    const text = "a\nb\r\nc\rd";
    const lines = new LineIndex(text);
    expect(lines.positionAt(text.indexOf("b"))).toEqual({ line: 1, character: 0 });
    expect(lines.positionAt(text.indexOf("c"))).toEqual({ line: 2, character: 0 });
    expect(lines.positionAt(text.indexOf("d"))).toEqual({ line: 3, character: 0 });
  });

  test("CRLF file: class position matches the editor", () => {
    const text = ":root {\r\n  --a: 1;\r\n}\r\n.shell {}";
    const store = new CssStore(diskLoader);
    const file = store.update("crlf.css", "v1", text);
    const shell = file.symbols.classes[0];
    expect(shell && file.lines.positionAt(shell.start)).toEqual({ line: 3, character: 1 });
  });

  test("offsets outside the text are clamped", () => {
    const lines = new LineIndex("ab\ncd");
    expect(lines.positionAt(-5)).toEqual({ line: 0, character: 0 });
    expect(lines.positionAt(99)).toEqual({ line: 1, character: 2 });
  });
});
