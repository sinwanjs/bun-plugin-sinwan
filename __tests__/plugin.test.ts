import { describe, it, expect } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { sinwan } from "../src/index.ts";

describe("sinwan bun plugin", () => {
  it("forwards opt-in derived locals to the linked compiler", async () => {
    const directory = fs.mkdtempSync(
      path.join(import.meta.dir, ".tmp-derived-"),
    );
    const filename = path.join(directory, "App.tsx");
    fs.writeFileSync(
      filename,
      `export function App() {
      const open = state.value > 0;
      return <div title={open}>{open}</div>;
    }`,
    );
    try {
      for (const derivedLocals of [false, true]) {
        const plugin = sinwan({
          cache: false,
          dev: false,
          fastRefresh: false,
          hoist: false,
          derivedLocals,
        });
        const callbacks: Array<
          (args: { path: string }) => Promise<{ contents: string }>
        > = [];
        plugin.setup({
          onLoad(_options, callback) {
            callbacks.push(callback);
          },
        });
        const result = await callbacks[0]!({ path: filename });
        expect(
          result.contents.includes("const open = () => state.value > 0;"),
        ).toBe(derivedLocals);
        expect(result.contents.includes("title={() => open()}")).toBe(
          derivedLocals,
        );
      }
    } finally {
      fs.rmSync(directory, { recursive: true });
    }
  });

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
      onLoad(
        _filter: { filter: RegExp },
        fn: (args: { path: string }) => Promise<unknown>,
      ) {
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

  it("registers onResolve that marks sinwan external for library builds", () => {
    const plugin = sinwan({ cache: false, peerExternal: true });
    let resolveFn:
      | ((args: { path: string }) =>
          | { path: string; external?: boolean }
          | undefined)
      | null = null;
    plugin.setup({
      onLoad() {},
      onResolve(_options, fn) {
        resolveFn = fn;
      },
    });
    expect(resolveFn).not.toBeNull();
    expect(resolveFn!({ path: "sinwan-router" })).toBeUndefined();
    expect(resolveFn!({ path: "sinwan/component" })).toEqual({
      path: "sinwan/component",
      external: true,
    });
  });
});

const SPREAD_JSX =
  "const Card = (props) => <div {...props}><p>Hello</p></div>;";

async function transformWithPlugin(
  options: Parameters<typeof sinwan>[0],
  source: string,
  filename = "Card.tsx",
): Promise<{ contents: string; warns: string[] }> {
  const plugin = sinwan(options);
  let onLoadFn:
    | ((args: { path: string }) => Promise<{ contents: string }>)
    | null = null;
  plugin.setup({
    onLoad(_filter, fn) {
      onLoadFn = fn;
    },
  });
  const tmpDir = fs.mkdtempSync(path.join(import.meta.dir, ".tmp-"));
  const tmpFile = path.join(tmpDir, filename);
  fs.mkdirSync(path.dirname(tmpFile), { recursive: true });
  fs.writeFileSync(tmpFile, source);
  const warns: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warns.push(String(args[0]));
  };
  try {
    const result = await onLoadFn!({ path: tmpFile });
    return { contents: result.contents, warns };
  } finally {
    console.warn = originalWarn;
    fs.rmSync(tmpDir, { recursive: true });
  }
}

describe("compiler dev warnings", () => {
  it("does not warn about skipped hoists when dev is false", async () => {
    const { warns, contents } = await transformWithPlugin(
      { cache: false, dev: false },
      SPREAD_JSX,
    );
    expect(contents).toContain("{...props}");
    expect(
      warns.some((line) => line.includes("template hoisting skipped")),
    ).toBe(false);
  });

  it("warns about skipped hoists when dev is true", async () => {
    const { warns } = await transformWithPlugin(
      { cache: false, dev: true },
      SPREAD_JSX,
    );
    expect(
      warns.some((line) => line.includes("template hoisting skipped")),
    ).toBe(true);
  });

  it("defaults to quiet when NODE_ENV is production", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const { warns } = await transformWithPlugin({ cache: false }, SPREAD_JSX);
      expect(
        warns.some((line) => line.includes("template hoisting skipped")),
      ).toBe(false);
    } finally {
      if (previous === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previous;
      }
    }
  });

  it("defaults to warnings when NODE_ENV is not production", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
      const { warns } = await transformWithPlugin({ cache: false }, SPREAD_JSX);
      expect(
        warns.some((line) => line.includes("template hoisting skipped")),
      ).toBe(true);
    } finally {
      if (previous === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previous;
      }
    }
  });
});

