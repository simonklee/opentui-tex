export type SymbolRole = "ordinary" | "binary" | "relation" | "operator" | "punctuation" | "opening" | "closing"

export type MathEnvironment =
  | "matrix" | "pmatrix" | "bmatrix" | "Bmatrix" | "vmatrix" | "Vmatrix"
  | "cases" | "aligned" | "align" | "gathered" | "gather" | "smallmatrix" | "array"

export type AccentKind = "hat" | "widehat" | "bar" | "overline" | "underline" | "vec" | "tilde" | "dot" | "ddot"

export type MathNode =
  | { type: "row"; body: MathNode[] }
  | { type: "symbol"; value: string; role?: SymbolRole }
  | { type: "text"; value: string }
  | { type: "space"; width: number }
  | { type: "fraction"; numerator: MathNode; denominator: MathNode; bar: boolean }
  | { type: "root"; body: MathNode; index?: MathNode }
  | { type: "scripts"; base: MathNode; superscript?: MathNode; subscript?: MathNode }
  | { type: "delimited"; left: string; body: MathNode; right: string }
  | { type: "matrix"; rows: MathNode[][]; environment: MathEnvironment }
  | { type: "accent"; accent: AccentKind; body: MathNode }
  | { type: "operator"; value: string; limits: boolean | "display" }
  | { type: "overunder"; base: MathNode; over?: MathNode; under?: MathNode }

export interface MathBox {
  width: number
  height: number
  baseline: number
  cells: Array<Array<string | undefined>>
}
