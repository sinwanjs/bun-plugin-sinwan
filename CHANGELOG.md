# Changelog

All notable changes to **bun-plugin-sinwan** are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com) and bun-plugin-sinwan adheres to [Semantic Versioning](https://semver.org).

## [0.3.1] — @sinwan-pure Resolver Forwarding

bun-plugin-sinwan 0.3.1 forwards the analyzer cache `resolve` callback to the compiler as `resolveImport`, enabling `@sinwan-pure` JSDoc annotation scanning across all import types (relative, bare specifiers, scoped packages, subpaths). Pair with **sinwan-compiler 0.4.0**.

### Added

- **`resolveImport` forwarding (`src/index.ts`)**: When the analyzer cache is enabled (`cache: true`, the default), the plugin forwards `cache.resolve` to the compiler as the `resolveImport` option. This allows the compiler to resolve imports using the plugin's module resolver, which handles workspace packages, tsconfig paths, and Bun module resolution. The compiler uses this resolver to find `@sinwan-pure`-annotated source files for purity scanning.

### Internal

- Documentation updated in `README.md` — references the `@sinwan-pure` JSDoc contract in `sinwan-compiler/docs/transform.md`.
- `bun test`: 34 pass / 0 fail. 100% line and function coverage. `bun run typecheck` clean. `bun run build` clean.

---

## [0.3.0] — Derived Locals

bun-plugin-sinwan 0.3.0 forwards the `derivedLocals` option to the compiler. Pair with **sinwan-compiler 0.3.2**.

### Added

- **`derivedLocals` option**: When `true`, the compiler promotes eligible derived `const` initializers to zero-arity getters.
