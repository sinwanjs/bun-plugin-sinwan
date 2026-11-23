import {
  transformJSX,
  AnalyzerCache,
  IMAGE_QUERY_PATTERN,
  formatDiagnostic,
  type DiagnosticHandler,
  type SinwanDiagnostic,
} from "sinwan-compiler";
import {
  IMAGE_FILE_PATTERN,
  IMAGE_FILE_PREFIX,
  assertBunImageRuntime,
  loadImageModule,
  resolveImageConfig,
  type ImageConfig,
} from "sinwan-compiler/image";
import * as fs from "fs";
import * as path from "path";
import {
  SINWAN_SPECIFIER,
  bunResolveSync,
  resolveSinwanImport,
} from "./resolve-app-sinwan.ts";
import { injectComponentHmr, isNodeModulePath } from "./hmr.ts";

export {
  SINWAN_SPECIFIER,
  isSinwanSpecifier,
  resolveAppSinwan,
} from "./resolve-app-sinwan.ts";
export type { SpecifierResolver } from "./resolve-app-sinwan.ts";

interface BunOnLoadResult {
  contents: string;
  loader?: "js" | "jsx" | "ts" | "tsx";
  errors?: { text: string; file: string }[];
}

interface BunPluginBuild {
  onLoad(
    options: { filter: RegExp; namespace?: string },
    callback: (args: { path: string }) => Promise<BunOnLoadResult>,
  ): void;
  onResolve?(
    options: { filter: RegExp },
    callback: (args: { path: string; importer?: string }) =>
      | { path: string; external?: boolean; namespace?: string }
      | undefined,
  ): void;
}

/** Namespace of the modules behind `<Img>` asset imports (`?sinwan-img=`). */
export const IMAGE_NAMESPACE = "sinwan-img";

/**
 * `<Img>` (`sinwan/image`) settings. `root` defaults to `cache.root`, else
 * the working directory; `publicDir` and `cacheDir` resolve against it.
 */
export type SinwanImageOptions = Partial<ImageConfig>;

export type SinwanCacheOptions =
  | boolean
  | {
      root: string;
      /**
       * tsconfig/jsconfig whose `paths` the analyzer uses to resolve aliased
       * imports such as `@/components/...`. Defaults to `tsconfig.json`, then
       * `jsconfig.json`, in `root`.
       */
      tsConfigPath?: string;
      /** Path to a JSON cache file for persisting the analyzer state. */
      cachePath?: string;
      /** Path to bunfig.toml for Bun alias resolution. */
      bunfigPath?: string;
      /** Workspace file or package paths for cross-package analysis. */
      workspaces?: import("sinwan-compiler").WorkspacesConfig;
    };

export interface SinwanBunOptions {
  derivedLocals?: boolean;
  /** Enable template hoisting (default: true) */
  hoist?: boolean;
  /** Emit explicit compiler-driven binding descriptors (default: true). */
  explicitBindings?: boolean;
  /**
   * Warn when template hoisting is skipped (spreads, enhancer tags, …).
   * Default: `process.env.NODE_ENV !== "production"`, read when `sinwan()`
   * runs — not when this plugin package was compiled.
   */
  dev?: boolean;
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
  /**
   * Inject per-component Fast Refresh boundaries (`import.meta.hot.accept`).
   * Default: same as `dev` (on unless `NODE_ENV` is `"production"`).
   */
  fastRefresh?: boolean;
  /**
   * Library/publish builds: keep `sinwan` / `sinwan/*` as bare imports and
   * mark them external. Default false (apps): rewrite to the app's copy so
   * linked packages do not load a second runtime.
   */
  peerExternal?: boolean;
  /**
   * `<Img>` optimization (Bun.Image): public directory for `src="/x.jpg"`,
   * cache directory (default `.sinwan/images`), sizes and quality. Static
   * `<Img>` sources are optimized at build and in the dev server; unchanged
   * images are served from the cache.
   */
  images?: SinwanImageOptions;
  /**
   * Receives compiler diagnostics (`SW1xx`) for your source files; files under
   * `node_modules` are skipped. The lint rules run only with `dev`. Default:
   * print `file:line:column CODE: message` and its hint with `console.warn`.
   */
  onDiagnostic?: DiagnosticHandler;
}

function printDiagnostic(diagnostic: SinwanDiagnostic): void {
  console.warn(formatDiagnostic(diagnostic));
}

function ignoreDiagnostic(): void {}

/**
 * Bracket access so Bun.build cannot fold `process.env.NODE_ENV` into `true`
 * when this plugin itself is bundled.
 */
function defaultCompilerDev(): boolean {
  return process.env["NODE_ENV"] !== "production";
}

