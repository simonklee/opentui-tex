import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"
import process from "node:process"

interface Manifest {
  name: string
  version: string
  license?: string
  repository: { type: string; url: string }
  homepage: string
  bugs: { url: string }
  publishConfig: { access: string; registry: string }
  optionalDependencies: Record<string, string>
}

interface Variant {
  platform: "darwin" | "linux" | "win32"
  arch: "x64" | "arm64"
  abi?: "musl"
  zigTarget: string
  output: string
  library: string
}

const variants: readonly Variant[] = [
  { platform: "linux", arch: "x64", zigTarget: "x86_64-linux-gnu.2.17", output: "x86_64-linux", library: "libtex_renderer.so" },
  { platform: "linux", arch: "arm64", zigTarget: "aarch64-linux-gnu.2.17", output: "aarch64-linux", library: "libtex_renderer.so" },
  { platform: "linux", arch: "x64", abi: "musl", zigTarget: "x86_64-linux-musl", output: "x86_64-linux-musl", library: "libtex_renderer.so" },
  { platform: "linux", arch: "arm64", abi: "musl", zigTarget: "aarch64-linux-musl", output: "aarch64-linux-musl", library: "libtex_renderer.so" },
  { platform: "darwin", arch: "x64", zigTarget: "x86_64-macos.13.0", output: "x86_64-macos", library: "libtex_renderer.dylib" },
  { platform: "darwin", arch: "arm64", zigTarget: "aarch64-macos.13.0", output: "aarch64-macos", library: "libtex_renderer.dylib" },
  { platform: "win32", arch: "x64", zigTarget: "x86_64-windows-gnu", output: "x86_64-windows", library: "tex_renderer.dll" },
  { platform: "win32", arch: "arm64", zigTarget: "aarch64-windows-gnu", output: "aarch64-windows", library: "tex_renderer.dll" },
]

const args = process.argv.slice(2)
const all = args.length === 1 && args[0] === "--all"
const targetIndex = args.indexOf("--target")
if ((!all && args.length !== 0 && !(args.length === 2 && targetIndex === 0)) || (all && targetIndex !== -1)) {
  throw new Error("usage: bun scripts/package-native.ts [--all | --target ZIG_TARGET]")
}

const rootManifest = readManifest("package.json")
if (!rootManifest.license) throw new Error("The package manifest must declare a license")
const nativeName = `${rootManifest.name}-native`
const metadata = {
  version: rootManifest.version,
  repository: rootManifest.repository,
  homepage: rootManifest.homepage,
  bugs: rootManifest.bugs,
  publishConfig: rootManifest.publishConfig,
}

const selected = all
  ? variants
  : targetIndex === 0
    ? variants.filter((variant) => variant.zigTarget === args[1])
    : variants.filter((variant) => variant.platform === process.platform && variant.arch === process.arch && !variant.abi)
if (selected.length === 0) throw new Error("No supported native artifact was selected")

const licenses = [
  ["LICENSE", "LICENSE"],
  ["native/vendor/zigtex/LICENSE", "LICENSE-ZIGTEX"],
  ["native/vendor/microtex/LICENSE", "LICENSE-MICROTEX"],
  ["native/vendor/LICENSE-NANOSVG", "LICENSE-NANOSVG"],
  ["scripts/LICENSE-LATIN-MODERN-MATH", "LICENSE-LATIN-MODERN-MATH"],
  ["native/vendor/microtex/res/lm-math/README", "NOTICE-LATIN-MODERN-MATH"],
] as const
for (const [source] of licenses) requireFile(source, "license")

