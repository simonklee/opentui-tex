import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

interface Manifest {
  name: string
  version: string
  description: string
  type: string
  module: string
  types: string
  exports: unknown
  dependencies: Record<string, string>
  engines: Record<string, string>
}

const releaseDirectory = "release"
const fatDirectory = join(releaseDirectory, "native-package")
const loader = JSON.parse(readFileSync("packages/latex-native/package.json", "utf8")) as Manifest
const fatDependencies = { ...loader.dependencies }
delete fatDependencies["@simonklee/opentui-tex"]
const variants = [
  ["x86_64-linux", "linux-x64", "libtex_renderer.so"],
  ["aarch64-linux", "linux-arm64", "libtex_renderer.so"],
  ["x86_64-linux-musl", "linux-x64-musl", "libtex_renderer.so"],
  ["aarch64-linux-musl", "linux-arm64-musl", "libtex_renderer.so"],
  ["x86_64-macos", "darwin-x64", "libtex_renderer.dylib"],
  ["aarch64-macos", "darwin-arm64", "libtex_renderer.dylib"],
  ["x86_64-windows", "win32-x64", "tex_renderer.dll"],
  ["aarch64-windows", "win32-arm64", "tex_renderer.dll"],
] as const

rmSync(releaseDirectory, { recursive: true, force: true })
mkdirSync(fatDirectory, { recursive: true })
cpSync("packages/latex-native/dist", join(fatDirectory, "dist"), { recursive: true })
copyFileSync("packages/latex-native/README.md", join(fatDirectory, "README.md"))

for (const [output, suffix, library] of variants) {
  const destination = join(fatDirectory, "native", suffix)
  mkdirSync(destination, { recursive: true })
  copyFileSync(join("zig-out", "lib", output, library), join(destination, library))
}

const licenses = [
  ["LICENSE", "LICENSE"],
  ["native/vendor/zigtex/LICENSE", "LICENSE-ZIGTEX"],
  ["native/vendor/microtex/LICENSE", "LICENSE-MICROTEX"],
  ["native/vendor/LICENSE-NANOSVG", "LICENSE-NANOSVG"],
  ["scripts/LICENSE-LATIN-MODERN-MATH", "LICENSE-LATIN-MODERN-MATH"],
  ["native/vendor/microtex/res/lm-math/README", "NOTICE-LATIN-MODERN-MATH"],
] as const
for (const [source, destination] of licenses) copyFileSync(source, join(fatDirectory, destination))

writeFileSync(join(fatDirectory, "package.json"), `${JSON.stringify({
  name: loader.name,
  version: loader.version,
  description: `${loader.description} with all prebuilt native libraries`,
  license: "GPL-3.0-only",
  type: loader.type,
  module: loader.module,
  types: loader.types,
  exports: loader.exports,
  dependencies: fatDependencies,
  engines: loader.engines,
}, null, 2)}\n`)

pack(".")
pack(fatDirectory)
pack(join("node_modules", `${loader.name}-source`))
rmSync(fatDirectory, { recursive: true, force: true })

function pack(directory: string): void {
  const result = Bun.spawnSync(["npm", "pack", resolve(directory), "--pack-destination", releaseDirectory], {
    stdout: "inherit",
    stderr: "inherit",
  })
  if (result.exitCode !== 0) process.exit(result.exitCode)
}
