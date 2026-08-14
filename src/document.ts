export const SOURCE_LENGTH_MAX = 64 * 1024
export const FORMULA_COUNT_MAX = 128
export const FORMULA_LENGTH_MAX = 4096

export type InlineSpan =
  | { kind: "text"; value: string }
  | { kind: "math"; value: string }

export type DocumentBlock =
  | { kind: "heading"; level: 1 | 2; value: string }
  | { kind: "paragraph"; spans: InlineSpan[] }
  | { kind: "math"; value: string }

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8")
}

export function parseInline(value: string): InlineSpan[] {
  const spans: InlineSpan[] = []
  let textStart = 0
  let index = 0
  while (index < value.length) {
    if (value[index] !== "$" || value[index - 1] === "\\") {
      index += 1
      continue
    }
    let close = index + 1
    while (close < value.length && (value[close] !== "$" || value[close - 1] === "\\")) close += 1
    if (close === value.length) break
    if (index > textStart) spans.push({ kind: "text", value: value.slice(textStart, index) })
    spans.push({ kind: "math", value: value.slice(index + 1, close) })
    index = close + 1
    textStart = index
  }
  if (textStart < value.length) spans.push({ kind: "text", value: value.slice(textStart) })
  return spans.length > 0 ? spans : [{ kind: "text", value }]
}

export function parseDocument(source: string): DocumentBlock[] {
  if (byteLength(source) > SOURCE_LENGTH_MAX) throw new Error(`Source exceeds ${SOURCE_LENGTH_MAX} bytes`)
  const blocks: DocumentBlock[] = []
  const paragraph: string[] = []
  let formulaCount = 0

  const addFormula = (value: string): void => {
    const formula = value.trim()
    if (formula.length === 0) throw new Error("Empty display formula")
    if (byteLength(formula) > FORMULA_LENGTH_MAX) throw new Error(`Formula exceeds ${FORMULA_LENGTH_MAX} bytes`)
    formulaCount += 1
    if (formulaCount > FORMULA_COUNT_MAX) throw new Error(`Content exceeds ${FORMULA_COUNT_MAX} formulas`)
    blocks.push({ kind: "math", value: formula })
  }
  const flushParagraph = (): void => {
    if (paragraph.length === 0) return
    const spans = parseInline(paragraph.join(" "))
    for (const span of spans) {
      if (span.kind !== "math") continue
      if (byteLength(span.value) > FORMULA_LENGTH_MAX) throw new Error(`Formula exceeds ${FORMULA_LENGTH_MAX} bytes`)
      formulaCount += 1
    }
    if (formulaCount > FORMULA_COUNT_MAX) throw new Error(`Content exceeds ${FORMULA_COUNT_MAX} formulas`)
    blocks.push({ kind: "paragraph", spans })
    paragraph.length = 0
  }

  const lines = source.replaceAll("\r\n", "\n").split("\n")
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim()
    const singleLineDisplay = trimmed.match(/^\$\$(.+)\$\$$/)
    if (singleLineDisplay) {
      flushParagraph()
      addFormula(singleLineDisplay[1])
      continue
    }
    if (trimmed === "$$") {
      flushParagraph()
      const formula: string[] = []
      index += 1
      while (index < lines.length && lines[index].trim() !== "$$") {
        formula.push(lines[index])
        index += 1
      }
      if (index === lines.length) throw new Error(`Unclosed display formula at line ${index - formula.length}`)
      addFormula(formula.join("\n"))
      continue
    }
    if (trimmed === "") {
      flushParagraph()
      continue
    }
    const heading = trimmed.match(/^(#{1,2})\s+(.+)$/)
    if (heading) {
      flushParagraph()
      blocks.push({ kind: "heading", level: heading[1].length as 1 | 2, value: heading[2] })
    } else paragraph.push(trimmed)
  }
  flushParagraph()
  return blocks
}
