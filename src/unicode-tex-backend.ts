import type { TexBackend, TexRenderOutput, TexRenderRequest } from "./backend.js"
import { boxToString, layoutMath } from "./math-layout.js"
import { parseMath, parseMathIncomplete } from "./math-parser.js"
import stringWidth from "string-width"

export const UNICODE_TEX_SOURCE_LENGTH_MAX = 4096
const OUTPUT_LENGTH_MAX = 16384
type UnicodeTexRenderOutput = Extract<TexRenderOutput, { kind: "unicode" }>

export class UnicodeTexBackend implements TexBackend {
  renderSync(request: TexRenderRequest): UnicodeTexRenderOutput {
    return renderUnicode(request, false)
  }

  async render(request: TexRenderRequest): Promise<TexRenderOutput> {
    return this.renderSync(request)
  }
}

export function renderIncompleteUnicode(request: TexRenderRequest): UnicodeTexRenderOutput {
  return renderUnicode(request, true)
}

function renderUnicode(request: TexRenderRequest, incomplete: boolean): UnicodeTexRenderOutput {
  assertNotAborted(request.signal)
  const sourceBytes = Buffer.byteLength(request.formula, "utf8")
  if (sourceBytes === 0 || sourceBytes > UNICODE_TEX_SOURCE_LENGTH_MAX) {
    throw new Error(`TeX formula must be between 1 and ${UNICODE_TEX_SOURCE_LENGTH_MAX} UTF-8 bytes`)
  }
  if (!Number.isFinite(request.widthMax) || !Number.isFinite(request.heightMax) || request.widthMax < 1 || request.heightMax < 1) {
    throw new Error("Unicode TeX dimensions must be finite positive numbers")
  }

  const widthMax = Math.floor(request.widthMax)
  const heightMax = Math.floor(request.heightMax)
  const node = incomplete ? parseMathIncomplete(request.formula) : parseMath(request.formula)
  const text = boxToString(layoutMath(node, request.display), widthMax, heightMax)
  assertNotAborted(request.signal)
  if (!text) throw new Error("TeX formula produced no Unicode output")
  if (text.length > OUTPUT_LENGTH_MAX) throw new Error(`Unicode TeX output exceeds ${OUTPUT_LENGTH_MAX} characters`)
  const lines = text.split("\n")
  return {
    kind: "unicode",
    text,
    columns: Math.max(1, ...lines.map((line) => stringWidth(line))),
    rows: lines.length,
  }
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new Error("Unicode render cancelled")
}
