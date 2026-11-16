/**
 * A culvert's opening, read from its optional shape fields. A culvert with none of them is one round
 * pipe of `diameterM`, as every culvert was before these fields existed.
 *
 * For a shape other than round, `diameterM` is the opening's rise (its height), so the cover, crown
 * and channel calculations that read it stay right, and `spanM` is its width.
 *
 * Free of DOM and network access.
 */
import type { Culvert } from '../engineeringTypes'

export type CulvertShape = 'round' | 'box' | 'pipe-arch' | 'open-bottom-arch'
export type CulvertPurpose = 'stream' | 'cross-drain'

export const CULVERT_SHAPES: ReadonlyArray<{ value: CulvertShape; label: string }> = [
  { value: 'round', label: 'Round pipe' },
  { value: 'box', label: 'Box' },
  { value: 'pipe-arch', label: 'Pipe arch' },
  { value: 'open-bottom-arch', label: 'Open-bottom arch' },
]

/** Most barrels one culvert site holds. */
export const MAX_CULVERT_BARRELS = 6

type Opening = Pick<Culvert, 'diameterM' | 'shape' | 'spanM' | 'openingAreaM2' | 'barrels'>

export const culvertShapeOf = (c: Pick<Culvert, 'shape'>): CulvertShape => c.shape ?? 'round'
export const culvertBarrels = (c: Pick<Culvert, 'barrels'>): number => c.barrels ?? 1
/** The editor shows an unset purpose as a cross-drain, so every rule reads it as one. */
export const culvertPurposeOf = (c: Pick<Culvert, 'kind'>): CulvertPurpose => c.kind ?? 'cross-drain'

/** Height of the opening, m: the diameter of a round pipe. */
export const culvertRiseM = (c: Pick<Culvert, 'diameterM'>): number => c.diameterM
/** Width of the opening, m: the diameter of a round pipe, and of another shape with no span entered. */
export const culvertSpanM = (c: Opening): number =>
  culvertShapeOf(c) === 'round' ? c.diameterM : (c.spanM ?? c.diameterM)

export interface OpeningArea {
  /** One barrel's end area, m². */
  areaM2: number
  /**
   * True for an arch with no end area entered: the area is then an ellipse of the span and rise
   * (π/4 · span · rise), which is not the supplier's figure.
   */
  approximate: boolean
}

/** End area of one barrel. An arch's is the entered area where there is one. */
export function barrelOpeningArea(c: Opening): OpeningArea {
  const shape = culvertShapeOf(c),
    rise = culvertRiseM(c),
    span = culvertSpanM(c)
  if (shape === 'round') return { areaM2: (Math.PI * rise ** 2) / 4, approximate: false }
  if (shape === 'box') return { areaM2: span * rise, approximate: false }
  if (c.openingAreaM2 !== undefined) return { areaM2: c.openingAreaM2, approximate: false }
  return { areaM2: (Math.PI * span * rise) / 4, approximate: true }
}

/** The round pipe with the same end area as one barrel, m. */
export const equivalentDiameterM = (c: Opening): number => Math.sqrt((4 * barrelOpeningArea(c).areaM2) / Math.PI)

const trim = (value: number, digits: number) => String(Number(value.toFixed(digits)))

/** "Ø 1.2 m", "2 × Ø 0.9 m", "Box 2.4 × 1.2 m", "Pipe arch 2.1 × 1.5 m". */
export function culvertSizeText(c: Opening): string {
  const shape = culvertShapeOf(c),
    barrels = culvertBarrels(c),
    many = barrels > 1 ? `${barrels} × ` : ''
  if (shape === 'round') return `${many}Ø ${trim(c.diameterM, 3)} m`
  const label = CULVERT_SHAPES.find((s) => s.value === shape)!.label
  return `${many}${label} ${trim(culvertSpanM(c), 3)} × ${trim(culvertRiseM(c), 3)} m`
}
