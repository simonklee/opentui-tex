import { extend } from "@opentui/solid/components"
import type {} from "@opentui/solid"
import { BindingTexRenderable } from "./binding-tex-renderable.js"

declare module "@opentui/solid" {
  interface OpenTUIComponents {
    tex: typeof BindingTexRenderable
  }
}

export function registerTex(): void {
  extend({ tex: BindingTexRenderable })
}

export * from "./index.js"
