import type { RenderContext } from "@opentui/core"
import type { TexBackend } from "./backend.js"
import { TexRenderable, type TexRenderableOptions } from "./tex-renderable.js"

const UNCONFIGURED_BACKEND: TexBackend = {
  async render() {
    throw new Error("TexRenderable requires a backend")
  },
}

export class BindingTexRenderable extends TexRenderable {
  private bindingFormula: string
  private bindingStreaming: boolean
  private bindingDisplay: boolean
  private bindingForeground: string
  private bindingBackground: string
  private updateQueued = false

  constructor(context: RenderContext, options: TexRenderableOptions) {
    const initial = options as Partial<TexRenderableOptions>
    const foreground = initial.foreground ?? ""
    const background = initial.background ?? ""
    super(context, {
      ...options,
      formula: initial.formula ?? "",
      foreground,
      background,
      backend: initial.backend ?? UNCONFIGURED_BACKEND,
      streaming: initial.streaming === true,
      display: initial.display === true,
      width: initial.width ?? undefined,
      height: initial.height ?? undefined,
    })
    this.bindingFormula = initial.formula ?? ""
    this.bindingStreaming = initial.streaming === true
    this.bindingDisplay = initial.display === true
    this.bindingForeground = foreground
    this.bindingBackground = background
  }

  override get formula(): string {
    return this.bindingFormula
  }

  override set formula(value: string) {
    const formula = typeof value === "string" ? value : ""
    if (formula === this.formula) return
    this.bindingFormula = formula
    this.queueUpdate()
  }

  override get streaming(): boolean {
    return this.bindingStreaming
  }

  override set streaming(value: boolean) {
    const streaming = value === true
    if (streaming === this.streaming) return
    this.bindingStreaming = streaming
    this.queueUpdate()
  }

  override get display(): boolean {
    return this.bindingDisplay
  }

  override set display(value: boolean) {
    const display = value === true
    if (display === this.display) return
    this.bindingDisplay = display
    this.queueUpdate()
  }

  get foreground(): string {
    return this.bindingForeground
  }

  set foreground(value: string) {
    const foreground = typeof value === "string" ? value : ""
    if (foreground === this.bindingForeground) return
    this.bindingForeground = foreground
    this.queueUpdate()
  }

  get background(): string {
    return this.bindingBackground
  }

  set background(value: string) {
    const background = typeof value === "string" ? value : ""
    if (background === this.bindingBackground) return
    this.bindingBackground = background
    this.queueUpdate()
  }

  override setColors(foreground: string, background: string): void {
    this.bindingForeground = foreground
    this.bindingBackground = background
    super.setColors(foreground, background)
  }

  private queueUpdate(): void {
    if (this.updateQueued) return
    this.updateQueued = true
    let queued!: Promise<void>
    queued = Promise.resolve().then(() => {
      this.flushUpdate()
      if (this.ready !== queued) return this.ready
    })
    this.ready = queued
  }

  private flushUpdate(): void {
    this.updateQueued = false
    if (this.isDestroyed) return
    if (this.bindingStreaming && !super.streaming) super.streaming = true
    this.setSnapshot(this.bindingFormula, this.bindingForeground, this.bindingBackground, this.bindingDisplay)
    if (!this.bindingStreaming && super.streaming) super.streaming = false
  }
}
