#!/usr/bin/env bun
// Headless performance probe for the demo app. Drives the real LatexApp with
// synthetic key events and attributes slow frames to instrumented stages.
// Run inside a pty with OPENTUI_GRAPHICS=true OPENTUI_IMAGE_PROTOCOL=kitty.

import { appendFileSync, writeFileSync } from "node:fs"
import { createCliRenderer, type KeyEvent, NativeImage } from "@opentui/core"
import { NativeTexRenderer } from "@simonklee/opentui-tex-native"
import { TexRenderable } from "../src/index.js"
import { resolveTheme } from "../src/theme.js"
import { LatexApp } from "./app.js"

const OUT = process.env.TEX_PERF_OUT ?? "/tmp/tex-perf.jsonl"
const SCROLL_HZ = 30
const FRAME_BUDGET_MS = 1000 / 60

interface Probe {
  t: number
  kind: string
  ms: number
  detail?: string
}

const probes: Probe[] = []
const frames: Array<{ t: number; ms: number; phase: string }> = []
let phase = "startup"

function patch(target: object, method: string, kind: string): void {
  const original = (target as Record<string, (...args: unknown[]) => unknown>)[method]
  ;(target as Record<string, unknown>)[method] = function (this: unknown, ...args: unknown[]) {
    const start = performance.now()
    const result = original.apply(this, args)
    if (result instanceof Promise) {
      return result.finally(() => probes.push({ t: start, kind, ms: performance.now() - start }))
    }
    probes.push({ t: start, kind, ms: performance.now() - start })
    return result
  }
}

patch(NativeTexRenderer.prototype, "renderSync", "texRender")
patch(TexRenderable.prototype, "applyOutput", "applyOutput")
patch(TexRenderable.prototype, "createImageChild", "createImageChild")

// A/B switches: disable individual optimizations to measure their contribution.
if (process.env.TEX_PERF_NO_PNG) {
  ;(NativeImage.prototype as unknown as Record<string, unknown>).ensureEncodedPng = () => {}
}
if (process.env.TEX_PERF_NO_RESIZE) {
  ;(TexRenderable.prototype as unknown as Record<string, unknown>).resizeToPlacement = () => null
}

function key(name: string, options: { ctrl?: boolean; shift?: boolean } = {}): KeyEvent {
  return { eventType: "press", name, ctrl: options.ctrl ?? false, shift: options.shift ?? false, sequence: name, preventDefault() {}, defaultPrevented: false } as unknown as KeyEvent
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function summarize(label: string): string {
  const samples = frames.filter((frame) => frame.phase === label).map((frame) => frame.ms).sort((a, b) => a - b)
  if (samples.length === 0) return `${label}: no frames`
  const over16 = samples.filter((ms) => ms > FRAME_BUDGET_MS).length
  const over33 = samples.filter((ms) => ms > 2 * FRAME_BUDGET_MS).length
  const pick = (q: number) => samples[Math.min(samples.length - 1, Math.floor(q * samples.length))].toFixed(1)
  const avg = samples.reduce((sum, ms) => sum + ms, 0) / samples.length
  return `${label}: n=${samples.length} avg=${avg.toFixed(1)} p50=${pick(0.5)} p95=${pick(0.95)} max=${pick(1)} >16.7ms=${over16} >33ms=${over33}`
}

function slowFrames(label: string): string[] {
  return frames
    .filter((frame) => frame.phase === label && frame.ms > FRAME_BUDGET_MS)
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 10)
    .map((frame) => {
      const windowStart = frame.t - frame.ms
      const inside = probes
        .filter((probe) => probe.t >= windowStart - 1 && probe.t <= frame.t + 1)
        .map((probe) => `${probe.kind}=${probe.ms.toFixed(1)}ms`)
        .join(" ")
      return `  ${frame.ms.toFixed(1)}ms frame [${inside || "unattributed"}]`
    })
}

async function main(): Promise<void> {
  writeFileSync(OUT, "")
  const renderer = await createCliRenderer({ exitOnCtrlC: false, targetFps: 60, gatherStats: true })
  renderer.start()
  const columns = renderer.width
  const rows = renderer.height
  ;(renderer as unknown as { _resolution: { width: number; height: number } })._resolution = { width: columns * 10, height: rows * 20 }
  const theme = await resolveTheme(renderer)
  const app = new LatexApp(renderer, theme)
  renderer.on("frame", () => {
    const stats = renderer.getStats()
    const ms = stats.frameTimes[stats.frameTimes.length - 1]
    if (ms !== undefined) frames.push({ t: performance.now(), ms, phase })
  })

  await sleep(700)
  renderer.keyInput.emit("keypress", key("space"))
  await sleep(300)

  const scroll = async (count: number) => {
    for (let index = 0; index < count; index += 1) {
      renderer.keyInput.emit("keypress", key("j"))
      await sleep(1000 / SCROLL_HZ)
    }
  }

  phase = "A-unicode-scroll"
  await scroll(90)
  renderer.keyInput.emit("keypress", key("g"))
  await sleep(300)

  phase = "B-native-toggle-scroll"
  renderer.keyInput.emit("keypress", key("u", { ctrl: true }))
  await scroll(240)

  renderer.keyInput.emit("keypress", key("g"))
  await sleep(1_000)
  phase = "C-native-steady-scroll"
  await scroll(240)

  phase = "done"
  const nativeStats = renderer.getStats()
  const lines = [
    summarize("A-unicode-scroll"),
    summarize("B-native-toggle-scroll"),
    ...slowFrames("B-native-toggle-scroll"),
    summarize("C-native-steady-scroll"),
    ...slowFrames("C-native-steady-scroll"),
    `native: renderTime=${((nativeStats.nativeRenderTime ?? 0) / 1000).toFixed(2)}ms write=${((nativeStats.nativeStdoutWriteTime ?? 0) / 1000).toFixed(2)}ms cells=${nativeStats.cellsUpdated ?? 0}`,
    `probe totals: ${["texRender", "applyOutput", "createImageChild"].map((kind) => `${kind}=${probes.filter((probe) => probe.kind === kind).reduce((sum, probe) => sum + probe.ms, 0).toFixed(0)}ms/${probes.filter((probe) => probe.kind === kind).length}calls`).join(" ")}`,
  ]
  appendFileSync(OUT, lines.join("\n") + "\n")
  app.shutdown()
  renderer.destroy()
  process.exit(0)
}

await main()
