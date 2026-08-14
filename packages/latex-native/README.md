# @simonklee/opentui-tex-native

Optional native TeX backend for `@simonklee/opentui-tex`.

```ts
import { NativeTexBackend } from "@simonklee/opentui-tex-native"
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
