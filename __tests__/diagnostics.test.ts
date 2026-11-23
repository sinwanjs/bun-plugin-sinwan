import { describe, expect, it, spyOn } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import type { SinwanDiagnostic } from "sinwan-compiler";
import { sinwan } from "../src/index.ts";

const SOURCE = `import { cc } from "sinwan";
import { Gate } from "./gate";
export const App = cc(() => <Gate content={() => 1} />);
`;

type Load = (args: { path: string }) => Promise<{ contents: string }>;

async function compile(
  relative: string,
  options: Parameters<typeof sinwan>[0],
): Promise<void> {
  const directory = fs.mkdtempSync(path.join(import.meta.dir, ".tmp-diag-"));
  const filename = path.join(directory, relative);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, SOURCE);
  try {
    const callbacks: Load[] = [];
    sinwan({ cache: false, fastRefresh: false, ...options }).setup({
      onLoad(filter: { namespace?: string }, callback: Load) {
        if (filter.namespace === undefined) callbacks.push(callback);
      },
    });
    await callbacks[0]!({ path: filename });
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
}

describe("compiler diagnostics in the bun plugin", () => {
  it("prints diagnostics for app files in dev", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      await compile("App.tsx", { dev: true });
      expect(warn).toHaveBeenCalledTimes(1);
      const message = String(warn.mock.calls[0]?.[0]);
      expect(message).toContain("App.tsx:3:44 SW101:");
      expect(message).toContain("give it a parameter");
    } finally {
      warn.mockRestore();
    }
  });

  it("hands diagnostics to onDiagnostic", async () => {
    const found: SinwanDiagnostic[] = [];
    await compile("App.tsx", {
      dev: true,
      onDiagnostic: (diagnostic) => found.push(diagnostic),
    });
    expect(found).toMatchObject([{ code: "SW101", line: 3, column: 44 }]);
  });

  it("skips node_modules and production compiles", async () => {
    const found: SinwanDiagnostic[] = [];
    const onDiagnostic = (diagnostic: SinwanDiagnostic) => found.push(diagnostic);
    await compile("node_modules/lib/App.tsx", { dev: true, onDiagnostic });
    await compile("App.tsx", { dev: false, onDiagnostic });
    expect(found).toEqual([]);
  });
});