const sourcePackageName = `${nativeName}-source`
const sourcePackageDir = join("node_modules", sourcePackageName)
rmSync(sourcePackageDir, { recursive: true, force: true })
mkdirSync(join(sourcePackageDir, "scripts"), { recursive: true })
for (const file of ["build.zig", "build.zig.zon"]) copyFileSync(file, join(sourcePackageDir, file))
copyFileSync("native/vendor/zigtex/LICENSE", join(sourcePackageDir, "LICENSE"))
copyFileSync("LICENSE", join(sourcePackageDir, "LICENSE-PROJECT"))
copyFileSync("scripts/bootstrap-native", join(sourcePackageDir, "scripts", "bootstrap-native"))
cpSync("native", join(sourcePackageDir, "native"), { recursive: true })
writeFileSync(join(sourcePackageDir, "package.json"), `${JSON.stringify({
  name: sourcePackageName,
  ...metadata,
  description: `Complete corresponding source for ${rootManifest.name} native binaries`,
  license: "GPL-3.0-only",
  files: ["build.zig", "build.zig.zon", "native", "scripts", "LICENSE", "LICENSE-PROJECT", "README.md"],
}, null, 2)}\n`)
writeFileSync(join(sourcePackageDir, "README.md"), `# ${sourcePackageName}\n\nComplete corresponding source for the statically linked native TeX renderer, including the patched ZigTeX and MicroTeX trees. Build a target with:\n\n\`\`\`sh\nzig build -Doptimize=ReleaseSmall -Dtarget=<zig-target>\n\`\`\`\n`)

for (const variant of selected) {
  const suffix = `${variant.platform}-${variant.arch}${variant.abi ? `-${variant.abi}` : ""}`
  const packageName = `${nativeName}-${suffix}`
  if (rootManifest.optionalDependencies[packageName] !== rootManifest.version) {
    throw new Error(`Native dependency version mismatch: ${packageName}`)
  }
  const packageDir = join("node_modules", packageName)
  const artifact = join("zig-out", "lib", variant.output, variant.library)
  requireFile(artifact, "selected native artifact")

  rmSync(packageDir, { recursive: true, force: true })
  mkdirSync(packageDir, { recursive: true })
  copyFileSync(artifact, join(packageDir, variant.library))
  writeFileSync(join(packageDir, "index.js"), `import { fileURLToPath } from "node:url"\n\nexport default fileURLToPath(new URL("./${variant.library}", import.meta.url))\n`)
  writeFileSync(join(packageDir, "index.bun.js"), `const asset = await import("./${variant.library}", { with: { type: "file" } })\n\nexport default asset.default\n`)
  writeFileSync(join(packageDir, "index.d.ts"), "declare const path: string\nexport default path\n")
  writeFileSync(join(packageDir, "package.json"), `${JSON.stringify({
    name: packageName,
    ...metadata,
    description: `Prebuilt ${suffix} native renderer for ${rootManifest.name}`,
    type: "module",
    main: "./index.js",
    module: "./index.js",
    types: "./index.d.ts",
    exports: { ".": { types: "./index.d.ts", bun: "./index.bun.js", import: "./index.js" } },
    os: [variant.platform],
    cpu: [variant.arch],
    ...(variant.platform === "linux" ? { libc: [variant.abi ?? "glibc"] } : {}),
    license: "GPL-3.0-only",
  }, null, 2)}\n`)
  writeFileSync(join(packageDir, "README.md"), `# ${packageName}\n\nPrebuilt ${suffix} native renderer for \`${rootManifest.name}\`. Complete corresponding source is published as \`${sourcePackageName}@${rootManifest.version}\`.\n`)
  for (const [source, destination] of licenses) copyFileSync(source, join(packageDir, destination))
  console.log(`Packaged ${packageName}`)
}

function readManifest(path: string): Manifest {
  const manifest = JSON.parse(readFileSync(path, "utf8")) as Partial<Manifest>
  if (!manifest.name || !manifest.version) throw new Error(`Invalid package manifest: ${path}`)
  return manifest as Manifest
}

function requireFile(path: string, kind: string): void {
  if (!existsSync(path) || readFileSync(path).byteLength === 0) throw new Error(`Required ${kind} is missing: ${basename(path)}`)
}
