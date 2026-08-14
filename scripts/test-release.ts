import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const assets = readdirSync("release").filter((file) => file.endsWith(".tgz") && !file.includes("native-source"))
if (assets.length !== 2) throw new Error(`Expected two installable release tarballs, found ${assets.length}`)

const directory = mkdtempSync(join(tmpdir(), "opentui-tex-release-"))
try {
  writeFileSync(join(directory, "package.json"), '{"private":true,"type":"module"}\n')
  run(["bun", "add", ...assets.map((asset) => resolve("release", asset))])
  const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as { dependencies?: Record<string, string> }
  if (!manifest.dependencies?.["@simonklee/opentui-tex"] || !manifest.dependencies["@simonklee/opentui-tex-native"]) {
    throw new Error("Release tarballs did not install under their package names")
  }
  run(["bun", "-e", 'import { NativeTexRenderer } from "@simonklee/opentui-tex-native"; const renderer = new NativeTexRenderer(); const image = await renderer.renderAsync("x^2", false, "#ffffff", "#000000"); if (image.width < 1) throw new Error("empty image"); image.dispose(); renderer.destroy()'])
} finally {
  rmSync(directory, { recursive: true, force: true })
}

function run(command: string[]): void {
  const result = Bun.spawnSync(command, { cwd: directory, stdout: "inherit", stderr: "inherit" })
  if (result.exitCode !== 0) process.exit(result.exitCode)
}
