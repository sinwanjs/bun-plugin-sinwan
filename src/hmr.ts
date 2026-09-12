/**
 * Sinwan Fast Refresh — HMR boundary injection (DEV only).
 *
 * Same footer as vite-plugin-sinwan. Each exported component module becomes
 * its own Bun `import.meta.hot.accept` boundary so an edit does not depend
 * on importers re-running (they often snapshot components, e.g. a
 * `demoPages[slug]` record passed to `<Route component={Page} />`).
 *
 * Detection uses sinwan-compiler's `collectExportedComponents`.
 */

import { collectExportedComponents } from "sinwan-compiler";

/**
 * Append a Fast Refresh HMR footer to a component module's source.
 * Returns the augmented code, or `null` when the module exports no components.
 */
export function injectComponentHmr(
  code: string,
  filename: string,
): string | null {
  const components = collectExportedComponents(code, filename);
  if (components.length === 0) return null;

  if (code.includes("$$sinwanReplace") || code.includes("__$sinwanRefresh")) {
    return null;
  }

  const replaces = components
    .map(({ local, key }) => `    __$sinwanReplace(${local}, __m.${key});`)
    .join("\n");

  const footer = `

import { $$sinwanReplace as __$sinwanReplace, $$sinwanRefresh as __$sinwanRefresh } from "sinwan/react";
if (import.meta.hot) {
  import.meta.hot.accept((__m) => {
    if (!__m) return;
${replaces}
    __$sinwanRefresh();
  });
}
`;

  return code + footer;
}

export function isNodeModulePath(filePath: string): boolean {
  return filePath.split(/[/\\]/).includes("node_modules");
}
