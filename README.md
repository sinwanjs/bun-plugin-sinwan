# bun-plugin-sinwan

Bun plugin for [Sinwan](https://sinwanjs.com) — JSX transformation with template hoisting and reactive expression wrapping powered by `sinwan-compiler`.

## Install

```sh
bun add -d bun-plugin-sinwan
```

## Usage

```ts
import { sinwan } from "bun-plugin-sinwan";

await Bun.build({
  entrypoints: ["src/index.tsx"],
  plugins: [sinwan()],
  outdir: "dist",
});
```

Configure JSX in the app (`tsconfig.json` `jsx` / `jsxImportSource`, or Bun's equivalent). The plugin does not set Bun's JSX runtime.

## Compiler updates

The plugin depends on `sinwan-compiler` with `>=0.2.5 <1.0.0` and does not bundle it. Publishing a new 0.x compiler does **not** require a plugin release.

- New installs resolve the newest compatible compiler automatically.
- Existing apps keep a lockfile pin until they run `bun update sinwan-compiler`.
- Republish this plugin only when the plugin API itself changes, or when `sinwan-compiler` reaches 1.0.

## Options

```ts
sinwan({
  // Enable template hoisting (default: true)
  hoist: true,
  // Warn when hoisting is skipped (default: NODE_ENV !== "production")
  dev: true,
  // Emit explicit binding descriptors (default: false)
  explicitBindings: false,
  // Path to reactive-props metadata from `sinwan analyze`
  analyze: "./.sinwan/props.json",
  // Incremental cross-file analysis for dev/HMR
  cache: {
    root: process.cwd(),
    tsConfigPath: "./tsconfig.json",
    cachePath: "./.sinwan/cache.json",
    bunfigPath: "./bunfig.toml",
  },
});
```

| Option             | Type                            | Default                     | Description                                           |
| ------------------ | ------------------------------- | --------------------------- | ----------------------------------------------------- |
| `hoist`            | `boolean`                       | `true`                      | Hoist static DOM to module-level templates            |
| `dev`              | `boolean`                       | `NODE_ENV !== "production"` | Warn when template hoisting is skipped                |
| `explicitBindings` | `boolean`                       | `false`                     | Emit compiler-driven binding descriptors              |
| `analyze`          | `string`                        | `undefined`                 | Path to reactive-props metadata from `sinwan analyze` |
| `cache`            | `boolean \| SinwanCacheOptions` | `false`                     | Enable incremental in-memory cross-file analysis      |

Enable `sinwan({ derivedLocals: true })` to promote eligible reactive `const` derivations inside component setup. This defaults to `false`; use compiler and runtime builds containing derived-local promotion and getter-attribute hydration support. `/* sinwan-snapshot */` preserves an intentional one-shot read. In development, the compiler diagnoses eligible JSX snapshots and setup `if` reads. Imported functions annotated with `/** @sinwan-pure */` JSDoc are also promoted; see the [`@sinwan-pure` JSDoc contract](../sinwan-compiler/docs/transform.md#sinwan-pure-jsdoc-contract) in the compiler docs.

## How it works

- Transforms `.tsx` and `.jsx` files via Bun's `onLoad` hook
- Static DOM elements are hoisted to module-level template objects
- Dynamic expressions are wrapped in zero-arity functions for fine-grained reactivity
- Component calls (capitalised tags) are left for the runtime

## License

MIT © Mohammed Ben Cheikh
