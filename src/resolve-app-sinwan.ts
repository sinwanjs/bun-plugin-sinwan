/**
 * Force `sinwan` / `sinwan/*` to the app's copy.
 *
 * Linked packages (`file:`, `link:`) often have their own `node_modules/sinwan`.
 * Bun walks from the importer, so the bundler can load two runtimes and break
 * signals, inject, and component identity. Vite's equivalent is
 * `resolve.dedupe: ["sinwan"]`.
 */

export const SINWAN_SPECIFIER = /^sinwan(\/|$)/;

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
