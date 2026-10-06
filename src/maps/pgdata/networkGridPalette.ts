import type { GridPaletteEntry } from '@/lib/rasterClassGrid'

/** Source snapshot display colours; class codes describe inferred image labels. */
export function networkGridPalette(provider: 'bell' | 'rogers', layer: string): readonly GridPaletteEntry[] {
  if (provider === 'bell') {
    const colors: Record<string, readonly [number, number, number]> = {
      lte: [0, 155, 135], 'lte-advanced': [185, 239, 243],
      '5g': [57, 213, 227], '5g-plus': [0, 0, 155], '5g-plus-advanced': [197, 59, 200],
      hspa: [230, 200, 30], 'lte-m': [1, 33, 94],
    }
    if (!colors[layer]) throw new Error(`Unknown Bell grid layer: ${layer}`)
    return [{ value: 1, rgb: colors[layer] }]
  }
  const colors: Record<string, readonly [number, number, number]> = {
    '4g': [252, 128, 118], '3g': [252, 128, 118],
    ltem: [0, 160, 183], nbiot: [34, 34, 34], comp_sat: [161, 37, 27],
  }
  if (layer === '4g5g') return [{ value: 1, rgb: [218, 41, 28] }, { value: 2, rgb: [102, 21, 16] }, { value: 3, rgb: [252, 128, 118] }]
  if (layer === '4g5g-only') return [{ value: 1, rgb: [218, 41, 28] }, { value: 2, rgb: [102, 21, 16] }]
  if (layer === '5g-only') return [{ value: 1, rgb: [218, 41, 28] }]
  if (layer === '5g-plus-only') return [{ value: 2, rgb: [102, 21, 16] }]
  if (!colors[layer]) throw new Error(`Unknown Rogers grid layer: ${layer}`)
  return [{ value: 1, rgb: colors[layer] }]
}
