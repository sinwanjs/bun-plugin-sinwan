import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { deflateSync } from "zlib";

import { IMAGE_NAMESPACE, resolveImagePath, sinwan } from "../src/index.ts";

const PLUGIN_SOURCE = path.join(import.meta.dir, "..", "src", "index.ts");

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.byteLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.byteLength);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.byteLength, Bun.hash.crc32(out.subarray(4, 8 + data.byteLength)));
  return out;
}

/** A decodable RGB PNG gradient. */
function gradientPng(width: number, height: number): Uint8Array {
  const raw = new Uint8Array(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = y * (1 + width * 3) + 1 + x * 3;
      raw[at] = (x * 255) / width;
      raw[at + 1] = (y * 255) / height;
      raw[at + 2] = 128;
    }
  }
  const header = new Uint8Array(13);
  new DataView(header.buffer).setUint32(0, width);
  new DataView(header.buffer).setUint32(4, height);
  header.set([8, 2, 0, 0, 0], 8);
  return new Uint8Array(
    Buffer.concat([
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", new Uint8Array()),
    ]),
  );
}

let app: string;

const APP_TSX = `import { Img } from "sinwan/image";
import logo from "./assets/logo.png";
export const Page = () => (
  <main>
    <Img src="./assets/hero.png" alt="Hero" width={300} placeholder="blur" />
    <Img src="/banner.png" alt="" sizes="100vw" format="jpeg" quality={60} />
    <Img src={logo} alt="Logo" width={64} />
  </main>
);
console.log(Page);
`;

beforeAll(() => {
  app = fs.mkdtempSync(path.join(import.meta.dir, ".tmp-image-"));
  fs.mkdirSync(path.join(app, "src", "assets"), { recursive: true });
  fs.mkdirSync(path.join(app, "public"), { recursive: true });
  fs.writeFileSync(path.join(app, "src", "assets", "hero.png"), gradientPng(1200, 600));
  fs.writeFileSync(path.join(app, "src", "assets", "logo.png"), gradientPng(256, 256));
  fs.writeFileSync(path.join(app, "public", "banner.png"), gradientPng(1000, 250));
  fs.writeFileSync(path.join(app, "src", "App.tsx"), APP_TSX);
  fs.writeFileSync(path.join(app, "tsconfig.json"), JSON.stringify({ compilerOptions: { jsx: "react-jsx", jsxImportSource: "sinwan" } }));
});

afterAll(() => {
  fs.rmSync(app, { recursive: true, force: true });
});

async function build(dev: boolean) {
  const outdir = path.join(app, dev ? "dist-dev" : "dist");
  fs.rmSync(outdir, { recursive: true, force: true });
  const result = await Bun.build({
    entrypoints: [path.join(app, "src", "App.tsx")],
    outdir,
    publicPath: "/",
    plugins: [sinwan({ cache: { root: app }, dev, fastRefresh: false, peerExternal: true })],
    define: { "process.env.NODE_ENV": JSON.stringify(dev ? "development" : "production") },
  });
  if (!result.success) throw new AggregateError(result.logs, "build failed");
  const js = result.outputs.find((output) => output.path.endsWith(".js"));
  return { outdir, result, code: await js!.text(), files: fs.readdirSync(outdir) };
}

describe("resolveImagePath", () => {
  const config = { publicDir: "/app/public" };
  test("public, relative and module specifiers keep the query", () => {
    expect(resolveImagePath("/x.jpg?sinwan-img=e30", "/app/src", config)).toBe("/app/public/x.jpg?sinwan-img=e30");
    expect(resolveImagePath("./x.jpg?sinwan-img=e30", "/app/src", config)).toBe("/app/src/x.jpg?sinwan-img=e30");
    expect(resolveImagePath("../x.jpg?sinwan-img=e30", "/app/src", config)).toBe("/app/x.jpg?sinwan-img=e30");
    expect(resolveImagePath("@/x.jpg?sinwan-img=e30", "/app/src", config, (spec, from) => `/resolved/${spec}@${from}`)).toBe(
      "/resolved/@/x.jpg@/app/src?sinwan-img=e30",
    );
  });
});

