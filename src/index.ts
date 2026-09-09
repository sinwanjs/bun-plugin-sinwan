import { transformJSX, AnalyzerCache } from "sinwan-compiler";
import * as fs from "fs";
import * as path from "path";
import {
  SINWAN_SPECIFIER,
  bunResolveSync,
  resolveAppSinwan,
} from "./resolve-app-sinwan.ts";

export {
  SINWAN_SPECIFIER,
  isSinwanSpecifier,
  resolveAppSinwan,
} from "./resolve-app-sinwan.ts";
export type { SpecifierResolver } from "./resolve-app-sinwan.ts";

interface BunOnLoadResult {
  contents?: string;
  loader?: string;
  errors?: { text: string; file: string }[];
}

interface BunPluginBuild {
  config?: Record<string, unknown>;
  onLoad(
    options: { filter: RegExp },
    callback: (args: { path: string }) => Promise<BunOnLoadResult>,
  ): void;
  onResolve?(
    options: { filter: RegExp },
    callback: (args: { path: string }) => { path: string } | undefined,
  ): void;
}

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
  /** Emit explicit compiler-driven binding descriptors (default: true). */
  explicitBindings?: boolean;
  /** Path to the reactive-props metadata file produced by `sinwan analyze`. */
  analyze?: string;
  /**
   * Enable incremental in-memory cross-file analysis for dev/HMR. When true,
   * the plugin analyzes each transformed file and passes the current metadata
   * to the transform without requiring a separate `sinwan analyze` step.
   * Default: true (in-memory only; set to `false` to disable, or pass an object
   * to configure root/paths and persistent cache).
   */
  cache?: SinwanCacheOptions;
  /** JSX configuration for automatic runtime */
  jsx?: {
    runtime?: "automatic" | "classic";
    importSource?: string;
  };
}

const DEFAULT_OPTIONS: Required<
  Pick<SinwanBunOptions, "hoist" | "explicitBindings" | "cache">
> &
  Pick<SinwanBunOptions, "jsx"> = {
  hoist: true,
  explicitBindings: false,
  cache: true,
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
    setup(build: BunPluginBuild) {
      // Configure JSX settings with defaults
      build.config = {
        ...build.config,
        jsx: opts.jsx,
      };

      const appRoot =
        typeof opts.cache === "object" ? opts.cache.root : process.cwd();
      build.onResolve?.({ filter: SINWAN_SPECIFIER }, (args) => {
        const resolved = resolveAppSinwan(args.path, appRoot, bunResolveSync);
        if (resolved === undefined) return undefined;
        return { path: resolved };
      });

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

      // Bun's onLoad handles JSX transformation.
      //
      // Transform errors are caught and returned via Bun's `errors` field
      // instead of throwing. This keeps the dev server alive when a template
      // has a syntax/compile error, so the HMR WebSocket stays connected and
      // the client automatically picks up the fix without a manual refresh.
      build.onLoad({ filter: /\.[tj]sx$/ }, async (args: { path: string }) => {
        const code = await Bun.file(args.path).text();

        if (cache) {
          try {
            cache.update(args.path, code);
          } catch (err) {
            // Analyzer errors must never crash the server; fall through to
            // transform with whatever metadata is already cached.
          }
        }

        try {
          const transformed = transformJSX(code, args.path, {
            hoist: opts.hoist,
            explicitBindings: opts.explicitBindings,
            dev: process.env.NODE_ENV !== "production",
            analyze: opts.analyze,
            analyzeMetadata: cache ? cache.reactiveProps : undefined,
            resolveImport: cache ? cache.resolve : undefined,
          });

          return {
            contents: transformed.code,
            loader: args.path.endsWith("x") ? "tsx" : "ts",
          };
        } catch (err: unknown) {
          return {
            errors: [
              {
                text: err instanceof Error ? err.message : String(err),
                file: args.path,
              },
            ],
            loader: args.path.endsWith("x") ? "tsx" : "ts",
          };
        }
      });
    },
  };
}

export { transformJSX };

export default sinwan();