/** The project's tsconfig.json, else jsconfig.json, so aliased imports resolve. */
function defaultTsConfigPath(root: string): string | undefined {
  for (const name of ["tsconfig.json", "jsconfig.json"]) {
    const candidate = path.join(root, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

const DEFAULT_OPTIONS: Required<
  Pick<SinwanBunOptions, "hoist" | "explicitBindings" | "cache" | "peerExternal">
> = {
  hoist: true,
  explicitBindings: false,
  cache: true,
  peerExternal: false,
};

/**
 * A module that rethrows `err` in the browser, plus the error Bun prints. Keeps
 * the dev server alive on a compile or image error, so the HMR socket stays
 * connected and the fix is picked up without a reload.
 */
function errorModule(
  err: unknown,
  file: string,
  loader: NonNullable<BunOnLoadResult["loader"]>,
): BunOnLoadResult {
  const text = err instanceof Error ? err.message : String(err);
  return {
    contents: `throw new Error(${JSON.stringify(text)});`,
    errors: [{ text, file }],
    loader,
  };
}

/**
 * Absolute path (query kept) of an `<Img>` asset import: `/x.jpg` is in the
 * public directory, `./x.jpg` is relative to `fromDir` (the importer's
 * directory), anything else is a
 * module specifier (tsconfig paths, packages) resolved by Bun.
 */
export function resolveImagePath(
  specifier: string,
  fromDir: string,
  config: Pick<ImageConfig, "publicDir">,
  resolve: (specifier: string, fromDir: string) => string = bunResolveSync,
): string {
  const index = specifier.search(IMAGE_QUERY_PATTERN);
  const file = specifier.slice(0, index);
  const query = specifier.slice(index);
  let absolute: string;
  if (file.startsWith("/")) absolute = path.join(config.publicDir, file);
  else if (file.startsWith("./") || file.startsWith("../")) absolute = path.resolve(fromDir, file);
  else absolute = resolve(file, fromDir);
  return `${absolute}${query}`;
}

/**
 * Sinwan Bun plugin.
 *
 * Provides JSX transformation (hoisting) using Bun's native plugin API.
 * Note: treeShake option is ignored for Bun builds as Bun.build has native
 * tree-shaking. Use the Vite plugin if you need custom Sinwan tree-shaking.
 */
export function sinwan(options: SinwanBunOptions = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const compilerDev = options.dev ?? defaultCompilerDev();
  const fastRefresh = options.fastRefresh ?? compilerDev;

  return {
    name: "sinwan",
    setup(build: BunPluginBuild) {
      const appRoot =
        typeof opts.cache === "object" ? opts.cache.root : process.cwd();
      // <Img>: `?sinwan-img=` imports become optimized image asset modules.
      assertBunImageRuntime();
      const imageConfig = resolveImageConfig({ root: appRoot, ...options.images });
      build.onResolve?.({ filter: IMAGE_QUERY_PATTERN }, (args) => ({
        path: resolveImagePath(
          args.path,
          args.importer ? path.dirname(args.importer) : imageConfig.root,
          imageConfig,
        ),
        namespace: IMAGE_NAMESPACE,
      }));
      // Optimized files are imported by absolute path; hand the path back so
      // Bun does not look it up in a directory listing cached before it was written.
      build.onResolve?.({ filter: IMAGE_FILE_PATTERN }, (args) => ({
        path: args.path.slice(IMAGE_FILE_PREFIX.length),
      }));
      build.onLoad({ filter: /.*/, namespace: IMAGE_NAMESPACE }, async (args) => {
        try {
          return { contents: await loadImageModule(args.path, imageConfig), loader: "js" };
        } catch (err: unknown) {
          return errorModule(err, args.path, "js");
        }
      });

      build.onResolve?.({ filter: SINWAN_SPECIFIER }, (args) =>
        resolveSinwanImport(
          args.path,
          opts.peerExternal,
          appRoot,
          bunResolveSync,
          compilerDev,
        ),
      );

      // Optional incremental cross-file analyzer for dev/HMR.
      let cache: AnalyzerCache | null = null;
      if (opts.cache) {
        const root =
          typeof opts.cache === "object" ? opts.cache.root : process.cwd();
        const tsConfigPath =
          (typeof opts.cache === "object" ? opts.cache.tsConfigPath : undefined) ??
          defaultTsConfigPath(root);
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
            derivedLocals: opts.derivedLocals,
            explicitBindings: opts.explicitBindings,
            dev: compilerDev,
            analyze: opts.analyze,
            analyzeMetadata: cache ? cache.reactiveProps : undefined,
            resolveImport: cache ? cache.resolve : undefined,
            images: { host: "bun" },
            onDiagnostic: isNodeModulePath(args.path)
              ? ignoreDiagnostic
              : (options.onDiagnostic ?? printDiagnostic),
          });

          let contents = transformed.code;
          if (fastRefresh && !isNodeModulePath(args.path)) {
            const withHmr = injectComponentHmr(contents, args.path);
            if (withHmr !== null) contents = withHmr;
          }

          return {
            contents,
            loader: args.path.endsWith("x") ? "tsx" : "ts",
          };
        } catch (err: unknown) {
          return errorModule(err, args.path, args.path.endsWith("x") ? "tsx" : "ts");
        }
      });

    },
  } satisfies Bun.BunPlugin;
}

export { transformJSX };

export default sinwan();
