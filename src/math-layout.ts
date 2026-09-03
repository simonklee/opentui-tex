import type { MathBox, MathCell, MathEnvironment, MathNode, MathStyle, MathVariant, SymbolRole } from "./math-types.js"
import type { TexTextSpan } from "./backend.js"
import stringWidth from "string-width"
import { graphemeSegmenter } from "./math-graphemes.js"

interface LayoutContext {
  display: boolean
  style?: MathStyle
  variant?: MathVariant
}

const CELL_LIMIT = 16384
const superscript: Readonly<Record<string, string>> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ",
}
const subscript: Readonly<Record<string, string>> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎", a: "ₐ", e: "ₑ", h: "ₕ", i: "ᵢ", j: "ⱼ", k: "ₖ",
  l: "ₗ", m: "ₘ", n: "ₙ", o: "ₒ", p: "ₚ", r: "ᵣ", s: "ₛ", t: "ₜ", u: "ᵤ", v: "ᵥ", x: "ₓ",
}

export function layoutMath(node: MathNode, displayMode: boolean): MathBox {
  return layout(node, { display: displayMode })
}

export function boxToOutput(box: MathBox, widthMax: number, heightMax: number): { text: string; spans?: TexTextSpan[] } {
  const spans: TexTextSpan[] = []
  for (let y = 0; y < Math.min(box.height, heightMax); y++) {
    const line: TexTextSpan[] = []
    let width = 0
    for (let x = 0; x < box.width && width < widthMax; x++) {
      const value = box.cells[y]![x]
      const cellWidth = value ? stringWidth(value.char) : 0
      if (cellWidth === 0) { appendSpan(line, " "); width++; continue }
      if (cellWidth > widthMax) throw new Error(`Unicode glyph exceeds the ${widthMax}-column TeX width`)
      if (width + cellWidth > widthMax) break
      appendSpan(line, value!.char, value!.style)
      width += cellWidth
      x += cellWidth - 1
    }
    trimSpans(line)
    if (y) appendSpan(spans, "\n")
    for (const span of line) appendSpan(spans, span.text, span)
  }
  trimSpans(spans)
  const text = spans.map((span) => span.text).join("")
  return spans.some((span) => span.color !== undefined || span.bold !== undefined || span.italic !== undefined) ? { text, spans } : { text }
}

function appendSpan(spans: TexTextSpan[], text: string, style?: MathStyle): void {
  const last = spans.at(-1)
  if (last && last.color === style?.color && last.bold === style?.bold && last.italic === style?.italic) { last.text += text; return }
  spans.push({ ...style, text })
}

function trimSpans(spans: TexTextSpan[]): void {
  while (spans.length) {
    const last = spans.at(-1)!
    last.text = last.text.trimEnd()
    if (last.text) return
    spans.pop()
  }
}

function layout(node: MathNode, context: LayoutContext): MathBox {
  switch (node.type) {
    case "row": return layoutRow(node.body, context)
    case "symbol": case "text": case "operator": return textBox(applyVariant(node.value, context.variant), context.style)
    case "space": return blank(node.width, 1, 0)
    case "fraction": return fraction(layout(node.numerator, context), layout(node.denominator, context), node.bar, node.numeratorAlign, context.style)
    case "root": return root(layout(node.body, context), node.index ? layout(node.index, context) : undefined, context.style)
    case "scripts": return scripts(node, context)
    case "delimited": return delimited(node.left, layout(node.body, context), node.right, context.style)
    case "matrix": return matrix(node, context)
    case "accent": return accent(node.accent, layout(node.body, context), context.style)
    case "brace": return brace(layout(node.body, context), node.position, context.style)
    case "variant": return layout(node.body, { ...context, variant: node.variant, style: node.variant === "bold" ? { ...context.style, bold: true } : node.variant === "italic" ? { ...context.style, italic: true } : context.style })
    case "color": return layout(node.body, { ...context, style: { ...context.style, color: node.color } })
    case "overunder": return overUnder(layout(node.base, context), node.over ? layout(node.over, context) : undefined, node.under ? layout(node.under, context) : undefined)
  }
}

