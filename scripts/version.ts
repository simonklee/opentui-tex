const path = "package.json"
const manifest = await Bun.file(path).json()
for (const name of Object.keys(manifest.optionalDependencies)) {
  manifest.optionalDependencies[name] = manifest.version
}
await Bun.write(path, `${JSON.stringify(manifest, null, 2)}\n`)
