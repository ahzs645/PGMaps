/** The parts of opentype.js 2 the map theme reads (the package ships no types). */
declare module 'opentype.js' {
  export type PathCommand =
    | { type: 'M' | 'L'; x: number; y: number }
    | { type: 'Q'; x1: number; y1: number; x: number; y: number }
    | { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
    | { type: 'Z' }
  export interface Glyph {
    index: number
    name: string | null
    unicode?: number
    advanceWidth?: number
    path: { commands: PathCommand[] }
    getBoundingBox(): { x1: number; y1: number; x2: number; y2: number }
  }
  export interface Font {
    unitsPerEm: number
    names: Record<string, Record<string, string> | undefined>
    charToGlyph(character: string): Glyph
    hasChar(character: string): boolean
    tables: Record<string, unknown>
  }
  export function parse(buffer: ArrayBuffer): Font
}
