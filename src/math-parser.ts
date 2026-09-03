import type { MathEnvironment, MathNode, MathVariant, SymbolRole } from "./math-types.js"
import { accents, delimiters, namedOperators, operators, spacing, symbols } from "./math-symbols.js"
import { graphemeSegmenter } from "./math-graphemes.js"

export const MAX_NESTING_DEPTH = 256

const environments = new Set<MathEnvironment>([
  "matrix", "pmatrix", "bmatrix", "Bmatrix", "vmatrix", "Vmatrix", "cases", "aligned", "align",
  "gathered", "gather", "smallmatrix", "array",
])

const variants: Readonly<Record<string, MathVariant>> = {
  mathrm: "normal", textrm: "normal", mathnormal: "normal", mathbf: "bold", boldsymbol: "bold", bm: "bold",
  mathit: "italic", mathsf: "sans", mathtt: "monospace", mathbb: "double-struck", mathcal: "script",
  mathscr: "script", mathfrak: "fraktur",
}

export interface MathParseOptions { strict?: boolean }

export function parseMath(source: string, options: MathParseOptions = {}): MathNode {
  return new Parser(source, false, options.strict ?? false).parse()
}

export function parseMathIncomplete(source: string, options: MathParseOptions = {}): MathNode {
  return new Parser(source, true, options.strict ?? false).parse()
}

class Parser {
  private offset = 0
  private depth = 0
  private readonly graphemes: Intl.Segments

