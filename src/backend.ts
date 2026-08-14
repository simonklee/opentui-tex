import type { NativeImage } from "@opentui/core"

export interface TexRenderRequest {
  formula: string
  display: boolean
  foreground: string
  background: string
  widthMax: number
  heightMax: number
  signal: AbortSignal
}

export type TexRenderOutput =
  | { kind: "image"; image: NativeImage }
  | { kind: "unicode"; text: string; columns: number; rows: number }

export interface TexBackend {
  /** The receiver owns image outputs and must dispose them. */
  render(request: TexRenderRequest): Promise<TexRenderOutput>
}
