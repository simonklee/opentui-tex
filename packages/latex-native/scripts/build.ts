import { renameSync, rmSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const directory = fileURLToPath(new URL("..", import.meta.url))

rmSync(join(directory, "dist"), { recursive: true, force: true })
const result = Bun.spawnSync(["bunx", "tsc", "-p", "tsconfig.build.json"], {
  cwd: directory,
  stdout: "inherit",
  stderr: "inherit",
})
if (result.exitCode !== 0) process.exit(result.exitCode)

const bunResult = await Bun.build({
  entrypoints: [join(directory, "src/index.ts")],
  outdir: join(directory, "dist-bun"),
  target: "bun",
  format: "esm",
  packages: "external",
})
if (!bunResult.success) {
  for (const log of bunResult.logs) console.error(log)
  process.exit(1)
}

renameSync(join(directory, "dist-bun/index.js"), join(directory, "dist/index.bun.js"))
rmSync(join(directory, "dist-bun"), { recursive: true, force: true })
