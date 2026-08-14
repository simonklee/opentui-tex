import type { MathBox, MathEnvironment, MathNode, SymbolRole } from "./math-types.js"
import stringWidth from "string-width"

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
  return layout(node, displayMode)
}

export function boxToString(box: MathBox, widthMax: number, heightMax: number): string {
  const lines: string[] = []
  for (let y = 0; y < Math.min(box.height, heightMax); y++) {
    let line = ""
    let width = 0
    for (let x = 0; x < box.width && width < widthMax; x++) {
      const value = box.cells[y]![x]
      if (!value) { line += " "; width++; continue }
      const cellWidth = stringWidth(value)
      if (cellWidth > widthMax) throw new Error(`Unicode glyph exceeds the ${widthMax}-column TeX width`)
      if (width + cellWidth > widthMax) break
      line += value
      width += cellWidth
      x += cellWidth - 1
    }
    lines.push(line.trimEnd())
  }
  return lines.join("\n").trimEnd()
}

function layout(node: MathNode, display: boolean): MathBox {
  switch (node.type) {
    case "row": return layoutRow(node.body, display)
    case "symbol": case "text": case "operator": return textBox(node.value)
    case "space": return blank(node.width, 1, 0)
    case "fraction": return fraction(layout(node.numerator, display), layout(node.denominator, display), node.bar)
    case "root": return root(layout(node.body, display), node.index ? layout(node.index, display) : undefined)
    case "scripts": return scripts(node, display)
    case "delimited": return delimited(node.left, layout(node.body, display), node.right)
    case "matrix": return matrix(node.rows, node.environment, display)
    case "accent": return accent(node.accent, layout(node.body, display))
    case "overunder": return overUnder(layout(node.base, display), node.over ? layout(node.over, display) : undefined, node.under ? layout(node.under, display) : undefined)
  }
}

function layoutRow(nodes: MathNode[], display: boolean): MathBox {
  const boxes: MathBox[] = []
  let previous: SymbolRole | undefined
  for (let index = 0; index < nodes.length; index++) {
    const role = normalizedRole(roleOf(nodes[index]!), previous, nextRole(nodes, index + 1))
    if (needsSpace(previous, role, boxes.length)) boxes.push(blank(1, 1, 0))
    boxes.push(layout(nodes[index]!, display))
    if (nodes[index]!.type !== "space") previous = role ?? "ordinary"
  }
  return hpack(boxes)
}

function fraction(top: MathBox, bottom: MathBox, bar: boolean): MathBox {
  const width = Math.max(top.width, bottom.width) + 2
  const result = blank(width, top.height + bottom.height + 1, top.height)
  overlay(result, top, Math.floor((width - top.width) / 2), 0)
  if (bar) horizontal(result, top.height, width, "─")
  overlay(result, bottom, Math.floor((width - bottom.width) / 2), top.height + 1)
  return result
}

function root(body: MathBox, index?: MathBox): MathBox {
  const indexWidth = index ? Math.max(0, index.width - 1) : 0
  const bodyX = indexWidth + 2
  const result = blank(bodyX + body.width, body.height + 1, body.baseline + 1)
  set(result, bodyX - 1, 0, "╭"); for (let x = bodyX; x < result.width; x++) set(result, x, 0, "─")
  set(result, bodyX - 2, result.baseline, "√"); overlay(result, body, bodyX, 1)
  if (index) overlay(result, index, 0, 0)
  return result
}

