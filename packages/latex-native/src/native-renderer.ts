import { isMainThread } from "node:worker_threads"
import { NativeImage } from "@opentui/core"
import { openNativeLibrary, type NativeSymbols, type Pointer } from "./ffi.js"
import { resolveNativeLibrary } from "./platform.js"

const CACHE_ENTRIES_MAX = 64
const QUEUE_ENTRIES_MAX = 128
const SOURCE_SIZE_MAX = 4096
const STATUS_MESSAGES = [
  "ok",
  "invalid native renderer argument",
  "invalid TeX formula",
  "invalid SVG output",
  "rendered dimensions exceed limits",
  "native renderer ran out of memory",
  "internal native renderer error",
] as const

let nativePromise: Promise<ReturnType<typeof openNativeLibrary>> | undefined

async function getNative(): Promise<ReturnType<typeof openNativeLibrary>> {
  nativePromise ??= resolveNativeLibrary().then((path) => {
    const loaded = openNativeLibrary(path)
    const status = loaded.symbols.texInit()
    if (status !== 0) throw new Error(STATUS_MESSAGES[status] ?? `Native renderer initialization failed with status ${status}`)
    return loaded
  }).catch((error) => {
    nativePromise = undefined
    throw error
  })
  return nativePromise
}

function rgb(hex: string): Uint8Array {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`Invalid RGB color: ${hex}`)
  return Uint8Array.of(Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16))
}

function copyResult(symbols: NativeSymbols, toArrayBuffer: (pointer: Pointer, length: number) => ArrayBuffer, handle: Pointer): NativeImage {
  const status = symbols.texResultStatus(handle)
  if (status !== 0) throw new Error(STATUS_MESSAGES[status] ?? `Native renderer failed with status ${status}`)
  const pixelsPointer = symbols.texResultPixels(handle)
  const pixelsLength = symbols.texResultPixelsLength(handle)
  const width = symbols.texResultWidth(handle)
  const height = symbols.texResultHeight(handle)
  if (!pixelsPointer || width === 0 || height === 0) throw new Error("Native renderer returned an empty image")
  const expectedLength = width * height * 4
  if (pixelsLength !== expectedLength) throw new Error("Native renderer returned an invalid pixel length")
  const pixels = new Uint8Array(toArrayBuffer(pixelsPointer, pixelsLength))
  return NativeImage.fromRgba(pixels, width, height, width * 4)
}

export class NativeTexRenderer {
  private readonly cache = new Map<string, NativeImage>()
  private readonly queue: Array<{
    formula: string
    display: boolean
    foreground: string
    background: string
    signal?: AbortSignal
    resolve: (image: NativeImage) => void
    reject: (error: unknown) => void
  }> = []
  private queueTimer: ReturnType<typeof setTimeout> | null = null
  private rendering = false
  private destroyed = false

  constructor() {
    if (!isMainThread) throw new Error("NativeTexRenderer is single-threaded and must be loaded on the main thread")
  }

  async renderAsync(formula: string, display: boolean, foreground: string, background: string, signal?: AbortSignal): Promise<NativeImage> {
    if (this.destroyed) throw new Error("Native renderer is destroyed")
    if (signal?.aborted) throw signal.reason ?? new Error("Native render cancelled")
    const key = `${display ? "D" : "I"}\0${foreground}\0${background}\0${formula}`
    const cached = this.getCached(key)
    if (cached) return cached
    this.discardAbortedJobs()
    if (this.queue.length >= QUEUE_ENTRIES_MAX) throw new Error(`Native render queue exceeds ${QUEUE_ENTRIES_MAX} formulas`)
    const promise = new Promise<NativeImage>((resolve, reject) => {
      this.queue.push({ formula, display, foreground, background, signal, resolve, reject })
    })
    this.scheduleQueue()
    return promise
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    if (this.queueTimer) clearTimeout(this.queueTimer)
    this.queueTimer = null
    for (const job of this.queue.splice(0)) job.reject(new Error("Native renderer is destroyed"))
    for (const image of this.cache.values()) image.dispose()
    this.cache.clear()
  }

  private async renderSync(formula: string, display: boolean, foreground: string, background: string, signal?: AbortSignal): Promise<NativeImage> {
    if (this.destroyed) throw new Error("Native renderer is destroyed")
    const key = `${display ? "D" : "I"}\0${foreground}\0${background}\0${formula}`
    const cached = this.getCached(key)
    if (cached) return cached
    const source = new TextEncoder().encode(formula)
    if (source.byteLength === 0 || source.byteLength > SOURCE_SIZE_MAX) throw new Error(`Formula must contain between 1 and ${SOURCE_SIZE_MAX} UTF-8 bytes`)
    const foregroundRgb = rgb(foreground)
    const backgroundRgb = rgb(background)
    const library = await getNative()
    if (this.destroyed) throw new Error("Native renderer is destroyed")
    if (signal?.aborted) throw signal.reason ?? new Error("Native render cancelled")
    const handle = library.symbols.texRender(source, source.byteLength, display ? 1 : 0, foregroundRgb, backgroundRgb)
    if (!handle) throw new Error("Native renderer could not allocate a result")
    let image: NativeImage
    try {
      image = copyResult(library.symbols, library.toArrayBuffer, handle)
    } finally {
      library.symbols.texResultDestroy(handle)
    }
    if (this.destroyed || signal?.aborted) {
      image.dispose()
      if (this.destroyed) throw new Error("Native renderer is destroyed")
      throw signal?.reason ?? new Error("Native render cancelled")
    }
    this.cache.set(key, image)
    if (this.cache.size > CACHE_ENTRIES_MAX) {
      const [oldest, evicted] = this.cache.entries().next().value!
      this.cache.delete(oldest)
      evicted.dispose()
    }
    return image.retain()
  }

  private getCached(key: string): NativeImage | null {
    const image = this.cache.get(key)
    if (!image) return null
    this.cache.delete(key)
    this.cache.set(key, image)
    return image.retain()
  }

  private scheduleQueue(): void {
    if (this.queueTimer || this.rendering || this.queue.length === 0) return
    this.queueTimer = setTimeout(() => {
      this.queueTimer = null
      const job = this.queue.shift()
      if (!job) return
      if (job.signal?.aborted) job.reject(job.signal.reason ?? new Error("Native render cancelled"))
      else {
        this.rendering = true
        void this.renderSync(job.formula, job.display, job.foreground, job.background, job.signal).then(job.resolve, job.reject).finally(() => {
          this.rendering = false
          this.scheduleQueue()
        })
        return
      }
      this.scheduleQueue()
    }, 0)
  }

  private discardAbortedJobs(): void {
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      const job = this.queue[index]
      if (!job.signal?.aborted) continue
      this.queue.splice(index, 1)
      job.reject(job.signal.reason ?? new Error("Native render cancelled"))
    }
  }
}
