import type { MathEnvironment, MathNode, SymbolRole } from "./math-types.js"
import { accents, delimiters, namedOperators, operators, spacing, symbols } from "./math-symbols.js"
import { graphemeSegmenter } from "./math-graphemes.js"

export const MAX_NESTING_DEPTH = 256

const environments = new Set<MathEnvironment>([
  "matrix", "pmatrix", "bmatrix", "Bmatrix", "vmatrix", "Vmatrix", "cases", "aligned", "align",
  "gathered", "gather", "smallmatrix", "array",
])

export function parseMath(source: string): MathNode {
  return new Parser(source).parse()
}

export function parseMathIncomplete(source: string): MathNode {
  return new Parser(source, true).parse()
}

class Parser {
  private offset = 0
  private depth = 0
  private readonly graphemes: Intl.Segments

  constructor(private readonly source: string, private readonly incomplete = false) {
    this.graphemes = graphemeSegmenter.segment(source)
  }

  parse(): MathNode {
    const result = row(this.parseRow())
    this.skipWhitespace()
    if (!this.done()) this.fail(this.peek() === "}" ? "Unexpected closing TeX group" : `Unexpected "${this.peek()}"`)
    return result
  }

  private parseRow(stop?: () => boolean): MathNode[] {
    const body: MathNode[] = []
    while (!this.done()) {
      this.skipWhitespace()
      if (this.done() || stop?.() || this.peek() === "}") break
      const char = this.peek()
      if (char === "^" || char === "_") {
        this.offset++
        const argument = this.parseArgument()
        const previous = body.pop() ?? row([])
        const scripts = previous.type === "scripts" ? previous : { type: "scripts" as const, base: previous }
        if (char === "^") scripts.superscript = argument
        else scripts.subscript = argument
        body.push(scripts)
      } else {
        const atom = this.parseAtom(body.at(-1))
        if (atom) body.push(atom)
      }
    }
    return body
  }

  private parseAtom(previous?: MathNode): MathNode | undefined {
    this.depth++
    if (this.depth > MAX_NESTING_DEPTH) this.fail(`TeX nesting exceeds the ${MAX_NESTING_DEPTH}-level limit`)
    try {
      if (this.peek() === "{") return this.parseGroup()
      if (this.peek() === "\\") {
        const atom = this.parseCommand(previous)
        if (atom && "value" in atom) atom.value += this.readCombiningSuffix()
        return atom
      }
      if (this.peek() === "~") { this.offset++; return { type: "space", width: 1 } }
      const part = this.graphemes.containing(this.offset)!
      // Unicode prepend characters must not absorb TeX control tokens.
      const literal = part.segment.slice(this.offset - part.index)
      const boundary = literal.search(/[\\{}[\]^_~&\s]/u)
      const value = boundary > 0 ? literal.slice(0, boundary) : literal
      this.offset += value.length
      return { type: "symbol", value, role: inferRole(value[0]!) }
    } finally {
      this.depth--
    }
  }

