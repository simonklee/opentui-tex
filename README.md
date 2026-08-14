# OpenTUI TeX

OpenTUI TeX renders TeX math in an ordinary renderable tree from
[OpenTUI](https://github.com/anomalyco/opentui):

```ts
import { TexRenderable, UnicodeTexBackend } from "@simonklee/opentui-tex";

container.add(
  new TexRenderable(renderer, {
    formula: String.raw`\sum_{i=1}^{n} i^2`,
    display: true,
    foreground: "#ffffff",
    background: "#000000",
    backend: new UnicodeTexBackend(),
  }),
);
```

The terminal shows selectable text cells:

```text
  n
  ∑   i²
i = 1
```

Two packages supply different output types:

- `@simonklee/opentui-tex` renders formulas as semantic Unicode cells. It does
  not have native build or runtime dependencies.
- `@simonklee/opentui-tex-native` renders formulas as images (Kitty, Sixel, or
  block cells) through a prebuilt shared library.

Both packages run on Bun and Node. The native package requires Node 26.4 or
newer and experimental FFI flags. See [Images](#images).

## Install

Until the packages are available from npm, install the two tarballs from the
GitHub Release. Replace `v0.1.0` with the release that you want:

```sh
bun add \
  https://github.com/simonklee/opentui-tex/releases/download/v0.1.0/simonklee-opentui-tex-0.1.0.tgz \
  https://github.com/simonklee/opentui-tex/releases/download/v0.1.0/simonklee-opentui-tex-native-0.1.0.tgz
```

The native release tarball contains all eight platform libraries and selects
the correct one at runtime. It is larger than the eventual npm package, which
will use platform-specific optional dependencies.

After the npm release, install from the registry:

```sh
npm install @simonklee/opentui-tex
npm install @simonklee/opentui-tex-native   # optional image output
```

You can also use `bun add`. The native package uses optional dependencies to
select a prebuilt library for the host platform. Prebuilt libraries exist for
x64 and arm64 on macOS, Windows, Linux glibc 2.17, and Linux musl.

## TexRenderable

`TexRenderable` is the primary application component. It is a backend-neutral
`BoxRenderable`, not an image subclass. You must select a backend:

```ts
const formula = new TexRenderable(renderer, {
  formula: String.raw`\frac{-b \pm \sqrt{b^2-4ac}}{2a}`,
  display: true,
  foreground: "#ffffff",
  background: "#000000",
  widthMax: 60,
  heightMax: 12,
  backend: new UnicodeTexBackend(),
  fallback: "unicode",
});

container.add(formula);
```

Options beyond `BoxOptions`:

- `formula` (required): TeX source, at most 4,096 UTF-8 bytes.
- `foreground`, `background` (required): six-digit hex colors (`#rrggbb`).
- `backend` (required): the `TexBackend` that renders the formula.
- `display`: display style instead of inline style. The default is `false`.
- `widthMax`, `heightMax`: output limits in cells. The defaults are 80 and 24.
- `fallback`: behavior after a failure. The default is `"message"`.
- `streaming`: preview updates for incomplete input. The default is `false`.
- `imageOptions`: options for the installed `ImageRenderable`.
- `onError`: receives backend errors.

When you assign `formula.formula`, `TexRenderable` installs a synchronous
Unicode preview. It then starts a request for the selected backend. A native
result replaces the preview with an image in the same `TexRenderable`.

`formula.whenReady()` tracks replacement requests. It resolves after
`TexRenderable` installs the latest result. `formula.ready` exposes the
current request. `setColors()` renders the formula again after a terminal
theme change. `TexRenderable` aborts requests for stale or destroyed nodes.

With `streaming: true`, only the synchronous Unicode preview changes. The
layout shows incomplete constructs at the end as `□` placeholders.

The `fallback` option controls behavior after a failure. `"unicode"` keeps the
semantic preview. `"retain"` restores the previous successful backend result.
`"message"` displays an error. `"throw"` rejects readiness. The default is
`"message"`.

Share one backend across multiple `TexRenderable` instances. A `TexBackend`
transfers ownership of each image output to the receiver. The receiver must
dispose the image. `TexRenderable` manages all images that its backend returns.
This includes stale outputs and outputs kept by the `"retain"` fallback. Thus,
most applications do not manage images directly.

## React and Solid

Use the same registration pattern as other OpenTUI extension packages:

```ts
import { registerTex } from "@simonklee/opentui-tex/react"; // or @simonklee/opentui-tex/solid

registerTex();
```

`registerTex()` registers a `<tex>` component. Its reactive props are
`formula`, `streaming`, `display`, `foreground`, and `background`. The
component passes the other `TexRenderable` options without changes:

```tsx
<tex
  formula={String.raw`e^{i\pi} + 1 = 0`}
  foreground="#ffffff"
  background="#000000"
  backend={backend}
/>
```

`@opentui/react` and `@opentui/solid` are optional peer dependencies. Install
the one that matches your renderer.

## Backends

A `TexBackend` returns an owned `NativeImage` or semantic Unicode text.
The Unicode backend installs a `TextRenderable`. The native backend installs
an `ImageRenderable`.

### Unicode cells

`UnicodeTexBackend` parses a bounded subset of TeX math into an abstract syntax
tree (AST). It lays out fractions, roots, scripts, accents, aligned equations,
matrices, and cases as two-dimensional terminal cells. The output remains
selectable terminal text. `string-width` measures the output. The backend is
stateless and synchronous, and `renderSync` is public. It needs no cache or
explicit destruction.

### Images

Import the native backend explicitly. The package root of
`@simonklee/opentui-tex` never loads native code. The platform shared library
loads during the first native render:

```ts
import { NativeTexBackend } from "@simonklee/opentui-tex-native";

const backend = new NativeTexBackend();
```

MicroTeX parses a TeX-math dialect and computes glyph and rule positions.
ZigTeX records SVG paths for the embedded glyph outlines from Latin Modern
Math. NanoSVG rasterizes only the SVG that ZigTeX generates. It does not
rasterize arbitrary external SVG.

MicroTeX uses one process-wide font context. The native library initializes
this context once through `texInit`. It keeps the context for the process
lifetime. The renderer supports only the main JavaScript thread. If you
construct `NativeTexRenderer` in a Worker, the constructor fails immediately.

Ownership rules for direct use:

- Direct callers of `NativeTexRenderer.renderAsync()` must dispose each
  returned image. Cached results use independent retained references. When you
  dispose one result, the other results stay valid.
- `NativeImage.takeRaw()` requires exclusive ownership. Before you call it,
  dispose all retained references. These references include the renderer cache
  and renderable references.

### Custom backends

`TexBackend` is a public interface with one method:

```ts
interface TexBackend {
  render(request: TexRenderRequest): Promise<TexRenderOutput>;
}
```

The request contains `formula`, `display`, `foreground`, `background`,
`widthMax`, `heightMax`, and an `AbortSignal`. The output is either
`{ kind: "image", image }` or `{ kind: "unicode", text, columns, rows }`.

## Node

Native rendering requires Node 26.4 or newer. Start Node with these options:

```sh
node --permission --allow-fs-read=<application> --allow-ffi --experimental-ffi app.js
```

## Development

You can develop the package without the native toolchain.

```sh
bun run test
bun run typecheck
bun run build:package
bun run build:loader
```

Native builds require Zig 0.16.0 and `curl`. Use this command to test a native
build:

```sh
bun run test:native
```
