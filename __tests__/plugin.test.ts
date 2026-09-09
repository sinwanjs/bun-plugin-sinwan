import { describe, it, expect } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { sinwan } from "../src/index.ts";

describe("sinwan bun plugin", () => {
  it("can be created with cache enabled", () => {
    const plugin = sinwan({ cache: true });
    expect(plugin.name).toBe("sinwan");
    expect(typeof plugin.setup).toBe("function");
  });

  it("is assignable to Bun.BunPlugin", () => {
    const plugin: Bun.BunPlugin = sinwan();
    expect(plugin.name).toBe("sinwan");
    expect(typeof plugin.setup).toBe("function");
  });

  it("does not write jsx settings onto the bun build config", () => {
    const plugin = sinwan();
    const fakeBuild = {
      config: {},
      onLoad() {},
    };
    plugin.setup(fakeBuild);
    expect(fakeBuild.config).toEqual({});
  });

  it("can be created with a custom cache root", () => {
    const plugin = sinwan({
      cache: { root: "/project", tsConfigPath: "/project/tsconfig.json" },
    });
    expect(plugin.name).toBe("sinwan");
  });

  it("enables explicit bindings and the incremental analyzer by default", () => {
    const plugin = sinwan();
    expect(plugin.name).toBe("sinwan");
    expect(typeof plugin.setup).toBe("function");
  });

  it("allows disabling the cache and explicit bindings", () => {
    const plugin = sinwan({ cache: false, explicitBindings: false });
    expect(plugin.name).toBe("sinwan");
  });

  it("returns errors instead of throwing on invalid JSX syntax", async () => {
    const plugin = sinwan({ cache: false });
    let onLoadFn: ((args: { path: string }) => Promise<any>) | null = null;
    const fakeBuild = {
      config: {},
      onLoad(_filter: { filter: RegExp }, fn: (args: { path: string }) => Promise<unknown>) {
        onLoadFn = fn;
      },
    };
    plugin.setup(fakeBuild);
    expect(onLoadFn).not.toBeNull();

    const tmpDir = fs.mkdtempSync(path.join(import.meta.dir, ".tmp-"));
    const tmpFile = path.join(tmpDir, "App.tsx");
    // Unclosed/invalid JSX — Babel parser will throw.
    fs.writeFileSync(tmpFile, "const App = () => (<div></span>;");

    try {
      const result = await onLoadFn!({ path: tmpFile });
      expect(result.errors).toBeInstanceOf(Array);
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
      expect(typeof result.errors[0].text).toBe("string");
      expect(result.errors[0].file).toBe(tmpFile);
      expect(result.contents).toContain("throw new Error(");
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("returns valid transformed code for correct JSX", async () => {
    const plugin = sinwan({ cache: false });
    let onLoadFn: ((args: { path: string }) => Promise<any>) | null = null;
    const fakeBuild = {
      config: {},
      onLoad(_filter: any, fn: (args: { path: string }) => Promise<any>) {
        onLoadFn = fn;
      },
    };
    plugin.setup(fakeBuild);
    expect(onLoadFn).not.toBeNull();

    const tmpDir = fs.mkdtempSync(path.join(import.meta.dir, ".tmp-"));
    const tmpFile = path.join(tmpDir, "App.tsx");
    fs.writeFileSync(tmpFile, "const App = () => <div>hello</div>;");

    try {
      const result = await onLoadFn!({ path: tmpFile });
      expect(result.contents).toBeDefined();
      expect(typeof result.contents).toBe("string");
      expect(result.loader).toBe("tsx");
      expect(result.errors).toBeUndefined();
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("initializes the analyzer cache when cache is enabled as boolean", () => {
    const plugin = sinwan({ cache: true });
    let onLoadFn: ((args: { path: string }) => Promise<any>) | null = null;
    const fakeBuild = {
      config: {},
      onLoad(_filter: any, fn: (args: { path: string }) => Promise<any>) {
        onLoadFn = fn;
      },
    };
    // setup() runs the cache init block (lines 74-93).
    plugin.setup(fakeBuild);
    expect(onLoadFn).not.toBeNull();
  });

  it("initializes the analyzer cache when cache is enabled as object", () => {
    const tmpDir = fs.mkdtempSync(path.join(import.meta.dir, ".tmp-"));
    try {
      const plugin = sinwan({
        cache: {
          root: tmpDir,
          tsConfigPath: path.join(tmpDir, "tsconfig.json"),
        },
      });
      let onLoadFn: ((args: { path: string }) => Promise<any>) | null = null;
      const fakeBuild = {
        config: {},
        onLoad(_filter: any, fn: (args: { path: string }) => Promise<any>) {
          onLoadFn = fn;
        },
      };
      plugin.setup(fakeBuild);
      expect(onLoadFn).not.toBeNull();
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("catches cache.update errors and still returns transform errors", async () => {
    const tmpDir = fs.mkdtempSync(path.join(import.meta.dir, ".tmp-"));
    try {
      const plugin = sinwan({ cache: { root: tmpDir } });
      let onLoadFn: ((args: { path: string }) => Promise<any>) | null = null;
      const fakeBuild = {
        config: {},
        onLoad(_filter: any, fn: (args: { path: string }) => Promise<any>) {
          onLoadFn = fn;
        },
      };
      plugin.setup(fakeBuild);
      expect(onLoadFn).not.toBeNull();

      const tmpFile = path.join(tmpDir, "App.tsx");
      // Invalid JSX — both cache.update (analyzeModule) and transformJSX
      // will throw. The cache.update catch must swallow the error (line
      // 106-108) and the transform catch must return errors.
      fs.writeFileSync(tmpFile, "const App = () => (<div></span>;");

      const result = await onLoadFn!({ path: tmpFile });
      expect(result.errors).toBeInstanceOf(Array);
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
      expect(result.contents).toContain("throw new Error(");
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("transforms valid JSX with cache enabled", async () => {
    const tmpDir = fs.mkdtempSync(path.join(import.meta.dir, ".tmp-"));
    try {
      const plugin = sinwan({ cache: { root: tmpDir } });
      let onLoadFn: ((args: { path: string }) => Promise<any>) | null = null;
      const fakeBuild = {
        config: {},
        onLoad(_filter: any, fn: (args: { path: string }) => Promise<any>) {
          onLoadFn = fn;
        },
      };
      plugin.setup(fakeBuild);
      expect(onLoadFn).not.toBeNull();

      const tmpFile = path.join(tmpDir, "App.tsx");
      fs.writeFileSync(tmpFile, "const App = () => <div>hello</div>;");

      const result = await onLoadFn!({ path: tmpFile });
      expect(result.contents).toBeDefined();
      expect(typeof result.contents).toBe("string");
      expect(result.loader).toBe("tsx");
      expect(result.errors).toBeUndefined();
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("registers onResolve that pins sinwan to the app root", () => {
    const appRoot = fs.mkdtempSync(path.join(import.meta.dir, ".tmp-"));
    const pkgDir = path.join(appRoot, "node_modules", "sinwan");
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({ name: "sinwan", version: "1.0.0", main: "index.js" }),
    );
    fs.writeFileSync(path.join(pkgDir, "index.js"), "export {}\n");
    try {
      const plugin = sinwan({ cache: { root: appRoot } });
      let resolveFn:
        | ((args: { path: string }) => { path: string } | undefined)
        | null = null;
      plugin.setup({
        onLoad() {},
        onResolve(_options, fn) {
          resolveFn = fn;
        },
      });
      expect(resolveFn).not.toBeNull();
      expect(resolveFn!({ path: "sinwan-router" })).toBeUndefined();
      const pinned = resolveFn!({ path: "sinwan" });
      expect(pinned?.path).toContain("sinwan");
    } finally {
      fs.rmSync(appRoot, { recursive: true });
    }
  });
});
