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

The plugin automatically configures Bun's JSX runtime to `automatic` with `sinwan` as the import source.

## Options

```ts
sinwan({
  // Enable template hoisting (default: true)
  hoist: true,
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
  // Override JSX runtime config
  jsx: {
    runtime: "automatic",
    importSource: "sinwan",
  },
});
```

| Option             | Type                                                            | Default                                            | Description                                           |
| ------------------ | --------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------- |
| `hoist`            | `boolean`                                                       | `true`                                             | Hoist static DOM to module-level templates            |
| `explicitBindings` | `boolean`                                                       | `false`                                            | Emit compiler-driven binding descriptors              |
| `analyze`          | `string`                                                        | `undefined`                                        | Path to reactive-props metadata from `sinwan analyze` |
| `cache`            | `boolean \| SinwanCacheOptions`                                 | `false`                                            | Enable incremental in-memory cross-file analysis      |
| `jsx`              | `{ runtime?: "automatic" \| "classic"; importSource?: string }` | `{ runtime: "automatic", importSource: "sinwan" }` | JSX runtime configuration                             |

## How it works

- Transforms `.tsx` and `.jsx` files via Bun's `onLoad` hook
- Static DOM elements are hoisted to module-level template objects
- Dynamic expressions are wrapped in zero-arity functions for fine-grained reactivity
- Component calls (capitalised tags) are left for the runtime

## License

MIT © Mohammed Ben Cheikh
