import {
  BoxRenderable,
  type BoxOptions,
  ImageRenderable,
  type ImageRenderableOptions,
  type NativeImage,
  type RenderContext,
  TextRenderable,
  Yoga,
} from "@opentui/core"
import stringWidth from "string-width"
import type { TexBackend, TexRenderOutput, TexRenderRequest } from "./backend.js"
import { graphemeSegmenter } from "./math-graphemes.js"
import { renderIncompleteUnicode, UNICODE_TEX_SOURCE_LENGTH_MAX, UnicodeTexBackend } from "./unicode-tex-backend.js"

export type { TexBackend, TexRenderOutput, TexRenderRequest } from "./backend.js"

const NATIVE_SUPERSAMPLE = 4
const RESIZE_AREA_THRESHOLD = 1.3
const DEFAULT_PREVIEW_BACKEND = new UnicodeTexBackend()
const UNICODE_RENDER = UnicodeTexBackend.prototype.render
const UNICODE_RENDER_SYNC = UnicodeTexBackend.prototype.renderSync

export type TexFallback = "message" | "throw" | "retain" | "unicode"

export interface TexRenderableOptions extends BoxOptions {
  formula: string
  display?: boolean
  foreground: string
  background: string
  widthMax?: number
  heightMax?: number
  backend: TexBackend
  fallback?: TexFallback
  imageOptions?: Omit<ImageRenderableOptions, "source" | "width" | "height">
  onError?: (error: unknown) => void
  streaming?: boolean
}

export interface TexDimensions {
  columns: number
  rows: number
}

function dimensionMax(value: number): number {
  if (!Number.isFinite(value)) throw new Error("TeX dimensions must be finite")
  return Math.max(1, Math.floor(value))
}

export function measureTex(width: number, height: number, display: boolean, widthMax: number, heightMax: number): TexDimensions {
  let rows = Math.max(1, Math.ceil(height / NATIVE_SUPERSAMPLE / (display ? 10 : 12)))
  let columns = Math.max(1, Math.round(width / height * rows * 2))
  if (columns > widthMax) {
    rows = Math.max(1, Math.round(rows * widthMax / columns))
    columns = widthMax
  }
  if (rows > heightMax) {
    columns = Math.max(1, Math.round(columns * heightMax / rows))
    rows = heightMax
  }
  return { columns, rows }
}

export function fitImageToPlacement(imageWidth: number, imageHeight: number, columns: number, rows: number, cellPxWidth: number, cellPxHeight: number): { width: number; height: number } | null {
  const boxWidth = Math.max(1, Math.floor(columns * cellPxWidth))
  const boxHeight = Math.max(1, Math.floor(rows * cellPxHeight))
  const scale = Math.min(boxWidth / imageWidth, boxHeight / imageHeight)
  if (scale >= 1) return null
  const width = Math.max(1, Math.round(imageWidth * scale))
  const height = Math.max(1, Math.round(imageHeight * scale))
  return imageWidth * imageHeight > width * height * RESIZE_AREA_THRESHOLD ? { width, height } : null
}

export class TexRenderable extends BoxRenderable {
  ready: Promise<void>
  private readonly backend: TexBackend
  private readonly fallback: TexFallback
  private readonly widthMax: number
  private readonly heightMax: number
  private autoWidth: boolean
  private autoHeight: boolean
  private requestedAlignSelf: Yoga.Align
  private currentDimensions: TexDimensions = { columns: 1, rows: 1 }
  private readonly imageOptions?: TexRenderableOptions["imageOptions"]
  private readonly onError?: (error: unknown) => void
  private _formula: string
  private _foreground: string
  private _background: string
  private _display: boolean
  private _streaming: boolean
  private controller: AbortController | null = null
  private committedOutput: TexRenderOutput | null = null

  constructor(context: RenderContext, options: TexRenderableOptions) {
    const {
      formula,
      display = false,
      foreground,
      background,
      widthMax = 80,
      heightMax = 24,
      backend,
      fallback = "message",
      imageOptions,
      onError,
      streaming = false,
      ...boxOptions
    } = options
    super(context, {
      shouldFill: false,
      ...boxOptions,
      flexShrink: options.flexShrink ?? (typeof options.width === "string" && typeof options.height === "string" ? 1 : 0),
      width: options.width ?? "auto",
      height: options.height ?? "auto",
    })
    this._formula = formula
    this._foreground = foreground
    this._background = background
    this._streaming = streaming
    this._display = display
    this.backend = backend
    this.fallback = fallback
    this.widthMax = dimensionMax(widthMax)
    this.heightMax = dimensionMax(heightMax)
    this.autoWidth = options.width == null || options.width === "auto"
    this.autoHeight = options.height == null || options.height === "auto"
    this.requestedAlignSelf = this.yogaNode.getAlignSelf()
    this.imageOptions = imageOptions
    this.onError = onError
    this.ready = this.update(formula, foreground, background, display)
  }

