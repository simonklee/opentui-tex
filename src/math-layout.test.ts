import { describe, expect, test } from "bun:test"
import stringWidth from "string-width"
import { boxToOutput, layoutMath } from "./math-layout.js"
import type { MathBox, MathNode, MathVariant } from "./math-types.js"

const text = (value: string): MathNode => ({ type: "text", value })
const fraction: MathNode = { type: "fraction", numerator: text("1"), denominator: text("2"), bar: true }

function render(node: MathNode, width = 80, height = 24, display = false) {
  return boxToOutput(layoutMath(node, display), width, height)
}

describe("math layout", () => {
  test.each(["left", "right", undefined] as const)("aligns fraction numerators: %s", (numeratorAlign) => {
    expect(render({ ...fraction, denominator: text("12345"), numeratorAlign }).text)
      .toBe(`${numeratorAlign === "left" ? " 1" : numeratorAlign === "right" ? "     1" : "   1"}\n───────\n 12345`)
    expect(render({ ...fraction, bar: false }).text).toBe(" 1\n\n 2")
  })

  test.each(["over", "under"] as const)("places annotations outside %s braces", (position) => {
    const base: MathNode = { type: "brace", body: text("abcd"), position }
    const node: MathNode = { type: "scripts", base, ...(position === "over" ? { superscript: text("n") } : { subscript: text("n") }) }
    expect(render(node).text).toBe(position === "over" ? " n\n╭┴─╮\nabcd" : "abcd\n╰┬─╯\n n")
    expect(layoutMath(node, false).baseline).toBe(position === "over" ? 2 : 0)
    expect(render({ ...base, body: text("x") }).text).toBe(position === "over" ? "╭┴╮\n x" : " x\n╰┬╯")
  })

  test("keeps array alignment and continuous edge and double rules across tall cells", () => {
    expect(render({
      type: "matrix", environment: "array", columns: "|l||r|",
      rows: [[text("a"), text("b")], [fraction, text("cc")]],
    }).text).toBe("│ a   ││  b │\n│  1  ││    │\n│ ─── ││ cc │\n│  2  ││    │")
    expect(render({
      type: "matrix", environment: "array", columns: "lcr",
      rows: [[text("a"), text("b"), text("c")], [text("long"), text("wide"), text("last")]],
    }).text).toBe("a     b      c\nlong wide last")
  })

  test("left-aligns cases without changing aligned equations or adding blank rows", () => {
    const rows = [[text("x"), text("p")], [text("long"), text("condition")]]
    expect(render({ type: "matrix", environment: "cases", rows }).text).toBe("⎧x     p\n⎩long  condition")
    expect(render({ type: "matrix", environment: "aligned", rows }).text).toBe("   x  p\nlong  condition")
  })

  test("raises scripts outside tall bases and preserves the literal radical", () => {
    const matrix: MathNode = { type: "matrix", environment: "pmatrix", rows: [[text("a"), text("b")], [text("c"), text("d")]] }
    expect(render({ type: "scripts", base: matrix, superscript: text("2") }).text).toBe("     2\n⎛a b⎞\n⎝c d⎠")
    expect(render({ type: "scripts", base: fraction, superscript: text("2"), subscript: text("1") }).text).toBe("   2\n 1\n───\n 2\n   1")
    expect(render({ type: "root", body: text("x"), index: fraction }).text).toBe(" 1\n───\n 2 ╭─\n  √ x")
  })

  test("empty scripts do not add geometry, including beside a nonempty script", () => {
    const bases: MathNode[] = [
      text("x"), fraction, { type: "root", body: text("x") },
      { type: "matrix", environment: "pmatrix", rows: [[text("a")], [text("b")]] },
      { type: "brace", position: "over", body: text("abcd") },
      { type: "brace", position: "under", body: text("abcd") },
      { type: "operator", value: "∑", limits: true },
    ]
    const empties: MathNode[] = [{ type: "row", body: [] }, text(""), { type: "color", color: "red", body: text("") }]
    for (const base of bases) for (const empty of empties) {
      for (const scripts of [{ superscript: empty }, { subscript: empty }, { superscript: empty, subscript: empty }]) {
        expect(layoutMath({ type: "scripts", base, ...scripts }, false)).toEqual(layoutMath(base, false))
      }
      expect(layoutMath({ type: "scripts", base, superscript: empty, subscript: text("q") }, false))
        .toEqual(layoutMath({ type: "scripts", base, subscript: text("q") }, false))
    }
  })

  test("preserves inline limits overrides and display-only defaults", () => {
    for (const display of [false, true]) for (const limits of [true, false, "display"] as const) {
      const node: MathNode = { type: "scripts", base: { type: "operator", value: "∑", limits }, superscript: text("2"), subscript: text("1") }
      expect(render(node, 80, 24, display).text).toBe(limits === true || limits === "display" && display ? "2\n∑\n1" : "∑²₁")
    }
  })

  test("bounds the cell grid before allocating oversized layouts", () => {
    expect(layoutMath(text("x".repeat(16384)), false).width).toBe(16384)
    expect(() => layoutMath(text("x".repeat(16385)), false)).toThrow("Unicode TeX output exceeds 16384 characters")
    const node: MathNode = { type: "matrix", environment: "array", columns: "|l||r|", rows: [[text("x".repeat(8192)), text("y")], [fraction, text("z")]] }
    expect(() => render(node, 1, 1)).toThrow("Unicode TeX output exceeds 16384 characters")
    expect(() => layoutMath({ type: "brace", position: "over", body: text("x".repeat(8193)) }, false)).toThrow("Unicode TeX output exceeds 16384 characters")
  })
})

