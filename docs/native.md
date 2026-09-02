# Native rendering

The native TeX backend is part of `@simonklee/opentui-tex`.

```ts
import { NativeTexBackend } from "@simonklee/opentui-tex/native"
```

`NativeTexRenderer.renderAsync()` returns an owned OpenTUI `NativeImage`. The
caller must dispose every returned image. Cached images use independent retained
references, so callers can dispose results without invalidating the cache or
other results. `TexRenderable` manages images returned through `NativeTexBackend`.

The native renderer returns borrowed RGBA pixels to JavaScript, which copies
them synchronously into OpenTUI native-image ownership. The rendering path is
free of image encoding and decoding, but it is not zero-copy because the TeX and
OpenTUI native libraries are separate.

`NativeImage.takeRaw()` requires exclusive ownership. Destroy the renderer and
dispose all other retained references before transferring its pixels.

The package loads a prebuilt library for the current operating system,
architecture, and Linux libc. Set `OPENTUI_LIBC=glibc` or `OPENTUI_LIBC=musl`
to override Linux selection.

Standalone executables can extract the selected shared library and set
`OPENTUI_LATEX_NATIVE_PATH` to its absolute path.

The native context is process-owned. `destroy()` releases renderer-instance
queues and caches. Node 26.4 can retain its experimental FFI handle during
shutdown, so short-lived Node programs may need to call `process.exit()` after
application cleanup. Re-test this restriction when upgrading Node's FFI.

## Input limits

Native rendering rejects invalid UTF-8, embedded NULs, unsupported glyphs, and
formulas that exceed parser budgets. Expansion permits at most 64 KiB per
string, 1,024 replacements, and 64 nested parser frames. Nested parsers also
share a work budget for scanning and string copies. These failures return
errors instead of terminating the application. Set `fallback: "unicode"`
to keep the semantic preview when native rendering fails.

Rendering runs synchronously on the main thread. An `AbortSignal` can cancel
queued work, but cannot interrupt an active native call. Parser budgets are not
a security sandbox; use a separate process if you need hard time or memory
limits for untrusted input.
