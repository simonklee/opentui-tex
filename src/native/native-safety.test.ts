import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "bun:test"

const fixture = fileURLToPath(new URL("./fixtures/regression.ts", import.meta.url))

function isolated(input: unknown) {
  const args = [process.execPath, fixture, JSON.stringify(input)]
  // The parent enforces the timeout even when native code blocks the child's event loop.
  const result = process.platform === "win32"
    ? spawnSync(args[0]!, args.slice(1), { timeout: 3000, killSignal: "SIGKILL", maxBuffer: 64 * 1024 })
    : spawnSync("bash", ["-c", 'ulimit -c 0; exec "$@"', "native-regression", ...args], {
      timeout: 3000, killSignal: "SIGKILL", maxBuffer: 64 * 1024,
    })
  expect({ status: result.status, signal: result.signal, error: result.error?.message, stderr: result.stderr?.toString() })
    .toEqual({ status: 0, signal: null, error: undefined, stderr: "" })
}

describe("native safety boundaries", () => {
  const invalid: [string, string | number[]][] = [
    ["C++ parse exception", "}"],
    ["exception after glyph allocation", String.raw`\frac{x}{y}}`],
    ["unsupported CJK glyph", "x+\u4e2d"],
    ["unsupported emoji", "x+\u{1f600}"],
    ["unsupported glyph via command", String.raw`x+\char"4E2D`],
    ["malformed UTF-8", [0x78, 0x2b, 0xff]],
    ["embedded NUL", "x\0}"],
    ["self-recursive macro", String.raw`\newcommand{\zzzz}{\zzzz}\zzzz`],
    ["mutually recursive macros", String.raw`\newcommand{\aaaa}{\bbbb}\newcommand{\bbbb}{\aaaa}\aaaa`],
    ["growing macro", String.raw`\newcommand{\growa}{x\growa}\growa`],
    ["branching macro", String.raw`\newcommand{\growb}{\growb\growb}\growb`],
    ["doubling macro argument", String.raw`\newcommand{\growc}[1]{\growc{#1#1}}\growc{x}`],
    ["recursive environment", String.raw`\newenvironment{loopa}{\begin{loopa}}{\end{loopa}}\begin{loopa}x\end{loopa}`],
    ["excessive nesting", "{".repeat(256) + "x" + "}".repeat(256)],
    ["excessive argument nesting", String.raw`\frac`.repeat(256) + "{x}{y}"],
    ["depth limit after left delimiter allocation", String.raw`\left\sqrt{x}` + "{".repeat(80) + "y" + "}".repeat(80) + String.raw`\right)`],
    ["excessive macro argument count", String.raw`\newcommand{\argcount}[99999999]{x}\argcount`],
    ["self-recursive column alias", String.raw`\newcolumntype{X}{X}\begin{array}{X}x\end{array}`],
    ["mutually recursive column aliases", String.raw`\newcolumntype{X}{Y}\newcolumntype{Y}{X}\begin{array}{X}x\end{array}`],
    ["growing column alias", String.raw`\newcolumntype{X}{cX}\begin{array}{X}x\end{array}`],
    ["nested column alias", String.raw`\newcolumntype{X}{@{\begin{array}{X}x\end{array}}c}\begin{array}{X}x\end{array}`],
    ["oversized column repetition", String.raw`\begin{array}{*{70000}{c}}x\end{array}`],
    ["overflowing column repetition", String.raw`\begin{array}{*{999999999999999999999999}{c}}x\end{array}`],
    ["oversized empty column repetition", String.raw`\begin{array}{*{70000}{}}x\end{array}`],
    ["negative column repetition", String.raw`\begin{array}{*{-1}{c}}x\end{array}`],
    ["empty column repetition", String.raw`\begin{array}{*{}{c}}x\end{array}`],
    ["sign-only column repetition", String.raw`\begin{array}{*{+}{c}}x\end{array}`],
    ["comment deletion work limit", String.raw`\newcommand{\comments}[1]{` + "#1".repeat(28) + String.raw`}\comments{` + "%\n".repeat(1000) + "}x"],
  ]
  for (const [name, source] of invalid) {
    test(`rejects ${name} and recovers`, () => isolated({ source, status: 2 }))
  }

  test("renders bounded macro expansion", () => {
    isolated({ source: String.raw`\newcommand{\bounded}[1]{\frac{#1}{2}}\bounded{x}`, status: 0 })
  })

  const bounded = [
    [String.raw`\newcolumntype{X}{c}\begin{array}{X}x\end{array}`, String.raw`\begin{array}{c}x\end{array}`],
    [String.raw`\begin{array}{*{ 2 }{c}}x&y\end{array}`, String.raw`\begin{array}{cc}x&y\end{array}`],
    [String.raw`\begin{array}{*{ +2 }{c}}x&y\end{array}`, String.raw`\begin{array}{cc}x&y\end{array}`],
    [String.raw`\begin{array}{*{0}{c}c}x\end{array}`, String.raw`\begin{array}{c}x\end{array}`],
    ["x% ignored\n+y", "x+y"],
    ["x% ignored\r\n+y% end", "x+y"],
    [String.raw`x\%` + "% ignored\n+y", String.raw`x\%+y`],
  ]
  for (const [source, equivalent] of bounded) {
    test(`preserves bounded expansion and comments: ${JSON.stringify(source)}`, () => isolated({ source, equivalent, status: 0 }))
  }

  for (const name of ["matrix", "smallmatrix", "array", "align", "flalign", "alignat", "aligned", "alignedat", "multline", "gather", "gathered"]) {
    test(`recovers from partial ${name} boxing`, () => {
      const args = name === "array" ? "{cc}" : name === "alignat" || name === "alignedat" ? "{1}" : ""
      const source = `\\begin{${name}}${args}` + String.raw`x&\genfrac{bad}{)}{0pt}{0}{1}{2}` + `\\end{${name}}`
      isolated({ source, status: 2 })
    })

    test(`recovers from partial ${name} allocation`, () => {
      const args = name === "array" ? "{c}" : name === "alignat" || name === "alignedat" ? "{1}" : ""
      const source = `\\begin{${name}}${args}` + "x&".repeat(1000) + "{".repeat(80) + "y" + "}".repeat(80) + `\\end{${name}}`
      isolated({ source, status: 2 })
    })
  }

  test("renders supported Unicode paths", () => isolated({ source: "x+\u03b1", status: 0 }))
  test("display and inline match explicit TeX styles", () => isolated("styles"))
})