  get formula(): string {
    return this._formula
  }

  set formula(value: string) {
    this.setSnapshot(value, this._foreground, this._background)
  }

  get display(): boolean {
    return this._display
  }

  set display(value: boolean) {
    this.setSnapshot(this._formula, this._foreground, this._background, value === true)
  }

  override get width(): number {
    return super.width
  }

  override set width(value: number | "auto" | `${number}%`) {
    super.width = value ?? "auto"
    this.autoWidth = value === "auto" || value == null
    for (const child of this.getChildren()) child.width = this.autoWidth ? this.currentDimensions.columns : "100%"
  }

  override get height(): number {
    return super.height
  }

  override set height(value: number | "auto" | `${number}%`) {
    super.height = value ?? "auto"
    this.autoHeight = value === "auto" || value == null
    for (const child of this.getChildren()) child.height = this.autoHeight ? this.currentDimensions.rows : "100%"
  }

  override set alignSelf(value: TexRenderableOptions["alignSelf"] | null) {
    super.alignSelf = value
    this.requestedAlignSelf = this.yogaNode.getAlignSelf()
  }

  override onLifecyclePass = (): void => {
    if (!this.parent) return
    const crossAuto = this.parent.primaryAxis === "column" ? this.autoWidth : this.autoHeight
    const alignment = this.requestedAlignSelf === Yoga.Align.Auto ? this.parent.getLayoutNode().getAlignItems() : this.requestedAlignSelf
    // Intrinsic formulas stay compact under stretch, but still inherit center/end alignment.
    const resolved = crossAuto && alignment === Yoga.Align.Stretch ? Yoga.Align.FlexStart : this.requestedAlignSelf
    if (this.yogaNode.getAlignSelf() !== resolved) this.yogaNode.setAlignSelf(resolved)
    for (const child of this.getChildren()) {
      const options = child instanceof ImageRenderable ? this.imageOptions : undefined
      const node = child.getLayoutNode()
      const shrink = options?.flexShrink ?? 1
      const flexible = shrink > 0 && node.getPositionType() !== Yoga.PositionType.Absolute
      // Flex shrinking fits the flow axis without capping intrinsic scrollable size.
      node.setFlexShrink(shrink)
      if (options?.maxWidth === undefined) node.setMaxWidth(this.primaryAxis === "row" && flexible ? undefined : "100%")
      if (options?.maxHeight === undefined) node.setMaxHeight(this.primaryAxis === "column" && flexible ? undefined : "100%")
    }
  }

  get streaming(): boolean {
    return this._streaming
  }

  set streaming(value: boolean) {
    if (value === this._streaming) return
    this._streaming = value
    if (value) {
      this.controller?.abort()
      this.controller = null
      this.ready = Promise.resolve()
      return
    }
    this.ready = this.update(this._formula, this._foreground, this._background, this._display)
  }

  setColors(foreground: string, background: string): void {
    this.setSnapshot(this._formula, foreground, background)
  }

  protected setSnapshot(formula: string, foreground: string, background: string, display = this._display): void {
    if (formula === this._formula && foreground === this._foreground && background === this._background && display === this._display) return
    this.ready = this.update(formula, foreground, background, display)
  }

  async whenReady(): Promise<void> {
    while (!this.isDestroyed) {
      const pending = this.ready
      const controller = this.controller
      let onAbort: (() => void) | undefined
      const changed = new Promise<void>((resolve) => {
        if (controller) {
          onAbort = () => resolve()
          controller.signal.addEventListener("abort", onAbort, { once: true })
        }
      })
      try {
        await Promise.race([pending, changed])
      } catch (error) {
        if (pending === this.ready) throw error
        continue
      } finally {
        if (onAbort) controller?.signal.removeEventListener("abort", onAbort)
      }
      if (pending === this.ready) return
    }
  }

