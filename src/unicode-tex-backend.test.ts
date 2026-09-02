import { describe, expect, spyOn, test } from "bun:test"
import { spawnSync } from "node:child_process"
import stringWidth from "string-width"
import { layoutMath } from "./math-layout.js"
import { parseMath } from "./math-parser.js"
import { renderIncompleteUnicode, UnicodeTexBackend } from "./unicode-tex-backend.js"

const backend = new UnicodeTexBackend()

function render(formula: string, display = false, widthMax = 80, heightMax = 24): string {
  const output = backend.renderSync({
    formula, display, foreground: "#ffffff", background: "#000000", widthMax, heightMax,
    signal: new AbortController().signal,
  })
  if (output.kind !== "unicode") throw new Error("Expected Unicode output")
  return output.text
}

function renderIncomplete(formula: string): string {
  return renderIncompleteUnicode({
    formula, display: false, foreground: "", background: "", widthMax: 80, heightMax: 24,
    signal: new AbortController().signal,
  }).text
}

describe("UnicodeTexBackend", () => {
  test("renders stacked fractions, roots, and scripts", () => {
    expect(render(String.raw`\frac{x+1}{y-1}`)).toBe([" x + 1", "───────", " y - 1"].join("\n"))
    expect(render(String.raw`\sqrt{x^2+y^2}`)).toBe([" ╭───────", "√ x² + y²"].join("\n"))
    expect(render(String.raw`e^{-x^2}\,dx`)).toContain("e")
    expect(render(String.raw`\not= x^😀`)).toContain("≠")
    expect(render(String.raw`\hat{x}+\overline{yz}`)).toBe(["^   ──", "x + yz"].join("\n"))
    expect(render(String.raw`\sqrt[3]{x}`)).toBe(["3╭─", "√ x"].join("\n"))
    expect(render(String.raw`\mathrm{d}\mathbf{x}+\alpha`)).toBe("dx + α")
  })

  test("places display operator limits above and below", () => {
    expect(render(String.raw`\sum_{i=1}^{n} i^2`, true)).toBe(["  n", "  ∑   i²", "i = 1"].join("\n"))
  })

  test("preserves complete literal graphemes, including unbraced arguments", () => {
    expect(render("a≠b".normalize("NFD"))).toBe("a =\u0338 b")
    expect(render("x\u0305+y")).toBe("x\u0305 + y")
    expect(render("x\u0305^2")).toBe("x\u0305²")
    expect(render("\\frac x\u0305y")).toBe(" x\u0305\n───\n y")
    expect(render("👩‍🔬^2+🇩🇰")).toBe("👩‍🔬² + 🇩🇰")
    expect(render("[\u0305x]\u0305")).toBe("[\u0305x]\u0305")
    expect(render("x\u0305y", false, 1)).toBe("x\u0305")
    expect(render("👩‍🔬", false, 2)).toBe("👩‍🔬")
    expect(() => render("👩‍🔬", false, 1)).toThrow("glyph exceeds")
  })

  test("does not merge TeX syntax into prepended graphemes", () => {
    for (const suffix of ["{x}", "^2", "_2", String.raw`\alpha`, "~x"]) {
      expect(parseMath("\u0600" + suffix)).toEqual(parseMath("\u0600 " + suffix))
    }
    expect(() => parseMath("\u0600}")).toThrow("Unexpected closing TeX group")
    expect(parseMath("\\sqrt[\u0600]{x}")).toEqual(parseMath("\\sqrt[\u0600 ]{x}"))
    expect(parseMath("\\begin{matrix}\u0600&x\\end{matrix}")).toEqual(parseMath("\\begin{matrix}\u0600 &x\\end{matrix}"))
  })

  test("preserves combining suffixes on command atoms and delimiters", () => {
    const cases = [
      ["\\big[\u0305x\\big]\u0305", "[\u0305x]\u0305"],
      ["\\left[\u0305x\\right]\u0305", "[\u0305x]\u0305"],
      ["\\left\\langle\u0305x\\right\\rangle\u0305", "⟨\u0305x⟩\u0305"],
      ["\\%\u0305x", "%\u0305x"],
      ["\\{\u0305x\\}\u0305", "{\u0305x}\u0305"],
      ["\\alpha\u0305\u0301\\beta", "α\u0305\u0301β"],
      ["\\alpha\u{1D167}^2", "α\u{1D167}²"],
      ["\\#\uFE0F\u20E3^2", "#\uFE0F\u20E3²"],
      ["{\\alpha\u0305}^2_1", "α\u0305²₁"],
      ["\\frac\\alpha\u0305x", " α\u0305\n───\n x"],
      ["x^\\alpha\u0305y", " α\u0305\nx y"],
      ["\\sum\u0305\\limits_1^2", "2\n∑\u0305\n1"],
      ["\\left.\u0305x\\right.\u0305", "x"],
      ["\\left[\u0305\\frac{1}{2}\\right]\u0305", "⎡ 1 ⎤\n⎢\u0305───⎥\u0305\n⎣ 2 ⎦"],
      ["\\left\\{\u0305\\frac{1}{2}\\right\\}\u0305", "⎧ 1 ⎫\n⎨\u0305───⎬\u0305\n⎩ 2 ⎭"],
      ["\\left#\uFE0F\u20E3\\frac{1}{2}\\right#\uFE0F\u20E3", "#  1 #\n#\uFE0F\u20E3───#\uFE0F\u20E3\n#  2 #"],
    ] as const
    for (const [formula, expected] of cases) {
      expect(render(formula)).toBe(expected)
    }
    expect(renderIncomplete("\\alpha\u0305^")).toBe(" □\nα\u0305")
    expect(renderIncomplete("\\left[\u0305x")).toBe("[\u0305x")
    expect(() => render("\\left[\u0305x")).toThrow("Missing \\right")
    expect(() => renderIncomplete("\\alpha\u0305}")).toThrow("Unexpected closing TeX group")
  })

  test("cell conversion advances past zero-width stretched delimiter glyphs", () => {
    const source = import.meta.resolve("./unicode-tex-backend.ts")
    const result = spawnSync(process.execPath, ["-e", `
      import { UnicodeTexBackend, renderIncompleteUnicode } from ${JSON.stringify(source)};
      for (const widthMax of [1, 80]) for (const heightMax of [1, 24]) {
        const request = { formula: ${JSON.stringify("\\left\u3164\u0305\\frac{1}{2}\\right.")},
          display: false, foreground: "#ffffff", background: "#000000",
          widthMax, heightMax, signal: new AbortController().signal };
        for (const render of [() => new UnicodeTexBackend().renderSync(request), () => renderIncompleteUnicode(request)]) {
          try { render(); } catch (error) {
            if (!(error instanceof Error) || !/produced no Unicode output|Unicode glyph exceeds/.test(error.message)) throw error;
          }
        }
      }
    `], { timeout: 2000, encoding: "utf8" })
    expect({ status: result.status, error: result.error?.message, stderr: result.stderr })
      .toEqual({ status: 0, error: undefined, stderr: "" })
  })

  test("reserves the full root index extent above the radical", () => {
    const cases = [
      [String.raw`\sqrt[\frac{1}{2}]{x}`, " 1\n───\n 2 ╭─\n  √ x", 5, 4, 3],
      [String.raw`\sqrt[a_b]{x}`, "a\n b╭─\n √ x", 4, 3, 2],
      ["\\sqrt[界]{x}", "界╭─\n √ x", 4, 2, 1],
      [String.raw`\sqrt[\frac{1}{2}]{\frac{x}{y}}`, " 1\n───\n 2 ╭───\n     x\n  √ ───\n     y", 7, 6, 4],
    ] as const
    for (const [formula, text, width, height, baseline] of cases) {
      expect(render(formula)).toBe(text)
      expect(layoutMath(parseMath(formula), false)).toMatchObject({ width, height, baseline })
    }
  })

  test("applies limits overrides without introducing an atom", () => {
    for (const display of [false, true]) {
      expect(render(String.raw`\sum\limits_1^2`, display)).toBe("2\n∑\n1")
      expect(render(String.raw`\sum\nolimits_1^2`, display)).toBe("∑²₁")
      expect(render(String.raw`\int\limits_1^2`, display)).toBe("2\n∫\n1")
      expect(render(String.raw`\sum^2\nolimits_1`, display)).toBe("∑²₁")
      expect(render(String.raw`\sum\limits\nolimits_1^2`, display)).toBe("∑²₁")
      expect(render(String.raw`\sum\nolimits\limits_1^2`, display)).toBe("2\n∑\n1")
    }
    expect(render(String.raw`\sum_1^2`)).toBe("∑²₁")
    expect(render(String.raw`\sum_1^2`, true)).toBe("2\n∑\n1")
    expect(render(String.raw`\int_1^2`, true)).toBe("∫²₁")
    for (const directive of ["displaystyle", "textstyle", "scriptstyle", "scriptscriptstyle"]) {
      expect(render(`\\sum\\${directive}_1^2`, true)).toBe("2\n∑\n1")
      expect(render(`x^\\${directive}2`)).toBe("x²")
    }
  })

  test("distinguishes double bars and keeps dot delimiters invisible", () => {
    expect(render(String.raw`\|x\|`)).toBe("║x║")
    expect(render(String.raw`\left\|x\right\|`)).toBe("║x║")
    expect(render(String.raw`\left\|\frac{1}{2}\right\|`)).toBe("║ 1 ║\n║───║\n║ 2 ║")
    expect(render("|x|")).toBe("|x|")
    expect(render(String.raw`\left|x\right|`)).toBe("│x│")
    expect(render(String.raw`\left.x\right\|`)).toBe("x║")
    expect(render(String.raw`\left\.x\right\.`)).toBe("x")
    expect(render(String.raw`x\.`)).toBe("x")
  })

  test("uses the TeX epsilon and phi variants", () => {
    expect(render(String.raw`\epsilon\varepsilon\phi\varphi`)).toBe("ϵεϕφ")
  })

  test("reuses the segmenter at the source limit and bounds tall root layouts", () => {
    const constructor = spyOn(Intl, "Segmenter")
    try {
      const ascii = "x".repeat(4096)
      const combining = "x\u0305".repeat(1365)
      expect(render(ascii, false, 4096)).toBe(ascii)
      expect(render(combining, false, 1365)).toBe(combining)
      expect(constructor).not.toHaveBeenCalled()
    } finally {
      constructor.mockRestore()
    }
    expect(() => render("x\u0305".repeat(1366))).toThrow("between 1 and 4096")
    const roots = String.raw`\sqrt[`.repeat(100) + "x" + String.raw`]{x}`.repeat(100)
    expect(() => render(roots)).toThrow("Unicode TeX output exceeds 16384 characters")
  })

  test("lays out aligned equations, matrices, and cases", () => {
    expect(render(String.raw`\begin{aligned}x &= 1 \\ yy &= 2\end{aligned}`, true)).toBe(" x  = 1\nyy  = 2")
    const matrix = render(String.raw`\begin{pmatrix}a & b \\ cc & d\end{pmatrix}`, true)
    expect(matrix).toContain("⎛")
    expect(matrix).toContain("⎝")
    expect(matrix).toContain("cc")
    const cases = render(String.raw`\begin{cases}x & x \ge 0 \\ -x & x < 0\end{cases}`, true)
    expect(cases).toContain("⎧")
    expect(cases).toContain("≥")
  })

  test("keeps nested environments in their cells", () => {
    const value = render(String.raw`\begin{aligned}A &= \begin{pmatrix}a & b \\ c & d\end{pmatrix} \\ z &= 1\end{aligned}`, true)
    expect(value).toContain("⎛")
    expect(value).toContain("z")
  })

  test("clips two-dimensional output to requested bounds", () => {
    const output = backend.renderSync({ formula: String.raw`\frac{abcdefgh}{12345678}`, display: true, foreground: "", background: "", widthMax: 5, heightMax: 2, signal: new AbortController().signal })
    if (output.kind !== "unicode") throw new Error("Expected Unicode output")
    expect(output.rows).toBeLessThanOrEqual(2)
    expect(output.columns).toBeLessThanOrEqual(5)
    expect(output.text.split("\n").every((line) => stringWidth(line) <= 5)).toBe(true)
    expect(() => render("界", false, 1)).toThrow("glyph exceeds")
  })

  test("rejects invalid, deeply nested, and cancelled requests", async () => {
    expect(() => render("")).toThrow("between 1 and 4096")
    expect(() => render("a}b")).toThrow("Unexpected closing TeX group")
    expect(() => render("{ab")).toThrow("Unclosed TeX group")
    expect(() => render("{".repeat(257) + "x" + "}".repeat(257))).toThrow("256-level limit")
    expect(() => render("😀".repeat(1025))).toThrow("between 1 and 4096")
    const controller = new AbortController(); controller.abort(new Error("cancelled"))
    const request = { formula: "x", display: false, foreground: "", background: "", widthMax: 80, heightMax: 24, signal: controller.signal }
    expect(() => backend.renderSync(request)).toThrow("cancelled")
    await expect(backend.render(request)).rejects.toThrow("cancelled")
  })

  test("recovers incomplete end-of-input constructs without weakening strict parsing", () => {
    const previews = [
      [String.raw`\frac`, "□"],
      [String.raw`\frac{1}{`, "□"],
      ["x^", "□"],
      [String.raw`\left(x`, "(x"],
      [String.raw`\begin{matrix}1&`, "1 □"],
      [String.raw`\text{abc`, "abc"],
      [String.raw`\sqrt[3`, "□"],
    ] as const
    for (const [formula, expected] of previews) expect(renderIncomplete(formula)).toContain(expected)

    expect(() => renderIncomplete("a}b")).toThrow("Unexpected closing TeX group")
    expect(() => renderIncomplete(String.raw`\frac}`)).toThrow("Unexpected closing TeX group")
    expect(() => renderIncomplete(String.raw`\not}`)).toThrow("Unexpected closing TeX group")
    expect(() => renderIncomplete(String.raw`\left(x\right}`)).toThrow("Unexpected closing TeX group")
    expect(() => renderIncomplete(String.raw`\end{matrix}`)).toThrow("Unexpected \\end")
    expect(() => renderIncomplete(String.raw`\begin{matrix}1&&2`)).toThrow("Unexpected token")
    expect(() => renderIncomplete(String.raw`\begin{matrix}1\end{pmatrix}`)).toThrow("Unexpected token")
    expect(() => renderIncomplete(String.raw`\begin{unknown}x`)).toThrow("Unsupported TeX environment")
    expect(() => render(String.raw`\frac`)).toThrow("Expected a TeX argument")
    expect(() => render(String.raw`\left(x\right`)).toThrow("Expected a TeX delimiter")
    expect(renderIncomplete(String.raw`\left(x\right`)).toBe("(x")
    expect(() => render(String.raw`\left(x\rightfoo`)).toThrow("Missing \\right")
    expect(renderIncomplete(String.raw`\left(x\rightfoo`)).toContain(String.raw`\rightfoo`)
    expect(renderIncomplete(String.raw`\begin{matrix}1&   `)).toContain("1 □")
    expect(renderIncomplete(String.raw`\begin{matrix}   `)).toBe("□")
  })

  test("preserves graphemes, root indices, and directives in incomplete input", () => {
    expect(renderIncomplete("x\u0305^")).toBe(" □\nx\u0305")
    expect(renderIncomplete(String.raw`\sqrt[\frac{1}{2}`)).toBe(" 1\n───\n 2 ╭─\n  √ □")
    expect(renderIncomplete(String.raw`\sqrt[a_b]{`)).toBe("a\n b╭─\n √ □")
    expect(renderIncomplete(String.raw`\sum\limits_`)).toBe("∑\n□")
    expect(renderIncomplete(String.raw`x^\displaystyle`)).toBe(" □\nx")
    expect(() => render(String.raw`\sqrt[\frac{1}{2}`)).toThrow('Expected "]"')
    expect(() => render(String.raw`x^\displaystyle`)).toThrow("Expected a TeX argument")
  })
})
