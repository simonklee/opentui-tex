import { mkdirSync, rmSync } from "node:fs"
import { join, resolve } from "node:path"

const manifest = await Bun.file("package.json").json()
const releaseDirectory = resolve("release")
rmSync(releaseDirectory, { recursive: true, force: true })
mkdirSync(releaseDirectory, { recursive: true })

const packages = [
  `${manifest.name}-native-source`,
  ...Object.keys(manifest.optionalDependencies),
]
for (const directory of [...packages.map((name) => join("node_modules", name)), "."]) {
  const result = Bun.spawnSync(["npm", "pack", "--loglevel", "error", "--pack-destination", releaseDirectory], {
    cwd: directory,
    stdout: "inherit",
    stderr: "inherit",
  })
  if (result.exitCode !== 0) throw new Error(`npm pack failed: ${directory}`)
}
