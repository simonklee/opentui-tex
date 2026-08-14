#!/usr/bin/env bun

import {
  BoxRenderable,
  bold,
  type CliRenderer,
  type KeyEvent,
  type Renderable,
  ScrollBoxRenderable,
  type StyledText,
  type TerminalColors,
  TextareaRenderable,
  TextRenderable,
  type ThemeMode,
  createCliRenderer,
  t,
} from "@opentui/core"
import { parseDocument, SOURCE_LENGTH_MAX, type InlineSpan } from "../src/document.js"
import { TexRenderable, type TexBackend, UnicodeTexBackend } from "../src/index.js"
import { type AppTheme, buildTheme, resolveTheme } from "../src/theme.js"

const COMPILE_DELAY_MS = 100
const STREAM_INTERVAL_MS = 22
const PAGE_WIDTH_MAX = 72
const OPENING_HOLD_MS = 2_400
const OPENING_FADE_MS = 900
const OPENING_FRAME_MS = 16

export const OPENING_TITLE = "T E X  /  C E L L"
export const OPENING_FORMULA = String.raw`\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}`

export const DEMO_SOURCE = String.raw`# A field guide to terminal mathematics

This document tests semantic TeX in a long reading flow. Inline math such as $e^{i\pi}+1=0$ stays with the surrounding text.

## 1. Coordinate motion

Constant acceleration changes position through a linear velocity term and a quadratic acceleration term.

$$
x(t) = x_0 + v_0t + \frac{1}{2}at^2
$$

The display uses a stacked fraction. The baseline keeps the adjacent terms on the correct row.

## 2. Fractions and roots

The quadratic formula combines a fraction, a square root, a superscript, and two binary operators.

$$
x = \frac{-b \pm \sqrt{b^2-4ac}}{2a}
$$

An indexed root places its index above the radical hook.

$$
r = \sqrt[3]{\frac{V}{4\pi}}
$$

## 3. Limits and series

A display limit puts its index below the operator. The same layout puts the destination above it.

$$
\lim_{n\to\infty}\left(1+\frac{1}{n}\right)^n=e
$$

The next identity combines an infinite series with a fraction on each side.

$$
\sum_{n=1}^{\infty}\frac{1}{n^2}=\frac{\pi^2}{6}
$$

## 4. Differential and integral calculus

Aligned rows keep each relation on one shared column.

$$
\begin{aligned}
\frac{d}{dx}x^n &= nx^{n-1} \\
\frac{d}{dx}\sin x &= \cos x \\
\int_0^1 x^2\,dx &= \frac{1}{3}
\end{aligned}
$$

The Gaussian integral uses limits, a negative exponent, and a radical.

$$
\int_{-\infty}^{\infty}e^{-x^2}\,dx=\sqrt{\pi}
$$

## 5. Vectors and accents

Accents identify vectors, unit directions, averages, and rates of change.

$$
\vec{v}=v_x\hat{x}+v_y\hat{y}
\qquad
\bar{x}=\frac{1}{n}\sum_{i=1}^{n}x_i
$$

Dots can show the first and second time derivatives.

$$
\dot{x}=v
\qquad
\ddot{x}=a
$$

## 6. Linear algebra

A matrix needs column widths, row baselines, and delimiters that span the full height.

$$
A=\begin{pmatrix}
a & b \\
c & d
\end{pmatrix}
\qquad
I=\begin{bmatrix}
1 & 0 \\
0 & 1
\end{bmatrix}
$$

An aligned system can contain a matrix as one of its cells.

$$
\begin{aligned}
A\vec{x} &= \vec{b} \\
\det(A) &= ad-bc \\
\operatorname{rank}(I) &= 2
\end{aligned}
$$

## 7. Piecewise definitions

The cases environment aligns each value with its condition.

$$
|x|=\begin{cases}
x & \text{if }x\ge 0 \\
-x & \text{if }x<0
\end{cases}
$$

Floor and ceiling delimiters use different top and bottom glyphs.

$$
\left\lfloor\frac{n}{2}\right\rfloor
\le
\frac{n}{2}
\le
\left\lceil\frac{n}{2}\right\rceil
$$

## 8. Sets and logic

Set notation combines relations, unions, intersections, and logical operators.

$$
A\cap(B\cup C)=(A\cap B)\cup(A\cap C)
$$

Quantifiers and arrows can express a compact logical statement.

$$
\forall x\in A\quad \exists y\in B\quad x\mapsto y
$$

## 9. Products and large operators

Display mode puts bounds above and below sums, products, unions, and intersections.

$$
\prod_{k=1}^{n}k=n!
\qquad
\bigcup_{i=1}^{n}A_i
\qquad
\bigcap_{i=1}^{n}A_i
$$

A double integral remains a named large operator in the cell layout.

$$
\iint_A f(x,y)\,dx\,dy
$$

## 10. Scalable delimiters

Angle brackets stretch around a fraction and preserve the center axis.

$$
\left\langle\frac{a+b}{c+d}\right\rangle
$$

Nested delimiters test height propagation through more than one layout box.

$$
\left[1+\left(\frac{x}{1-x}\right)^2\right]
$$

## 11. Greek symbols and relations

Greek symbols can mix with named functions and comparison operators.

$$
\alpha+\beta=\gamma
\qquad
\sin^2\theta+\cos^2\theta=1
$$

The relation table also includes approximation, proportion, and equivalence.

$$
\pi\approx 3.14159
\qquad
y\propto x^2
\qquad
p\equiv q
$$

## 12. A coupled system

The final display combines accents, Greek symbols, products, and aligned rows.

$$
\begin{aligned}
\dot{x} &= \sigma(y-x) \\
\dot{y} &= x(\rho-z)-y \\
\dot{z} &= xy-\beta z \\
E &= \frac{1}{2}(x^2+y^2+z^2)
\end{aligned}
$$

The document ends after enough mixed content to test page scrolling, viewport culling, and renderer changes.`

