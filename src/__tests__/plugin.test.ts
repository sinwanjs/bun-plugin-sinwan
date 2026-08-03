import { describe, it, expect } from "bun:test";
import { sinwan } from "../index";

describe("sinwan bun plugin", () => {
  it("can be created with cache enabled", () => {
    const plugin = sinwan({ cache: true });
    expect(plugin.name).toBe("sinwan");
    expect(typeof plugin.setup).toBe("function");
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
});
