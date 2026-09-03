export type SymbolRole = "ordinary" | "binary" | "relation" | "operator" | "punctuation" | "opening" | "closing"

export type MathEnvironment =
  | "matrix" | "pmatrix" | "bmatrix" | "Bmatrix" | "vmatrix" | "Vmatrix"
  | "cases" | "aligned" | "align" | "gathered" | "gather" | "smallmatrix" | "array"

export type AccentKind = "hat" | "widehat" | "bar" | "overline" | "underline" | "vec" | "tilde" | "dot" | "ddot"

export type MathVariant = "normal" | "bold" | "italic" | "sans" | "monospace" | "double-struck" | "script" | "fraktur"

export interface MathStyle {
  color?: string
  bold?: boolean
  italic?: boolean
}

export interface MathCell {
  char: string
  style?: MathStyle
}

export type MathNode =
  | { type: "row"; body: MathNode[] }
  | { type: "symbol"; value: string; role?: SymbolRole }
  | { type: "text"; value: string }
  | { type: "space"; width: number }
  | { type: "fraction"; numerator: MathNode; denominator: MathNode; bar: boolean; numeratorAlign?: "left" | "right" }
  | { type: "root"; body: MathNode; index?: MathNode }
  | { type: "scripts"; base: MathNode; superscript?: MathNode; subscript?: MathNode }
  | { type: "delimited"; left: string; body: MathNode; right: string }
  | { type: "matrix"; rows: MathNode[][]; environment: MathEnvironment; columns?: string }
  | { type: "accent"; accent: AccentKind; body: MathNode }
  | { type: "brace"; body: MathNode; position: "over" | "under" }
  | { type: "variant"; variant: MathVariant; body: MathNode }
  | { type: "color"; color: string; body: MathNode }
  | { type: "operator"; value: string; limits: boolean | "display" }
  | { type: "overunder"; base: MathNode; over?: MathNode; under?: MathNode }

export interface MathBox {
  width: number
  height: number
  baseline: number
  cells: Array<Array<MathCell | undefined>>
}