type ViewMode = "split" | "source" | "render"

export class LatexApp {
  private readonly root: BoxRenderable
  private readonly editor: TextareaRenderable
  private readonly preview: ScrollBoxRenderable
  private readonly page: BoxRenderable
  private readonly help: BoxRenderable
  private readonly opening: BoxRenderable
  private texBackend: TexBackend = new UnicodeTexBackend()
  private nativeTexBackend: (TexBackend & { destroy(): void }) | null = null
  private switchingBackend = false
  private mode: ViewMode = "render"
  private previewActive = true
  private helpVisible = false
  private compileTimer: ReturnType<typeof setTimeout> | null = null
  private streamTimer: ReturnType<typeof setInterval> | null = null
  private openingTimer: ReturnType<typeof setInterval> | null = null
  private themeRevision = 0
  private shuttingDown = false
  private currentMeasure = PAGE_WIDTH_MAX - 6

  constructor(private readonly renderer: CliRenderer, private theme: AppTheme) {
    this.root = new BoxRenderable(renderer, {
      id: "latex-root",
      width: "100%",
      height: "100%",
      flexDirection: "row",
      backgroundColor: theme.background,
    })
    this.editor = new TextareaRenderable(renderer, {
      id: "latex-source",
      width: "50%",
      height: "100%",
      visible: false,
      initialValue: DEMO_SOURCE,
      backgroundColor: theme.background,
      focusedBackgroundColor: theme.background,
      textColor: theme.foreground,
      focusedTextColor: theme.foreground,
      cursorColor: theme.foreground,
      selectionBg: theme.foreground,
      selectionFg: theme.background,
      wrapMode: "none",
      onContentChange: () => this.scheduleCompile(),
    })
    this.preview = new ScrollBoxRenderable(renderer, {
      id: "latex-preview",
      width: "100%",
      height: "100%",
      scrollY: true,
      scrollX: false,
      viewportCulling: true,
      backgroundColor: theme.background,
      contentOptions: { backgroundColor: theme.background },
      verticalScrollbarOptions: { visible: false },
      onMouseDown: () => this.activatePreview(),
    })
    this.page = new BoxRenderable(renderer, {
      id: "latex-content",
      width: PAGE_WIDTH_MAX,
      flexDirection: "column",
      paddingTop: 2,
      paddingBottom: 3,
      paddingLeft: 3,
      paddingRight: 3,
      backgroundColor: theme.background,
    })
    this.help = new BoxRenderable(renderer, {
      id: "latex-help",
      position: "absolute",
      zIndex: 100,
      width: "100%",
      height: "100%",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.background,
      visible: false,
      onMouseDown: () => this.hideHelp(),
    })
    this.help.add(new TextRenderable(renderer, {
      id: "latex-help-text",
      width: 43,
      height: 10,
      content: [
        "?             close help",
        "Tab           source / render focus",
        "s / b / r     source / split / render",
        "Ctrl+U        Unicode / native TeX",
        "j k / arrows  scroll render",
        "PgUp PgDn     scroll one page",
        "g / G         top / bottom",
        "mouse wheel   scroll render",
        "Ctrl+G        replay streaming input",
        "Ctrl+C        quit",
      ].join("\n"),
      fg: theme.foreground,
      bg: theme.background,
      selectable: false,
    }))
    this.opening = new BoxRenderable(renderer, {
      id: "latex-opening",
      position: "absolute",
      zIndex: 200,
      width: "100%",
      height: "100%",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.background,
      onMouseDown: () => this.dismissOpening(),
    })
    const openingContent = new BoxRenderable(renderer, {
      width: Math.max(1, Math.min(60, renderer.width - 4)),
      alignItems: "center",
      backgroundColor: theme.background,
    })
    openingContent.add(new TextRenderable(renderer, {
      content: t`${bold(OPENING_TITLE)}`,
      marginBottom: 2,
      fg: theme.foreground,
      bg: theme.background,
    }))
    openingContent.add(new TexRenderable(renderer, {
      formula: OPENING_FORMULA,
      display: true,
      foreground: theme.foregroundHex,
      background: theme.backgroundHex,
      widthMax: Math.max(1, Math.min(56, renderer.width - 6)),
      heightMax: 12,
      backend: new UnicodeTexBackend(),
      fallback: "unicode",
    }))
    this.opening.add(openingContent)

    this.preview.add(this.page)
    this.preview.verticalScrollBar.visible = false
    this.preview.horizontalScrollBar.visible = false
    this.root.add(this.editor)
    this.root.add(this.preview)
    renderer.root.add(this.root)
    renderer.root.add(this.help)
    renderer.root.add(this.opening)
    this.preview.focus()
    renderer.keyInput.on("keypress", this.handleKey)
    renderer.on("resize", this.handleResize)
    renderer.on("theme_mode", this.handleThemeMode)
    renderer.on("palette", this.handlePalette)
    this.applyDocumentLayout()
    this.compile()
    this.updateTitle()
    this.startOpeningFade()
  }

