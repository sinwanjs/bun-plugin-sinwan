import { describe, expect, it } from "bun:test";
import { injectComponentHmr, isNodeModulePath } from "../src/hmr.ts";

describe("injectComponentHmr", () => {
  it("returns null when the module exports no component", () => {
    expect(injectComponentHmr("export const max = 1;", "util.tsx")).toBeNull();
  });

  it("returns null when $$sinwanReplace is already present", () => {
    const code =
      "export function Hello() { return <div>hi</div>; }\nconst $$sinwanReplace = 1;";
    expect(injectComponentHmr(code, "Hello.tsx")).toBeNull();
  });

  it("returns null when __$sinwanRefresh is already present", () => {
    const code =
      "export function Hello() { return <div>hi</div>; }\nconst __$sinwanRefresh = 1;";
    expect(injectComponentHmr(code, "Hello.tsx")).toBeNull();
  });

  it("maps a renamed export specifier", () => {
    const code = "const Foo = () => null;\nexport { Foo as Bar };\n";
    const out = injectComponentHmr(code, "Hello.tsx");
    expect(out).toContain("__$sinwanReplace(Foo, __m.Bar)");
  });

  it("does not replace type-only exports that have no runtime binding", () => {
    const code = `
const Button = () => null;
type ButtonProps = { variant?: string };
export { Button };
export type { ButtonProps };
`;
    const out = injectComponentHmr(code, "button.tsx");
    expect(out).toContain("__$sinwanReplace(Button, __m.Button)");
    expect(out).not.toContain("__$sinwanReplace(ButtonProps");
  });
});

describe("isNodeModulePath", () => {
  it("detects node_modules on posix and windows separators", () => {
    expect(isNodeModulePath("/app/src/Hello.tsx")).toBe(false);
    expect(isNodeModulePath("/app/node_modules/lib/Hello.tsx")).toBe(true);
    expect(isNodeModulePath("C:\\app\\node_modules\\lib\\Hello.tsx")).toBe(true);
  });
});
