import type { AccentKind, SymbolRole } from "./math-types.js"

export interface SymbolDefinition { value: string; role?: SymbolRole }

const ordinary: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ϵ", varepsilon: "ε", zeta: "ζ", eta: "η",
  theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", omicron: "ο",
  pi: "π", varpi: "ϖ", rho: "ρ", varrho: "ϱ", sigma: "σ", varsigma: "ς", tau: "τ", upsilon: "υ", phi: "ϕ",
  varphi: "φ", chi: "χ", psi: "ψ", omega: "ω", Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ",
  Pi: "Π", Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω", infty: "∞", partial: "∂", nabla: "∇",
  emptyset: "∅", varnothing: "∅", forall: "∀", exists: "∃", neg: "¬", angle: "∠", degree: "°", prime: "′",
  hbar: "ℏ", ell: "ℓ", Re: "ℜ", Im: "ℑ", aleph: "ℵ", top: "⊤", bot: "⊥", checkmark: "✓",
  imath: "ı", jmath: "ȷ", beth: "ℶ", gimel: "ℷ", daleth: "ℸ", measuredangle: "∡", triangle: "△",
  square: "□", lozenge: "◊", nexists: "∄", lnot: "¬", backprime: "‵", clubsuit: "♣", diamondsuit: "♢",
  heartsuit: "♡", spadesuit: "♠",
}
const binary: Record<string, string> = {
  pm: "±", mp: "∓", times: "×", div: "÷", cdot: "·", ast: "∗", star: "⋆", circ: "∘", bullet: "•",
  oplus: "⊕", ominus: "⊖", otimes: "⊗", oslash: "⊘", odot: "⊙", cap: "∩", cup: "∪", land: "∧", wedge: "∧",
  lor: "∨", vee: "∨", setminus: "∖", uplus: "⊎", sqcap: "⊓", sqcup: "⊔", wr: "≀", diamond: "⋄",
  bigtriangleup: "△", bigtriangledown: "▽", triangleleft: "◁", triangleright: "▷",
}
const relation: Record<string, string> = {
  ne: "≠", neq: "≠", equiv: "≡", approx: "≈", sim: "∼", simeq: "≃", cong: "≅", propto: "∝", le: "≤",
  leq: "≤", ge: "≥", geq: "≥", ll: "≪", gg: "≫", in: "∈", notin: "∉", ni: "∋", subset: "⊂",
  supset: "⊃", subseteq: "⊆", supseteq: "⊇", parallel: "∥", perp: "⊥", vdash: "⊢", models: "⊨",
  leftarrow: "←", gets: "←", rightarrow: "→", to: "→", leftrightarrow: "↔", Leftarrow: "⇐", Rightarrow: "⇒",
  Leftrightarrow: "⇔", mapsto: "↦", longleftarrow: "⟵", longrightarrow: "⟶", longleftrightarrow: "⟷",
  uparrow: "↑", downarrow: "↓", updownarrow: "↕",
  equals: "=", asymp: "≍", lt: "<", gt: ">", prec: "≺", succ: "≻", preceq: "⪯", succeq: "⪰",
  sqsubset: "⊏", sqsupset: "⊐", sqsubseteq: "⊑", sqsupseteq: "⊒", owns: "∋", dashv: "⊣", mid: "∣",
  smile: "⌣", frown: "⌢", hookleftarrow: "↩", hookrightarrow: "↪", leftharpoonup: "↼", leftharpoondown: "↽",
  rightharpoonup: "⇀", rightharpoondown: "⇁", rightleftharpoons: "⇌", Longleftarrow: "⟸", Longrightarrow: "⟹",
  Longleftrightarrow: "⟺", longmapsto: "⟼", Uparrow: "⇑", Downarrow: "⇓", Updownarrow: "⇕", nearrow: "↗",
  searrow: "↘", swarrow: "↙", nwarrow: "↖",
}
const punctuation: Record<string, string> = { ldots: "…", dots: "…", cdots: "⋯", vdots: "⋮", ddots: "⋱", colon: ":" }

function definitions(values: Record<string, string>, role: SymbolRole): Record<string, SymbolDefinition> {
  return Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { value, role }]))
}

export const symbols: Readonly<Record<string, SymbolDefinition>> = {
  ...definitions(ordinary, "ordinary"), ...definitions(binary, "binary"),
  ...definitions(relation, "relation"), ...definitions(punctuation, "punctuation"),
}

export const operators: Readonly<Record<string, string>> = {
  sum: "∑", prod: "∏", coprod: "∐", int: "∫", iint: "∬", iiint: "∭", oint: "∮",
  bigcap: "⋂", bigcup: "⋃", bigvee: "⋁", bigwedge: "⋀", bigoplus: "⨁", bigotimes: "⨂", bigodot: "⨀",
}

export const namedOperators = new Set([
  "arccos", "arcsin", "arctan", "arg", "cos", "cosh", "cot", "coth", "csc", "deg", "det", "dim", "exp",
  "gcd", "hom", "inf", "ker", "lg", "lim", "liminf", "limsup", "ln", "log", "max", "min", "mod", "Pr",
  "sec", "sin", "sinh", "sup", "tan", "tanh",
])

export const delimiters: Readonly<Record<string, string>> = {
  "(": "(", ")": ")", "[": "[", "]": "]", "{": "{", "}": "}", "|": "│", "\\|": "║",
  lbrace: "{", rbrace: "}", vert: "│", Vert: "║", langle: "⟨", rangle: "⟩", lfloor: "⌊", rfloor: "⌋",
  lceil: "⌈", rceil: "⌉", lvert: "│", rvert: "│", lVert: "║", rVert: "║", "\\{": "{", "\\}": "}",
  "/": "/", "<": "<", ">": ">", backslash: "\\", ".": "",
}

export const accents: Readonly<Record<string, AccentKind>> = {
  hat: "hat", widehat: "widehat", bar: "bar", overline: "overline", underline: "underline", vec: "vec",
  tilde: "tilde", widetilde: "tilde", dot: "dot", ddot: "ddot",
}

export const spacing: Readonly<Record<string, number>> = { ",": 0, ":": 1, ";": 1, "!": 0, quad: 2, qquad: 4, enspace: 1, thinspace: 0 }
