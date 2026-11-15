/**
 * The class and term scales VIA documents read a percent alteration or a distance against. They differ in small,
 * consequential ways: the 2022 handbook's Table 2 is inclusive at 1.5/7/18/30, one district's summary prints strict
 * "<" bounds, the consultants' reports name size words rather than classes, and referral packages state a single
 * ceiling. A document format names its scale, so a figure on the boundary reads as that document would read it.
 * The handbook's own Table 2 stays `table2Class` (`via.ts`); this file adds the others beside it.
 *
 * Read from the reference documents in November 2026, cited by number. No DOM or network access.
 */
import { table2Class } from '../via'

export type ClassCode = 'P' | 'R' | 'PR' | 'M' | 'MM'

export const CLASS_NAMES: Record<ClassCode, string> = {
  P: 'Preservation',
  R: 'Retention',
  PR: 'Partial Retention',
  M: 'Modification',
  MM: 'Maximum Modification',
}

/** One band of a percent scale: a class code (when the scale names classes) and the term it prints. */
export interface PercentBand {
  /** Upper bound of the band, percent; `inclusive` says whether a figure equal to it belongs here. */
  max: number
  inclusive: boolean
  code: ClassCode | null
  term: string
}

export interface PercentScale {
  id: string
  name: string
  bands: readonly PercentBand[]
  /** Past the last band. */
  beyond: string
  /** How the document prints the ranges. */
  printed: string
  spec: string
}

const band = (max: number, inclusive: boolean, code: ClassCode | null, term: string): PercentBand => ({
  max,
  inclusive,
  code,
  term,
})

export const PERCENT_SCALES = {
  /** 2022 handbook Table 2, perspective view, inclusive upper bounds (as `table2Class`). */
  handbookTable2: {
    id: 'handbook-table-2',
    name: 'Handbook Table 2 (perspective view)',
    bands: [
      band(0, true, 'P', 'very small'),
      band(1.5, true, 'R', 'small'),
      band(7, true, 'PR', 'medium'),
      band(18, true, 'M', 'large'),
      band(30, true, 'MM', 'very large'),
    ],
    beyond: 'excessive',
    printed: 'P 0%; R 0-1.5%; PR 1.6-7%; M 7.1-18%; MM 18.1-30%',
    spec: '2022 VIA handbook Table 2; the Appendix 1 bar ticks 0 1.5 4 7 12 18 24 30+ (06, 07)',
  },
  /** 02's district summary: strict "<" upper bounds and no lower bounds. */
  guidebookStrict: {
    id: 'guidebook-strict',
    name: 'Strict upper bounds (district summary)',
    bands: [
      band(0, true, 'P', 'very small'),
      band(1.5, false, 'R', 'small'),
      band(7, false, 'PR', 'medium'),
      band(18, false, 'M', 'large'),
      band(30, false, 'MM', 'very large'),
    ],
    beyond: 'excessive',
    printed: 'P=0%; R<1.5%; PR<7%; M<18%; MM<30%',
    spec: '02 summary table: "(P=0%; R<1.5%; PR<7%; M<18%; MM<30%)"',
  },
  /** 22, 23: size words with percent bands, as FPPR s.1.1 terms. */
  sizeWords: {
    id: 'size-words',
    name: 'Size and scale terms (consultant reports)',
    bands: [
      band(0, true, null, 'Very Small'),
      band(1.5, true, null, 'Small'),
      band(7, true, null, 'Small to Medium'),
      band(18, true, null, 'Large'),
      band(30, true, null, 'Very large'),
    ],
    beyond: 'Out of scale',
    printed: 'Very Small (0%); Small (0-1.5%); Small to Medium (1.5-7%); Large (7.1-18%); Very large (18.1-30%)',
    spec: '22 p3 and 23 p3, "Size and scale are described with the following terms"',
  },
} as const satisfies Record<string, PercentScale>

export type PercentScaleKey = keyof typeof PERCENT_SCALES

/** The band a percent falls in, or null past the last one. */
export function readPercent(scale: PercentScale, percent: number): PercentBand | null {
  for (const b of scale.bands) if (b.inclusive ? percent <= b.max + 1e-9 : percent < b.max - 1e-9) return b
  return null
}

/** The class a percent reads as on `scale`, or null when the scale names no classes or the figure is past it. */
export function scaleClass(scale: PercentScale, percent: number): ClassCode | null {
  return readPercent(scale, percent)?.code ?? null
}

/** The size term a percent reads as on `scale`. */
export function scaleTerm(scale: PercentScale, percent: number): string {
  return readPercent(scale, percent)?.term ?? scale.beyond
}

/**
 * A referral package's single ceiling: "should generally not exceed 7% of the perspective view" (PR, 12, 13) or 1.5%
 * (R, 11). No lower bound and no class reading: the figure is under the ceiling or not.
 */
export const REFERRAL_CEILINGS: Partial<Record<ClassCode, number>> = { R: 1.5, PR: 7 }

export function underCeiling(objective: ClassCode, percent: number): boolean | null {
  const ceiling = REFERRAL_CEILINGS[objective]
  return ceiling === undefined ? null : percent <= ceiling + 1e-9
}

// ------------------------------------------------------------------ distance

export interface DistanceBand {
  maxKm: number
  term: string
}

export interface DistanceScale {
  id: string
  name: string
  bands: readonly DistanceBand[]
  spec: string
}

export const DISTANCE_SCALES = {
  /** BC visual landscape inventory zones, as the page's own figures use them (`viewingZoneFor`). */
  vli: {
    id: 'vli',
    name: 'Visual landscape inventory zones',
    bands: [
      { maxKm: 1, term: 'Foreground' },
      { maxKm: 8, term: 'Middleground' },
      { maxKm: Infinity, term: 'Background' },
    ],
    spec: 'BC VLI: foreground under 1 km, middleground 1-8 km, background beyond',
  },
  /** 05's own zones. */
  report05: {
    id: 'zones-1-5-12',
    name: 'Foreground / Midground / Background (1, 5, 12 km)',
    bands: [
      { maxKm: 1, term: 'Foreground' },
      { maxKm: 5, term: 'Midground' },
      { maxKm: 12, term: 'Background' },
      { maxKm: Infinity, term: 'Beyond 12 km' },
    ],
    spec: '05 p3: "Foreground = 0-1km Midground = 1 - 5km Background = 5 -12km"',
  },
  /** 22, 23: viewing distance as a design rating. */
  designDistance: {
    id: 'design-distance',
    name: 'Distance as a design rating (under 2, 2-5, over 5 km)',
    bands: [
      { maxKm: 2, term: 'Poor' },
      { maxKm: 5, term: 'Moderate' },
      { maxKm: Infinity, term: 'Good' },
    ],
    spec: '22 Table 5 fn 19, 23 Table 5: distance under 2 km poor, 2-5 km moderate, over 5 km good',
  },
} as const satisfies Record<string, DistanceScale>

export type DistanceScaleKey = keyof typeof DISTANCE_SCALES

export function distanceTerm(scale: DistanceScale, km: number): string {
  return (scale.bands.find((b) => km < b.maxKm) ?? scale.bands[scale.bands.length - 1]).term
}

/** The handbook's reading of a percent, through `via.ts` itself, so the two never part. */
export function handbookClass(percent: number): ClassCode | null {
  return (table2Class(percent)?.code as ClassCode | undefined) ?? null
}