function layoutRow(nodes: MathNode[], context: LayoutContext): MathBox {
  const boxes: MathBox[] = []
  let previous: SymbolRole | undefined
  for (let index = 0; index < nodes.length; index++) {
    const role = normalizedRole(roleOf(nodes[index]!), previous, nextRole(nodes, index + 1))
    if (needsSpace(previous, role, boxes.length)) boxes.push(blank(1, 1, 0))
    boxes.push(layout(nodes[index]!, context))
    if (nodes[index]!.type !== "space") previous = role ?? "ordinary"
  }
  return hpack(boxes)
}

function fraction(top: MathBox, bottom: MathBox, bar: boolean, align?: "left" | "right", style?: MathStyle): MathBox {
  const width = Math.max(top.width, bottom.width) + 2
  const result = blank(width, top.height + bottom.height + 1, top.height)
  overlay(result, top, align === "left" ? 1 : align === "right" ? width - top.width - 1 : Math.floor((width - top.width) / 2), 0)
  if (bar) horizontal(result, top.height, width, "─", style)
  overlay(result, bottom, Math.floor((width - bottom.width) / 2), top.height + 1)
  return result
}

function root(body: MathBox, index?: MathBox, style?: MathStyle): MathBox {
  const indexWidth = index ? Math.max(0, index.width - 1) : 0
  const bodyX = indexWidth + 2
  const bodyY = index?.height ?? 1
  const result = blank(bodyX + body.width, body.height + bodyY, body.baseline + bodyY)
  set(result, bodyX - 1, bodyY - 1, "╭", style); for (let x = bodyX; x < result.width; x++) set(result, x, bodyY - 1, "─", style)
  set(result, bodyX - 2, result.baseline, "√", style); overlay(result, body, bodyX, bodyY)
  if (index) overlay(result, index, 0, 0)
  return result
}

function scripts(node: Extract<MathNode, { type: "scripts" }>, context: LayoutContext): MathBox {
  const base = layout(node.base, context)
  const sup = node.superscript ? layout(node.superscript, context) : undefined
  const sub = node.subscript ? layout(node.subscript, context) : undefined
  const supText = node.superscript ? simpleText(node.superscript) : undefined
  const subText = node.subscript ? simpleText(node.subscript) : undefined
  let target = node.base
  while (target.type === "variant" || target.type === "color" || target.type === "scripts") {
    target = target.type === "scripts" ? target.base : target.body
  }
  const limits = target.type === "operator" && (target.limits === true || (target.limits === "display" && context.display))
  if (limits || target.type === "brace") return overUnder(base, sup, sub)
  if (base.height === 1) {
    const mappedSup = supText === undefined ? undefined : mapScript(supText, superscript)
    const mappedSub = subText === undefined ? undefined : mapScript(subText, subscript)
    if ((!sup?.width || mappedSup !== undefined) && (!sub?.width || mappedSub !== undefined)) {
      return hpack([base, textBox((mappedSup ?? "") + (mappedSub ?? ""), context.style)])
    }
  }
  const sideWidth = Math.max(sup?.width ?? 0, sub?.width ?? 0)
  const topHeight = sup?.width ? sup.height : 0
  const bottomHeight = sub?.width ? sub.height : 0
  const result = blank(base.width + sideWidth, topHeight + base.height + bottomHeight, topHeight + base.baseline)
  overlay(result, base, 0, topHeight)
  if (sup) overlay(result, sup, base.width, 0)
  if (sub) overlay(result, sub, base.width, topHeight + base.height)
  return result
}

function overUnder(base: MathBox, over?: MathBox, under?: MathBox): MathBox {
  const width = Math.max(base.width, over?.width ?? 0, under?.width ?? 0)
  const overHeight = over?.width ? over.height : 0
  const underHeight = under?.width ? under.height : 0
  const result = blank(width, overHeight + base.height + underHeight, overHeight + base.baseline)
  if (over) overlay(result, over, Math.floor((width - over.width) / 2), 0)
  overlay(result, base, Math.floor((width - base.width) / 2), overHeight)
  if (under) overlay(result, under, Math.floor((width - under.width) / 2), overHeight + base.height)
  return result
}

