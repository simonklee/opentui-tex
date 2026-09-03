import type { NativeImage } from "@opentui/core"
import type { MathStyle } from "./math-types.js"

export type TexTextSpan = MathStyle & { text: string }

export interface TexRenderRequest {
  formula: string
  display: boolean
  foreground: string
  background: string
  widthMax: number
  heightMax: number
  signal: AbortSignal
  strict?: boolean
}

export type TexRenderOutput =
  | { kind: "image"; image: NativeImage }
  | { kind: "unicode"; text: string; columns: number; rows: number; spans?: TexTextSpan[] }

export interface TexBackend {
  /** The receiver owns image outputs and must dispose them. */
  render(request: TexRenderRequest): Promise<TexRenderOutput>
}
