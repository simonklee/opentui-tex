import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const root = await Bun.file("package.json").json()
const packages = new Map<string, { manifest: typeof root; path: string; integrity: string }>()
for (const file of readdirSync("release").filter((name) => name.endsWith(".tgz"))) {
  const path = resolve("release", file)
  const result = Bun.spawnSync(["tar", "-xOf", path, "package/package.json"])
  assert.equal(result.exitCode, 0, `Cannot read ${file}`)
  const manifest = JSON.parse(result.stdout.toString())
  assert.equal(manifest.version, root.version)
  assert(!packages.has(manifest.name), `Duplicate package: ${manifest.name}`)
  const integrity = `sha512-${createHash("sha512").update(new Uint8Array(await Bun.file(path).arrayBuffer())).digest("base64")}`
  packages.set(manifest.name, { manifest, path, integrity })
}
assert.deepEqual([...packages.keys()].sort(), [root.name, `${root.name}-native-source`, ...Object.keys(root.optionalDependencies)].sort())
assert.deepEqual(packages.get(root.name)!.manifest.optionalDependencies, root.optionalDependencies)

// Serve the packed artifacts as a scoped registry so installers select optional binaries themselves.
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const path = decodeURIComponent(new URL(request.url).pathname.slice(1))
    const tarball = path.endsWith(".tgz")
    const name = tarball ? path.slice(0, -4) : path
    const pkg = packages.get(name)
    if (!pkg) return new Response("Not found", { status: 404 })
    if (tarball) return new Response(Bun.file(pkg.path))
    return Response.json({
      name,
      "dist-tags": { latest: root.version, next: root.version },
      versions: {
        [root.version]: {
          ...pkg.manifest,
          dist: { tarball: `${server.url}${name}.tgz`, integrity: pkg.integrity },
        },
      },
    })
  },
})

const directory = mkdtempSync(join(tmpdir(), "opentui-tex-release-"))
const report = process.report.getReport() as { header: { glibcVersionRuntime?: string } }
const libc = report.header.glibcVersionRuntime ? "glibc" : "musl"
const suffix = `${process.platform}-${process.arch}${process.platform === "linux" && libc === "musl" ? "-musl" : ""}`
const nativeName = `${root.name}-native-${suffix}`
const unicode = `
  import assert from "node:assert/strict";
  import { BoxRenderable } from "@opentui/core";
  import { TexRenderable, UnicodeTexBackend } from "@simonklee/opentui-tex";
  assert(TexRenderable.prototype instanceof BoxRenderable);
  const result = new UnicodeTexBackend().renderSync({ formula: "x^2", display: false,
    foreground: "#ffffff", background: "#000000", widthMax: 80, heightMax: 24,
    signal: new AbortController().signal });
  assert(result.columns > 0);
  const { NativeTexRenderer } = await import("@simonklee/opentui-tex/native");
  const renderer = new NativeTexRenderer();
`
const native = `
  const { NativeImage } = await import("@opentui/core");
  const image = await renderer.renderAsync("x^2", false, "#ffffff", "#000000");
  assert(image instanceof NativeImage);
  assert(image.width > 0 && image.height > 0);
  image.dispose();
  renderer.destroy();
  process.exit(0);
`
try {
  for (const installer of ["npm", "bun"]) {
    const cwd = join(directory, installer)
    await Bun.write(join(cwd, "package.json"), '{"private":true,"type":"module"}\n')
    await Bun.write(join(cwd, ".npmrc"), `@simonklee:registry=${server.url}\n`)
    await run(installer === "npm"
      ? ["npm", "install", `${root.name}@${root.version}`, "--ignore-scripts", "--no-audit", "--no-fund"]
      : ["bun", "add", `${root.name}@${root.version}`, "--ignore-scripts"], cwd)
    for (const name of Object.keys(root.optionalDependencies)) {
      // Bun 1.3.14 installs both Linux libc variants; the runtime selects one.
      const expected = installer === "bun"
        ? name.replace(/-musl$/, "") === nativeName.replace(/-musl$/, "")
        : name === nativeName
      assert.equal(existsSync(join(cwd, "node_modules", name)), expected, `Unexpected ${installer} platform selection: ${name}`)
    }
    await Bun.write(join(cwd, "consumer.ts"), 'import type { TexBackend } from "@simonklee/opentui-tex";\nimport { NativeTexBackend } from "@simonklee/opentui-tex/native";\nconst backend: TexBackend = new NativeTexBackend();\n')
    await run(["bun", resolve("node_modules/typescript/bin/tsc"), "--noEmit", "--skipLibCheck", "--module", "nodenext", "--target", "esnext", "consumer.ts"], cwd)
    await Bun.write(join(cwd, "smoke.mjs"), unicode + native)
    await run(["bun", "smoke.mjs"], cwd)
    await run(["node", "--experimental-ffi", "smoke.mjs"], cwd)
    rmSync(join(cwd, "node_modules", nativeName), { recursive: true })
    await Bun.write(join(cwd, "smoke.mjs"), unicode + 'await assert.rejects(renderer.renderAsync("x", false, "#ffffff", "#000000")); renderer.destroy(); process.exit(0);\n')
    await run(["bun", "smoke.mjs"], cwd)
    await run(["node", "--experimental-ffi", "smoke.mjs"], cwd)
  }
} finally {
  server.stop(true)
  rmSync(directory, { recursive: true, force: true })
}

async function run(command: string[], cwd: string): Promise<void> {
  const result = Bun.spawn(command, {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, OPENTUI_LIBC: libc, OPENTUI_LATEX_NATIVE_PATH: "", npm_config_cache: join(directory, "npm-cache"), BUN_INSTALL_CACHE_DIR: join(directory, "bun-cache") },
    timeout: 180_000,
  })
  assert.equal(await result.exited, 0, command.join(" "))
}
