import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  bunResolveSync,
  isSinwanSpecifier,
  pickConditionalExport,
  readPackageJson,
  resolveAppSinwan,
  resolveDevelopmentSinwan,
  resolveSinwanImport,
  sinwanExportSubpath,
} from "../src/resolve-app-sinwan.ts";

describe("isSinwanSpecifier", () => {
  it("matches the runtime package and its subpaths", () => {
    expect(isSinwanSpecifier("sinwan")).toBe(true);
    expect(isSinwanSpecifier("sinwan/component")).toBe(true);
    expect(isSinwanSpecifier("sinwan-router")).toBe(false);
    expect(isSinwanSpecifier("lodash")).toBe(false);
  });
});

describe("resolveAppSinwan", () => {
  it("resolves sinwan specifiers from the app root", () => {
    const resolved = resolveAppSinwan(
      "sinwan/component",
      "/app",
      (specifier, fromDir) => `${fromDir}/node_modules/${specifier}/index.js`,
    );
    expect(resolved).toBe("/app/node_modules/sinwan/component/index.js");
  });

  it("ignores other packages", () => {
    expect(
      resolveAppSinwan("sinwan-router", "/app", () => {
        throw new Error("should not resolve");
      }),
    ).toBeUndefined();
  });

  it("returns undefined when the app has no sinwan", () => {
    expect(
      resolveAppSinwan("sinwan", "/app", () => {
        throw new Error("not found");
      }),
    ).toBeUndefined();
  });

  it("bunResolveSync resolves an installed package", () => {
    const resolved = bunResolveSync("sinwan-compiler", process.cwd());
    expect(resolved).toContain("sinwan-compiler");
  });
});

describe("resolveSinwanImport", () => {
  it("marks sinwan specifiers external for library builds", () => {
    const result = resolveSinwanImport("sinwan/reactivity", true, "/app", () => {
      throw new Error("should not resolve");
    });
    expect(result).toEqual({ path: "sinwan/reactivity", external: true });
  });

  it("ignores other packages when peerExternal is true", () => {
    expect(
      resolveSinwanImport("sinwan-router", true, "/app", () => {
        throw new Error("should not resolve");
      }),
    ).toBeUndefined();
  });

  it("returns undefined when the app has no sinwan", () => {
    expect(
      resolveSinwanImport("sinwan", false, "/app", () => {
        throw new Error("not found");
      }),
    ).toBeUndefined();
  });

  it("pins sinwan specifiers to the app root for app builds", () => {
    const result = resolveSinwanImport(
      "sinwan/component",
      false,
      "/app",
      (specifier, fromDir) => `${fromDir}/node_modules/${specifier}/index.js`,
    );
    expect(result).toEqual({
      path: "/app/node_modules/sinwan/component/index.js",
    });
  });

  it("keeps the production resolve when development is off", () => {
    const result = resolveSinwanImport(
      "sinwan/react",
      false,
      "/app",
      () => "/app/node_modules/sinwan/dist/react.production.min.js",
      false,
    );
    expect(result).toEqual({
      path: "/app/node_modules/sinwan/dist/react.production.min.js",
    });
  });
});

const SINWAN_EXPORTS = {
  "./react": {
    types: "./dist/react.d.ts",
    import: {
      development: "./dist/react.development.js",
      production: "./dist/react.production.min.js",
      default: "./dist/react.production.min.js",
    },
    default: "./dist/react.production.min.js",
  },
  "./component": {
    import: "dist/component.js",
  },
  "./bare": {
    development: "dist/bare.js",
  },
};

describe("conditional sinwan exports", () => {
  it("maps package subpaths", () => {
    expect(sinwanExportSubpath("sinwan")).toBe(".");
    expect(sinwanExportSubpath("sinwan/react")).toBe("./react");
    expect(sinwanExportSubpath("sinwan-router")).toBeUndefined();
  });

  it("reads a nested development condition and ignores types", () => {
    expect(
      pickConditionalExport(SINWAN_EXPORTS, "./react", "development"),
    ).toBe("./dist/react.development.js");
    expect(pickConditionalExport(null, "./react", "development")).toBeUndefined();
    expect(pickConditionalExport(SINWAN_EXPORTS, "./missing", "development")).toBeUndefined();
    expect(pickConditionalExport(SINWAN_EXPORTS, "./component", "development")).toBeUndefined();
    expect(
      pickConditionalExport(
        { "./react": { import: { browser: { development: "./dev.js" } } } },
        "./react",
        "development",
      ),
    ).toBe("./dev.js");
    expect(
      pickConditionalExport(
        { "./react": { development: { default: { development: "./nested.js" } } } },
        "./react",
        "development",
      ),
    ).toBe("./nested.js");
    expect(
      pickConditionalExport(
        {
          "./react": {
            development: { types: "./react.d.ts" },
            import: { development: "./from-import.js" },
          },
        },
        "./react",
        "development",
      ),
    ).toBe("./from-import.js");
    expect(
      pickConditionalExport(
        { "./react": { import: "not-a-record", require: 1 } },
        "./react",
        "development",
      ),
    ).toBeUndefined();
  });

  it("resolves the development file and falls back when it cannot", () => {
    const appRoot = fs.mkdtempSync(path.join(import.meta.dir, ".tmp-dev-"));
    const pkgDir = path.join(appRoot, "node_modules", "sinwan");
    fs.mkdirSync(path.join(pkgDir, "dist"), { recursive: true });
    const packageJsonPath = path.join(pkgDir, "package.json");
    fs.writeFileSync(
      packageJsonPath,
      JSON.stringify({
        name: "sinwan",
        exports: SINWAN_EXPORTS,
      }),
    );
    fs.writeFileSync(path.join(pkgDir, "index.js"), "export {}\n");
    try {
      const resolved = resolveSinwanImport(
        "sinwan/react",
        false,
        appRoot,
        bunResolveSync,
        true,
      );
      expect(resolved?.path).toBe(
        path.join(pkgDir, "dist", "react.development.js"),
      );

      expect(readPackageJson(packageJsonPath)).toMatchObject({
        name: "sinwan",
      });

      const unreadable = resolveDevelopmentSinwan(
        "sinwan/react",
        appRoot,
        bunResolveSync,
        () => {
          throw new Error("unreadable");
        },
      );
      expect(unreadable).toBeUndefined();

      const notObject = resolveDevelopmentSinwan(
        "sinwan/react",
        appRoot,
        bunResolveSync,
        () => [],
      );
      expect(notObject).toBeUndefined();

      const bare = resolveDevelopmentSinwan(
        "sinwan/component",
        appRoot,
        bunResolveSync,
      );
      expect(bare).toBeUndefined();
      expect(
        resolveDevelopmentSinwan("sinwan/bare", appRoot, bunResolveSync),
      ).toBeUndefined();

      expect(
        resolveDevelopmentSinwan("lodash", appRoot, bunResolveSync),
      ).toBeUndefined();

      expect(
        resolveDevelopmentSinwan("sinwan/react", appRoot, () => {
          throw new Error("missing");
        }),
      ).toBeUndefined();

      fs.writeFileSync(packageJsonPath, "{");
      const fallback = resolveSinwanImport(
        "sinwan",
        false,
        appRoot,
        bunResolveSync,
        true,
      );
      expect(fallback).toBeUndefined();
    } finally {
      fs.rmSync(appRoot, { recursive: true });
    }
  });
});
