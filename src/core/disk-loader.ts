import { readFile, stat } from "node:fs/promises";
import type { FileLoader } from "./css-store.ts";

/** Loads CSS files by file system path. The key is `mtimeMs:size`; a leading BOM is dropped. */
export const diskLoader: FileLoader = {
  async key(path) {
    try {
      const s = await stat(path);
      return s.isFile() ? `${s.mtimeMs}:${s.size}` : undefined;
    } catch {
      return undefined;
    }
  },
  async read(path) {
    const text = await readFile(path, "utf8");
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  },
};