  private readonly handleResize = (): void => {
    this.applyDocumentLayout()
    this.scheduleCompile()
  }

  private readonly handleThemeMode = (mode: ThemeMode): void => {
    const revision = ++this.themeRevision
    void resolveTheme(this.renderer, mode).then((theme) => {
      if (this.shuttingDown || revision !== this.themeRevision) return
      this.applyTheme(theme)
    })
  }

  private readonly handlePalette = (colors: TerminalColors): void => {
    if (!this.shuttingDown) this.applyTheme(buildTheme(this.renderer.themeMode, colors))
  }

  private readonly handleKey = (key: KeyEvent): void => {
    if (key.eventType === "release") return
    if (this.opening.visible && !(key.ctrl && key.name === "c")) {
      key.preventDefault()
      this.dismissOpening()
      return
    }
    if (key.sequence === "?" || (key.name === "/" && key.shift)) {
      key.preventDefault()
      this.helpVisible ? this.hideHelp() : this.showHelp()
      return
    }
    if (this.helpVisible) {
      key.preventDefault()
      this.hideHelp()
      return
    }
    if (key.name === "tab") {
      key.preventDefault()
      this.previewActive ? this.activateSource() : this.activatePreview()
      return
    }
    if (key.ctrl && key.name === "u") {
      key.preventDefault()
      void this.toggleTexBackend()
      return
    }
    if (!this.previewActive) return

    const name = key.name
    if (key.ctrl && name === "g") this.startGeneratedStream()
    else if (name === "s") this.setMode("source")
    else if (name === "b") this.setMode("split")
    else if (name === "r") this.setMode("render")
    else if (name === "j") this.preview.scrollBy(1)
    else if (name === "k") this.preview.scrollBy(-1)
    else if (name === "g" && key.shift) this.preview.scrollTo(this.preview.scrollHeight)
    else if (name === "g") this.preview.scrollTo(0)
    else return
    key.preventDefault()
  }

  private async toggleTexBackend(): Promise<void> {
    if (this.switchingBackend) return
    if (this.texBackend === this.nativeTexBackend) {
      this.texBackend = new UnicodeTexBackend()
      this.updateTitle()
      this.compile()
      return
    }

    this.switchingBackend = true
    try {
      if (!this.nativeTexBackend) {
        const { NativeTexBackend } = await import("@simonklee/opentui-tex-native")
        if (this.shuttingDown) return
        this.nativeTexBackend = new NativeTexBackend()
      }
      if (!this.nativeTexBackend) return
      this.texBackend = this.nativeTexBackend
      this.updateTitle()
      this.compile()
    } catch (error) {
      for (const child of this.page.getChildren()) child.destroyRecursively()
      this.page.add(this.text(`Native backend unavailable: ${error instanceof Error ? error.message : String(error)}`, { marginBottom: 0 }))
    } finally {
      this.switchingBackend = false
    }
  }