function scripts(node: Extract<MathNode, { type: "scripts" }>, display: boolean): MathBox {
  const base = layout(node.base, display)
  const supText = node.superscript ? simpleText(node.superscript) : undefined
  const subText = node.subscript ? simpleText(node.subscript) : undefined
  const limits = node.base.type === "operator" && node.base.limits && display
  if (!limits) {
    const mappedSup = supText === undefined ? undefined : mapScript(supText, superscript)
    const mappedSub = subText === undefined ? undefined : mapScript(subText, subscript)
    if ((!node.superscript || mappedSup !== undefined) && (!node.subscript || mappedSub !== undefined)) {
      return hpack([base, textBox((mappedSup ?? "") + (mappedSub ?? ""))])
    }
  }
  if (limits) return overUnder(base, node.superscript ? layout(node.superscript, display) : undefined, node.subscript ? layout(node.subscript, display) : undefined)
  const sup = node.superscript ? layout(node.superscript, display) : undefined
  const sub = node.subscript ? layout(node.subscript, display) : undefined
  const sideWidth = Math.max(sup?.width ?? 0, sub?.width ?? 0)
  const result = blank(base.width + sideWidth, (sup?.height ?? 0) + base.height + (sub?.height ?? 0), (sup?.height ?? 0) + base.baseline)
  overlay(result, base, 0, sup?.height ?? 0)
  if (sup) overlay(result, sup, base.width, 0)
  if (sub) overlay(result, sub, base.width, (sup?.height ?? 0) + base.height)
  return result
}

function overUnder(base: MathBox, over?: MathBox, under?: MathBox): MathBox {
  const width = Math.max(base.width, over?.width ?? 0, under?.width ?? 0)
  const result = blank(width, (over?.height ?? 0) + base.height + (under?.height ?? 0), (over?.height ?? 0) + base.baseline)
  if (over) overlay(result, over, Math.floor((width - over.width) / 2), 0)
  overlay(result, base, Math.floor((width - base.width) / 2), over?.height ?? 0)
  if (under) overlay(result, under, Math.floor((width - under.width) / 2), (over?.height ?? 0) + base.height)
  return result
}

function delimited(left: string, body: MathBox, right: string): MathBox {
  return hpack([delimiter(left, body.height, body.baseline, true), body, delimiter(right, body.height, body.baseline, false)])
}

function matrix(rows: MathNode[][], environment: MathEnvironment, display: boolean): MathBox {
  const cells = rows.map((row) => row.map((node) => layout(node, display)))
  const columns = Math.max(0, ...cells.map((row) => row.length))
  const widths = Array.from({ length: columns }, (_, x) => Math.max(0, ...cells.map((row) => row[x]?.width ?? 0)))
  const ascents = cells.map((row) => Math.max(0, ...row.map((cell) => cell.baseline)))
  const descents = cells.map((row) => Math.max(0, ...row.map((cell) => cell.height - cell.baseline - 1)))
  const heights = ascents.map((value, y) => value + descents[y]! + 1)
  const gap = environment === "cases" || environment === "aligned" || environment === "align" ? 2 : 1
  const width = widths.reduce((sum, value) => sum + value, 0) + Math.max(0, columns - 1) * gap
  const height = Math.max(1, heights.reduce((sum, value) => sum + value, 0))
  const result = blank(width, height, Math.floor(height / 2))
  let y = 0
  for (let rowIndex = 0; rowIndex < cells.length; rowIndex++) {
    let x = 0
    for (let column = 0; column < columns; column++) {
      const cell = cells[rowIndex]![column]
      if (cell) {
        const aligned = environment === "aligned" || environment === "align" || environment === "cases"
        const offset = aligned ? (column % 2 === 0 ? widths[column]! - cell.width : 0) : Math.floor((widths[column]! - cell.width) / 2)
        overlay(result, cell, x + offset, y + ascents[rowIndex]! - cell.baseline)
      }
      x += widths[column]! + gap
    }
    y += heights[rowIndex]!
  }
  const pair = matrixDelimiters(environment)
  return pair ? delimited(pair[0], result, pair[1]) : result
}

