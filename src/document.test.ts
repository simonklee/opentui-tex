import { describe, expect, test } from "bun:test"
import { FORMULA_COUNT_MAX, FORMULA_LENGTH_MAX, parseDocument, parseInline, SOURCE_LENGTH_MAX } from "./document.js"

describe("parseInline", () => {
  test("separates escaped dollars and formulas", () => {
    expect(parseInline(String.raw`cost \$5 and $x^2$ now`)).toEqual([
      { kind: "text", value: String.raw`cost \$5 and ` },
      { kind: "math", value: "x^2" },
      { kind: "text", value: " now" },
    ])
  })

  test("allows escaped dollars inside a formula", () => {
    expect(parseInline(String.raw`Text $x \$ y$ after`)).toEqual([
      { kind: "text", value: "Text " },
      { kind: "math", value: String.raw`x \$ y` },
      { kind: "text", value: " after" },
    ])
  })

  test("keeps an unclosed delimiter as text", () => {
    expect(parseInline("an $open formula")).toEqual([{ kind: "text", value: "an $open formula" }])
  })
})

describe("parseDocument", () => {
  test("parses markdown headings and math", () => {
    expect(parseDocument("# Notes\n\nEnergy is $E=mc^2$.\n\n$$x^2$$")).toEqual([
      { kind: "heading", level: 1, value: "Notes" },
      { kind: "paragraph", spans: [{ kind: "text", value: "Energy is " }, { kind: "math", value: "E=mc^2" }, { kind: "text", value: "." }] },
      { kind: "math", value: "x^2" },
    ])
  })

  test("rejects unclosed displays", () => {
    expect(() => parseDocument("$$\nx + 1")).toThrow("Unclosed display formula")
  })

  test("bounds source and formulas", () => {
    expect(() => parseDocument("x".repeat(SOURCE_LENGTH_MAX + 1))).toThrow("Source exceeds")
    expect(() => parseDocument(Array.from({ length: FORMULA_COUNT_MAX + 1 }, () => "$x$").join(" "))).toThrow("Content exceeds")
    expect(() => parseDocument(`$${"x".repeat(FORMULA_LENGTH_MAX + 1)}$`)).toThrow("Formula exceeds")
    expect(() => parseDocument(`$${"α".repeat(FORMULA_LENGTH_MAX / 2 + 1)}$`)).toThrow("Formula exceeds")
  })
})
