import { type CliRenderer, RGBA, type TerminalColors, type ThemeMode } from "@opentui/core"

export interface AppTheme {
  background: RGBA
  foreground: RGBA
  backgroundHex: string
  foregroundHex: string
}

function inferredMode(background?: string | null): ThemeMode {
  if (!background) return "dark"
  const color = RGBA.fromHex(background)
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b > 0.5 ? "light" : "dark"
}

export function buildTheme(mode: ThemeMode | null, colors?: TerminalColors): AppTheme {
  const resolvedMode = mode ?? inferredMode(colors?.defaultBackground)
  const backgroundHex = colors?.defaultBackground ?? (resolvedMode === "light" ? "#ffffff" : "#000000")
  const foregroundHex = colors?.defaultForeground ?? (resolvedMode === "light" ? "#000000" : "#ffffff")
  return {
    background: RGBA.fromHex(backgroundHex),
    foreground: RGBA.fromHex(foregroundHex),
    backgroundHex,
    foregroundHex,
  }
}

export async function resolveTheme(renderer: CliRenderer, mode?: ThemeMode | null): Promise<AppTheme> {
  const [detectedMode, colors] = await Promise.all([
    mode ? Promise.resolve(mode) : renderer.waitForThemeMode(350),
    renderer.getPalette({ size: 16, timeout: 350 }).catch(() => undefined),
  ])
  return buildTheme(detectedMode, colors)
}