  private updateTitle(): void {
    this.renderer.setTerminalTitle(`TeX / ${this.texBackend === this.nativeTexBackend ? "Native" : "Unicode"}`)
  }

  private setMode(mode: ViewMode): void {
    if (this.mode === mode) return
    this.mode = mode
    this.editor.visible = mode !== "render"
    this.preview.visible = mode !== "source"
    this.editor.width = mode === "source" ? "100%" : "50%"
    this.preview.width = mode === "render" ? "100%" : "50%"
    this.applyDocumentLayout()
    if (mode === "source") this.activateSource()
    else this.activatePreview()
    this.compile()
  }

  private applyDocumentLayout(): void {
    const viewportWidth = this.mode === "render" ? this.renderer.width : Math.floor(this.renderer.width / 2)
    const pageWidth = Math.max(1, Math.min(PAGE_WIDTH_MAX, viewportWidth))
    const margin = pageWidth >= 36 ? 3 : pageWidth >= 16 ? 1 : 0
    this.page.width = pageWidth
    this.page.paddingLeft = margin
    this.page.paddingRight = margin
    this.currentMeasure = Math.max(1, pageWidth - margin * 2)
    this.preview.content.alignItems = pageWidth === PAGE_WIDTH_MAX ? "center" : "flex-start"
  }

  private applyTheme(theme: AppTheme): void {
    const changed = theme.foregroundHex !== this.theme.foregroundHex || theme.backgroundHex !== this.theme.backgroundHex
    this.theme = theme
    this.renderer.setBackgroundColor(theme.background)
    this.root.backgroundColor = theme.background
    this.preview.backgroundColor = theme.background
    this.preview.content.backgroundColor = theme.background
    this.page.backgroundColor = theme.background
    this.help.backgroundColor = theme.background
    this.editor.backgroundColor = theme.background
    this.editor.focusedBackgroundColor = theme.background
    this.editor.textColor = theme.foreground
    this.editor.focusedTextColor = theme.foreground
    this.editor.cursorColor = theme.foreground
    this.editor.selectionBg = theme.foreground
    this.editor.selectionFg = theme.background
    const helpText = this.help.getRenderable("latex-help-text")
    if (helpText instanceof TextRenderable) {
      helpText.fg = theme.foreground
      helpText.bg = theme.background
    }
    if (changed) this.compile()
  }

  private activateSource(): void {
    if (this.mode === "render") this.setMode("split")
    this.previewActive = false
    this.editor.focus()
  }

  private activatePreview(): void {
    if (this.mode === "source") this.setMode("split")
    this.previewActive = true
    this.preview.focus()
  }

  private showHelp(): void {
    this.helpVisible = true
    this.help.visible = true
    this.editor.blur()
    this.preview.blur()
  }

  private startOpeningFade(): void {
    const startedAt = performance.now()
    this.openingTimer = setInterval(() => {
      const fadeElapsed = performance.now() - startedAt - OPENING_HOLD_MS
      if (fadeElapsed <= 0) return
      this.opening.opacity = Math.max(0, 1 - fadeElapsed / OPENING_FADE_MS)
      if (fadeElapsed >= OPENING_FADE_MS) this.dismissOpening()
    }, OPENING_FRAME_MS)
  }

  private dismissOpening(): void {
    if (this.openingTimer) clearInterval(this.openingTimer)
    this.openingTimer = null
    if (!this.opening.visible) return
    this.opening.visible = false
    this.opening.destroyRecursively()
  }

  private hideHelp(): void {
    this.helpVisible = false
    this.help.visible = false
    if (this.previewActive) this.preview.focus()
    else this.editor.focus()
  }

  private scheduleCompile(): void {
    if (this.compileTimer) clearTimeout(this.compileTimer)
    this.compileTimer = setTimeout(() => {
      this.compileTimer = null
      this.compile()
    }, COMPILE_DELAY_MS)
  }

  private compile(): void {
    const source = this.editor.plainText
    let children: Renderable[] = []
    try {
      if (Buffer.byteLength(source, "utf8") > SOURCE_LENGTH_MAX) throw new Error(`Source exceeds ${SOURCE_LENGTH_MAX} bytes`)
      children = this.createContent(source)
    } catch (error) {
      for (const child of children) child.destroyRecursively()
      children = [this.text(error instanceof Error ? error.message : String(error), { marginBottom: 0 })]
    }
    for (const child of this.page.getChildren()) child.destroyRecursively()
    for (const child of children) this.page.add(child)
  }