  private async update(formula: string, foreground: string, background: string, display: boolean): Promise<void> {
    this.controller?.abort()
    this._formula = formula
    this._foreground = foreground
    this._background = background
    this._display = display
    if (!formula) {
      this.clearOutput()
      this.currentDimensions = { columns: 1, rows: 1 }
      this.yogaNode.setMeasureFunc(() => ({ width: 1, height: 1 }))
      if (!this._streaming) {
        disposeOutput(this.committedOutput)
        this.committedOutput = null
      }
      this.controller = null
      return
    }
    const controller = new AbortController()
    this.controller = controller
    const request: TexRenderRequest = {
      formula,
      display,
      foreground,
      background,
      widthMax: this.widthMax,
      heightMax: this.heightMax,
      signal: controller.signal,
    }
    if (this._streaming) {
      this.applyOutput(this.previewOutput(request))
      return
    }
    let unicodeOutput: TexRenderOutput | null = null
    const synchronousBackend = this.backend instanceof UnicodeTexBackend
      && this.backend.render === UNICODE_RENDER
      && this.backend.renderSync === UNICODE_RENDER_SYNC ? this.backend : null
    if (!synchronousBackend) {
      try {
        unicodeOutput = DEFAULT_PREVIEW_BACKEND.renderSync(request)
        this.applyOutput(unicodeOutput)
      } catch {
        // The primary backend may support input outside the Unicode subset.
      }
    }
    try {
      const output = synchronousBackend ? synchronousBackend.renderSync(request) : await this.backend.render(request)
      if (controller.signal.aborted || this.isDestroyed) {
        disposeOutput(output)
        return
      }
      if (this.fallback === "retain") {
        const previous = this.committedOutput
        try {
          this.applyOutput(output)
        } catch (error) {
          disposeOutput(output)
          throw error
        }
        this.committedOutput = output
        disposeOutput(previous)
      } else {
        try {
          this.applyOutput(output)
        } finally {
          disposeOutput(output)
        }
      }
    } catch (error) {
      // Publish readiness before observers can start a replacement request.
      if (synchronousBackend) await Promise.resolve()
      if (!controller.signal.aborted && !this.isDestroyed) {
        if (this.fallback === "retain" && this.committedOutput) this.applyOutput(this.committedOutput)
        else if (this.fallback === "message" || (this.fallback === "unicode" && !unicodeOutput)) {
          const message = error instanceof Error ? error.message : String(error)
          const text = fitLine(`[TeX error: ${message}]`, this.widthMax)
          this.applyOutput({ kind: "unicode", text, columns: Math.max(1, stringWidth(text)), rows: 1 })
        }
        this.onError?.(error)
        if (this.fallback === "throw") throw error
      }
    }
  }

  private previewOutput(request: TexRenderRequest): TexRenderOutput {
    if (request.formula.length <= UNICODE_TEX_SOURCE_LENGTH_MAX && Buffer.byteLength(request.formula, "utf8") <= UNICODE_TEX_SOURCE_LENGTH_MAX) {
      try {
        return DEFAULT_PREVIEW_BACKEND.renderSync(request)
      } catch {
        try {
          return renderIncompleteUnicode(request)
        } catch {}
      }
    }
    return rawSourceOutput(request.formula, this.widthMax, this.heightMax)
  }

  private clearOutput(): void {
    for (const existing of this.getChildren()) existing.destroyRecursively()
  }

  private applyOutput(output: TexRenderOutput): void {
    const dimensions = output.kind === "image"
      ? measureTex(output.image.width, output.image.height, this.display, this.widthMax, this.heightMax)
      : { columns: Math.min(this.widthMax, output.columns), rows: Math.min(this.heightMax, output.rows) }
    const child = output.kind === "image"
      ? this.createImageChild(output.image, dimensions)
      : new TextRenderable(this._ctx, {
          content: output.text,
          fg: this._foreground,
          bg: this._background,
          wrapMode: "none",
          width: this.autoWidth ? dimensions.columns : "100%",
          height: this.autoHeight ? dimensions.rows : "100%",
          maxWidth: "100%",
          maxHeight: "100%",
        })
    let added = false
    try {
      this.clearOutput()
      this.currentDimensions = dimensions
      this.yogaNode.unsetMeasureFunc()
      this.add(child)
      added = true
    } finally {
      if (!added) child.destroyRecursively()
    }
  }

