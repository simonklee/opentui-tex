import type { TexBackend, TexRenderOutput, TexRenderRequest } from "../backend.js"
import { NativeTexRenderer } from "./native-renderer.js"

export class NativeTexBackend implements TexBackend {
  constructor(private readonly renderer = new NativeTexRenderer()) {}

  async render(request: TexRenderRequest): Promise<TexRenderOutput> {
    const image = await this.renderer.renderAsync(request.formula, request.display, request.foreground, request.background, request.signal)
    return { kind: "image", image }
  }

  destroy(): void {
    this.renderer.destroy()
  }
}
