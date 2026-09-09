import { describe, expect, it } from "bun:test";
import {
  bunResolveSync,
  isSinwanSpecifier,
  resolveAppSinwan,
} from "../resolve-app-sinwan.ts";

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
