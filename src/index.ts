import { transformJSX, AnalyzerCache } from "sinwan-compiler";
import * as fs from "fs";
import * as path from "path";

export type SinwanCacheOptions =
  | boolean
  | {
      root: string;
      tsConfigPath?: string;
      /** Path to a JSON cache file for persisting the analyzer state. */
      cachePath?: string;
      /** Path to bunfig.toml for Bun alias resolution. */
      bunfigPath?: string;
      /** Workspace file or package paths for cross-package analysis. */
      workspaces?: import("sinwan-compiler").WorkspacesConfig;
    };

export interface SinwanBunOptions {
  /** Enable template hoisting (default: true) */
  hoist?: boolean;
  /** Emit explicit compiler-driven binding descriptors (Phase 2, default: false). */
  explicitBindings?: boolean;
  /** Path to the reactive-props metadata file produced by `sinwan analyze`. */
  analyze?: string;
  /**
   * Enable incremental in-memory cross-file analysis for dev/HMR. When true,
   * the plugin analyzes each transformed file and passes the current metadata
   * to the transform without requiring a separate `sinwan analyze` step.
   */
  cache?: SinwanCacheOptions;
  /** JSX configuration for automatic runtime */
  jsx?: {
    runtime?: "automatic" | "classic";
    importSource?: string;
  };
}

const DEFAULT_OPTIONS: Required<
  Pick<SinwanBunOptions, "hoist" | "explicitBindings">
> &
  Pick<SinwanBunOptions, "jsx"> = {
  hoist: true,
  explicitBindings: false,
  jsx: {
    runtime: "automatic",
    importSource: "sinwan",
  },
};

/**
 * Sinwan Bun plugin.
 *
 * Provides JSX transformation (hoisting) using Bun's native plugin API.
 * Note: treeShake option is ignored for Bun builds as Bun.build has native
 * tree-shaking. Use the Vite plugin if you need custom Sinwan tree-shaking.
 */
export function sinwan(options: SinwanBunOptions = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  return {
    name: "sinwan",
    setup(build: any) {
      // Configure JSX settings with defaults
      build.config = {
        ...build.config,
        jsx: opts.jsx,
      };

      // Optional incremental cross-file analyzer for dev/HMR.
      let cache: AnalyzerCache | null = null;
      if (opts.cache) {
        const root =
          typeof opts.cache === "object" ? opts.cache.root : process.cwd();
        const tsConfigPath =
          typeof opts.cache === "object" ? opts.cache.tsConfigPath : undefined;
        const cachePath =
          typeof opts.cache === "object" ? opts.cache.cachePath : undefined;
        const bunfigPath =
          typeof opts.cache === "object"
            ? (opts.cache.bunfigPath ?? path.join(root, "bunfig.toml"))
            : path.join(root, "bunfig.toml");
        const workspaces =
          typeof opts.cache === "object" ? opts.cache.workspaces : undefined;
        cache = new AnalyzerCache({
          root,
          tsConfigPath,
          cachePath,
          bunfigPath: fs.existsSync(bunfigPath) ? bunfigPath : undefined,
          workspaces,
        });
      }

      // Bun's onLoad handles JSX transformation
      build.onLoad({ filter: /\.[tj]sx$/ }, async (args: { path: string }) => {
        const code = await (globalThis as any).Bun.file(args.path).text();

        if (cache) {
          cache.update(args.path, code);
        }

        // JSX compilation with hoisting
        const transformed = transformJSX(code, args.path, {
          hoist: opts.hoist,
          explicitBindings: opts.explicitBindings,
          analyze: opts.analyze,
          analyzeMetadata: cache ? cache.reactiveProps : undefined,
        });

        return {
          contents: transformed.code,
          loader: args.path.endsWith("x") ? "tsx" : "ts",
        };
      });
    },
  };
}

export { transformJSX };

export default sinwan();
