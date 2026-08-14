import { createRequire } from "node:module"

export type Pointer = number | bigint

type PointerArgument = Pointer | Uint8Array

export interface NativeSymbols {
  texInit(): number
  texRender(source: PointerArgument, sourceLength: number, display: number, foreground: PointerArgument, background: PointerArgument): Pointer | null
  texResultStatus(handle: Pointer): number
  texResultPixels(handle: Pointer): Pointer | null
  texResultPixelsLength(handle: Pointer): number
  texResultWidth(handle: Pointer): number
  texResultHeight(handle: Pointer): number
  texResultDestroy(handle: Pointer): void
}

interface NativeLibrary {
  symbols: NativeSymbols
  toArrayBuffer(pointer: Pointer, length: number): ArrayBuffer
}

interface BunFfi {
  FFIType: Record<"u8" | "u32" | "ptr" | "void", unknown>
  dlopen(path: string, definitions: Record<string, { args: unknown[]; returns: unknown }>): { symbols: NativeSymbols }
  toArrayBuffer(pointer: Pointer, offset: number, length: number): ArrayBuffer
}

interface NodeFfi {
  dlopen(path: string, definitions: Record<string, { arguments: string[]; return: string }>): { functions: NativeSymbols }
  toArrayBuffer(pointer: Pointer, length: number, copy?: boolean): ArrayBuffer
}

const require = createRequire(import.meta.url)

export function openNativeLibrary(path: string): NativeLibrary {
  if ((globalThis as { Bun?: unknown }).Bun) {
    const ffi = require("bun:ffi") as BunFfi
    const { u8, u32, ptr, void: voidType } = ffi.FFIType
    const library = ffi.dlopen(path, {
      texInit: { args: [], returns: u32 },
      texRender: { args: [ptr, u32, u8, ptr, ptr], returns: ptr },
      texResultStatus: { args: [ptr], returns: u32 },
      texResultPixels: { args: [ptr], returns: ptr },
      texResultPixelsLength: { args: [ptr], returns: u32 },
      texResultWidth: { args: [ptr], returns: u32 },
      texResultHeight: { args: [ptr], returns: u32 },
      texResultDestroy: { args: [ptr], returns: voidType },
    })
    return {
      symbols: library.symbols,
      toArrayBuffer: (pointer, length) => ffi.toArrayBuffer(pointer, 0, length),
    }
  }

  const ffi = require("node:ffi") as NodeFfi
  const library = ffi.dlopen(path, {
    texInit: { arguments: [], return: "u32" },
    texRender: { arguments: ["pointer", "u32", "u8", "pointer", "pointer"], return: "pointer" },
    texResultStatus: { arguments: ["pointer"], return: "u32" },
    texResultPixels: { arguments: ["pointer"], return: "pointer" },
    texResultPixelsLength: { arguments: ["pointer"], return: "u32" },
    texResultWidth: { arguments: ["pointer"], return: "u32" },
    texResultHeight: { arguments: ["pointer"], return: "u32" },
    texResultDestroy: { arguments: ["pointer"], return: "void" },
  })
  return {
    symbols: library.functions,
    toArrayBuffer: (pointer, length) => ffi.toArrayBuffer(pointer, length, true),
  }
}
