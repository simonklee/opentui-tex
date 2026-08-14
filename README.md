# OpenTUI TeX

OpenTUI TeX renders TeX math inside an ordinary [OpenTUI](https://github.com/anomalyco/opentui)
renderable tree:

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

Two packages divide the work:

- `@simonklee/opentui-tex` renders formulas as semantic Unicode cells. It has
  no native build or runtime dependencies.
- `@simonklee/opentui-tex-native` renders formulas as images (Kitty, Sixel, or
  block cells) through a prebuilt shared library.

Both packages run on Bun 1.3 or newer and on Node. The Unicode package
requires Node 26.1 or newer. The native package requires Node 26.4 or newer
plus experimental FFI flags (see [Native images](#native-images)). Neither
backend requires TeX Live, MathJax, Sharp, Cairo, librsvg, or runtime font
files.

## Install

```sh
npm install @simonklee/opentui-tex
npm install @simonklee/opentui-tex-native   # optional image output
```

`bun add` works the same. The native package selects a prebuilt library for
the host platform through optional dependencies. Prebuilt libraries exist for
x64 and arm64 on macOS, Windows, Linux glibc 2.17, and Linux musl.

## TexRenderable

`TexRenderable` is the application-facing primitive. It is a neutral
`BoxRenderable`, not an image subclass, and backend selection is explicit:

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

- `formula` (required) — TeX source, at most 4,096 UTF-8 bytes.
- `foreground`, `background` (required) — six-digit hex colors (`#rrggbb`).
- `backend` (required) — the `TexBackend` that renders the formula.
- `display` — display style instead of inline style. Default `false`.
- `widthMax`, `heightMax` — output limits in cells. Defaults 80 and 24.
- `fallback` — failure behavior. Default `"message"`.
- `streaming` — preview-only updates for incomplete input. Default `false`.
- `imageOptions` — options for the installed `ImageRenderable`.
- `onError` — receives backend errors.

Assigning `formula.formula` installs a synchronous Unicode preview and queues
the selected backend. A native result upgrades the same `TexRenderable` to an
image. `formula.whenReady()` follows replacements and resolves after
`TexRenderable` installs the latest request. `formula.ready` exposes the
current individual request. `setColors()` rerenders after a terminal theme
change. `TexRenderable` aborts stale and destroyed-node requests. With
`streaming: true`, only the synchronous Unicode preview updates, and the
layout renders incomplete trailing constructs as `□` placeholders.

Failure behavior is explicit. `fallback: "unicode"` keeps the semantic
preview. `"retain"` restores the previous successful backend result.
`"message"` displays an error. `"throw"` rejects readiness. The default is
`"message"`.

Applications must share one backend across their `TexRenderable`s. The
receiver owns image outputs from a `TexBackend` and must dispose them.
`TexRenderable` manages images returned by its backend, including stale and
retained-fallback outputs, so most applications never touch an image.

## React and Solid

Registration follows the other OpenTUI extension packages:

```ts
import { registerTex } from "@simonklee/opentui-tex/react"; // or @simonklee/opentui-tex/solid

registerTex();
```

`registerTex()` registers a `<tex>` component with reactive `formula`,
`streaming`, `display`, `foreground`, and `background` props. The remaining
`TexRenderable` options pass through unchanged:

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

```text
TeX formula ───► UnicodeTexBackend ───► AST / 2D cell layout
    │
    └──► NativeTexBackend ───► bun:ffi or node:ffi / Zig / MicroTeX / NanoSVG / RGBA
                              │
                              ▼
TexRenderable extends BoxRenderable
    │
    ├── image output ───────► ImageRenderable (Kitty/Sixel/blocks)
    └── Unicode output ─────► TextRenderable
```

A `TexBackend` returns either an owned `NativeImage` or semantic Unicode text.
The Unicode backend installs a `TextRenderable`. The native backend installs
an `ImageRenderable`. Neither changes application layout or the public
`TexRenderable` type.

### Unicode cells

`UnicodeTexBackend` parses a bounded TeX math subset into an AST. It then lays
out fractions, roots, scripts, accents, aligned equations, matrices, and cases
as two-dimensional terminal cells. Output remains selectable terminal text,
measured with `string-width`. The backend is stateless and synchronous
(`renderSync` is public), and it needs no cache or explicit destruction.

### Native images

Import the native backend explicitly. The package root of
`@simonklee/opentui-tex` never loads native code, and the platform shared
library loads lazily on the first native render:

```ts
import { NativeTexBackend } from "@simonklee/opentui-tex-native";

const backend = new NativeTexBackend();
```

MicroTeX parses a TeX-math dialect and computes glyph and rule positions.
ZigTeX records the embedded Latin Modern Math glyph outlines as SVG paths.
NanoSVG rasterizes only that trusted generated SVG, not arbitrary external
SVG. The rasterizer works at four times logical size, and `TexRenderable`
derives terminal rows and columns from that 4x raster. Before the library
returns RGBA, it composites transparent samples onto the detected terminal
background. This prevents rectangular seams, because terminal graphics
protocols composite sibling images against the terminal, not against another
renderable beneath them.

There are no renderer subprocesses, pipes, temporary files, or command-line
protocols. `NativeTexRenderer` loads the platform `.so`, `.dylib`, or `.dll`
with `bun:ffi` on Bun and with Node's experimental `node:ffi` on Node. The
FFI call itself is synchronous. A bounded queue runs at most one formula per
event-loop turn, so bulk content cannot monopolize layout and input handling.
The bounded LRU cache uses formula, inline/display style, foreground, and
background as its key.

`NativeImage.fromRgba()` copies the borrowed result pixels synchronously into
OpenTUI ownership, and `TexRenderable` passes that image directly to
`ImageRenderable`. This path performs no image encoding or decoding. It is
not zero-copy, because RGBA still crosses the JavaScript FFI boundary between
the two native libraries.

MicroTeX's embedded font context is process-global. The library cannot
initialize and release it per formula. Instead, it initializes the context
once through `texInit` and keeps it for the process lifetime. The renderer
deliberately supports only the main JavaScript thread. Constructing
`NativeTexRenderer` in a Worker fails immediately. That explicit contract
avoids mutexes and cross-isolate shutdown ownership.

Ownership rules for direct use:

- Direct callers of `NativeTexRenderer.renderAsync()` must dispose each
  returned image. Cached results use independent retained references, so
  disposal of one result does not invalidate another.
- `NativeImage.takeRaw()` requires exclusive ownership. Dispose all retained
  references, including renderer cache and renderable references, before you
  call it.

### Custom backends

`TexBackend` is a public single-method interface:

```ts
interface TexBackend {
  render(request: TexRenderRequest): Promise<TexRenderOutput>;
}
```

The request carries `formula`, `display`, `foreground`, `background`,
`widthMax`, `heightMax`, and an `AbortSignal`. The output is either
`{ kind: "image", image }` or `{ kind: "unicode", text, columns, rows }`.

## Node

Native rendering on Node requires Node 26.4 or newer with:

```sh
node --permission --allow-fs-read=<application> --allow-ffi --experimental-ffi app.js
```

The portable Unicode package does not require those flags. The native context
is process-owned. Node 26.4 can retain its experimental FFI handle during
shutdown, so short-lived Node programs can need an explicit `process.exit()`
after `NativeTexRenderer.destroy()`.

Two environment variables override library resolution. Standalone executables
can extract the selected shared library and set `OPENTUI_LATEX_NATIVE_PATH` to
its absolute path. `OPENTUI_LIBC` (`glibc`, `gnu`, or `musl`) overrides Linux
libc detection.

## Bounds

- formula source: 4,096 UTF-8 bytes
- intermediate Unicode output: 16,384 characters
- Unicode output: constrained to the requested terminal width and height
- raster dimensions: at most 4,096 by 4,096 pixels
- retained formula cache: 64 native images
- main-thread-only native FFI calls
- at most 128 queued formulas, processed one per event-loop turn

Native code validates the FFI pointers, source length, dimensions,
multiplication overflow, allocation failures, and output status. Result memory
has one explicit owner and one explicit destroy operation.

## Demo

```sh
bun install
bun start        # or: bun run start:node
```

The demo is a borderless markdown-style editor and preview with inline `$...$`
and display `$$...$$` formulas. It starts with `UnicodeTexBackend`. Press
`Ctrl+U` to switch to native image formulas. The native backend loads only on
first use. Press `?` for all shortcuts. The preview is a native
`ScrollBoxRenderable`, so scrolling uses OpenTUI's normal viewport and culling
path. The demo bounds its own state: source content of 64 KiB, 128 formulas
per content revision, one editor debounce timer, and one optional demo-stream
timer.

OpenTUI's markdown custom-node hook operates at block-token level and does not
expose an inline-math token. The demo therefore uses a small bounded
markdown/math adapter (`src/document.ts`) for paragraphs. In an application
with its own markdown AST, map text nodes to `TextRenderable` and math nodes
to `TexRenderable`. The backends do not need to know about documents or
markdown.

## Development

- `native/lib.zig` exports the bounded FFI API and native render pipeline.
- `native/nanosvg.c` compiles NanoSVG's parser and rasterizer.
- `packages/latex-native/src/native-renderer.ts` owns FFI loading, bounded
  scheduling, RGBA conversion, errors, and caching.
- `packages/latex-native/src/native-tex-backend.ts` adapts native raster
  output to `TexBackend`.
- `scripts/package-native.ts` creates the eight platform-specific packages and
  copies required notices.
- `src/math-parser.ts` and `src/math-layout.ts` build the bounded AST and 2D
  cell layout.
- `src/unicode-tex-backend.ts` adapts that layout to `TexBackend`.
- `src/tex-renderable.ts` supplies the reusable OpenTUI renderable.
- `src/document.ts` is the demo's bounded markdown/math adapter.
- `demo/app.ts` builds the normal OpenTUI renderable tree and live demo.

Pure package work does not require the native toolchain:

```sh
bun run test
bun run typecheck
bun run build:package
bun run build:loader
```

Native builds require Zig 0.16.0 and `curl`. The build pins and verifies:

- ZigTeX commit `fda2819e45f57ca2071810c47249a46bfc782cdf`
- MicroTeX commit `74e8fee9e47edc3a777e64fb2eff9a85a01defac`
- NanoSVG commit `239e102ec2c691f2902e20ace2ed36ee4a35cfe6`

`native/zigtex-0.16.patch` contains the narrow upstream build/I/O API
migration needed for Zig 0.16. Build and test the native backend separately:

```sh
bun run test:native
```

Normal `bun run build` builds the host native package plus both JavaScript
packages. Host builds generate one platform package under
`node_modules/@simonklee`. Build the complete release matrix with
`bun run build:native:all`. Release builds generate x64 and arm64 packages for
macOS, Windows, Linux glibc 2.17, and Linux musl. `bun run release:check`
verifies tests, all eight artifacts, and npm package contents. After that
succeeds, `bun run publish:packages` publishes the complete corresponding
source package, the eight GPLv3 native packages, then `@simonklee/opentui-tex`
and `@simonklee/opentui-tex-native`.