  private createImageChild(image: NativeImage, dimensions: TexDimensions): ImageRenderable {
    // Downscale the supersampled image to its placement pixel size here, off the
    // frame loop, so the terminal image transmit payload is placement-sized.
    const resized = this.resizeToPlacement(image, dimensions)
    const source = resized ?? image
    if (this._ctx.capabilities?.kitty_graphics) {
      try {
        // A PNG encoding lets the kitty transmit send compressed bytes instead
        // of base64 raw RGBA; without it the raw path stays correct.
        source.ensureEncodedPng()
      } catch {}
    }
    try {
      return new ImageRenderable(this._ctx, {
        protocol: "auto",
        fit: "fit",
        maxWidth: "100%",
        maxHeight: "100%",
        ...this.imageOptions,
        source,
        width: this.autoWidth ? dimensions.columns : "100%",
        height: this.autoHeight ? dimensions.rows : "100%",
      })
    } finally {
      resized?.dispose()
    }
  }

  private resizeToPlacement(image: NativeImage, dimensions: TexDimensions): NativeImage | null {
    const { terminalWidth, terminalHeight, resolution } = this._ctx
    if (!terminalWidth || !terminalHeight || !resolution?.width || !resolution.height) return null
    const target = fitImageToPlacement(image.width, image.height, dimensions.columns, dimensions.rows, resolution.width / terminalWidth, resolution.height / terminalHeight)
    if (!target) return null
    try {
      return image.resize({ ...target, kernel: "area" })
    } catch {
      return null
    }
  }

  protected destroySelf(): void {
    this.controller?.abort()
    this.controller = null
    disposeOutput(this.committedOutput)
    this.committedOutput = null
    super.destroySelf()
  }
}

function disposeOutput(output: TexRenderOutput | null): void {
  if (output?.kind === "image") output.image.dispose()
}

function fitLine(value: string, widthMax: number): string {
  let output = ""
  for (const character of value) {
    if (stringWidth(output + character) > widthMax) break
    output += character
  }
  return output || "?"
}

function rawSourceOutput(source: string, widthMax: number, heightMax: number): TexRenderOutput {
  const cellLimit = Math.min(16384, widthMax * heightMax)
  const tailStart = Math.max(0, source.length - cellLimit * 2)
  let tail = source.slice(tailStart)
  if (tailStart > 0) {
    const restart = safeRawRestart(tail)
    tail = restart < 0 ? "" : tail.slice(restart)
  }
  const tailGraphemes = Array.from(graphemeSegmenter.segment(tail), (part) => part.segment)
  const lines: string[] = []
  let line = ""
  let width = 0
  for (const sourceGrapheme of tailGraphemes) {
    const visible = [...sourceGrapheme].map(visibleSourceCharacter).join("")
    const segments = visible === sourceGrapheme ? [visible] : [...visible]
    for (const character of segments) {
      const characterWidth = stringWidth(character)
      if (characterWidth > widthMax) {
        if (line) lines.push(line)
        lines.push("?")
        line = ""
        width = 0
      } else if (width + characterWidth > widthMax) {
        lines.push(line)
        line = character
        width = characterWidth
      } else {
        line += character
        width += characterWidth
      }
    }
  }
  if (line) lines.push(line)
  const visibleLines = lines.slice(-heightMax)
  const widths = visibleLines.map((value) => stringWidth(value))
  const visible = visibleLines.some((value, index) => /\S/u.test(value) && widths[index]! > 0)
  const text = visible ? visibleLines.join("\n") : "?"
  return {
    kind: "unicode",
    text,
    columns: visible ? Math.max(1, ...widths) : 1,
    rows: visible ? Math.max(1, visibleLines.length) : 1,
  }
}

function safeRawRestart(value: string): number {
  for (let index = 1; index < value.length; index++) {
    if (isPrintableAscii(value.charCodeAt(index - 1)) && isPrintableAscii(value.charCodeAt(index))) return index
  }
  return -1
}

function isPrintableAscii(value: number): boolean { return value >= 0x20 && value <= 0x7E }

function visibleSourceCharacter(character: string): string {
  if (character === "\n") return "\\n"
  if (character === "\r") return "\\r"
  if (character === "\t") return "\\t"
  const code = character.codePointAt(0)!
  return code < 32 || (code >= 127 && code <= 159) ? `\\x${code.toString(16).padStart(2, "0")}` : character
}
