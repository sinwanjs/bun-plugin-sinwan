/**
 * Force `sinwan` / `sinwan/*` to the app's copy.
 *
 * Linked packages (`file:`, `link:`) often have their own `node_modules/sinwan`.
 * Bun walks from the importer, so the bundler can load two runtimes and break
 * signals, inject, and component identity. Vite's equivalent is
 * `resolve.dedupe: ["sinwan"]`.
 *
 * Dev also prefers the package `development` export. Bun's default condition
 * is the production build, whose Fast Refresh helpers are no-ops, so a demo
 * page edit never reaches the mounted tree.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export const SINWAN_SPECIFIER = /^sinwan(\/|$)/;

const NEST_KEYS = ["import", "require", "browser", "node", "bun", "default"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export type SpecifierResolver = (specifier: string, fromDir: string) => string;

export function isSinwanSpecifier(specifier: string): boolean {
  return SINWAN_SPECIFIER.test(specifier);
}

export function resolveAppSinwan(
  specifier: string,
  root: string,
  resolveSync: SpecifierResolver,
): string | undefined {
  if (!isSinwanSpecifier(specifier)) return undefined;
  try {
    return resolveSync(specifier, root);
  } catch {
    return undefined;
  }
}

export function bunResolveSync(specifier: string, fromDir: string): string {
  return Bun.resolveSync(specifier, fromDir);
}

export type SinwanResolveResult = {
  path: string;
  external?: boolean;
};

/** `sinwan` → `.`, `sinwan/react` → `./react`. */
export function sinwanExportSubpath(specifier: string): string | undefined {
  if (!isSinwanSpecifier(specifier)) return undefined;
  const rest = specifier.slice("sinwan".length);
  return rest === "" ? "." : `.${rest}`;
}

/**
 * Read a conditional export such as `import.development` from a package
 * `exports` entry. Skips `types` and other non-runtime keys.
 */
export function pickConditionalExport(
  exportsField: unknown,
  subpath: string,
  condition: string,
): string | undefined {
  if (!isRecord(exportsField)) return undefined;
  if (!Object.prototype.hasOwnProperty.call(exportsField, subpath)) {
    return undefined;
  }
  return pickCondition(exportsField[subpath], condition);
}

function pickCondition(node: unknown, condition: string): string | undefined {
  if (!isRecord(node)) return undefined;
  const direct = node[condition];
  if (typeof direct === "string") return direct;
  if (isRecord(direct)) {
    const nested = pickCondition(direct, condition);
    if (nested) return nested;
  }
  for (const key of NEST_KEYS) {
    const child = node[key];
    if (!isRecord(child)) continue;
    const found = pickCondition(child, condition);
    if (found) return found;
  }
  return undefined;
}

export function readPackageJson(packageJsonPath: string): unknown {
  const parsed: unknown = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  return parsed;
}

/**
 * Absolute path of the `development` export for a sinwan specifier, when the
 * installed package publishes one.
 */
export function resolveDevelopmentSinwan(
  specifier: string,
  appRoot: string,
  resolveSync: SpecifierResolver,
  readPackage: (packageJsonPath: string) => unknown = readPackageJson,
): string | undefined {
  const subpath = sinwanExportSubpath(specifier);
  if (!subpath) return undefined;
  let packageJsonPath: string;
  try {
    packageJsonPath = resolveSync("sinwan/package.json", appRoot);
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = readPackage(packageJsonPath);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  const relative = pickConditionalExport(
    parsed.exports,
    subpath,
    "development",
  );
  if (typeof relative !== "string" || !relative.startsWith("./")) {
    return undefined;
  }
  return path.join(path.dirname(packageJsonPath), relative);
}

/**
 * App builds pin `sinwan/*` to the project copy. Library builds
 * (`peerExternal: true`) leave the specifier bare and mark it external so
 * Bun does not inline a second runtime. Dev builds prefer the package
 * `development` export so Fast Refresh is live.
 */
export function resolveSinwanImport(
  specifier: string,
  peerExternal: boolean,
  appRoot: string,
  resolveSync: SpecifierResolver,
  development = false,
): SinwanResolveResult | undefined {
  if (!isSinwanSpecifier(specifier)) return undefined;
  if (peerExternal) {
    return { path: specifier, external: true };
  }
  if (development) {
    const devPath = resolveDevelopmentSinwan(specifier, appRoot, resolveSync);
    if (devPath) return { path: devPath };
  }
  const resolved = resolveAppSinwan(specifier, appRoot, resolveSync);
  if (resolved === undefined) return undefined;
  return { path: resolved };
}
