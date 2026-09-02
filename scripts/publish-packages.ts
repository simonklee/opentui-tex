import { readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"

interface Manifest {
  name: string
  version: string
  main?: string
  module?: string
  types?: string
  exports?: Record<string, Record<string, string>>
  optionalDependencies?: Record<string, string>
  repository?: { type: string; url: string }
  publishConfig?: { access: string; registry: string }
  os?: string[]
  cpu?: string[]
  libc?: string[]
  private?: boolean
}

const dryRun = process.argv.length === 3 && process.argv[2] === "--dry-run"
if (process.argv.length > (dryRun ? 3 : 2)) throw new Error("usage: bun scripts/publish-packages.ts [--dry-run]")

const registry = "https://registry.npmjs.org/"
const root = JSON.parse(readFileSync("package.json", "utf8")) as Manifest
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?$/
if (root.name !== "@simonklee/opentui-tex" || !versionPattern.test(root.version)) throw new Error("Invalid root package name or version")
const releaseTag = process.env.RELEASE_TAG
if (!dryRun && !releaseTag) throw new Error("Publishing requires RELEASE_TAG=v<package version>")
if (releaseTag) {
  if (releaseTag !== `v${root.version}`) throw new Error(`Release tag ${releaseTag} does not match v${root.version}`)
  if (run(["git", "rev-parse", "--verify", `refs/tags/${releaseTag}^{commit}`]).trim() !== run(["git", "rev-parse", "HEAD"]).trim()) {
    throw new Error(`HEAD does not match release tag ${releaseTag}`)
  }
}

const variants = [
  ["linux", "x64", "", "libtex_renderer.so"],
  ["linux", "arm64", "", "libtex_renderer.so"],
  ["linux", "x64", "musl", "libtex_renderer.so"],
  ["linux", "arm64", "musl", "libtex_renderer.so"],
  ["darwin", "x64", "", "libtex_renderer.dylib"],
  ["darwin", "arm64", "", "libtex_renderer.dylib"],
  ["win32", "x64", "", "tex_renderer.dll"],
  ["win32", "arm64", "", "tex_renderer.dll"],
] as const
const nativeNames = variants.map(([os, cpu, libc]) => `${root.name}-native-${os}-${cpu}${libc ? `-${libc}` : ""}`)
const names = [`${root.name}-native-source`, ...nativeNames, root.name]
const tarballs = readdirSync("release").filter((file) => file.endsWith(".tgz"))
if (tarballs.length !== names.length) throw new Error(`Expected ${names.length} release tarballs, found ${tarballs.length}`)
checkOptionalDependencies(root)

const licenses = ["LICENSE", "LICENSE-ZIGTEX", "LICENSE-MICROTEX", "LICENSE-NANOSVG", "LICENSE-LATIN-MODERN-MATH", "NOTICE-LATIN-MODERN-MATH"]
const packages = names.map((name) => {
  const filename = `${name.replace("@", "").replace("/", "-")}-${root.version}.tgz`
  if (!tarballs.includes(filename)) throw new Error(`Missing release tarball: ${filename}`)
  const tarball = resolve("release", filename)
  const manifest = JSON.parse(run(["tar", "-xOzf", tarball, "package/package.json"])) as Manifest
  if (manifest.name !== name || manifest.version !== root.version || manifest.private) throw new Error(`Invalid manifest in ${filename}`)
  if (manifest.repository?.type !== "git" || manifest.repository.url !== "git+https://github.com/simonklee/opentui-tex.git") {
    throw new Error(`Missing or incorrect repository metadata in ${filename}`)
  }
  if (manifest.publishConfig?.access !== "public" || manifest.publishConfig.registry !== registry) {
    throw new Error(`Incorrect publishConfig in ${filename}`)
  }
  const [packed] = JSON.parse(run(["npm", "pack", tarball, "--dry-run", "--json", "--ignore-scripts", `--registry=${registry}`])) as {
    name: string; version: string; files: { path: string; size: number }[]
  }[]
  if (!packed || packed.name !== name || packed.version !== root.version) throw new Error(`Invalid npm package: ${filename}`)
  const files = new Set(packed.files.filter((file) => file.size > 0).map((file) => file.path))
  const required = ["package.json", "README.md", "LICENSE"]
  const nativeIndex = nativeNames.indexOf(name)
  if (name === root.name) {
    checkOptionalDependencies(manifest)
    for (const entry of [".", "./native", "./react", "./solid"]) {
      if (!manifest.exports?.[entry]?.types || !manifest.exports[entry]?.import) throw new Error(`Missing ${entry} export in ${filename}`)
    }
    if (!manifest.exports?.["./native"]?.bun) throw new Error(`Missing Bun native export in ${filename}`)
    required.push("docs/native.md")
  } else if (nativeIndex !== -1) {
    const [os, cpu, libc, library] = variants[nativeIndex]!
    const expectedLibc = os === "linux" ? [libc || "glibc"] : undefined
    if (JSON.stringify(manifest.os) !== JSON.stringify([os]) || JSON.stringify(manifest.cpu) !== JSON.stringify([cpu]) ||
        JSON.stringify(manifest.libc) !== JSON.stringify(expectedLibc)) {
      throw new Error(`Incorrect native target metadata in ${filename}`)
    }
    if (!manifest.exports?.["."]?.types || !manifest.exports["."]?.bun || !manifest.exports["."]?.import) {
      throw new Error(`Missing native entry points in ${filename}`)
    }
    required.push(library, ...licenses)
  } else {
    required.push(
      "build.zig", "build.zig.zon", "scripts/bootstrap-native", "LICENSE-PROJECT",
      "native/lib.zig", "native/nanosvg.c", "native/zigtex-0.16.patch",
      "native/vendor/nanosvg.h", "native/vendor/nanosvgrast.h", "native/vendor/LICENSE-NANOSVG",
      "native/vendor/zigtex/build.zig", "native/vendor/zigtex/build.zig.zon", "native/vendor/zigtex/src/tex.zig", "native/vendor/zigtex/LICENSE",
      "native/vendor/microtex/build.zig", "native/vendor/microtex/LICENSE", "native/vendor/microtex/res/lm-math/README",
    )
  }
  for (const entry of [manifest.main, manifest.module, manifest.types, ...Object.values(manifest.exports ?? {}).flatMap(Object.values)]) {
    if (entry !== undefined) {
      if (typeof entry !== "string" || !entry.startsWith("./")) throw new Error(`Invalid entry point in ${filename}`)
      required.push(entry.slice(2))
    }
  }
  for (const file of required) {
    if (!files.has(file)) throw new Error(`Missing or empty ${file} in ${filename}`)
  }
  return { name, tarball }
})

const tag = root.version.includes("-") ? "next" : "latest"
// Finish every local and registry check before publishing the first package.
const published = dryRun ? [] : await Promise.all(packages.map(async ({ name }) => {
  const response = await fetch(`${registry}${encodeURIComponent(name)}/${root.version}`, { signal: AbortSignal.timeout(30_000) })
  if (response.status === 404) return false
  if (!response.ok) throw new Error(`Registry lookup failed for ${name}: HTTP ${response.status}`)
  const existing = await response.json() as Manifest
  if (existing.name !== name || existing.version !== root.version) throw new Error(`Unexpected registry response for ${name}@${root.version}`)
  return true
}))
for (const [index, { name, tarball }] of packages.entries()) {
  if (published[index]) {
    console.log(`Already published: ${name}@${root.version}`)
    continue
  }
  if (dryRun) {
    console.log(`Would publish ${name}@${root.version} to ${registry} with tag ${tag}`)
    continue
  }
  const result = Bun.spawnSync(["npm", "publish", tarball, "--access=public", `--registry=${registry}`, `--tag=${tag}`, "--ignore-scripts"], {
    stdin: "inherit", stdout: "inherit", stderr: "inherit", timeout: 180_000,
  })
  if (result.exitCode !== 0) throw new Error(`npm publish failed: ${name}@${root.version}`)
}

function checkOptionalDependencies(manifest: Manifest): void {
  const dependencies = manifest.optionalDependencies ?? {}
  if (Object.keys(dependencies).length !== nativeNames.length || nativeNames.some((name) => dependencies[name] !== root.version)) {
    throw new Error(`Expected all eight native optional dependencies at ${root.version} in ${manifest.name}`)
  }
}

function run(command: string[]): string {
  const result = Bun.spawnSync(command, { stdout: "pipe", stderr: "pipe", timeout: 180_000 })
  if (result.exitCode !== 0) throw new Error(`${command.join(" ")} failed:\n${result.stderr.toString()}`)
  return result.stdout.toString()
}