describe("math styles and output", () => {
  test.each([
    ["double-struck", "CHNPQRZaz09", "ℂℍℕℙℚℝℤ𝕒𝕫𝟘𝟡"],
    ["script", "BEFHILMRegoAz9", "ℬℰℱℋℐℒℳℛℯℊℴ𝒜𝓏9"],
    ["fraktur", "CHIRZaz9", "ℭℌℑℜℨ𝔞𝔷9"],
    ["sans", "AZaz09", "𝖠𝖹𝖺𝗓𝟢𝟫"],
    ["monospace", "AZaz09", "𝙰𝚉𝚊𝚣𝟶𝟿"],
    ["normal", "AZaz09", "AZaz09"],
  ] satisfies [MathVariant, string, string][])("maps the %s alphabet", (variant, value, expected) => {
    expect(render({ type: "variant", variant, body: text(value + "α+") })).toEqual({ text: expected + "α+" })
  })

  test("preserves inherited attributes and color overrides without leaking to siblings", () => {
    const node: MathNode = { type: "row", body: [
      { type: "color", color: "red", body: { type: "variant", variant: "bold", body: { type: "row", body: [
        text("a"), { type: "variant", variant: "italic", body: text("b") }, { type: "color", color: "blue", body: text("c") },
      ] } } },
      text("d"), { type: "color", color: "red", body: text("e") }, { type: "color", color: "red", body: text("f") },
    ] }
    expect(render(node)).toEqual({ text: "abcdef", spans: [
      { text: "a", color: "red", bold: true }, { text: "b", color: "red", bold: true, italic: true },
      { text: "c", color: "blue", bold: true }, { text: "d" }, { text: "ef", color: "red" },
    ] })
    expect(render({ type: "variant", variant: "sans", body: { type: "variant", variant: "normal", body: text("x") } }))
      .toEqual({ text: "x" })
  })

  test("styles structural glyphs and both compact and stacked scripts", () => {
    const nodes: MathNode[] = [
      fraction, { type: "root", body: fraction, index: text("3") },
      { type: "delimited", left: "[\u0305", body: fraction, right: "]\u0305" },
      { type: "matrix", environment: "array", columns: "|l||r|", rows: [[text("x"), fraction]] },
      { type: "matrix", environment: "cases", rows: [[text("x")], [text("y")]] },
      { type: "brace", position: "over", body: text("abcd") },
      { type: "accent", accent: "hat", body: text("x") }, { type: "accent", accent: "underline", body: text("x") },
      { type: "scripts", base: text("x"), superscript: text("2"), subscript: text("i") },
      { type: "scripts", base: fraction, superscript: text("q") },
      { type: "overunder", base: text("x"), over: text("n"), under: text("m") },
    ]
    for (const node of nodes) {
      const box = layoutMath({ type: "color", color: "red", body: { type: "variant", variant: "bold", body: node } }, false)
      for (const row of box.cells) for (const cell of row) if (cell) expect(cell.style).toEqual({ color: "red", bold: true })
      const output = boxToOutput(box, 80, 24)
      expect(output.text).toBe(render(node).text)
      expect(output.spans!.map((span) => span.text).join("")).toBe(output.text)
    }
    expect(render({ type: "scripts", base: text("x"), superscript: { type: "color", color: "blue", body: text("q") } }))
      .toEqual({ text: " q\nx", spans: [{ text: " " }, { text: "q", color: "blue" }, { text: "\nx" }] })
  })

  test("keeps styles and whole graphemes through clipping and trailing whitespace removal", () => {
    const box: MathBox = { width: 6, height: 4, baseline: 0, cells: [
      [{ char: "x\u0305", style: { color: "red" } }, { char: " ", style: { color: "red" } },
        { char: " ", style: { color: "blue" } }, { char: "👩‍🔬", style: { color: "blue" } }, undefined, { char: "Z", style: { bold: true } }],
      [], [{ char: "q", style: { italic: true } }, { char: " ", style: { bold: true } }], [],
    ] }
    expect(boxToOutput(box, 4, 4)).toEqual({ text: "x\u0305\n\nq", spans: [{ text: "x\u0305", color: "red" }, { text: "\n\n" }, { text: "q", italic: true }] })
    expect(boxToOutput(box, 5, 1)).toEqual({ text: "x\u0305  👩‍🔬", spans: [{ text: "x\u0305 ", color: "red" }, { text: " 👩‍🔬", color: "blue" }] })
    for (const width of [1, 2, 3, 4, 5, 6]) for (const height of [0, 1, 2, 3, 4]) {
      const output = boxToOutput(box, width, height)
      expect(output.spans?.map((span) => span.text).join("") ?? "").toBe(output.text)
      expect(output.text.split("\n").every((line) => stringWidth(line) <= width)).toBe(true)
    }
    expect(boxToOutput(box, 6, 0)).toEqual({ text: "" })
    expect(() => render({ type: "color", color: "red", body: text("👩‍🔬") }, 1)).toThrow("glyph exceeds")
    expect(render({ type: "variant", variant: "sans", body: text("x\u0305y") }, 1)).toEqual({ text: "𝗑\u0305" })
    expect(render({ type: "color", color: "red", body: text(" ") })).toEqual({ text: "" })
    expect(box.cells[2]![0]).toEqual({ char: "q", style: { italic: true } })
  })

  test("preserves combining suffixes on styled stretching delimiters", () => {
    const node: MathNode = { type: "color", color: "blue", body: { type: "delimited", left: "[\u0305", right: "]\u0305", body: fraction } }
    const output = render(node)
    expect(output.text).toBe("⎡ 1 ⎤\n⎢\u0305───⎥\u0305\n⎣ 2 ⎦")
    expect(output.spans).toContainEqual({ text: "⎢\u0305───⎥\u0305", color: "blue" })
    const box: MathBox = { width: 2, height: 1, baseline: 0, cells: [[{ char: "\u3164", style: { bold: true } }, { char: "x" }]] }
    expect(boxToOutput(box, 2, 1)).toEqual({ text: " x" })
  })
})