  private createContent(source: string): Renderable[] {
    const children: Renderable[] = []
    const widthMax = this.currentMeasure
    try {
      for (const block of parseDocument(source)) {
        if (block.kind === "math") children.push(this.displayMath(block.value, widthMax))
        else if (block.kind === "paragraph") children.push(this.paragraph(block.spans, widthMax))
        else children.push(this.heading(block.value, block.level))
      }
      return children
    } catch (error) {
      for (const child of children) child.destroyRecursively()
      throw error
    }
  }

  private paragraph(spans: InlineSpan[], widthMax: number): BoxRenderable {
    const paragraph = new BoxRenderable(this.renderer, {
      width: "100%",
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      marginBottom: 1,
      backgroundColor: this.theme.background,
    })
    for (const span of spans) {
      if (span.kind === "math") {
        paragraph.add(new TexRenderable(this.renderer, {
          formula: span.value,
          foreground: this.theme.foregroundHex,
          background: this.theme.backgroundHex,
          widthMax,
          heightMax: Math.max(1, this.renderer.height - 2),
          backend: this.texBackend,
          fallback: "unicode",
        }))
        continue
      }
      for (const word of span.value.match(/\S+\s*|\s+/g) ?? []) {
        paragraph.add(this.text(word, { width: "auto", height: 1, marginBottom: 0 }))
      }
    }
    return paragraph
  }

  private displayMath(formula: string, widthMax: number): BoxRenderable {
    const row = new BoxRenderable(this.renderer, {
      width: "100%",
      alignItems: "center",
      marginTop: 1,
      marginBottom: 2,
      backgroundColor: this.theme.background,
    })
    row.add(new TexRenderable(this.renderer, {
      formula,
      display: true,
      foreground: this.theme.foregroundHex,
      background: this.theme.backgroundHex,
      widthMax,
      heightMax: Math.max(1, this.renderer.height - 2),
      backend: this.texBackend,
      fallback: "unicode",
    }))
    return row
  }

  private heading(content: string, level: 1 | 2): Renderable {
    if (level === 2) {
      return this.text(t`${bold(content)}`, { marginTop: 1, marginBottom: 1 })
    }
    const title = new BoxRenderable(this.renderer, {
      width: "100%",
      alignItems: "center",
      marginBottom: 2,
      backgroundColor: this.theme.background,
    })
    title.add(this.text(t`${bold(content)}`, { width: "auto", marginBottom: 0 }))
    return title
  }

  private text(content: string | StyledText, layout: { width?: number | "auto" | `${number}%`; height?: number | "auto" | `${number}%`; marginTop?: number; marginBottom: number }): TextRenderable {
    return new TextRenderable(this.renderer, {
      content,
      width: layout.width ?? "100%",
      height: layout.height ?? 1,
      marginTop: layout.marginTop ?? 0,
      marginBottom: layout.marginBottom,
      fg: this.theme.foreground,
      bg: this.theme.background,
    })
  }

  private startGeneratedStream(): void {
    if (this.streamTimer) clearInterval(this.streamTimer)
    this.editor.setText("")
    let length = 0
    this.streamTimer = setInterval(() => {
      length = Math.min(DEMO_SOURCE.length, length + 9)
      this.editor.setText(DEMO_SOURCE.slice(0, length))
      this.editor.cursorOffset = length
      if (length === DEMO_SOURCE.length && this.streamTimer) {
        clearInterval(this.streamTimer)
        this.streamTimer = null
      }
    }, STREAM_INTERVAL_MS)
  }

  shutdown(): void {
    this.shuttingDown = true
    if (this.compileTimer) clearTimeout(this.compileTimer)
    if (this.streamTimer) clearInterval(this.streamTimer)
    if (this.openingTimer) clearInterval(this.openingTimer)
    this.nativeTexBackend?.destroy()
    this.renderer.keyInput.off("keypress", this.handleKey)
    this.renderer.off("resize", this.handleResize)
    this.renderer.off("theme_mode", this.handleThemeMode)
    this.renderer.off("palette", this.handlePalette)
  }
}

export async function main(): Promise<void> {
  let app: LatexApp | null = null
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    targetFps: 60,
    onDestroy: () => {
      app?.shutdown()
      // Node 26.4 can crash while finalizing the experimental TeX FFI handle.
      if (!("Bun" in globalThis)) queueMicrotask(() => process.exit(0))
    },
  })
  renderer.start()
  const theme = await resolveTheme(renderer)
  renderer.setBackgroundColor(theme.background)
  app = new LatexApp(renderer, theme)
}

if (import.meta.main) await main()
