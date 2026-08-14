import { describe, expect, test } from "bun:test"
import stringWidth from "string-width"
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
})
