# CSS Compass

Go to definition, hover and completion for CSS Modules class names, global classes and CSS custom
properties — from your project and from packages in `node_modules`. Lean and fast by default.

Status: early development. See `SPEC.md` in the repository.

## Go to Definition jumps straight to the CSS

With Vite's types, TypeScript answers Ctrl+Click on `styles.shell` too (with its generic
`declare module "*.module.css"`), so VS Code would show a list with two entries. CSS Compass
therefore sets this default for TypeScript and JavaScript files:

```json
"editor.gotoLocation.multipleDefinitions": "goto"
```

Side effect: in those languages, every Go to Definition with several results (for example a
function with overloads) jumps to the first result instead of showing the list. Press
<kbd>Alt</kbd>+<kbd>F12</kbd> (Peek Definition) to see all results. To get the list back, set
the value to `"peek"` in your settings, for example only for TypeScript React:

```json
"[typescriptreact]": { "editor.gotoLocation.multipleDefinitions": "peek" }
```

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `cssCompass.localsConvention` | `asIs` | Same value as `css.modules.localsConvention` in your Vite config. |
| `cssCompass.diagnostics.unknownModuleClass` | `true` | Warn about `styles.x` when `.x` doesn't exist in the imported `.module.css` file. No scope analysis: a local variable that shadows `styles` is checked too. |
| `cssCompass.diagnostics.unknownGlobalClass` | `false` | Warn about names in `className` strings and class functions that no CSS source defines. Classes from CSS outside the sources are flagged too, hence off by default. |
| `cssCompass.debug.timings` | `false` | Log how long each request takes to the "CSS Compass" output channel. |

## Development

```bash
pnpm install
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test
```

Integration tests run in a downloaded VS Code (pinned in `.vscode-test.mjs`). Set
`VSCODE_TEST_VERSION` to run them on another version.

```bash
pnpm test:integration
```

Benchmarks for the performance budgets (results in `docs/benchmarks.md`):

```bash
pnpm bench
```

```bash
pnpm package
```

`pnpm package` builds `css-compass-<version>.vsix`. Install it with
`code --install-extension css-compass-<version>.vsix`.