function delimited(left: string, body: MathBox, right: string, style?: MathStyle): MathBox {
  return hpack([delimiter(left, body.height, body.baseline, true, style), body, delimiter(right, body.height, body.baseline, false, style)])
}

function matrix(node: Extract<MathNode, { type: "matrix" }>, context: LayoutContext): MathBox {
  const cells = node.rows.map((row) => row.map((cell) => layout(cell, context)))
  const alignments = node.columns?.match(/[lcr]/g)
  const rules = node.columns?.split(/[lcr]/).map((rule) => rule.length) ?? []
  const columns = Math.max(alignments?.length ?? 0, ...cells.map((row) => row.length))
  const widths = Array.from({ length: columns }, (_, x) => Math.max(0, ...cells.map((row) => row[x]?.width ?? 0)))
  const ascents = cells.map((row) => Math.max(0, ...row.map((cell) => cell.baseline)))
  const descents = cells.map((row) => Math.max(0, ...row.map((cell) => cell.height - cell.baseline - 1)))
  const heights = ascents.map((value, y) => value + descents[y]! + 1)
  const aligned = node.environment === "aligned" || node.environment === "align"
  const gap = node.environment === "cases" || aligned ? 2 : 1
  const gaps = Array.from({ length: columns + 1 }, (_, boundary) => {
    const edge = boundary === 0 || boundary === columns
    return rules[boundary] ? rules[boundary]! + (edge ? 1 : 2) : edge ? 0 : gap
  })
  const width = widths.reduce((sum, value) => sum + value, 0) + gaps.reduce((sum, value) => sum + value, 0)
  const height = Math.max(1, heights.reduce((sum, value) => sum + value, 0))
  const result = blank(width, height, Math.floor(height / 2))
  let y = 0
  for (let rowIndex = 0; rowIndex < cells.length; rowIndex++) {
    let x = gaps[0]!
    for (let column = 0; column < columns; column++) {
      const cell = cells[rowIndex]![column]
      if (cell) {
        const alignment = alignments?.[column] ?? (node.environment === "cases" ? "l" : aligned ? column % 2 === 0 ? "r" : "l" : "c")
        const offset = alignment === "l" ? 0 : alignment === "r" ? widths[column]! - cell.width : Math.floor((widths[column]! - cell.width) / 2)
        overlay(result, cell, x + offset, y + ascents[rowIndex]! - cell.baseline)
      }
      x += widths[column]! + gaps[column + 1]!
    }
    y += heights[rowIndex]!
  }
  let boundaryX = 0
  for (let boundary = 0; boundary <= columns; boundary++) {
    for (let rule = 0; rule < (rules[boundary] ?? 0); rule++) {
      for (let row = 0; row < height; row++) set(result, boundaryX + (boundary === 0 ? 0 : 1) + rule, row, "│", context.style)
    }
    boundaryX += gaps[boundary]! + (widths[boundary] ?? 0)
  }
  const pair = matrixDelimiters(node.environment)
  return pair ? delimited(pair[0], result, pair[1], context.style) : result
}

function brace(body: MathBox, position: "over" | "under", style?: MathStyle): MathBox {
  const over = position === "over"
  const width = Math.max(3, body.width)
  const result = blank(width, body.height + 1, body.baseline + (over ? 1 : 0))
  const y = over ? 0 : body.height
  overlay(result, body, Math.floor((width - body.width) / 2), over ? 1 : 0)
  horizontal(result, y, width, "─", style)
  set(result, 0, y, over ? "╭" : "╰", style)
  set(result, width - 1, y, over ? "╮" : "╯", style)
  set(result, Math.floor((width - 1) / 2), y, over ? "┴" : "┬", style)
  return result
}

