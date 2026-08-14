import { ImageRenderable, NativeImage, TextRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { describe, expect, spyOn, test } from "bun:test"
import { BindingTexRenderable } from "./binding-tex-renderable.js"
import { fitImageToPlacement, TexRenderable, type TexBackend, type TexRenderableOptions } from "./tex-renderable.js"

function imageOutput(red: number, width = 1, height = 1): { output: Awaited<ReturnType<TexBackend["render"]>>; probe: NativeImage } {
  const data = new Uint8Array(width * height * 4).fill(255)
  data.set([red, 20, 30, 255])
  const image = NativeImage.fromRgba(data, width, height)
  return { output: { kind: "image", image }, probe: image.retain() }
}

function takeProbe(probe: NativeImage): void {
  const raw = probe.takeRaw()
  raw.dispose()
}

describe("fitImageToPlacement", () => {
  test("contain-fits without upscaling and skips near-fit downscales", () => {
    expect(fitImageToPlacement(80, 40, 4, 1, 10, 20)).toEqual({ width: 40, height: 20 })
    expect(fitImageToPlacement(40, 20, 4, 1, 10, 20)).toBeNull()
    expect(fitImageToPlacement(44, 22, 4, 1, 10, 20)).toBeNull()
    expect(fitImageToPlacement(48, 24, 4, 1, 10, 20)).toEqual({ width: 40, height: 20 })
    expect(fitImageToPlacement(1000, 2, 1, 1, 10, 20)).toEqual({ width: 10, height: 1 })
  })
})

describe("TexRenderable", () => {
  test("binding updates apply streaming before formula regardless of prop order", async () => {
    const { renderer, flush, captureCharFrame } = await createTestRenderer({ width: 20, height: 4 })
    const requests: Array<{ formula: string; foreground: string; display: boolean }> = []
    let resolveFinal!: () => void
    const backend: TexBackend = {
      async render(request) {
        requests.push({ formula: request.formula, foreground: request.foreground, display: request.display })
        if (request.formula === String.raw`\frac`) await new Promise<void>((resolve) => { resolveFinal = resolve })
        return { kind: "unicode", text: request.formula, columns: 1, rows: 1 }
      },
    }
    const tex = new BindingTexRenderable(renderer, { id: "tex" } as TexRenderableOptions)
    renderer.root.add(tex)
    tex.width = 10
    tex.height = 4
    tex.formula = String.raw`\frac`
    tex.foreground = "#ffffff"
    tex.background = "#000000"
    Object.assign(tex, { backend })
    tex.display = true
    tex.streaming = true
    await tex.whenReady()
    await flush()
    expect(requests).toEqual([])
    expect(captureCharFrame()).toContain("□")
    expect(tex.width).toBe(10)
    expect(tex.height).toBe(4)
    Reflect.set(tex, "width", null)
    Reflect.set(tex, "height", null)
    await flush()
    expect(tex.width).toBe(3)
    expect(tex.height).toBe(3)

    tex.foreground = "#ff0000"
    tex.streaming = false
    const ready = tex.ready
    let settled = false
    void ready.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBeFalse()
    resolveFinal()
    await ready

    tex.foreground = "#00ff00"
    Reflect.set(tex, "display", null)
    tex.formula = "q"
    await tex.ready
    expect(requests).toEqual([
      { formula: String.raw`\frac`, foreground: "#ff0000", display: true },
      { formula: "q", foreground: "#00ff00", display: false },
    ])

    tex.formula = "x^"
    tex.streaming = true
    await tex.whenReady()
    Reflect.set(tex, "formula", null)
    await tex.whenReady()
    expect(tex.formula).toBe("")
    Reflect.set(tex, "streaming", null)
    await tex.whenReady()
    expect(tex.streaming).toBeFalse()
    renderer.destroy()
  })

  test("renders incomplete streaming snapshots without calling the primary backend", async () => {
    const { renderer, flush, captureCharFrame } = await createTestRenderer({ width: 20, height: 6 })
    const requests: string[] = []
    const tex = new TexRenderable(renderer, {
      formula: String.raw`\frac`,
      foreground: "#ffffff",
      background: "#000000",
      streaming: true,
      backend: { async render(request) { requests.push(request.formula); return { kind: "unicode", text: "backend", columns: 7, rows: 1 } } },
    })
    renderer.root.add(tex)
    await tex.whenReady()
    await flush()
    expect(captureCharFrame()).toContain("□")
    tex.formula = String.raw`\frac{1}{`
    await tex.whenReady()
    await flush()
    expect(captureCharFrame()).toContain("1")
    expect(tex.formula).toBe(String.raw`\frac{1}{`)
    expect(requests).toEqual([])
    renderer.destroy()
  })

  test("shows the tail of unrecoverable and oversized streaming source", async () => {
    const { renderer, flush, captureCharFrame } = await createTestRenderer({ width: 8, height: 2 })
    let calls = 0
    const tex = new TexRenderable(renderer, {
      formula: "abcdefghijk}",
      foreground: "#ffffff",
      background: "#000000",
      widthMax: 4,
      heightMax: 2,
      streaming: true,
      backend: { async render() { calls++; return { kind: "unicode", text: "backend", columns: 7, rows: 1 } } },
    })
    renderer.root.add(tex)
    await flush()
    expect(captureCharFrame()).toContain("ijk}")
    tex.formula += "Z"
    await flush()
    expect(captureCharFrame()).toContain("Z")

    tex.formula = "a".repeat(4097)
    await tex.whenReady()
    await flush()
    expect(captureCharFrame()).toContain("aaaa")
    expect(calls).toBe(0)

    tex.formula = "}" + "a".repeat(100) + "👨‍👩‍👧‍👦"
    await flush()
    expect(captureCharFrame()).toContain("👨‍👩‍👧‍👦")

    tex.formula = "}x" + "\u0301".repeat(200)
    await flush()
    expect(captureCharFrame()).toContain("?")

    tex.formula = "\u0301"
    await flush()
    expect(captureCharFrame()).toContain("?")
    renderer.destroy()
  })

  test("does not emit a grapheme fragment when the bounded raw tail starts inside one", async () => {
    const { renderer, flush, captureCharFrame } = await createTestRenderer({ width: 3, height: 1 })
    const tex = new TexRenderable(renderer, {
      formula: "}" + "a".repeat(100) + "👨‍👩‍👧‍👦",
      foreground: "#ffffff",
      background: "#000000",
      widthMax: 3,
      heightMax: 1,
      streaming: true,
      backend: { async render() { throw new Error("primary backend must not run") } },
    })
    renderer.root.add(tex)
    await flush()
    expect(captureCharFrame()).toContain("?")
    expect(captureCharFrame()).not.toContain("👧‍👦")
    renderer.destroy()
  })

  test("finalizes the exact latest snapshot and follows the final request", async () => {
    const { renderer } = await createTestRenderer({ width: 20, height: 4 })
    const requests: string[] = []
    let resolve!: () => void
    const tex = new TexRenderable(renderer, {
      formula: "x^",
      foreground: "#ffffff",
      background: "#000000",
      streaming: true,
      backend: {
        async render(request) {
          requests.push(request.formula)
          await new Promise<void>((done) => { resolve = done })
          return { kind: "unicode", text: request.formula, columns: 2, rows: 1 }
        },
      },
    })
    renderer.root.add(tex)
    tex.formula = "x^2"
    tex.streaming = false
    const ready = tex.whenReady()
    let settled = false
    void ready.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBeFalse()
    expect(requests).toEqual(["x^2"])
    resolve()
    await ready
    tex.streaming = false
    expect(requests).toEqual(["x^2"])
    tex.streaming = true
    tex.formula = "y^"
    await tex.whenReady()
    expect(requests).toEqual(["x^2"])
    renderer.destroy()
  })

  test("finalizing an empty stream stays blank and skips the backend", async () => {
    const { renderer } = await createTestRenderer({ width: 20, height: 4 })
    let calls = 0
    const tex = new TexRenderable(renderer, {
      formula: "",
      foreground: "#ffffff",
      background: "#000000",
      streaming: true,
      backend: { async render() { calls++; return { kind: "unicode", text: "backend", columns: 7, rows: 1 } } },
    })
    renderer.root.add(tex)
    tex.streaming = false
    await tex.whenReady()
    expect(calls).toBe(0)
    expect(tex.getChildren()).toHaveLength(0)
    renderer.destroy()
  })

  test("enabling streaming aborts a primary request and disposes its late image", async () => {
    const { renderer } = await createTestRenderer({ width: 10, height: 4 })
    let requestSignal!: AbortSignal
    let resolve!: (output: Awaited<ReturnType<TexBackend["render"]>>) => void
    const tex = new TexRenderable(renderer, {
      formula: "x",
      foreground: "#ffffff",
      background: "#000000",
      backend: {
        render(request) {
          requestSignal = request.signal
          return new Promise((done) => { resolve = done })
        },
      },
    })
    renderer.root.add(tex)
    const staleReady = tex.ready
    const waiting = tex.whenReady()
    tex.streaming = true
    await waiting
    expect(requestSignal.aborted).toBeTrue()
    const stale = imageOutput(8)
    resolve(stale.output)
    await staleReady
    takeProbe(stale.probe)
    tex.destroyRecursively()
    renderer.destroy()
  })

  test("shows Unicode while an asynchronous backend is pending", async () => {
    const { renderer, flush, captureCharFrame } = await createTestRenderer({ width: 20, height: 6 })
    let resolve!: (output: Awaited<ReturnType<TexBackend["render"]>>) => void
    const backend: TexBackend = {
      render: () => new Promise((done) => { resolve = done }),
    }
    const tex = new TexRenderable(renderer, {
      formula: String.raw`\frac{1}{2}`,
      foreground: "#ffffff",
      background: "#000000",
      backend,
    })
    renderer.root.add(tex)
    await flush()
    expect(captureCharFrame()).toContain("1")
    expect(captureCharFrame()).toContain("─")
    resolve({ kind: "unicode", text: "upgraded", columns: 8, rows: 1 })
    await tex.whenReady()
    await flush()
    expect(captureCharFrame()).toContain("upgraded")
    renderer.destroy()
  })

  test("renders backend-neutral Unicode output", async () => {
    const { renderer, flush, captureCharFrame } = await createTestRenderer({ width: 20, height: 4 })
    const backend: TexBackend = {
      async render(request) {
        return { kind: "unicode", text: request.formula === "sqrt(x)" ? "√x" : request.formula, columns: 2, rows: 1 }
      },
    }
    const tex = new TexRenderable(renderer, {
      formula: "sqrt(x)",
      foreground: "#ffffff",
      background: "#000000",
      backend,
    })
    renderer.root.add(tex)
    await tex.ready
    await flush()
    expect(tex.getChildren()[0]).toBeInstanceOf(TextRenderable)
    expect(captureCharFrame()).toContain("√x")
    tex.formula = "Σx"
    await tex.ready
    await flush()
    expect(captureCharFrame()).toContain("Σx")
    renderer.destroy()
  })

  test("replaces a pending update when reverting to the current formula", async () => {
    const { renderer, flush, captureCharFrame } = await createTestRenderer({ width: 20, height: 4 })
    const requests: string[] = []
    const backend: TexBackend = {
      async render(request) {
        requests.push(request.formula)
        if (request.formula === "B") {
          await new Promise<void>((_, reject) => request.signal.addEventListener("abort", () => reject(request.signal.reason), { once: true }))
        }
        return { kind: "unicode", text: request.formula, columns: 1, rows: 1 }
      },
    }
    const tex = new TexRenderable(renderer, {
      formula: "A",
      foreground: "#ffffff",
      background: "#000000",
      backend,
    })
    renderer.root.add(tex)
    await tex.ready
    tex.formula = "B"
    tex.formula = "A"
    await tex.ready
    await flush()
    expect(requests).toEqual(["A", "B", "A"])
    expect(captureCharFrame()).toContain("A")
    renderer.destroy()
  })

  test("installs error output before notifying an observer", async () => {
    const { renderer } = await createTestRenderer({ width: 40, height: 4 })
    const backend: TexBackend = { render: async () => { throw new Error("invalid formula") } }
    const tex = new TexRenderable(renderer, {
      formula: "x}",
      foreground: "#ffffff",
      background: "#000000",
      backend,
      onError: () => { throw new Error("observer failed") },
    })
    renderer.root.add(tex)
    await expect(tex.ready).rejects.toThrow("observer failed")
    expect(tex.getChildren()[0]).toBeInstanceOf(TextRenderable)
    renderer.destroy()
  })

  test("supports Unicode and retained-output fallbacks", async () => {
    const { renderer, flush, captureCharFrame } = await createTestRenderer({ width: 30, height: 4 })
    const unicode = new TexRenderable(renderer, {
      formula: "x^2",
      foreground: "#ffffff",
      background: "#000000",
      fallback: "unicode",
      backend: { render: async () => { throw new Error("native unavailable") } },
    })
    renderer.root.add(unicode)
    await unicode.whenReady()
    await flush()
    expect(captureCharFrame()).toContain("x²")
    unicode.destroyRecursively()

    const backend: TexBackend = {
      async render(request) {
        if (request.formula === "bad") throw new Error("temporary failure")
        return { kind: "unicode", text: "committed", columns: 9, rows: 1 }
      },
    }
    const retained = new TexRenderable(renderer, {
      formula: "good",
      foreground: "#ffffff",
      background: "#000000",
      fallback: "retain",
      backend,
    })
    renderer.root.add(retained)
    await retained.whenReady()
    retained.formula = "bad"
    await retained.whenReady()
    await flush()
    expect(captureCharFrame()).toContain("committed")
    renderer.destroy()
  })

  test("whenReady follows the latest request", async () => {
    const { renderer } = await createTestRenderer({ width: 20, height: 4 })
    const resolvers = new Map<string, () => void>()
    const backend: TexBackend = {
      async render(request) {
        await new Promise<void>((resolve) => resolvers.set(request.formula, resolve))
        return { kind: "unicode", text: request.formula, columns: 1, rows: 1 }
      },
    }
    const tex = new TexRenderable(renderer, {
      formula: "A",
      foreground: "#ffffff",
      background: "#000000",
      backend,
    })
    renderer.root.add(tex)
    tex.formula = "B"
    const ready = tex.whenReady()
    tex.formula = "C"
    resolvers.get("B")?.()
    let settled = false
    void ready.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBeFalse()
    resolvers.get("C")?.()
    await ready
    renderer.destroy()
  })

  test("creates an ImageRenderable child that renders the supplied pixels", async () => {
    const { renderer } = await createTestRenderer({ width: 10, height: 4 })
    const rendered = imageOutput(10)
    const tex = new TexRenderable(renderer, {
      formula: "x",
      foreground: "#ffffff",
      background: "#000000",
      backend: { render: async () => rendered.output },
    })
    renderer.root.add(tex)
    await tex.ready
    const child = tex.getChildren()[0]
    expect(child).toBeInstanceOf(ImageRenderable)
    await (child as ImageRenderable).loadPromise
    expect([...(child as ImageRenderable).image!.raw().data]).toEqual([10, 20, 30, 255])
    renderer.destroy()
    takeProbe(rendered.probe)
  })

  test("downscales an oversized image to the placement pixel size", async () => {
    const { renderer } = await createTestRenderer({ width: 20, height: 6 })
    Object.defineProperty(renderer, "resolution", { value: { width: 200, height: 120 } })
    const rendered = imageOutput(255, 80, 40)
    const tex = new TexRenderable(renderer, {
      formula: "x",
      foreground: "#ffffff",
      background: "#000000",
      backend: { render: async () => rendered.output },
    })
    renderer.root.add(tex)
    await tex.ready
    const child = tex.getChildren()[0]
    expect(child).toBeInstanceOf(ImageRenderable)
    await (child as ImageRenderable).loadPromise
    // placement is 4x1 cells at 10x20 px per cell => 40x20 box; 80x40 contain-fits to 40x20
    const image = (child as ImageRenderable).image!
    expect(image.width).toBe(40)
    expect(image.height).toBe(20)
    takeProbe(rendered.probe)
    const resizedProbe = image.retain()
    tex.destroyRecursively()
    takeProbe(resizedProbe)
    renderer.destroy()
  })

  test("attaches a PNG encoding only on kitty-capable terminals", async () => {
    const encodeSpy = spyOn(NativeImage.prototype, "ensureEncodedPng")
    try {
      const { renderer } = await createTestRenderer({ width: 10, height: 4 })
      const outputs: ReturnType<typeof imageOutput>[] = []
      const backend: TexBackend = {
        async render() {
          const rendered = imageOutput(7)
          outputs.push(rendered)
          return rendered.output
        },
      }
      const tex = new TexRenderable(renderer, {
        formula: "x",
        foreground: "#ffffff",
        background: "#000000",
        backend,
      })
      renderer.root.add(tex)
      await tex.ready
      expect(encodeSpy).not.toHaveBeenCalled()

      Object.defineProperty(renderer, "capabilities", { value: { kitty_graphics: true } })
      tex.formula = "y"
      await tex.ready
      expect(encodeSpy).toHaveBeenCalledTimes(1)
      tex.destroyRecursively()
      for (const rendered of outputs) takeProbe(rendered.probe)
      renderer.destroy()
    } finally {
      encodeSpy.mockRestore()
    }
  })

  test("keeps the original image when pixel resolution is unavailable", async () => {
    const { renderer } = await createTestRenderer({ width: 20, height: 6 })
    expect(renderer.resolution).toBeNull()
    const rendered = imageOutput(255, 80, 40)
    const tex = new TexRenderable(renderer, {
      formula: "x",
      foreground: "#ffffff",
      background: "#000000",
      backend: { render: async () => rendered.output },
    })
    renderer.root.add(tex)
    await tex.ready
    const child = tex.getChildren()[0]
    expect(child).toBeInstanceOf(ImageRenderable)
    await (child as ImageRenderable).loadPromise
    const image = (child as ImageRenderable).image!
    expect(image.width).toBe(80)
    expect(image.height).toBe(40)
    expect(() => rendered.probe.takeRaw()).toThrow("native buffers retain the image")
    tex.destroyRecursively()
    takeProbe(rendered.probe)
    renderer.destroy()
  })

  test("replacing the formula releases the previous image", async () => {
    const { renderer } = await createTestRenderer({ width: 10, height: 4 })
    const outputs = new Map<string, ReturnType<typeof imageOutput>>()
    const backend: TexBackend = {
      async render(request) {
        const rendered = imageOutput(request.formula === "A" ? 1 : 2)
        outputs.set(request.formula, rendered)
        return rendered.output
      },
    }
    const tex = new TexRenderable(renderer, {
      formula: "A",
      foreground: "#ffffff",
      background: "#000000",
      backend,
    })
    renderer.root.add(tex)
    await tex.ready
    tex.formula = "B"
    await tex.ready

    takeProbe(outputs.get("A")!.probe)
    renderer.destroy()
    takeProbe(outputs.get("B")!.probe)
  })

  test("destroying TexRenderable releases the current image", async () => {
    const { renderer } = await createTestRenderer({ width: 10, height: 4 })
    const rendered = imageOutput(3)
    const tex = new TexRenderable(renderer, {
      formula: "x",
      foreground: "#ffffff",
      background: "#000000",
      backend: { render: async () => rendered.output },
    })
    renderer.root.add(tex)
    await tex.ready
    tex.destroyRecursively()
    takeProbe(rendered.probe)
    renderer.destroy()
  })

  test("disposes an image returned by a stale backend request", async () => {
    const { renderer } = await createTestRenderer({ width: 10, height: 4 })
    const resolvers = new Map<string, (output: Awaited<ReturnType<TexBackend["render"]>>) => void>()
    const backend: TexBackend = {
      render: (request) => new Promise((resolve) => resolvers.set(request.formula, resolve)),
    }
    const tex = new TexRenderable(renderer, {
      formula: "A",
      foreground: "#ffffff",
      background: "#000000",
      backend,
    })
    renderer.root.add(tex)
    const staleReady = tex.ready
    tex.formula = "B"
    const current = imageOutput(5)
    resolvers.get("B")!(current.output)
    await tex.ready
    const stale = imageOutput(4)
    resolvers.get("A")!(stale.output)
    await staleReady

    takeProbe(stale.probe)
    renderer.destroy()
    takeProbe(current.probe)
  })

  test("retain fallback keeps its image after a later backend error", async () => {
    const { renderer } = await createTestRenderer({ width: 10, height: 4 })
    const rendered = imageOutput(6)
    const backend: TexBackend = {
      async render(request) {
        if (request.formula === "bad") throw new Error("temporary failure")
        return rendered.output
      },
    }
    const tex = new TexRenderable(renderer, {
      formula: "good",
      foreground: "#ffffff",
      background: "#000000",
      fallback: "retain",
      backend,
      onError: () => { throw new Error("observer failed") },
    })
    renderer.root.add(tex)
    await tex.ready
    tex.formula = "bad"
    await expect(tex.ready).rejects.toThrow("observer failed")
    const child = tex.getChildren()[0]
    expect(child).toBeInstanceOf(ImageRenderable)
    await (child as ImageRenderable).loadPromise
    expect(() => rendered.probe.takeRaw()).toThrow("native buffers retain the image")

    tex.destroyRecursively()
    takeProbe(rendered.probe)
    renderer.destroy()
  })
})
