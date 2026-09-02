import { rmSync } from "node:fs"

rmSync("dist", { recursive: true, force: true })

const result = await Bun.build({
  entrypoints: ["src/index.ts", "src/react.ts", "src/solid.ts", "src/native.ts"],
  outdir: "dist",
  target: "node",
  format: "esm",
  packages: "external",
})
if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

const native = await Bun.build({
  entrypoints: ["src/native.ts"],
  outdir: "dist",
  naming: "[name].bun.js",
  target: "bun",
  format: "esm",
  packages: "external",
})
if (!native.success) throw new AggregateError(native.logs, "Native entry point build failed")

const declarations = Bun.spawnSync(["bunx", "tsc", "-p", "tsconfig.build.json"], {
  stdout: "inherit",
  stderr: "inherit",
})
if (declarations.exitCode !== 0) process.exit(declarations.exitCode)