function accent(kind: Extract<MathNode, { type: "accent" }>["accent"], body: MathBox, style?: MathStyle): MathBox {
  if (kind === "underline") {
    const result = blank(body.width, body.height + 1, body.baseline); overlay(result, body, 0, 0); horizontal(result, body.height, body.width, "─", style); return result
  }
  const result = blank(body.width, body.height + 1, body.baseline + 1); overlay(result, body, 0, 1)
  const mark = kind === "hat" || kind === "widehat" ? (body.width === 1 ? "^" : "⌢") : kind === "bar" || kind === "overline" ? "─" : kind === "vec" ? "→" : kind === "tilde" ? "~" : kind === "dot" ? "·" : "¨"
  if (kind === "bar" || kind === "overline") horizontal(result, 0, body.width, mark, style)
  else set(result, Math.max(0, Math.floor((body.width - stringWidth(mark)) / 2)), 0, mark, style)
  return result
}

function delimiter(value: string, height: number, baseline: number, left: boolean, style?: MathStyle): MathBox {
  const base = value.replace(/\p{Mark}+$/u, "")
  if (!base) return blank(0, height, baseline)
  if (height === 1) return textBox(value, style)
  const glyphs = delimiterGlyphs(base, left)
  const suffix = value.slice(base.length)
  const result = blank(Math.max(...glyphs.map((glyph) => stringWidth(glyph + suffix))), height, baseline)
  for (let y = 0; y < height; y++) set(result, 0, y, y === 0 ? glyphs[0] : y === height - 1 ? glyphs[2] : glyphs[1], style)
  if ((base === "{" || base === "}") && height >= 3) set(result, 0, Math.floor(height / 2), left ? "⎨" : "⎬", style)
  if (suffix) set(result, 0, baseline, result.cells[baseline]![0]!.char + suffix, style)
  return result
}

function delimiterGlyphs(value: string, left: boolean): [string, string, string] {
  if (value === "(") return ["⎛", "⎜", "⎝"]
  if (value === ")") return ["⎞", "⎟", "⎠"]
  if (value === "[") return ["⎡", "⎢", "⎣"]
  if (value === "]") return ["⎤", "⎥", "⎦"]
  if (value === "{") return ["⎧", "⎪", "⎩"]
  if (value === "}") return ["⎫", "⎪", "⎭"]
  if (value === "⟨") return ["/", "│", "\\"]
  if (value === "⟩") return ["\\", "│", "/"]
  if (value === "⌊" || value === "⌋") return ["│", "│", value]
  if (value === "⌈" || value === "⌉") return [value, "│", "│"]
  return [value, value, value]
}

function matrixDelimiters(value: MathEnvironment): [string, string] | undefined {
  return value === "pmatrix" ? ["(", ")"] : value === "bmatrix" ? ["[", "]"] : value === "Bmatrix" ? ["{", "}"] : value === "vmatrix" ? ["│", "│"] : value === "Vmatrix" ? ["║", "║"] : value === "cases" ? ["{", ""] : undefined
}

function textBox(text: string, style?: MathStyle): MathBox {
  const parts = Array.from(graphemeSegmenter.segment(text), (part) => part.segment)
  const result = blank(parts.reduce((sum, part) => sum + stringWidth(part), 0), 1, 0)
  let x = 0
  for (const part of parts) { set(result, x, 0, part, style); x += stringWidth(part) }
  return result
}

function hpack(boxes: MathBox[]): MathBox {
  if (!boxes.length) return blank(0, 1, 0)
  const ascent = Math.max(...boxes.map((box) => box.baseline))
  const descent = Math.max(...boxes.map((box) => box.height - box.baseline - 1))
  const result = blank(boxes.reduce((sum, box) => sum + box.width, 0), ascent + descent + 1, ascent)
  let x = 0
  for (const box of boxes) { overlay(result, box, x, ascent - box.baseline); x += box.width }
  return result
}

