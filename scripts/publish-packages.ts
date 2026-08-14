import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

interface Manifest {
  name: string
  version: string
  optionalDependencies?: Record<string, string>
}

const dryRun = process.argv.length === 3 && process.argv[2] === "--dry-run"
if (process.argv.length > (dryRun ? 3 : 2)) throw new Error("usage: bun scripts/publish-packages.ts [--dry-run]")

const portable = manifest("package.json")
const loaderDirectory = join("packages", "latex-native")
const loader = manifest(join(loaderDirectory, "package.json"))
if (portable.version !== loader.version) throw new Error("Portable and native loader versions differ")
if (!existsSync("dist/index.js") || !existsSync(join(loaderDirectory, "dist", "index.js"))) {
  throw new Error("Build both JavaScript packages before publishing")
}

const nativeDirectories = Object.entries(loader.optionalDependencies ?? {}).map(([name, version]) => {
  if (version !== loader.version) throw new Error(`Native package version mismatch: ${name}@${version}`)
  const directory = join("node_modules", name)
  const native = manifest(join(directory, "package.json"))
  if (native.name !== name || native.version !== loader.version) throw new Error(`Invalid generated native package: ${name}`)
  if (!["libtex_renderer.so", "libtex_renderer.dylib", "tex_renderer.dll"].some((file) => existsSync(join(directory, file)))) {
    throw new Error(`Native library is missing: ${name}`)
  }
  return directory
})
if (nativeDirectories.length !== 8) throw new Error(`Expected 8 native packages, found ${nativeDirectories.length}`)
const sourceDirectory = join("node_modules", `${loader.name}-source`)
const source = manifest(join(sourceDirectory, "package.json"))
if (source.version !== loader.version) throw new Error("Native source package version differs")

for (const directory of [sourceDirectory, ...nativeDirectories, ".", loaderDirectory]) {
  const args = ["publish", "--access", "public", ...(dryRun ? ["--dry-run"] : [])]
  const result = Bun.spawnSync(["npm", ...args], { cwd: directory, stdout: "inherit", stderr: "inherit", timeout: 180_000 })
  if (result.exitCode !== 0) throw new Error(`npm publish failed: ${directory}`)
}

function manifest(path: string): Manifest {
  if (!existsSync(path)) throw new Error(`Package manifest is missing: ${path}`)
  return JSON.parse(readFileSync(path, "utf8")) as Manifest
}