const COMPILER_RANGE = ">=1.1.2 <2.0.0";

describe("sinwan-compiler dependency range", () => {
  it("requires sinwan-compiler 1.x", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(import.meta.dir, "..", "package.json"), "utf8"),
    ) as {
      dependencies: Record<string, string>;
      peerDependencies: Record<string, string>;
    };
    expect(pkg.dependencies["sinwan-compiler"]).toBe(COMPILER_RANGE);
  });
});

const HELLO_EXPORT = "export function Hello() { return <div>hi</div>; }\n";

describe("Fast Refresh HMR injection", () => {
  it("injects accept footer for an exported component in dev", async () => {
    const { contents } = await transformWithPlugin(
      { cache: false, fastRefresh: true, dev: false },
      HELLO_EXPORT,
      "Hello.tsx",
    );
    expect(contents).toContain("$$sinwanReplace");
    expect(contents).toContain("$$sinwanRefresh");
    expect(contents).toContain("import.meta.hot.accept");
    expect(contents).toContain("__$sinwanReplace(Hello, __m.Hello)");
  });

  it("does not inject Fast Refresh when disabled", async () => {
    const { contents } = await transformWithPlugin(
      { cache: false, fastRefresh: false, dev: true },
      HELLO_EXPORT,
      "Hello.tsx",
    );
    expect(contents).not.toContain("import.meta.hot.accept");
  });

  it("does not inject Fast Refresh for node_modules", async () => {
    const { contents } = await transformWithPlugin(
      { cache: false, fastRefresh: true, dev: false },
      HELLO_EXPORT,
      path.join("node_modules", "lib", "Hello.tsx"),
    );
    expect(contents).not.toContain("import.meta.hot.accept");
  });

  it("does not inject Fast Refresh when the module exports no component", async () => {
    const { contents } = await transformWithPlugin(
      { cache: false, fastRefresh: true, dev: false },
      "export const max = 1;\n",
      "util.tsx",
    );
    expect(contents).not.toContain("import.meta.hot.accept");
  });
});

describe("default tsconfig for the analyzer", () => {
  const CHILD = `import { cc } from "sinwan/component";
export const Child = cc((props: { title: string }) => <h1>{format(props.title)}</h1>);
function format(value: string): string { return value; }
`;
  const PARENT = `import { cc } from "sinwan/component";
import { signal } from "sinwan/reactivity";
import { Child } from "@/components/Child";
export const Parent = cc(() => {
  const title = signal("Hello");
  return <Child title={title.value} />;
});
`;

  async function childOutput(
    configFile: "tsconfig.json" | "jsconfig.json" | null,
  ): Promise<string> {
    const tmpDir = fs.mkdtempSync(path.join(import.meta.dir, ".tmp-"));
    try {
      if (configFile) {
        fs.writeFileSync(
          path.join(tmpDir, configFile),
          JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
        );
      }
      fs.mkdirSync(path.join(tmpDir, "src", "components"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, "src", "pages"), { recursive: true });
      const child = path.join(tmpDir, "src", "components", "Child.tsx");
      const parent = path.join(tmpDir, "src", "pages", "Parent.tsx");
      fs.writeFileSync(child, CHILD);
      fs.writeFileSync(parent, PARENT);

      const plugin = sinwan({ cache: { root: tmpDir }, fastRefresh: false });
      let onLoadFn: ((args: { path: string }) => Promise<{ contents: string }>) | null = null;
      const fakeBuild = {
        config: {},
        onLoad(_filter: unknown, fn: (args: { path: string }) => Promise<{ contents: string }>) {
          onLoadFn = fn;
        },
      };
      plugin.setup(fakeBuild);
      await onLoadFn!({ path: parent });
      return (await onLoadFn!({ path: child })).contents;
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  }

  it("resolves @/ imports through the root tsconfig.json without tsConfigPath", async () => {
    expect(await childOutput("tsconfig.json")).toContain("() => format(");
  });

  it("falls back to jsconfig.json when there is no tsconfig.json", async () => {
    expect(await childOutput("jsconfig.json")).toContain("() => format(");
  });

  it("treats the prop as static when no config maps the alias", async () => {
    expect(await childOutput(null)).not.toContain("() => format(");
  });
});
