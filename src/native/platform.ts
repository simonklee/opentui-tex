function packagePath(loaded: string | { default: string }): string {
  return typeof loaded === "string" ? loaded : loaded.default
}

function linuxLibc(): "gnu" | "musl" {
  const configured = process.env.OPENTUI_LIBC
  if (configured === "gnu" || configured === "glibc") return "gnu"
  if (configured === "musl") return "musl"
  if (configured) throw new Error(`Unsupported OPENTUI_LIBC value: ${configured}`)
  const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined
  return report?.header?.glibcVersionRuntime ? "gnu" : "musl"
}

export async function resolveNativeLibrary(): Promise<string> {
  if (process.env.OPENTUI_LATEX_NATIVE_PATH) return process.env.OPENTUI_LATEX_NATIVE_PATH
  const abi = process.platform === "linux" ? linuxLibc() : undefined
  const suffix = `${process.platform}-${process.arch}${abi === "musl" ? "-musl" : ""}`
  if (suffix === "darwin-x64") return packagePath(await import("@simonklee/opentui-tex-native-darwin-x64" as string))
  if (suffix === "darwin-arm64") return packagePath(await import("@simonklee/opentui-tex-native-darwin-arm64" as string))
  if (suffix === "win32-x64") return packagePath(await import("@simonklee/opentui-tex-native-win32-x64" as string))
  if (suffix === "win32-arm64") return packagePath(await import("@simonklee/opentui-tex-native-win32-arm64" as string))
  if (suffix === "linux-x64") return packagePath(await import("@simonklee/opentui-tex-native-linux-x64" as string))
  if (suffix === "linux-x64-musl") return packagePath(await import("@simonklee/opentui-tex-native-linux-x64-musl" as string))
  if (suffix === "linux-arm64") return packagePath(await import("@simonklee/opentui-tex-native-linux-arm64" as string))
  if (suffix === "linux-arm64-musl") return packagePath(await import("@simonklee/opentui-tex-native-linux-arm64-musl" as string))
  throw new Error(`Unsupported native renderer platform: ${process.platform}-${process.arch}`)
}