function accent(kind: Extract<MathNode, { type: "accent" }>["accent"], body: MathBox): MathBox {
  if (kind === "underline") {
    const result = blank(body.width, body.height + 1, body.baseline); overlay(result, body, 0, 0); horizontal(result, body.height, body.width, "─"); return result
  }
  const result = blank(body.width, body.height + 1, body.baseline + 1); overlay(result, body, 0, 1)
  const mark = kind === "hat" || kind === "widehat" ? (body.width === 1 ? "^" : "⌢") : kind === "bar" || kind === "overline" ? "─" : kind === "vec" ? "→" : kind === "tilde" ? "~" : kind === "dot" ? "·" : "¨"
  if (kind === "bar" || kind === "overline") horizontal(result, 0, body.width, mark)
  else set(result, Math.max(0, Math.floor((body.width - stringWidth(mark)) / 2)), 0, mark)
  return result
}

function delimiter(value: string, height: number, baseline: number, left: boolean): MathBox {
  if (!value) return blank(0, height, baseline)
  if (height === 1) return textBox(value)
  const glyphs = delimiterGlyphs(value, left)
  const result = blank(Math.max(...glyphs.map((glyph) => stringWidth(glyph))), height, baseline)
  for (let y = 0; y < height; y++) set(result, 0, y, y === 0 ? glyphs[0] : y === height - 1 ? glyphs[2] : glyphs[1])
  if ((value === "{" || value === "}") && height >= 3) set(result, 0, Math.floor(height / 2), left ? "⎨" : "⎬")
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

function textBox(text: string): MathBox {
  const parts = typeof Intl.Segmenter === "function" ? [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].map((part) => part.segment) : [...text]
  const result = blank(parts.reduce((sum, part) => sum + stringWidth(part), 0), 1, 0)
  let x = 0
  for (const part of parts) { set(result, x, 0, part); x += stringWidth(part) }
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
  return { width, height, baseline: Math.max(0, baseline), cells: Array.from({ length: height }, () => Array<string | undefined>(width)) }
}
function overlay(target: MathBox, source: MathBox, x: number, y: number): void { for (let sy = 0; sy < source.height; sy++) for (let sx = 0; sx < source.width; sx++) if (source.cells[sy]![sx]) target.cells[y + sy]![x + sx] = source.cells[sy]![sx] }
function set(box: MathBox, x: number, y: number, value: string): void { if (x >= 0 && y >= 0 && x < box.width && y < box.height) box.cells[y]![x] = value }
function horizontal(box: MathBox, y: number, width: number, value: string): void { for (let x = 0; x < width; x++) set(box, x, y, value) }
function simpleText(node: MathNode): string | undefined { if (node.type === "symbol" || node.type === "text" || node.type === "operator") return node.value; if (node.type === "row") { const values = node.body.map(simpleText); if (values.every((value) => value !== undefined)) return values.join("") } return undefined }
function mapScript(value: string, table: Readonly<Record<string, string>>): string | undefined { let result = ""; for (const char of value) { if (!table[char]) return undefined; result += table[char] } return result }
function roleOf(node: MathNode): SymbolRole | undefined { if (node.type === "symbol") return node.role; if (node.type === "operator" || node.type === "fraction" || node.type === "root" || node.type === "matrix") return "operator"; if (node.type === "scripts") return roleOf(node.base); return undefined }
function nextRole(nodes: MathNode[], start: number): SymbolRole | undefined { for (let i = start; i < nodes.length; i++) if (nodes[i]!.type !== "space") return roleOf(nodes[i]!) ?? "ordinary"; return undefined }
function needsSpace(previous: SymbolRole | undefined, current: SymbolRole | undefined, count: number): boolean { return count > 0 && previous !== "opening" && previous !== "punctuation" && current !== "closing" && current !== "punctuation" && (previous === "binary" || previous === "relation" || previous === "operator" || current === "binary" || current === "relation" || current === "operator") }
function normalizedRole(role: SymbolRole | undefined, previous: SymbolRole | undefined, next: SymbolRole | undefined): SymbolRole | undefined { return role === "binary" && (!previous || ["binary", "relation", "operator", "punctuation", "opening"].includes(previous) || !next || ["binary", "relation", "punctuation", "closing"].includes(next)) ? "ordinary" : role }
