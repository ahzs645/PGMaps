import type { ResolvedPaletteScale } from './paletteScale.js'

/** Numeric semantics shared by a resolved colour scale and every view of it. */
export type ResolvedScaleLegendInput = Pick<
  ResolvedPaletteScale,
  'domain' | 'breaks' | 'colors' | 'missingColor' | 'bins'
>

export interface ScaleLegendBin {
  min: number
  max: number
  includesMin: true
  includesMax: boolean
  color: string
  /** Positions in the numeric domain, independent of palette sampling. */
  start: number
  end: number
}

/** Serializable legend data. No renderer is allowed to invent new thresholds. */
export interface ResolvedScaleLegend {
  kind: 'classified'
  title?: string
  unit?: string
  domain: readonly [number, number]
  breaks: readonly number[]
  colors: readonly string[]
  bins: readonly ScaleLegendBin[]
  boundaryPolicy: 'upper-bin'
  outOfDomain: 'clamp'
  missing: {
    color: string
    label: string
    /** Zero is an observation; only absent and nonfinite values are missing. */
    values: 'null-undefined-nonfinite'
  }
}

/**
 * Build a legend from the same resolved scale used to colour marks. Unequal
 * class widths retain their numeric positions; palette ranges never change
 * the measurement domain. The result can be saved alongside project recipes.
 */
export function createScaleLegend(
  scale: ResolvedScaleLegendInput,
  { title, unit, missingLabel = 'No data' }: { title?: string; unit?: string; missingLabel?: string } = {},
): ResolvedScaleLegend {
  const [min, max] = scale.domain
  const position = (value: number) => (min === max ? 0 : (value - min) / (max - min))
  return {
    kind: 'classified',
    ...(title === undefined ? {} : { title }),
    ...(unit === undefined ? {} : { unit }),
    domain: [min, max],
    breaks: [...scale.breaks],
    colors: [...scale.colors],
    bins: scale.bins.map((bin) => ({
      ...bin,
      includesMin: true,
      start: position(bin.min),
      end: min === max ? 1 : position(bin.max),
    })),
    boundaryPolicy: 'upper-bin',
    outOfDomain: 'clamp',
    missing: { color: scale.missingColor, label: missingLabel, values: 'null-undefined-nonfinite' },
  }
}