  private parseCommand(previous?: MathNode): MathNode | undefined {
    const start = this.offset
    const command = this.readCommand()
    if (command === "\\") return row([])
    if (command === "begin") return this.parseEnvironment()
    if (command === "end") this.fail("Unexpected \\end", start)
    if (["frac", "dfrac", "tfrac", "cfrac"].includes(command)) {
      return { type: "fraction", numerator: this.parseArgument(), denominator: this.parseArgument(), bar: true }
    }
    if (["binom", "dbinom", "tbinom"].includes(command)) {
      return { type: "delimited", left: "(", body: { type: "fraction", numerator: this.parseArgument(), denominator: this.parseArgument(), bar: false }, right: ")" }
    }
    if (command === "sqrt") {
      const index = this.optionalArgument()
      return { type: "root", body: this.parseArgument(), ...(index ? { index } : {}) }
    }
    if (command === "left") return this.parseLeftRight()
    if (command === "right") this.fail("Unexpected \\right", start)
    if (command === "middle") return { type: "symbol", value: this.readDelimiter() }
    if (command in accents) return { type: "accent", accent: accents[command]!, body: this.parseArgument() }
    if (["mathrm", "mathbf", "mathit", "mathsf", "mathtt", "mathbb", "mathcal", "mathfrak"].includes(command)) {
      return this.parseArgument()
    }
    if (["text", "textrm", "mbox"].includes(command)) {
      return { type: "text", value: this.readRawGroup().replace(/\\([{}%#$&_])/g, "$1").replaceAll("~", " ") }
    }
    if (command === "operatorname") return { type: "operator", value: this.readRawGroup(), limits: false }
    if (command === "overset" || command === "stackrel") {
      const over = this.parseArgument(); return { type: "overunder", over, base: this.parseArgument() }
    }
    if (command === "underset") {
      const under = this.parseArgument(); return { type: "overunder", under, base: this.parseArgument() }
    }
    if (command === "not") {
      const target = this.parseArgument()
      if (target.type === "symbol") return { ...target, value: negate(target.value) }
      return { type: "row", body: [{ type: "symbol", value: "¬" }, target] }
    }
    if (command === "limits" || command === "nolimits") {
      const base = previous?.type === "scripts" ? previous.base : previous
      if (base?.type === "operator") base.limits = command === "limits"
      return undefined
    }
    if (["displaystyle", "textstyle", "scriptstyle", "scriptscriptstyle"].includes(command)) return undefined
    if (/^(?:big|Big|bigg|Bigg)[lrm]?$/.test(command)) return { type: "symbol", value: this.readDelimiter() }
    if (command in spacing) return { type: "space", width: spacing[command]! }
    if (command in symbols) return { type: "symbol", ...symbols[command]! }
    if (command in operators) return { type: "operator", value: operators[command]!, limits: command.includes("int") ? false : "display" }
    if (namedOperators.has(command)) return { type: "operator", value: command, limits: ["lim", "min", "max"].includes(command) ? "display" : false }
    if (command in delimiters) return { type: "symbol", value: delimiters[`\\${command}`] ?? delimiters[command]! }
    if (["{", "}", "%", "#", "$", "&", "_", "backslash"].includes(command)) return { type: "symbol", value: command === "backslash" ? "\\" : command }
    return { type: "text", value: `\\${command}` }
  }

  private parseEnvironment(): MathNode {
    const rawName = this.readRawGroup()
    const name = rawName.replace(/\*$/, "") as MathEnvironment
    if (!environments.has(name)) this.fail(`Unsupported TeX environment: ${rawName}`)
    if (name === "array") { this.skipWhitespace(); if (this.peek() === "{") this.readRawGroup() }
    const rows: MathNode[][] = []
    let cells: MathNode[] = []
    while (!this.done()) {
      this.skipWhitespace()
      if (this.done()) break
      if (this.isEnd(rawName)) {
        this.offset += `\\end{${rawName}}`.length
        if (cells.length || !rows.length) rows.push(cells)
        return { type: "matrix", rows, environment: name }
      }
      const start = this.offset
      cells.push(row(this.parseRow(() => this.peek() === "&" || this.source.startsWith("\\\\", this.offset) || this.source.startsWith("\\end{", this.offset))))
      if (this.offset === start) this.fail(`Unexpected token in ${rawName}`)
      this.skipWhitespace()
      if (this.peek() === "&") {
        this.offset++
        this.skipWhitespace()
        if (this.incomplete && this.done()) cells.push(placeholder())
        continue
      }
      if (this.source.startsWith("\\\\", this.offset)) {
        this.offset += 2; this.skipOptionalRowSpacing(); rows.push(cells); cells = []; continue
      }
    }
    if (this.incomplete) {
      if (cells.length) rows.push(cells)
      else if (!rows.length) rows.push([placeholder()])
      return { type: "matrix", rows, environment: name }
    }
    this.fail(`Unclosed TeX environment: ${rawName}`)
  }

  private parseLeftRight(): MathNode {
    const left = this.readDelimiter()
    const nodes = this.parseRow(() => this.isCommand("right"))
    const body = row(nodes)
    if (!this.isCommand("right")) {
      if (this.incomplete && this.done()) return { type: "delimited", left, body: nodes.length ? body : placeholder(), right: "" }
      this.fail("Missing \\right")
    }
    this.readCommand()
    return { type: "delimited", left, body, right: this.readDelimiter() }
  }

  private parseArgument(): MathNode {
    while (true) {
      this.skipWhitespace()
      if (this.done()) {
        if (this.incomplete) return placeholder()
        this.fail("Expected a TeX argument")
      }
      if (this.peek() === "}") this.fail("Unexpected closing TeX group")
      const argument = this.peek() === "{" ? this.parseGroup() : this.parseAtom()
      if (argument) return argument
    }
  }

  private parseGroup(): MathNode {
    this.expect("{")
    const nodes = this.parseRow()
    const result = row(nodes)
    if (this.peek() !== "}") {
      if (this.incomplete && this.done()) return nodes.length ? result : placeholder()
      this.fail("Unclosed TeX group")
    }
    this.offset++
    return result
  }

  private optionalArgument(): MathNode | undefined {
    this.skipWhitespace()
    if (this.peek() !== "[") return undefined
    this.offset++
    const nodes = this.parseRow(() => this.peek() === "]")
    const result = row(nodes)
    if (this.peek() !== "]") {
      if (this.incomplete && this.done()) return nodes.length ? result : placeholder()
      this.fail('Expected "]"')
    }
    this.offset++
    return result
  }

  private readRawGroup(): string {
    this.skipWhitespace(); this.expect("{")
    const start = this.offset
    let depth = 1
    while (!this.done()) {
      const char = this.source[this.offset++]!
      if (char === "{" && !this.escaped(this.offset - 1)) depth++
      else if (char === "}" && !this.escaped(this.offset - 1) && --depth === 0) return this.source.slice(start, this.offset - 1)
      if (depth > MAX_NESTING_DEPTH) this.fail(`TeX nesting exceeds the ${MAX_NESTING_DEPTH}-level limit`)
    }
    if (this.incomplete) return this.source.slice(start) || "□"
    this.fail("Unclosed TeX group", start)
  }

  private readCommand(): string {
    this.expect("\\")
    if (this.done()) return "\\"
    if (!/[A-Za-z@]/.test(this.peek())) return this.source[this.offset++]!
    const start = this.offset
    while (/[A-Za-z@]/.test(this.peek())) this.offset++
    const result = this.source.slice(start, this.offset)
    if (this.peek() === " ") this.offset++
    return result
  }

  private readDelimiter(): string {
    this.skipWhitespace()
    if (this.done()) {
      if (this.incomplete) return ""
      this.fail("Expected a TeX delimiter")
    }
    if (this.peek() === "}") this.fail("Unexpected closing TeX group")
    if (this.peek() === "\\") {
      const command = this.readCommand()
      return (delimiters[`\\${command}`] ?? delimiters[command] ?? command) + this.readCombiningSuffix()
    }
    const token = this.source[this.offset++] ?? ""
    return (delimiters[token] ?? token) + this.readCombiningSuffix()
  }

  private readCombiningSuffix(): string {
    if (this.done()) return ""
    const part = this.graphemes.containing(this.offset)!
    const suffix = part.segment.slice(this.offset - part.index).match(/^\p{Mark}+/u)?.[0] ?? ""
    this.offset += suffix.length
    return suffix
  }

  private skipOptionalRowSpacing(): void {
    this.skipWhitespace()
    if (this.peek() !== "[") return
    while (!this.done() && this.source[this.offset++] !== "]") {}
  }

  private isEnd(name: string): boolean { return this.source.startsWith(`\\end{${name}}`, this.offset) }
  private isCommand(name: string): boolean {
    if (!this.source.startsWith(`\\${name}`, this.offset)) return false
    return !/[A-Za-z@]/.test(this.source[this.offset + name.length + 1] ?? "")
  }
  private skipWhitespace(): void { while (/\s/.test(this.peek())) this.offset++ }
  private done(): boolean { return this.offset >= this.source.length }
  private peek(): string { return this.source[this.offset] ?? "" }
  private expect(value: string): void { if (!this.source.startsWith(value, this.offset)) this.fail(`Expected "${value}"`); this.offset += value.length }
  private escaped(index: number): boolean { let count = 0; while (index > count && this.source[index - count - 1] === "\\") count++; return count % 2 === 1 }
  private fail(message: string, offset = this.offset): never { throw new Error(`${message} at offset ${offset}`) }
}

function row(body: MathNode[]): MathNode { return body.length === 1 ? body[0]! : { type: "row", body } }
function placeholder(): MathNode { return { type: "symbol", value: "□" } }

function inferRole(value: string): SymbolRole {
  if ("+-*/×÷±∓".includes(value)) return "binary"
  if ("=<>≤≥≠≈∈∉⊂⊃".includes(value)) return "relation"
  if (",;:".includes(value)) return "punctuation"
  if ("([{".includes(value)) return "opening"
  if (")]}".includes(value)) return "closing"
  return "ordinary"
}

function negate(value: string): string {
  return ({ "=": "≠", "<": "≮", ">": "≯", "≤": "≰", "≥": "≱", "∈": "∉", "∋": "∌", "⊂": "⊄", "⊃": "⊅" } as Record<string, string>)[value] ?? `${value}̸`
}
