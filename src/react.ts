import { extend } from "@opentui/react"
import { BindingTexRenderable } from "./binding-tex-renderable.js"

declare module "@opentui/react" {
  interface OpenTUIComponents {
    tex: typeof BindingTexRenderable
  }
}

export function registerTex(): void {
  extend({ tex: BindingTexRenderable })
}

export * from "./index.js"
