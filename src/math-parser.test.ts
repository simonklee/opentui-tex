import { describe, expect, test } from "bun:test"
import { MAX_NESTING_DEPTH, parseMath, parseMathIncomplete } from "./math-parser.js"

const empty = { type: "row" as const, body: [] }
const placeholder = { type: "symbol", value: "\u25a1" }

describe("parseMath", () => {
  test.each([
    ["x% ignored }\\unknown\ny", "xy"],
    ["x% ignored\ry", "xy"],
    ["x% ignored at EOF", "x"],
    ["\\frac% ignored\n{x}{y}", "\\frac{x}{y}"],
    ["\\begin{array}{l% ignored }\ncr}x&y&z\\end{array}", "\\begin{array}{lcr}x&y&z\\end{array}"],
    ["\\textcolor{re% ignored\r\nd}{x}", "\\textcolor{red}{x}"],
  ])("skips math comments in %s", (source, expected) => {
    expect(parseMath(source, { strict: true })).toEqual(parseMath(expected, { strict: true }))
  })

  test.each([
    [String.raw`a&&\\&b&`, [[{ value: "a" }, empty, empty], [empty, { value: "b" }, empty]]],
    [String.raw`&=x\\&=y`, [[empty, { type: "row" }], [empty, { type: "row" }]]],
    [String.raw`&&`, [[empty, empty, empty]]],
    [String.raw`a\\`, [[{ value: "a" }]]],
    [String.raw`\\`, [[empty]]],
    ["", [[]]],
  ])("retains empty matrix cells in %s", (source, rows) => {
    for (const environment of ["matrix", "aligned", "align*"]) {
      expect(parseMath(`\\begin{${environment}}${source}\\end{${environment}}`, { strict: true }))
        .toMatchObject({ type: "matrix", environment: environment.replace("*", ""), rows })
    }
  })

  test("keeps nested matrices and displaylines in their enclosing cells and groups", () => {
    expect(parseMath(String.raw`\begin{aligned}&\begin{matrix}a&&b\end{matrix}\\c&\end{aligned}`, { strict: true }))
      .toMatchObject({ rows: [[empty, { type: "matrix", rows: [[{ value: "a" }, empty, { value: "b" }]] }], [{ value: "c" }, empty]] })
    expect(parseMath(String.raw`\displaylines{\frac{1}{2}\\{y}}+z`, { strict: true }))
      .toMatchObject({ type: "row", body: [{ type: "matrix", environment: "gathered", rows: [[{ type: "fraction" }], [{ value: "y" }]] }, { value: "+" }, { value: "z" }] })
    expect(parseMath(String.raw`\displaylines{a&\\&b}`, { strict: true }))
      .toMatchObject({ rows: [[{ value: "a" }, empty], [empty, { value: "b" }]] })
  })

  test("retains array column alignment and rules", () => {
    expect(parseMath(String.raw`\begin{array}{ | l || c r | }a&b&c\end{array}`, { strict: true }))
      .toMatchObject({ type: "matrix", environment: "array", columns: "|l||cr|", rows: [[{ value: "a" }, { value: "b" }, { value: "c" }]] })
  })

  test.each([["", undefined], ["[]", undefined], ["[l]", "left"], ["[r]", "right"]] as const)("parses cfrac alignment %s", (option, numeratorAlign) => {
    expect(parseMath(`\\cfrac${option}{x}{y}`, { strict: true })).toEqual({
      type: "fraction", numerator: parseMath("x"), denominator: parseMath("y"), bar: true,
      ...(numeratorAlign ? { numeratorAlign } : {}),
    })
  })

  test.each([
    ["mathrm", "normal"], ["textrm", "normal"], ["mathnormal", "normal"], ["mathbf", "bold"],
    ["boldsymbol", "bold"], ["bm", "bold"], ["mathit", "italic"], ["mathsf", "sans"],
    ["mathtt", "monospace"], ["mathbb", "double-struck"], ["mathcal", "script"], ["mathscr", "script"], ["mathfrak", "fraktur"],
  ] as const)("preserves the %s variant", (command, variant) => {
    expect(parseMath(`\\${command}{x}`, { strict: true })).toEqual({
      type: "variant", variant, body: command === "textrm" ? { type: "text", value: "x" } : parseMath("x"),
    })
  })

  test.each([["overbrace", "over", "^", "superscript"], ["underbrace", "under", "_", "subscript"]] as const)("preserves %s annotations", (command, position, script, field) => {
    expect(parseMath(`\\${command}{x}${script}{n}`, { strict: true })).toEqual({
      type: "scripts", base: { type: "brace", position, body: parseMath("x") }, [field]: parseMath("n"),
    })
  })

  test("scopes color to its argument or the current row boundary", () => {
    expect(parseMath(String.raw`\textcolor{red}{x}+y`, { strict: true }))
      .toMatchObject({ body: [{ type: "color", color: "red", body: { value: "x" } }, { value: "+" }, { value: "y" }] })
    expect(parseMath(String.raw`{\color{red}xy}z`, { strict: true }))
      .toMatchObject({ body: [{ type: "color", color: "red", body: { body: [{ value: "x" }, { value: "y" }] } }, { value: "z" }] })
    expect(parseMath(String.raw`\begin{matrix}\color{red}x&y\\z\end{matrix}`, { strict: true }))
      .toMatchObject({ rows: [[{ type: "color", color: "red", body: { value: "x" } }, { value: "y" }], [{ value: "z" }]] })
    expect(parseMath(String.raw`\left(\color{red}x\right)`, { strict: true }))
      .toMatchObject({ type: "delimited", body: { type: "color", body: { value: "x" } }, right: ")" })
    expect(parseMath(String.raw`\sqrt[\color{red}3]{x}`, { strict: true }))
      .toMatchObject({ type: "root", index: { type: "color", body: { value: "3" } }, body: { value: "x" } })
  })

  test.each([
    [String.raw`\text{left \{ right \} \% \# \$ \& \_ \ }`, "left { right } % # $ & _  "],
    [String.raw`\text{a\,b\:c\;d\!e~f\textbackslash!}`, "a b c de f\\!"],
    [String.raw`\mbox{\quad!\qquad!\enspace!\thinspace!}`, "  !    ! ! !"],
    ["\\text{100% raw\ntext}", "100% raw\ntext"],
    [String.raw`\text{\unknown}`, String.raw`\unknown`],
  ])("decodes raw text escapes in %s", (source, value) => {
    expect(parseMath(source, { strict: true })).toEqual({ type: "text", value })
  })

  test("retains text whitespace and operatorname star limits", () => {
    expect(parseMath(String.raw`\textrm{ if }`, { strict: true })).toEqual({ type: "variant", variant: "normal", body: { type: "text", value: " if " } })
    for (const star of ["", "*"]) {
      expect(parseMath(`\\operatorname${star}{arg\\,max}_x`, { strict: true }))
        .toMatchObject({ type: "scripts", base: { type: "operator", value: "arg max", limits: star === "*" } })
    }
    expect(parseMath(String.raw`\pmod{x}`, { strict: true })).toEqual({ type: "row", body: [
      { type: "space", width: 1 }, { type: "text", value: "(mod " }, parseMath("x"), { type: "text", value: ")" },
    ] })
    for (const command of ["mod", "bmod"]) expect(parseMath(`\\${command}`, { strict: true })).toEqual({ type: "operator", value: "mod", limits: false })
  })

  test.each(["arccos", "arcsin", "arctan", "arg", "cosh", "cot", "coth", "csc", "deg", "dim", "hom", "lg", "Pr", "sec", "sinh", "tanh", "liminf", "limsup"])("recognizes named operator %s", (command) => {
    expect(parseMath(`\\${command}`, { strict: true })).toEqual({ type: "operator", value: command, limits: command.startsWith("lim") ? "display" : false })
  })

  test.each([
    ["imath", "\u0131"], ["jmath", "\u0237"], ["beth", "\u2136"], ["daleth", "\u2138"],
    ["measuredangle", "\u2221"], ["lozenge", "\u25ca"], ["nexists", "\u2204"], ["clubsuit", "\u2663"],
    ["uplus", "\u228e"], ["sqcup", "\u2294"], ["wr", "\u2240"], ["triangleleft", "\u25c1"],
    ["equals", "="], ["asymp", "\u224d"], ["preceq", "\u2aaf"], ["sqsubseteq", "\u2291"], ["owns", "\u220b"],
    ["mid", "\u2223"], ["dashv", "\u22a3"], ["smile", "\u2323"], ["hookrightarrow", "\u21aa"],
    ["rightharpoonup", "\u21c0"], ["rightleftharpoons", "\u21cc"], ["Longrightarrow", "\u27f9"],
    ["longmapsto", "\u27fc"], ["Updownarrow", "\u21d5"], ["nwarrow", "\u2196"],
    ["epsilon", "\u03f5"], ["varepsilon", "\u03b5"], ["degree", "\u00b0"],
  ])("recognizes symbol %s", (command, value) => {
    expect(parseMath(`\\${command}`, { strict: true })).toMatchObject({ type: "symbol", value })
  })

  test.each([["bigoplus", "\u2a01"], ["bigotimes", "\u2a02"], ["bigodot", "\u2a00"]])("recognizes large operator %s", (command, value) => {
    expect(parseMath(`\\${command}`, { strict: true })).toEqual({ type: "operator", value, limits: "display" })
  })

  test.each([
    ["=", "\u2260"], ["<", "\u226e"], [">", "\u226f"], ["\\leq", "\u2270"], ["\\geq", "\u2271"],
    ["\\in", "\u2209"], ["\\ni", "\u220c"], ["\\subset", "\u2284"], ["\\supset", "\u2285"],
    ["\\equiv", "\u2262"], ["\\approx", "\u2249"], ["\\sim", "\u2241"], ["\\subseteq", "\u2288"],
    ["\\supseteq", "\u2289"], ["\\mid", "\u2224"], ["\\parallel", "\u2226"], ["x", "x\u0338"],
  ])("uses precomposed negation for %s when available", (source, value) => {
    expect(parseMath(`\\not ${source}`, { strict: true })).toMatchObject({ type: "symbol", value })
  })

  test.each([["lvert", "rvert", "\u2502"], ["lVert", "rVert", "\u2551"], ["lbrace", "rbrace", "{"]])("recognizes delimiter aliases %s/%s", (left, right, value) => {
    expect(parseMath(`\\left\\${left} x\\right\\${right}`, { strict: true })).toMatchObject({ type: "delimited", left: value })
    expect(parseMath(`\\${left}`, { strict: true })).toEqual({ type: "symbol", value })
  })

  test("preserves transparent directives and forced inline limits", () => {
    for (const directive of ["displaystyle", "textstyle", "scriptstyle", "scriptscriptstyle"]) {
      expect(parseMath(`x^\\${directive}2`, { strict: true })).toEqual(parseMath("x^2"))
      expect(parseMath(`\\sum\\${directive}_1^2`, { strict: true })).toEqual(parseMath(String.raw`\sum_1^2`))
    }
    for (const [source, limits] of [[String.raw`\sum\limits_1^2`, true], [String.raw`\sum^2\nolimits_1`, false], [String.raw`\int\limits_1^2`, true]] as const) {
      expect(parseMath(source, { strict: true })).toMatchObject({ type: "scripts", base: { type: "operator", limits } })
    }
    expect(parseMath(String.raw`\mathbf{\sum}\limits_1^2`, { strict: true }))
      .toMatchObject({ type: "scripts", base: { type: "variant", body: { type: "operator", limits: true } } })
  })

  test.each([String.raw`\unknown`, String.raw`\constructor`, String.raw`\toString`])("keeps %s permissive by default and rejects it in strict mode", (source) => {
    for (const parse of [parseMath, parseMathIncomplete]) {
      expect(parse(source)).toEqual({ type: "text", value: source })
      expect(() => parse(source, { strict: true })).toThrow("Unsupported command")
    }
  })

  test.each([String.raw`\left\unknown x\right)`, String.raw`\left(x\right\unknown`, String.raw`\big\unknown`, String.raw`\left(x\middle\unknown y\right)`, String.raw`\left ax\right)`])("rejects unsupported delimiters only in strict mode: %s", (source) => {
    for (const parse of [parseMath, parseMathIncomplete]) {
      expect(() => parse(source)).not.toThrow()
      expect(() => parse(source, { strict: true })).toThrow("Unsupported delimiter")
    }
  })

  test.each([
    String.raw`a}b`, String.raw`\frac}`, String.raw`\not}`, String.raw`\end{matrix}`, String.raw`\begin{unknown}x`,
    String.raw`\begin{matrix}x}`, String.raw`\begin{matrix}&}`, String.raw`\begin{matrix}1\end{pmatrix}`,
    String.raw`\begin{array}x`, String.raw`\begin{array}{}x`, String.raw`\begin{array}{||}x`,
    String.raw`\begin{array}{p{2cm}}x`, String.raw`\begin{array}{*{2}{c}}x`, String.raw`\begin{array}{c@{}c}x`,
    String.raw`\begin{array}{lXr}x`, String.raw`\cfrac[c]12`, String.raw`\cfrac[lr]12`, String.raw`\cfrac[l{1}{2}`, "\\cfrac[l\n",
    "\\begin{array}{% comment\n}",
    String.raw`\displaylines[l]{x}`, String.raw`\left(x\right}`,
  ])("does not recover malformed non-EOF syntax: %s", (source) => {
    for (const parse of [parseMath, parseMathIncomplete]) expect(() => parse(source, { strict: true })).toThrow()
  })

  test.each([
    [String.raw`\frac`, { type: "fraction", numerator: placeholder, denominator: placeholder }],
    [String.raw`\frac{1}{`, { type: "fraction", numerator: { value: "1" }, denominator: placeholder }],
    ["x^", { type: "scripts", superscript: placeholder }],
    [String.raw`x^\displaystyle`, { type: "scripts", superscript: placeholder }],
    [String.raw`\left(x`, { type: "delimited", left: "(", body: { value: "x" }, right: "" }],
    [String.raw`\left(x\right`, { type: "delimited", body: { value: "x" }, right: "" }],
    ["\\left(x\\right\\", { type: "delimited", body: { value: "x" }, right: "" }],
    [String.raw`\sqrt[3`, { type: "root", index: { value: "3" }, body: placeholder }],
    [String.raw`\text{abc`, { type: "text", value: "abc" }],
    [String.raw`\operatorname*`, { type: "operator", value: "\u25a1", limits: true }],
    [String.raw`\overbrace{`, { type: "brace", position: "over", body: placeholder }],
    [String.raw`\mathbb`, { type: "variant", variant: "double-struck", body: placeholder }],
    [String.raw`\textcolor{red}{`, { type: "color", color: "red", body: placeholder }],
    [String.raw`\displaylines{a\\b`, { type: "matrix", environment: "gathered", rows: [[{ value: "a" }], [{ value: "b" }]] }],
    [String.raw`\begin{matrix}1&&`, { type: "matrix", rows: [[{ value: "1" }, empty, placeholder]] }],
    ["\\begin{matrix}1& % comment", { type: "matrix", rows: [[{ value: "1" }, placeholder]] }],
    [String.raw`\begin{array}`, { type: "matrix", columns: "", rows: [[placeholder]] }],
    [String.raw`\begin{array}{|`, { type: "matrix", columns: "|", rows: [[placeholder]] }],
    [String.raw`\begin{array}{% comment }`, { type: "matrix", columns: "", rows: [[placeholder]] }],
    [String.raw`\begin{array}{lr`, { type: "matrix", columns: "lr", rows: [[placeholder]] }],
    [String.raw`\cfrac[`, { type: "fraction", numerator: placeholder, denominator: placeholder }],
    [String.raw`\cfrac[l`, { type: "fraction", numeratorAlign: "left", numerator: placeholder, denominator: placeholder }],
    [String.raw`\cfrac[r`, { type: "fraction", numeratorAlign: "right", numerator: placeholder, denominator: placeholder }],
  ])("recovers supported EOF prefixes only in incomplete mode: %s", (source, expected) => {
    expect(parseMathIncomplete(source, { strict: true })).toMatchObject(expected)
    expect(() => parseMath(source, { strict: true })).toThrow()
  })

  test.each([
    (depth: number) => "{".repeat(depth) + "}".repeat(depth),
    (depth: number) => String.raw`\frac`.repeat(depth) + "x",
    (depth: number) => String.raw`\mathbb{`.repeat(depth) + "x" + "}".repeat(depth),
    (depth: number) => String.raw`\displaylines{`.repeat(depth) + "x" + "}".repeat(depth),
    (depth: number) => String.raw`\color{red}`.repeat(depth) + "x",
    (depth: number) => String.raw`\text{` + "{".repeat(depth) + "}".repeat(depth) + "}",
  ])("bounds recursive and raw nesting", (source) => {
    for (const parse of [parseMath, parseMathIncomplete]) expect(() => parse(source(MAX_NESTING_DEPTH + 1))).toThrow("256-level limit")
  })

  test("allows group-only nesting through the existing limit", () => {
    expect(parseMath("{".repeat(MAX_NESTING_DEPTH) + "}".repeat(MAX_NESTING_DEPTH))).toEqual(empty)
    expect(parseMath("{".repeat(MAX_NESTING_DEPTH - 1) + "x" + "}".repeat(MAX_NESTING_DEPTH - 1))).toEqual(parseMath("x"))
  })

  test("preserves graphemes without absorbing syntax or comments", () => {
    for (const suffix of ["{x}", "^2", "_2", String.raw`\alpha`, "~x", "% ignored\nx"]) {
      expect(parseMath("\u0600" + suffix)).toEqual(parseMath("\u0600 " + suffix))
    }
    expect(parseMath("\\frac x\u0305\u{1f469}\u200d\u{1f52c}", { strict: true }))
      .toMatchObject({ numerator: { value: "x\u0305" }, denominator: { value: "\u{1f469}\u200d\u{1f52c}" } })
    expect(parseMath("\\alpha\u0305^2", { strict: true })).toMatchObject({ type: "scripts", base: { value: "\u03b1\u0305" } })
    expect(parseMath("\\left\\langle\u0305x\\right\\rangle\u0305", { strict: true }))
      .toMatchObject({ left: "\u27e8\u0305", right: "\u27e9\u0305" })
    expect(parseMath("\\left\u{1f431}x\\right\u{1f436}"))
      .toMatchObject({ left: "\u{1f431}", right: "\u{1f436}", body: { value: "x" } })
    expect(parseMath("\\%\u0305", { strict: true })).toEqual({ type: "symbol", value: "%\u0305" })
    expect(parseMathIncomplete("\\bm x\u0305^", { strict: true }))
      .toMatchObject({ type: "scripts", base: { type: "variant", body: { value: "x\u0305" } }, superscript: placeholder })
    expect(parseMath("\\begin{matrix}\u0600&&x\\end{matrix}"))
      .toMatchObject({ rows: [[{ value: "\u0600" }, empty, { value: "x" }]] })
  })
})
