import assert from "node:assert/strict"
import { openNativeLibrary } from "../ffi.js"
import { resolveNativeLibrary } from "../platform.js"

const library = openNativeLibrary(await resolveNativeLibrary())
const { symbols } = library
assert.equal(symbols.texInit(), 0)
const foreground = Uint8Array.of(255, 255, 255)
const background = Uint8Array.of(0, 0, 0)

function render(source: string | number[], display = false, status = 0) {
  const bytes = typeof source === "string" ? new TextEncoder().encode(source) : Uint8Array.from(source)
  const result = symbols.texRender(bytes, bytes.length, Number(display), foreground, background)
  assert.ok(result)
  try {
    assert.equal(symbols.texResultStatus(result), status)
    const length = symbols.texResultPixelsLength(result)
    const pointer = symbols.texResultPixels(result)
    if (status !== 0) {
      assert.equal(length, 0)
      assert.ok(!pointer)
      return
    }
    assert.ok(pointer)
    const width = symbols.texResultWidth(result)
    const height = symbols.texResultHeight(result)
    assert.ok(width > 0 && height > 0)
    assert.equal(length, width * height * 4)
    return { width, height, pixels: Buffer.from(new Uint8Array(library.toArrayBuffer(pointer, length))) }
  } finally {
    symbols.texResultDestroy(result)
  }
}

const input = JSON.parse(process.argv[2]!) as { source: string | number[]; status: number; equivalent?: string } | "styles"
if (input === "styles") {
  const source = String.raw`\sum_{i=1}^{n}i + x^2`
  const inline = render(source)
  const display = render(source, true)
  assert.notDeepEqual(display, inline)
  assert.deepEqual(display, render(String.raw`\displaystyle ` + source))
  assert.deepEqual(inline, render(String.raw`\textstyle ` + source, true))
} else {
  const healthy = render(String.raw`\frac{1}{\sqrt{x}}`)
  for (let attempt = 0; attempt < (input.status === 0 ? 1 : 3); attempt++) {
    const result = render(input.source, false, input.status)
    if (input.equivalent !== undefined) assert.deepEqual(result, render(input.equivalent))
    assert.deepEqual(render(String.raw`\frac{1}{\sqrt{x}}`), healthy)
  }
}
