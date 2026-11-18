# CSS Compass

Go to definition, hover and completion for CSS Modules class names, global classes and CSS custom
properties — from your project and from packages in `node_modules`. Lean and fast by default.

Status: early development. See `SPEC.md` in the repository.

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
