import { NativeImage } from "@opentui/core"
import { describe, expect, test } from "bun:test"
import { NativeTexRenderer } from "./native-renderer.js"

describe("NativeTexRenderer", () => {
  test("does not load a native package until rendering starts", () => {
    const renderer = new NativeTexRenderer()
    renderer.destroy()
  })

  test("rejects an already aborted render without loading native code", async () => {
    const renderer = new NativeTexRenderer()
    const controller = new AbortController()
    controller.abort(new Error("cancelled"))
    await expect(renderer.renderAsync("x", false, "#ffffff", "#000000", controller.signal)).rejects.toThrow("cancelled")
    renderer.destroy()
  })

  test("rejects queued work when destroyed", async () => {
    const renderer = new NativeTexRenderer()
    const pending = renderer.renderAsync("x", false, "#ffffff", "#000000")
    renderer.destroy()
    await expect(pending).rejects.toThrow("destroyed")
  })

  test("renders an owned NativeImage through the selected platform package", async () => {
    const renderer = new NativeTexRenderer()
    const image = await renderer.renderAsync(String.raw`\frac{1}{\sqrt{x}} < 2`, true, "#172033", "#f4f0e7")
    try {
      expect(image).toBeInstanceOf(NativeImage)
      expect(image.width).toBeGreaterThan(1)
      expect(image.height).toBeGreaterThan(1)
      expect(image.info().format).toBe("raw-rgba")
    } finally {
      image.dispose()
      renderer.destroy()
    }
  })

  test("returns independently disposable references for cached results", async () => {
    const renderer = new NativeTexRenderer()
    const first = await renderer.renderAsync("x^2", false, "#ffffff", "#000000")
    const second = await renderer.renderAsync("x^2", false, "#ffffff", "#000000")
    expect(second).not.toBe(first)
    first.dispose()
    try {
      expect(second.info().format).toBe("raw-rgba")
    } finally {
      second.dispose()
      renderer.destroy()
    }
  })

  test("rejects rather than throwing when a cached retain fails", async () => {
    const renderer = new NativeTexRenderer()
    const image = await renderer.renderAsync("retain_failure", false, "#ffffff", "#000000")
    image.dispose()
    const originalRetain = NativeImage.prototype.retain
    NativeImage.prototype.retain = () => { throw new Error("retain failed") }
    try {
      const pending = renderer.renderAsync("retain_failure", false, "#ffffff", "#000000")
      expect(pending).toBeInstanceOf(Promise)
      await expect(pending).rejects.toThrow("retain failed")
    } finally {
      NativeImage.prototype.retain = originalRetain
      renderer.destroy()
    }
  })

  test("destroying the renderer preserves caller-owned references", async () => {
    const renderer = new NativeTexRenderer()
    const image = await renderer.renderAsync("x+1", false, "#ffffff", "#000000")
    renderer.destroy()
    try {
      expect(image.width).toBeGreaterThan(0)
      expect(image.info().format).toBe("raw-rgba")
    } finally {
      image.dispose()
    }
  })

  test("cache eviction disposes only the cache reference", async () => {
    const renderer = new NativeTexRenderer()
    const first = await renderer.renderAsync("q_0", false, "#ffffff", "#000000")
    for (let index = 1; index <= 64; index += 1) {
      const image = await renderer.renderAsync(`q_${index}`, false, "#ffffff", "#000000")
      image.dispose()
    }
    const raw = first.takeRaw()
    raw.dispose()
    renderer.destroy()
  })

  test("a cancelled cache request does not retain an image", async () => {
    const renderer = new NativeTexRenderer()
    const image = await renderer.renderAsync("c_0", false, "#ffffff", "#000000")
    const controller = new AbortController()
    controller.abort(new Error("cancelled"))
    await expect(renderer.renderAsync("c_0", false, "#ffffff", "#000000", controller.signal)).rejects.toThrow("cancelled")
    renderer.destroy()
    const raw = image.takeRaw()
    raw.dispose()
  })

  test("cancellation after native image creation releases the new image", async () => {
    const renderer = new NativeTexRenderer()
    const originalFromRgba = NativeImage.fromRgba
    const controller = new AbortController()
    let probe: NativeImage | undefined
    NativeImage.fromRgba = (...arguments_: Parameters<typeof NativeImage.fromRgba>) => {
      const image = originalFromRgba(...arguments_)
      probe = image.retain()
      controller.abort(new Error("cancelled after rendering"))
      return image
    }

    try {
      await expect(renderer.renderAsync("cancel_after_render", false, "#ffffff", "#000000", controller.signal)).rejects.toThrow("cancelled after rendering")
    } finally {
      NativeImage.fromRgba = originalFromRgba
      renderer.destroy()
    }
    const raw = probe!.takeRaw()
    raw.dispose()
  })

  test("yields between uncached formulas", async () => {
    const renderer = new NativeTexRenderer()
    const order: string[] = []
    const first = renderer.renderAsync("q_1 + 12345", false, "#ffffff", "#000000").then((image) => {
      image.dispose()
      order.push("first")
    })
    const second = renderer.renderAsync("q_2 + 67890", false, "#ffffff", "#000000").then((image) => {
      image.dispose()
      order.push("second")
    })
    const timer = new Promise<void>((resolve) => setTimeout(() => { order.push("timer"); resolve() }, 0))
    await Promise.all([first, second, timer])
    expect(order).toEqual(["first", "timer", "second"])
    renderer.destroy()
  })
})
