// `sources` entries (SPEC §7): globs relative to a workspace folder, or package specifiers such
// as `@acme/design-system/style.css` resolved like Node does, through the package's `exports`.
import { existsSync, readFileSync, statSync } from "node:fs";
import * as path from "node:path";

export type ResolvedSource =
  | {
      readonly kind: "glob";
      readonly pattern: string;
      /** The glob reaches into node_modules, so it must not exclude it. */
      readonly includesNodeModules: boolean;
      /** No glob characters: a plain path, which needs no file search. */
      readonly literal: boolean;
    }
  | {
      readonly kind: "package";
      readonly specifier: string;
      readonly file: string;
      /** The package's package.json; its changes can move the file. */
      readonly packageJson: string;
    };

const GLOB_CHARS = /[*?{}[\]]/;
const CONDITIONS = ["style", "default"];

/** Resolves one entry; a would-be specifier that names no installed package is a glob. */
export function resolveSource(entry: string, folder: string): ResolvedSource {
  const spec = entry.trim().replaceAll("\\", "/");
  const maybePackage =
    !spec.startsWith(".") &&
    !spec.startsWith("/") &&
    !GLOB_CHARS.test(spec) &&
    !/^[a-z]:/i.test(spec);
  if (maybePackage) {
    const resolved = resolvePackageFile(spec, folder);
    if (resolved) return { kind: "package", specifier: spec, ...resolved };
  }
  const pattern = spec.replace(/^\.\//, "");
  return {
    kind: "glob",
    pattern,
    includesNodeModules: /(^|\/)node_modules(\/|$)/.test(pattern),
    literal: !GLOB_CHARS.test(pattern),
  };
}

/** `@scope/name/sub/path` → [`@scope/name`, `./sub/path`]; `name` → [`name`, `.`]. */
export function splitSpecifier(spec: string): [string, string] | undefined {
  const parts = spec.split("/");
  const nameLength = spec.startsWith("@") ? 2 : 1;
  if (parts.length < nameLength || parts.slice(0, nameLength).some((p) => p === "")) {
    return undefined;
  }
  const rest = parts.slice(nameLength).join("/");
  return [parts.slice(0, nameLength).join("/"), rest === "" ? "." : `./${rest}`];
}

/** Finds the package above `fromDir` and resolves the specifier's subpath to an existing file. */
export function resolvePackageFile(
  spec: string,
  fromDir: string,
): { file: string; packageJson: string } | undefined {
  const split = splitSpecifier(spec);
  if (!split) return undefined;
  const [name, subpath] = split;
  for (let dir = path.resolve(fromDir); ; dir = path.dirname(dir)) {
    const packageDir = path.join(dir, "node_modules", ...name.split("/"));
    const packageJson = path.join(packageDir, "package.json");
    if (existsSync(packageJson)) {
      const file = resolveInPackage(packageDir, packageJson, subpath);
      return file ? { file, packageJson } : undefined;
    }
    if (path.dirname(dir) === dir) return undefined;
  }
}

function resolveInPackage(
  packageDir: string,
  packageJson: string,
  subpath: string,
): string | undefined {
  let manifest: { exports?: unknown; style?: unknown };
  try {
    manifest = JSON.parse(readFileSync(packageJson, "utf8")) as typeof manifest;
  } catch {
    return undefined;
  }
  let target: string | undefined;
  if (manifest.exports !== undefined && manifest.exports !== null) {
    target = resolveExports(manifest.exports, subpath);
  } else if (subpath === ".") {
    target = typeof manifest.style === "string" ? manifest.style : undefined;
  } else {
    target = subpath;
  }
  if (target === undefined) return undefined;
  const file = path.resolve(packageDir, target);
  if (!file.startsWith(packageDir + path.sep)) return undefined; // must stay inside the package
  return isFile(file) ? file : undefined;
}

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

/** Node's PACKAGE_EXPORTS_RESOLVE for one subpath, with the conditions `style`, `default`. */
export function resolveExports(exports: unknown, subpath: string): string | undefined {
  const map = isSubpathMap(exports) ? (exports as Record<string, unknown>) : { ".": exports };
  if (subpath in map && !subpath.includes("*")) return resolveTarget(map[subpath], undefined);
  // Pattern keys: the longest prefix before `*` wins.
  let best: { key: string; prefix: number; match: string } | undefined;
  for (const key of Object.keys(map)) {
    const star = key.indexOf("*");
    if (star < 0 || key.includes("*", star + 1)) continue;
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    const matches =
      subpath.length >= key.length - 1 && subpath.startsWith(prefix) && subpath.endsWith(suffix);
    if (matches && (!best || prefix.length > best.prefix)) {
      best = {
        key,
        prefix: prefix.length,
        match: subpath.slice(prefix.length, subpath.length - suffix.length),
      };
    }
  }
  return best ? resolveTarget(map[best.key], best.match) : undefined;
}

function isSubpathMap(exports: unknown): boolean {
  if (typeof exports !== "object" || exports === null || Array.isArray(exports)) return false;
  return Object.keys(exports).some((k) => k.startsWith("."));
}

function resolveTarget(target: unknown, match: string | undefined): string | undefined {
  if (typeof target === "string") {
    if (!target.startsWith("./")) return undefined;
    return match === undefined ? target : target.replaceAll("*", match);
  }
  if (Array.isArray(target)) {
    for (const t of target) {
      const resolved = resolveTarget(t, match);
      if (resolved !== undefined) return resolved;
    }
    return undefined;
  }
  if (typeof target === "object" && target !== null) {
    for (const [condition, value] of Object.entries(target)) {
      if (!CONDITIONS.includes(condition)) continue;
      const resolved = resolveTarget(value, match);
      if (resolved !== undefined) return resolved;
    }
  }
  return undefined;
}
