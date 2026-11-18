import type { CssClass, CssSymbols } from "./scan.ts";
import { exportNames, isIdentifier, type LocalsConvention } from "./locals-convention.ts";

export interface ModuleExports {
  /** JS export name → local classes (all rules) exported under it. */
  readonly byName: ReadonlyMap<string, readonly CssClass[]>;
  /** Names to offer in completion: an original that isn't an identifier is hidden when an alias exists. */
  readonly completionNames: readonly string[];
}

const cache = new WeakMap<CssSymbols, Map<LocalsConvention, ModuleExports>>();

/** The JS exports of a CSS Module file under a naming convention (cached per scan result). */
export function moduleExports(symbols: CssSymbols, convention: LocalsConvention): ModuleExports {
  let perConvention = cache.get(symbols);
  if (!perConvention) cache.set(symbols, (perConvention = new Map()));
  const known = perConvention.get(convention);
  if (known) return known;

  const byName = new Map<string, CssClass[]>();
  const offered = new Set<string>();
  for (const c of symbols.classes) {
    if (!c.local) continue;
    const names = exportNames(c.name, convention);
    for (const name of names) {
      const list = byName.get(name);
      if (list) list.push(c);
      else byName.set(name, [c]);
    }
    const [original, alias] = names;
    if (alias !== undefined && original !== undefined && !isIdentifier(original))
      offered.add(alias);
    else for (const name of names) offered.add(name);
  }
  const result: ModuleExports = { byName, completionNames: [...offered] };
  perConvention.set(convention, result);
  return result;
}