describe("<Img> in Bun.build", () => {
  test("production and development builds emit hashed optimized files and srcset", async () => {
    for (const dev of [false, true]) {
      const { code, files } = await build(dev);
      const webp = files.filter((file) => file.endsWith(".webp"));
      const jpeg = files.filter((file) => file.endsWith(".jpg"));
      // hero: 300 and 600 px; logo: 64 and 128 px; banner: device widths up to 1000 px.
      expect(webp).toHaveLength(4);
      expect(jpeg.length).toBeGreaterThanOrEqual(3);
      for (const file of [...webp, ...jpeg]) expect(file).toMatch(/-[a-z0-9]{8}\.(webp|jpg)$/);
      expect(files.some((file) => file.endsWith(".png"))).toBe(false);
      expect(code).toContain(" 2x");
      expect(code).toContain(" 640w");
      expect(code).toContain("data:image/png;base64,");
      expect(code).not.toMatch(/"[^"\n]*\?sinwan-img=/);
      const hero = await new Bun.Image(path.join(app, dev ? "dist-dev" : "dist", webp.sort()[0]!)).metadata();
      expect(hero.format).toBe("webp");
    }
  });

  test("a second build reuses the cache without encoding again", async () => {
    await build(false);
    const encodes = [spyOn(Bun.Image.prototype, "webp"), spyOn(Bun.Image.prototype, "jpeg")];
    try {
      await build(false);
      expect(encodes.map((spy) => spy.mock.calls.length)).toEqual([0, 0]);
    } finally {
      for (const spy of encodes) spy.mockRestore();
    }
    expect(fs.readdirSync(path.join(app, ".sinwan", "images")).length).toBeGreaterThan(0);
  });

  test("an image error is reported by the build, not thrown by the plugin", async () => {
    const plugin = sinwan({ cache: false, fastRefresh: false, images: { root: app } });
    const loaders: Array<{ namespace?: string; load: (args: { path: string }) => Promise<{ contents: string; errors?: unknown[] }> }> = [];
    plugin.setup({
      onLoad(options, load) {
        loaders.push({ namespace: options.namespace, load });
      },
    });
    const image = loaders.find((entry) => entry.namespace === IMAGE_NAMESPACE)!;
    const missing = await image.load({ path: `${path.join(app, "missing.png")}?sinwan-img=e30` });
    expect(missing.errors).toHaveLength(1);
    expect(missing.contents).toContain("source not found");
  });

  test("onResolve sends image imports to the image namespace", () => {
    const resolvers: Array<(args: { path: string; importer?: string }) => unknown> = [];
    sinwan({ cache: { root: app } }).setup({
      onLoad() {},
      onResolve(_options, resolve) {
        resolvers.push(resolve);
      },
    });
    expect(resolvers[0]!({ path: "./a.png?sinwan-img=e30", importer: path.join(app, "src", "App.tsx") })).toEqual({
      path: path.join(app, "src", "a.png?sinwan-img=e30"),
      namespace: IMAGE_NAMESPACE,
    });
    expect(resolvers[0]!({ path: "/a.png?sinwan-img=e30" })).toEqual({
      path: path.join(app, "public", "a.png?sinwan-img=e30"),
      namespace: IMAGE_NAMESPACE,
    });
    expect(resolvers[1]!({ path: "sinwan-img-file:/cache/a.webp" })).toEqual({ path: "/cache/a.webp" });
  });
});

describe("<Img> in the Bun dev server", () => {
  test("serve.static plugins optimize and serve the image", async () => {
    fs.writeFileSync(
      path.join(app, "plugin.ts"),
      `import { sinwan } from ${JSON.stringify(PLUGIN_SOURCE)};\nexport default sinwan({ cache: { root: ${JSON.stringify(app)} }, peerExternal: true, fastRefresh: false });\n`,
    );
    fs.writeFileSync(path.join(app, "bunfig.toml"), `[serve.static]\nplugins = ["./plugin.ts"]\n`);
    fs.writeFileSync(path.join(app, "index.html"), `<!doctype html><html><body><script type="module" src="./src/App.tsx"></script></body></html>`);
    fs.writeFileSync(
      path.join(app, "server.ts"),
      `import index from "./index.html";\nconst server = Bun.serve({ port: 0, development: true, routes: { "/": index } });\nconsole.log("READY " + server.url.href);\n`,
    );
    const child = Bun.spawn(["bun", "server.ts"], { cwd: app, stdout: "pipe", stderr: "pipe" });
    try {
      const reader = child.stdout.getReader();
      let output = "";
      while (!output.includes("READY ")) {
        const { value, done } = await reader.read();
        if (done) throw new Error(`dev server exited: ${await new Response(child.stderr).text()}`);
        output += new TextDecoder().decode(value);
      }
      const base = output.split("READY ")[1]!.trim();
      const html = await (await fetch(base)).text();
      const script = /<script[^>]+src="([^"]+)"/.exec(html)?.[1];
      expect(script).toBeDefined();
      const code = await (await fetch(new URL(script!, base))).text();
      const asset = /"(\/[^"\s]+\.webp)"/.exec(code)?.[1];
      expect(asset).toBeDefined();
      const image = await fetch(new URL(asset!, base));
      expect(image.status).toBe(200);
      expect((await new Bun.Image(new Uint8Array(await image.arrayBuffer())).metadata()).format).toBe("webp");
    } finally {
      child.kill();
      await child.exited;
    }
  }, 60_000);
});
