# CSS Compass — Specification

> Status: draft v0.1 · 2026-11-18

CSS Compass is a lean VS Code extension that lets you navigate CSS from where it is used. It
covers CSS Modules class names, global classes such as utility classes, and CSS custom
properties (design tokens). The CSS can live in the project or come from packages in
`node_modules`. For each of them it provides **completion**, **hover** and **go to
definition**, and it is fast and light on memory by default. Both are measured, not assumed.

Requirement levels: **MUST** (v1 is not done without it), **SHOULD** (planned for v1, can
slip), **COULD** (only if cheap), **WON'T** (out of scope for v1).

---

## 1. Motivation

- [react-ts-css](https://github.com/Viijay-Kr/react-ts-css) covers CSS Modules but has been
  unmaintained for about two years.
- [vscode-css-variables](https://github.com/vunguyentuan/vscode-css-variables) works, but only
  provides completion for custom properties.
- Nothing covers a typical setup in one place: React + TypeScript with CSS Modules, design
  tokens and utility classes from a package (e.g. `@acme/design-system/style.css`), and jump to
  source and hover everywhere.

## 2. Goals and non-goals

### Goals

1. Go to definition, hover and completion for:
   - **module classes** (`styles.shell`)
   - **global classes** (`className="text-sm"`)
   - **custom properties** (`var(--ds-grey-2)`)
2. Package CSS gets the same features as project CSS.
3. Fast and lean by default, with published, measured budgets (§8).
4. Works with no setup on a common Vite + React + TS project. It has few settings, and every
   one of them has a sensible default.
5. Installable locally as a `.vsix`. Publishing to the Marketplace is not a goal for v1.

### Non-goals (WON'T in v1)

- SCSS, Less, Stylus, PostCSS syntax extensions (only plain `.css`).
- Rename, find all references, code actions.
- HTML, Vue, Svelte, Astro files.
- CSS-in-JS (styled-components template literals, `createGlobalStyle`).
- `@keyframes`, `@container` and `@layer` names as symbols.
- Generating `.d.ts` files or type-checking class names.
- Linting or formatting CSS.

## 3. Terminology

| Term | Meaning |
|---|---|
| **Source** | A CSS file whose symbols CSS Compass indexes. Comes from config (§7) or is a `*.module.css` file imported by the current document. |
| **Module class** | A class selector in a `*.module.css` file, outside `:global`. Visible only through the import binding of that file. |
| **Global class** | A class selector in a non-module source, or inside `:global(...)` in a module file. Visible everywhere. |
| **Custom property** | A declaration `--name: value` in any source. Visible everywhere, whether or not the file is a module. |
| **Definition** | One place a symbol is declared: file, range, enclosing selector or scope, `@layer`/`@media` context, and declarations (for classes) or value (for properties). A symbol can have several definitions. |
| **Usage site** | A position in a document where a symbol is referenced (§5). |

## 4. Symbol extraction (CSS scanner)

The scanner is a hand-written tokenizer with **zero runtime dependencies**. Its output is
rules, class names and custom properties, each with an exact range.

- **R-SC-1 MUST** skip comments, strings and `url(...)`. Class names and properties inside
  them are never reported.
- **R-SC-2 MUST** collect every `.class` token in a selector list, including compound and
  complex selectors (`.a.b`, `.a > .b`, `.a:hover`, `.a::before`), with the exact range of
  the class name (without the dot). A class is `.` followed by a CSS identifier start (CSS
  Syntax §4.3.9), so `.5` and `50.5%` are not classes. Escapes are decoded (`.md\:flex` is
  the class `md:flex`, the range stays on the raw text). `@keyframes` selectors yield none.
- **R-SC-3 MUST** handle the scoping rules of CSS Modules:
  - `:global(.x)` is global, `:local(.x)` is local
  - a bare `:global` / `:local` switches the mode for the rest of the selector
  - in non-module files, every class is global
- **R-SC-4 MUST** look inside at-rules that contain rules (`@media`, `@supports`, `@layer`,
  `@container`) and record the enclosing at-rule chain (e.g. `@layer ds.utilities`).
- **R-SC-5 MUST** handle native CSS nesting (`.a { .b {} }`, `& .b`) for class collection.
  `&` concatenation (`&-suffix`) is SCSS-only and isn't supported in plain CSS. Inside a
  block, a statement is a nested rule if `{` comes before `;` or `}` (outside strings and
  parentheses), otherwise a declaration; `--name:` is always a declaration.
- **R-SC-6 MUST** collect `--name: value` declarations with:
  - the range of the name
  - the raw value
  - the enclosing selector (`:root`, `.theme-contrast`, …), which is the property's scope,
    plus its parts if it is a list (`:root, .theme-default`). Nesting is resolved: `&` is
    replaced by the parent selector, a nested rule without `&` is a descendant, and lists are
    combined (`:root { &.dark {} }` → `:root.dark`; at most 16 combinations).
  - a value that ends at `;` or `}` only outside strings, `url()` and parentheses
- **R-SC-7 MUST** record each rule's selector and block range. Hover slices and parses the
  declarations from the cached file text when it needs them.
- **R-SC-8 MUST** tolerate invalid or partial CSS while the user is typing: no throw, and as
  many symbols as possible are still recovered.
- **R-SC-9 SHOULD** (later, see §12) parse `composes: a b from "./x.module.css"` and
  `composes: a from global` as references (§5.3).

## 5. Features by usage site

### 5.1 Module classes in TS / TSX / JS / JSX

Import detection:
- **R-MC-1 MUST** detect `import styles from "<spec>.module.css"` and
  `import * as styles from "<spec>.module.css"`. Imports are read from the file header only
  (imports, comments, directives such as `"use client"`) and cached by the header text.
- **R-MC-2 MUST** resolve relative specifiers.
- **R-MC-3 SHOULD** resolve tsconfig `paths` and bare package specifiers. Moved to a separate
  item after M4 (it needs its own design: tsconfig `extends` chains, package `exports`).

Usage detection is line-local: `styles`, `styles.x`, `styles?.x`, `styles["x"]` on the
current line, outside strings, template text and comments that start on that line. A binding
right after a `.` (`props.styles.x`) is not a CSS Module usage. There is no scope analysis.

CSS Module files live in one cache for the window, keyed by normalised file system path. They
don't feed the global class/property index (§5.2, §5.3), which is built from `sources` only.
An open CSS document is read from the editor, so unsaved edits win; other files are read from
disk. Only cached files are refreshed: on edit, open and close of their document, and through a
watcher on `**/*.module.css` (plus one per cached file outside the workspace).

Features:

| ID | Level | Behaviour |
|---|---|---|
| R-MC-4 | MUST | **Go to definition** on the binding `styles` opens the CSS file (line 1). |
| R-MC-5 | MUST | **Go to definition** on `styles.shell` / `styles["shell"]` jumps to the exact class name in its rule. Multiple rules for the same class are all returned. |
| R-MC-6 | MUST | Ctrl+Click on `styles.shell` lands **directly** on the rule, with no peek list caused by TypeScript's own result for `vite/client`'s `declare module "*.module.css"` (see §10, risk 1). Achieved through R-CFG-5. |
| R-MC-7 | MUST | **Completion** after `styles.` and inside `styles["…"]` lists only that file's local classes. Each entry shows a short preview of the declarations (first 5, built when the item is resolved). Names that aren't JS identifiers are inserted as `["a-b"]`. Under `camelCase` / `dashes`, such an original is only offered as its alias; both names resolve. |
| R-MC-8 | MUST | **Hover** on `styles.shell` shows the rule(s) as a CSS code block, plus `file:line` and the at-rule context. |
| R-MC-9 | MUST | `localsConvention` (§7) maps CSS names to JS names the same way as Vite and css-loader: `asIs`, `camelCase`, `camelCaseOnly`, `dashes`, `dashesOnly`. |
| R-MC-10 | SHOULD | **Diagnostic** (warning) for `styles.x`, `styles?.x` and `styles["x"]` when `.x` doesn't exist in the imported file (under `localsConvention`). Same usage rules as above, applied to every line. A file that can't be found or read gives no warnings. Can be turned off. |
| R-MC-11 | COULD | Hover on `styles` lists the file path and its number of classes. |

### 5.2 Global classes in TS / TSX / JS / JSX

Global class completion, hover and definition are offered for class-name strings in **class
contexts**:
- **R-GC-1 MUST** string literals and template literals (static parts) in the value of a JSX
  `className` or `class` attribute, including inside conditionals, `&&`, arrays and object
  keys within that attribute expression.
- **R-GC-2 MUST** string literals, object keys and array items in the arguments of the
  configured class functions (`classFunctions`, default `clsx`, `cn`, `cx`, `classnames`).
- **R-GC-3 MUST** split the string on whitespace. The feature applies to the class name under
  the cursor.

How class contexts are found (no AST): the string under the cursor is found on its line
(templates only on one line); then a backward scan of at most 50 lines, with bracket depth and
skipping strings, must reach `className=`/`class=` (directly or before the enclosing `{`) or an
enclosing `(` after a class function name. On the way it may pass `[` only as an array and `{`
only as an object (after `(` `,` `{` `[` `?` `:` `=` `&&` `||`), `${` and grouping
parentheses; another call, a block or a statement end means no class context. Inside an object
only keys count (directly after `{` or `,`, followed by `:`); identifier keys
(`{ hidden: open }`) get hover and definition, not completion. A string that is a CSS Module
usage (`styles["x"]`) is never a global class. The context is checked before the index is
touched. Completion triggers on `"` `'` `` ` `` and space. Definitions list workspace files
before packages, so Ctrl+Click lands on the project's own rule.

| ID | Level | Behaviour |
|---|---|---|
| R-GC-4 | MUST | **Completion** of every global class from the sources, with a declaration preview and the source label (package name or relative path). |
| R-GC-5 | MUST | **Hover** shows the rule(s) as CSS, plus `file:line` and the at-rule context (e.g. `@layer ds.utilities`). |
| R-GC-6 | MUST | **Go to definition** jumps to the class in the source, including files in `node_modules`. |
| R-GC-7 | COULD | Diagnostic for unknown global classes. **Off by default**, because dynamically built class names and classes from CSS outside `sources` cause false positives. Checks every whitespace-separated name in class-context strings (same rules as above). Skipped: templates with `${…}`, strings that don't close on their line, identifier keys. Nothing is flagged while the folder has no global classes at all. |

### 5.3 CSS files (`.css` and `.module.css`)

| ID | Level | Behaviour |
|---|---|---|
| R-CSS-1 | MUST | **Completion** of custom properties inside `var(` with the resolved value, a colour swatch for colours, and the source label. |
| R-CSS-2 | MUST | **Hover** on `var(--x)` and on a `--x:` declaration shows every definition with its scope, and resolves the `var()` chain (§6). |
| R-CSS-3 | MUST | **Go to definition** on `--x` in `var(--x)` jumps to its definition(s). With several scopes, the result is a peek list. |
| R-CSS-4 | SHOULD | Completion, hover and definition for global classes in `:global(.…)` (done in M4; classes declared in the current file are left out). `composes: … from global` is later, with R-SC-9 (§12). |
| R-CSS-5 | SHOULD | (Later, see §12.) Completion, hover and definition for `composes: a from "./other.module.css"`. |

The built-in CSS language service keeps handling everything else (property names, values,
literal colour swatches). CSS Compass must not duplicate it: completion and definition leave
out tokens declared only in the current file. **Known limitation:** the built-in list also
contains every token name *used* in the current file (without value or source), so such a
name appears twice; CSS Compass's entry is the one with the value, source and swatch.

Completion triggers on `(` and `-` and replaces the whole `--…` token. Colours are given as
`#rrggbb` or `rgba(r, g, b, a)` so the suggest widget draws a swatch. Resolved values are
cached until the folder's index changes.

### 5.4 Custom properties in TS / TSX / JS / JSX

- **R-TS-1 MUST** `var(--x)` inside any string or template literal gets the same completion,
  hover and definition as in CSS (e.g. `style={{ color: "var(--ds-grey-8)" }}`).
- **R-TS-2 SHOULD** a string literal that is exactly a custom property name (`"--ds-grey-8"`,
  e.g. a style object key or a `setProperty` argument) gets hover and definition.

### 5.5 Colours

- **R-COL-1 SHOULD** show a colour swatch next to each `var(--x)` usage whose value resolves to
  a colour (DocumentColorProvider, read-only: the picker doesn't rewrite the token). A colour
  function with `var()` arguments gets one too: `rgba(var(--x-rgb), 0.25)`. An RGB triplet
  token (`--x-rgb: 31, 78, 140`) is not a colour by itself. In TS/JS only usages inside
  strings count. Documents without `var(` return before the index is touched.
- Recognised colours: hex (3/4/6/8 digits), `rgb()`/`rgba()`/`hsl()`/`hsla()` (comma and
  space syntax), named colours, `transparent`. Not: `oklch()`, `lab()`, `color-mix()`.

## 6. Resolving custom property values

- **R-VAR-1 MUST** resolve `var(--a)` → `var(--b)` → `#1f4e8c` through the index, in each
  definition's own scope first and then `:root`. The chain is shown in hover:
  `var(--ds-blue-0) → #1f4e8c`.
- **R-VAR-2 MUST** use the fallback value in `var(--a, fallback)` when `--a` isn't defined.
- **R-VAR-3 MUST** stop on cycles and at a depth of 10, showing the unresolved remainder.
- **R-VAR-4 MUST** list definitions in different scopes (`:root`, `.theme-default`,
  `.theme-contrast`) separately.
- **R-VAR-5 MUST** decide which definition counts (for the swatch, completion value and the
  first Go to Definition result, which TS/JS jumps to directly): same scope as the use, then
  `:root`, then any; within those, definitions outside at-rules (`@media` …) first; then the
  later one, as in the cascade. Lists and hover show this definition first.

Each substituted value keeps the scope of the definition it came from, so its own `var()`s
are looked up there first.

## 7. Configuration

All settings are under `cssCompass.*`, scoped to resources, so multi-root workspaces work.

| Setting | Type | Default | Meaning |
|---|---|---|---|
| `sources` | `string[]` | `["src/**/*.css"]`, plus the `cssVariables.lookupFiles` fallback | Globs relative to the workspace folder, **or** package specifiers (`@acme/design-system/style.css`). |
| `classFunctions` | `string[]` | `["clsx", "cn", "cx", "classnames"]` | Functions whose arguments are class contexts (§5.2). |
| `localsConvention` | enum | `"asIs"` | As in Vite's `css.modules.localsConvention`. |
| `diagnostics.unknownModuleClass` | `boolean` | `true` | R-MC-10. |
| `diagnostics.unknownGlobalClass` | `boolean` | `false` | R-GC-7. |
| `debug.timings` | `boolean` | `false` | Write a timing for each request to the "CSS Compass" output channel. |

How sources work:
- **R-CFG-1 MUST** resolve package specifiers with Node's resolution, honouring the package's
  `exports` map (conditions `style`, `default`). They resolve from the workspace folder.
  There are no hard-coded `node_modules` paths.
- **R-CFG-2 MUST** fall back to `cssVariables.lookupFiles` from vscode-css-variables if
  `cssCompass.sources` is unset: the default is then `src/**/*.css` plus those entries. Only
  values somebody set count (`inspect()`), never the other extension's own default. Existing
  projects then work without changes.
- An entry is a package specifier if it has no glob characters or path prefix and names an
  installed package; otherwise it is a glob relative to the folder. Globs that mention
  `node_modules` search it; others exclude it. Package files and their `package.json` are
  watched explicitly (VS Code doesn't watch `node_modules` by default); a configured package
  that isn't installed yet is picked up when it appears.
- The index is built per workspace folder on the first request that needs it. A settings change
  drops it; a build that finishes after a change is discarded.
- **R-CFG-3 MUST** treat `*.module.css` files matched by `sources` as module files: their
  custom properties and `:global` classes are global, and their local classes are **not**.
- **R-CFG-4 MUST** apply setting changes without a reload.

Contributed editor default:
- **R-CFG-5 MUST** contribute `configurationDefaults` that set
  `editor.gotoLocation.multipleDefinitions` to `"goto"` for `[typescript]`,
  `[typescriptreact]`, `[javascript]` and `[javascriptreact]` (decision for §10, risk 1). The
  README states the side effect (any Go to Definition with several results in those languages,
  e.g. overloads, jumps to the first instead of opening a peek list) and how to override it.

## 8. Performance and footprint

These budgets are requirements. Each has a way of measuring it, and the first column says
where it is checked. Benchmarks vary between machines, so they don't fail the build: they are
run at the end of each milestone and the numbers are recorded in `docs/benchmarks.md`.

| Check | Metric | Budget | How it is measured |
|---|---|---|---|
| Script | Bundle size (`dist/extension.cjs`, minified) | ≤ 65,536 bytes (64 KiB) | `pnpm check:size`, also run by `pnpm package` |
| Script | Runtime dependencies | 0 | `package.json` `dependencies` is empty |
| Manual | Activation time | ≤ 10 ms | *Developer: Show Running Extensions* |
| Bench | Scan of a 10k-line CSS file (generated, also minified) | ≤ 3 ms (median) | `pnpm bench` |
| Bench | Definition / hover / completion, warm | ≤ 1 ms | `pnpm bench` on the providers' pure core; owned by M2 (module classes), M3 (properties), M4 (global classes) |
| Bench | Cold first request (package sources indexed lazily) | ≤ 20 ms on the reference project | `debug.timings` |
| Manual | Extension heap after using every feature on the reference project | ≤ 10 MB above baseline | heap snapshot from the extension host |

The bundle budget was 50 KB until M5. It stands in for start-up cost, which is what users feel;
activation time is the requirement that counts and is measured in the acceptance run (§11).
The budget counts bytes, the same unit as `scripts/check-size.ts`.

How the budgets are met:
- **R-PERF-1 MUST** activate only through `onLanguage` (css, typescript, typescriptreact,
  javascript, javascriptreact). There is no `*` and no work at startup.
- **R-PERF-2 MUST** index lazily: nothing is scanned until the first request that needs it.
  There is never a workspace-wide crawl of every TS file. A diagnostics check counts as a
  request. It runs only for open TS/JS documents: 300 ms after one opens or changes, when a CSS
  file it imports changes, and when settings change. Documents open at activation are checked
  after the same delay, never during activation.
- **R-PERF-3 MUST** cache the parse of each file, keyed by document version (open files) or
  `mtimeMs:size` (closed files). Keys are checked when a file is first loaded or invalidated,
  never per request. A FileSystemWatcher on the sources invalidates the cache, which also
  covers a `node_modules` update after `npm i` (wired in M2).
- **R-PERF-4 MUST** detect usage sites in TS/TSX with a local scan around the cursor plus a
  cached scan of the import header. There is no full TypeScript AST and no TypeScript
  compiler dependency.
- **R-PERF-5 MUST** keep the benchmarks in the repo, so a regression shows up in a diff.

## 9. Tooling, build and install

- TypeScript (strict), target ES2022, one file `dist/extension.cjs` bundled by **esbuild**
  (CJS, `vscode` external). The package is `type: module`, hence the `.cjs` extension.
- **pnpm**, **Vitest** (unit + bench), **oxlint** + **oxfmt** (Markdown is not formatted).
  Build scripts are TypeScript run directly by Node (≥ 22.18).
- Integration tests use `@vscode/test-cli` on `@vscode/test-electron`, in a downloaded VS Code
  **pinned** in `.vscode-test.mjs` (1.146.0; `VSCODE_TEST_VERSION` overrides it). They open a
  fixture workspace and wait for the *semantic* TypeScript server: the syntax-only server
  answers first and resolves imports to the import line.
- `engines.vscode`: `^1.100.0`. The integration tests pass on 1.100.0 as well.
- Install: `pnpm package` builds and size-checks, then runs
  `vsce package --no-dependencies --skip-license --allow-missing-repository` and produces
  `css-compass-<version>.vsix`. Install it with
  `code --install-extension css-compass-<version>.vsix`. The license and repository URL are
  decided before any publishing.

**Fixtures:** tests use **synthetic** fixtures that copy the structure of real package
stylesheets: tokens in `:root` plus theme classes, `var()` chains, and utility classes in an
`@layer`. Third-party package files are **not** committed. The real
project in §11 is used only for manual acceptance.

## 10. Risks and open questions

1. **Definition merging with TypeScript (R-MC-4, R-MC-6) — measured in M0, resolved.**
   VS Code combines definitions from every provider. With a Vite-style
   `declare module "*.module.css"`, the bundled TypeScript (5.8.3 in VS Code 1.100, 6.0.3 in
   1.146) answers `styles` with the ambient `const classes` and `styles.shell` with the
   `[key: string]` index signature. It doesn't answer `styles["shell"]`. With the default
   `multipleDefinitions: "peek"`, Ctrl+Click therefore opens a peek list.
   **Decision:** contribute `"goto"` as the default for TS/JS languages (R-CFG-5). Rejected:
   a TS server plugin (second module, unclear support in the native TS 7 compiler), a
   README-only setting (R-MC-6 would become SHOULD), accepting the peek list.
   `test/integration/definition-merging.test.ts` pins both the TypeScript behaviour and the
   jump.
2. **Order of definitions — verified in M0.** VS Code sorts providers by selector score, then
   puts non-built-in providers before built-in ones, then newest first. In `goto` mode
   Ctrl+Click opens the first provider's first result. A provider registered with
   `{ language, scheme: "file" }` comes first (the selector the spike test uses). Tested on VS Code 1.100.0 and
   1.146.0. **Limit:** with a TypeScript extension that isn't built-in (TS Nightly, the native
   TS preview), the built-in rule no longer applies and the order isn't guaranteed.
3. **Class contexts without an AST.** A local scan can misread unusual code (a `className`
   built across several lines from helper variables). That's acceptable: missing a context is
   fine, a wrong feature in a non-class string is not.
4. **Name clashes.** A module class and a global class with the same name are kept apart by
   their usage site: `styles.x` is always a module class, a string is always a global class.

## 11. Acceptance on the reference project

Reference: a real Vite + React + TS project that uses CSS Modules and gets its design tokens
and utility classes from a design-system package in `node_modules`. It has **no**
`cssCompass.*` settings (the `cssVariables.lookupFiles` fallback is in use). The concrete
project, its files and its token names are kept in the git-ignored `.local/` folder, never in
the repo.

- [ ] Ctrl+Click on `styles` in a component opens its `.module.css` file.
- [ ] Ctrl+Click on `styles.<class>` jumps straight to the rule.
- [ ] `styles.` lists only that file's classes, with previews.
- [ ] In a component, hovering a utility class in `className="…"` shows the rule from the
      package stylesheet, with its `@layer`. Ctrl+Click opens that line in `node_modules`.
- [ ] In a `.module.css` file, `var(--` completes the package's tokens with swatches.
- [ ] Hovering a themed token shows the `:root` / theme definitions and the resolved colours.
- [ ] Hovering `"var(--ds-grey-8)"` in a TSX `style` prop works.
- [ ] All §8 budgets are met. The numbers are recorded in `docs/benchmarks.md`.

## 12. Milestones

| # | Content |
|---|---|
| M0 | Scaffold (build, test, package, install) + **spike for risk 1** — done |
| M1 | CSS scanner + index + cache + benchmarks (§4, §8) — done |
| M2 | Module classes in TS/TSX (§5.1) — done (R-MC-3 moved, R-MC-10 in M5) |
| M3 | Custom properties: CSS, TS strings, value resolution, colours (§5.3, §5.4, §5.5, §6) — done |
| M4 | Global classes (§5.2, R-CSS-4) — done (`composes … from global` later) |
| M5 | Diagnostics (R-MC-10, R-GC-7), bundle size budget, acceptance run on the reference project, `v0.1.0` `.vsix` |
| — | R-MC-3: tsconfig `paths` and bare specifiers for CSS Module imports (later) |
| — | `composes` (R-SC-9, R-CSS-5, `composes … from global`): rare in practice (about 1 % of public `*.module.css` files mention it), so later |