  constructor(private readonly source: string, private readonly incomplete: boolean, private readonly strict: boolean) {
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
        const atom = this.parseAtom(body.at(-1), stop)
        if (atom) body.push(atom)
      }
    }
    return body
  }

  private parseAtom(previous?: MathNode, stop?: () => boolean): MathNode | undefined {
    this.depth++
    if (this.depth > MAX_NESTING_DEPTH) this.fail(`TeX nesting exceeds the ${MAX_NESTING_DEPTH}-level limit`)
    try {
      if (this.peek() === "{") return this.parseGroup()
      if (this.peek() === "\\") {
        const atom = this.parseCommand(previous, stop)
        const value = atom && unwrapStyle(atom)
        if (value && "value" in value) value.value += this.readCombiningSuffix()
        return atom
      }
      if (this.peek() === "~") { this.offset++; return { type: "space", width: 1 } }
      const value = this.readLiteral()
      return { type: "symbol", value, role: inferRole(value[0]!) }
    } finally {
      this.depth--
    }
  }

  private parseCommand(previous?: MathNode, stop?: () => boolean): MathNode | undefined {
    const start = this.offset
    const command = this.readCommand()
    if (command === "\\") return row([])
    if (command === "begin") return this.parseEnvironment()
    if (command === "end") this.fail("Unexpected \\end", start)
    if (["frac", "dfrac", "tfrac", "cfrac"].includes(command)) {
      this.skipWhitespace()
      const alignment = command === "cfrac" && this.peek() === "[" ? /^\[([lr]?)(\]|$)/.exec(this.source.slice(this.offset)) : undefined
      if (alignment === null || (alignment && !alignment[2] && (!this.incomplete || this.offset + alignment[0].length !== this.source.length))) {
        this.fail("Unsupported \\cfrac alignment; expected [l], [r], or []")
      }
      if (alignment) this.offset += alignment[0].length
      return {
        type: "fraction", numerator: this.parseArgument(), denominator: this.parseArgument(), bar: true,
        ...(alignment?.[1] ? { numeratorAlign: alignment[1] === "l" ? "left" : "right" } : {}),
      }
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
    if (Object.hasOwn(accents, command)) return { type: "accent", accent: accents[command]!, body: this.parseArgument() }
    if (Object.hasOwn(variants, command)) {
      return { type: "variant", variant: variants[command]!, body: command === "textrm" ? { type: "text", value: this.readTextGroup() } : this.parseArgument() }
    }
    if (command === "text" || command === "mbox") return { type: "text", value: this.readTextGroup() }
    if (command === "operatorname") {
      const limits = this.peek() === "*"
      if (limits) this.offset++
      return { type: "operator", value: this.readTextGroup(), limits }
    }
    if (command === "overset" || command === "stackrel") {
      const over = this.parseArgument(); return { type: "overunder", over, base: this.parseArgument() }
    }
    if (command === "underset") {
      const under = this.parseArgument(); return { type: "overunder", under, base: this.parseArgument() }
    }
    if (command === "overbrace" || command === "underbrace") {
      return { type: "brace", body: this.parseArgument(), position: command === "overbrace" ? "over" : "under" }
    }
    if (command === "textcolor" || command === "color") {
      const color = this.readRawGroup().value
      return { type: "color", color, body: command === "textcolor" ? this.parseArgument() : row(this.parseRow(stop)) }
    }
    if (command === "not") {
      const target = this.parseArgument()
      const symbol = unwrapStyle(target)
      if (symbol.type === "symbol") {
        symbol.value = negate(symbol.value)
        return target
      }
      return { type: "row", body: [{ type: "symbol", value: "¬" }, target] }
    }
    if (command === "pmod") {
      return { type: "row", body: [{ type: "space", width: 1 }, { type: "text", value: "(mod " }, this.parseArgument(), { type: "text", value: ")" }] }
    }
    if (command === "mod" || command === "bmod") return { type: "operator", value: "mod", limits: false }
    if (command === "displaylines") {
      this.skipWhitespace()
      if (this.incomplete && this.done()) return { type: "matrix", environment: "gathered", rows: [[placeholder()]] }
      this.expect("{")
      return this.parseMatrix("gathered", "}")
    }
    if (command === "limits" || command === "nolimits") {
      let base = previous
      while (base?.type === "variant" || base?.type === "color" || base?.type === "scripts") {
        base = base.type === "scripts" ? base.base : base.body
      }
      if (base?.type === "operator") base.limits = command === "limits"
      return undefined
    }
    if (["displaystyle", "textstyle", "scriptstyle", "scriptscriptstyle"].includes(command)) return undefined
    if (/^(?:big|Big|bigg|Bigg)[lrm]?$/.test(command)) return { type: "symbol", value: this.readDelimiter() }
    if (Object.hasOwn(spacing, command)) return { type: "space", width: spacing[command]! }
    if (Object.hasOwn(symbols, command)) return { type: "symbol", ...symbols[command]! }
    if (Object.hasOwn(operators, command)) return { type: "operator", value: operators[command]!, limits: command.includes("int") ? false : "display" }
    if (namedOperators.has(command)) return { type: "operator", value: command, limits: command.startsWith("lim") || ["min", "max"].includes(command) ? "display" : false }
    if (Object.hasOwn(delimiters, command)) return { type: "symbol", value: delimiters[`\\${command}`] ?? delimiters[command]! }
    if (["{", "}", "%", "#", "$", "&", "_", "backslash"].includes(command)) return { type: "symbol", value: command === "backslash" ? "\\" : command }
    if (command === " ") return { type: "space", width: 1 }
    if (this.strict) this.fail(`Unsupported command \\${command}`, start)
    return { type: "text", value: `\\${command}` }
  }

  private parseEnvironment(): MathNode {
    const rawName = this.readRawGroup().value
    const name = rawName.replace(/\*$/, "") as MathEnvironment
    if (!environments.has(name)) this.fail(`Unsupported TeX environment: ${rawName}`)
    return this.parseMatrix(name, `\\end{${rawName}}`, name === "array" ? this.readArrayColumns() : undefined)
  }

  private parseMatrix(environment: MathEnvironment, end: string, columns?: string): MathNode {
    const rows: MathNode[][] = []
    let cells: MathNode[] = []
    while (!this.done()) {
      this.skipWhitespace()
      if (this.done()) break
      if (this.source.startsWith(end, this.offset) && !cells.length) break
      const start = this.offset
      cells.push(row(this.parseRow(() => this.peek() === "&" || this.source.startsWith("\\\\", this.offset) || this.source.startsWith(end, this.offset) || this.isCommand("end"))))
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
      if (this.source.startsWith(end, this.offset)) break
      if (this.offset === start) this.fail(`Unexpected token in ${environment}`)
    }
    const closed = this.source.startsWith(end, this.offset)
    if (!closed && !(this.incomplete && this.done())) this.fail(`Unclosed TeX environment: ${environment}`)
    if (closed) this.offset += end.length
    if (!closed && !rows.length && !cells.length) cells.push(placeholder())
    if (cells.length || !rows.length) rows.push(cells)
    return { type: "matrix", rows, environment, ...(columns !== undefined ? { columns } : {}) }
  }

  private readArrayColumns(): string {
    const group = this.readRawGroup()
    const columns = group.value.replace(/\s/g, "")
    if (/[^lcr|]/.test(columns) || (!/[lcr]/.test(columns) && group.closed)) {
      this.fail("Unsupported array columns; expected l, c, r, and |")
    }
    return columns
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
      const argument = this.parseAtom()
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

  private readTextGroup(): string {
    const group = this.readRawGroup(true)
    return (group.value || (group.closed ? "" : "□"))
      .replace(/\\([A-Za-z@]+|.)/g, (match, command: string) => {
        if ("{}%#$&_ ".includes(command)) return command
        if (command === "textbackslash") return "\\"
        if (command === "!") return ""
        if (Object.hasOwn(spacing, command)) return " ".repeat(Math.max(1, spacing[command]!))
        return match
      })
      .replaceAll("~", " ")
  }

  private readRawGroup(preserveComments = false): { value: string; closed: boolean } {
    this.skipWhitespace()
    if (this.incomplete && this.done()) return { value: "", closed: false }
    this.expect("{")
    let start = this.offset
    const parts: string[] = []
    let depth = 1
    while (!this.done()) {
      const char = this.source[this.offset++]!
      if (char === "%" && !preserveComments && !this.escaped(this.offset - 1)) {
        parts.push(this.source.slice(start, this.offset - 1))
        while (!this.done() && !/[\r\n]/.test(this.peek())) this.offset++
        if (this.peek() === "\r") this.offset++
        if (this.peek() === "\n") this.offset++
        start = this.offset
        continue
      }
      if (char === "{" && !this.escaped(this.offset - 1)) depth++
      else if (char === "}" && !this.escaped(this.offset - 1) && --depth === 0) return { value: parts.join("") + this.source.slice(start, this.offset - 1), closed: true }
      if (depth > MAX_NESTING_DEPTH) this.fail(`TeX nesting exceeds the ${MAX_NESTING_DEPTH}-level limit`)
    }
    if (this.incomplete) return { value: parts.join("") + this.source.slice(start), closed: false }
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
      const start = this.offset
      const command = this.readCommand()
      if (Object.hasOwn(delimiters, command)) return (delimiters[`\\${command}`] ?? delimiters[command]!) + this.readCombiningSuffix()
      if (this.incomplete && this.done() && this.offset === start + 1) return ""
      if (this.strict) this.fail(`Unsupported delimiter \\${command}`, start)
      return command + this.readCombiningSuffix()
    }
    const token = this.peek()
    if (Object.hasOwn(delimiters, token)) {
      this.offset++
      return delimiters[token]! + this.readCombiningSuffix()
    }
    if (this.strict) this.fail(`Unsupported delimiter ${token}`)
    return this.readLiteral()
  }

  private readLiteral(): string {
    const part = this.graphemes.containing(this.offset)!
    // Unicode prepend characters must not absorb TeX control tokens or comments.
    const literal = part.segment.slice(this.offset - part.index)
    const boundary = literal.search(/[\\{}[\]^_~&%\s]/u)
    const value = boundary > 0 ? literal.slice(0, boundary) : literal
    this.offset += value.length
    return value
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

  private isCommand(name: string): boolean {
    if (!this.source.startsWith(`\\${name}`, this.offset)) return false
    return !/[A-Za-z@]/.test(this.source[this.offset + name.length + 1] ?? "")
  }
  private skipWhitespace(): void {
    while (!this.done()) {
      if (/\s/.test(this.peek())) { this.offset++; continue }
      if (this.peek() !== "%") return
      while (!this.done() && !/[\r\n]/.test(this.peek())) this.offset++
    }
  }
  private done(): boolean { return this.offset >= this.source.length }
  private peek(): string { return this.source[this.offset] ?? "" }
  private expect(value: string): void { if (!this.source.startsWith(value, this.offset)) this.fail(`Expected "${value}"`); this.offset += value.length }
  private escaped(index: number): boolean { let count = 0; while (index > count && this.source[index - count - 1] === "\\") count++; return count % 2 === 1 }
  private fail(message: string, offset = this.offset): never { throw new Error(`${message} at offset ${offset}`) }
}

function row(body: MathNode[]): MathNode { return body.length === 1 ? body[0]! : { type: "row", body } }
function placeholder(): MathNode { return { type: "symbol", value: "□" } }

function unwrapStyle(node: MathNode): MathNode {
  while (node.type === "variant" || node.type === "color") node = node.body
  return node
}

function inferRole(value: string): SymbolRole {
  if ("+-*/×÷±∓".includes(value)) return "binary"
  if ("=<>≤≥≠≈∈∉⊂⊃".includes(value)) return "relation"
  if (",;:".includes(value)) return "punctuation"
  if ("([{".includes(value)) return "opening"
  if (")]}".includes(value)) return "closing"
  return "ordinary"
}

function negate(value: string): string {
  return ({
    "=": "≠", "<": "≮", ">": "≯", "≤": "≰", "≥": "≱", "∈": "∉", "∋": "∌", "⊂": "⊄", "⊃": "⊅",
    "≡": "≢", "≈": "≉", "∼": "≁", "⊆": "⊈", "⊇": "⊉", "∣": "∤", "∥": "∦",
  } as Record<string, string>)[value] ?? `${value}̸`
}