function blank(width: number, height: number, baseline: number): MathBox {
  width = Math.max(0, width); height = Math.max(1, height)
  if (width * height > CELL_LIMIT) throw new Error(`Unicode TeX output exceeds ${CELL_LIMIT} characters`)
  return { width, height, baseline: Math.max(0, baseline), cells: Array.from({ length: height }, () => Array<MathCell | undefined>(width)) }
}
function overlay(target: MathBox, source: MathBox, x: number, y: number): void { for (let sy = 0; sy < source.height; sy++) for (let sx = 0; sx < source.width; sx++) if (source.cells[sy]![sx]) target.cells[y + sy]![x + sx] = source.cells[sy]![sx] }
function set(box: MathBox, x: number, y: number, char: string, style?: MathStyle): void { if (x >= 0 && y >= 0 && x < box.width && y < box.height) box.cells[y]![x] = style ? { char, style } : { char } }
function horizontal(box: MathBox, y: number, width: number, value: string, style?: MathStyle): void { for (let x = 0; x < width; x++) set(box, x, y, value, style) }
function simpleText(node: MathNode): string | undefined { if (node.type === "symbol" || node.type === "text" || node.type === "operator") return node.value; if (node.type === "row") { const values = node.body.map(simpleText); if (values.every((value) => value !== undefined)) return values.join("") } return undefined }
function mapScript(value: string, table: Readonly<Record<string, string>>): string | undefined { let result = ""; for (const char of value) { if (!table[char]) return undefined; result += table[char] } return result }
function roleOf(node: MathNode): SymbolRole | undefined { if (node.type === "symbol") return node.role; if (node.type === "operator" || node.type === "fraction" || node.type === "root" || node.type === "matrix") return "operator"; if (node.type === "scripts") return roleOf(node.base); if (node.type === "variant" || node.type === "color") return roleOf(node.body); return undefined }
function nextRole(nodes: MathNode[], start: number): SymbolRole | undefined { for (let i = start; i < nodes.length; i++) if (nodes[i]!.type !== "space") return roleOf(nodes[i]!) ?? "ordinary"; return undefined }
function needsSpace(previous: SymbolRole | undefined, current: SymbolRole | undefined, count: number): boolean { return count > 0 && previous !== "opening" && previous !== "punctuation" && current !== "closing" && current !== "punctuation" && (previous === "binary" || previous === "relation" || previous === "operator" || current === "binary" || current === "relation" || current === "operator") }
function normalizedRole(role: SymbolRole | undefined, previous: SymbolRole | undefined, next: SymbolRole | undefined): SymbolRole | undefined { return role === "binary" && (!previous || ["binary", "relation", "operator", "punctuation", "opening"].includes(previous) || !next || ["binary", "relation", "punctuation", "closing"].includes(next)) ? "ordinary" : role }

function applyVariant(value: string, variant?: MathVariant): string {
  if (!variant || variant === "normal" || variant === "bold" || variant === "italic") return value
  const exceptions: Partial<Record<MathVariant, Readonly<Record<string, string>>>> = {
    "double-struck": { C: "ℂ", H: "ℍ", N: "ℕ", P: "ℙ", Q: "ℚ", R: "ℝ", Z: "ℤ" },
    script: { B: "ℬ", E: "ℰ", F: "ℱ", H: "ℋ", I: "ℐ", L: "ℒ", M: "ℳ", R: "ℛ", e: "ℯ", g: "ℊ", o: "ℴ" },
    fraktur: { C: "ℭ", H: "ℌ", I: "ℑ", R: "ℜ", Z: "ℨ" },
  }
  const ranges: Partial<Record<MathVariant, readonly [number, number, number?]>> = {
    "double-struck": [0x1d538, 0x1d552, 0x1d7d8], script: [0x1d49c, 0x1d4b6], fraktur: [0x1d504, 0x1d51e],
    sans: [0x1d5a0, 0x1d5ba, 0x1d7e2], monospace: [0x1d670, 0x1d68a, 0x1d7f6],
  }
  const range = ranges[variant]!
  return Array.from(value).map((char) => {
    const exception = exceptions[variant]?.[char]
    if (exception) return exception
    const code = char.codePointAt(0)!
    if (code >= 65 && code <= 90) return String.fromCodePoint(range[0] + code - 65)
    if (code >= 97 && code <= 122) return String.fromCodePoint(range[1] + code - 97)
    if (range[2] !== undefined && code >= 48 && code <= 57) return String.fromCodePoint(range[2] + code - 48)
    return char
  }).join("")
}
