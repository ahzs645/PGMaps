/**
 * D.3 of the 2004 order: a representative portion of stands not affected by the beetle must be
 * used to meet Objectives A and B. Whether the old forest held is representative is the reviewer's
 * judgement, never the model's: this module only breaks the old forest down beside the CFLB proxy
 * it is measured on, so the reviewer can see whether old forest is spread as the land base is. It
 * never says representative or not, and it never feeds a figure, a shortfall or a pathway.
 *
 * Every figure comes from the same prepared unit and the same per-stand areas as the calculation
 * (`unitYears` in `oldForest.ts`): each stand's old ground in the year, its non-pine old ground and
 * its CFLB ground, attributed to the stand's own VRI attributes. Areas are scaled by a stated CFLB
 * exactly as the figures are, so shares are the proxy's.
 *
 * DOM- and network-free.
 */
import type { Stand } from './reads'

/** What the order and the policy say "representative" refers to, quoted for the panel and the summary. */
export const REPRESENTATION_SOURCES = [
  {
    cite: 'Order, D.3 (p. 12)',
    text: 'A representative portion of stands that have been affected by an epidemic or catastrophic event may contribute to meeting the Old Forest Retention and the Old Interior Forest objectives. Due to the current Mountain Pine Beetle epidemic, licensees and BC Timber Sales must ensure a representative portion of stands that have not been affected by the epidemic (i.e. non-pine forest) are used to meet the Old Forest Retention and the Old Interior Forest objectives.',
  },
  {
    cite: 'Implementation policy, section 1 (p. 3)',
    text: 'A licensee that is affected by an epidemic or catastrophic event may ensure a representative portion of the stand is used to contribute to the Old Forest Retention and Old Interior Forest Objective by: (a) maintaining the percentage of live timber that contributes to meeting the objective that is in proportion to the percentage of the area that is not affected by the epidemic or catastrophic event, or (b) by following Tables 8-10.',
  },
  {
    cite: 'Implementation policy, section 7 (p. 11)',
    text: 'The current representative portion of non-pine forest for interior old forest is uncertain. … Licensees and BC Timber Sales are to strive for a representative portion of the current portion for pine leading and non-pine leading forests. The benchmark for this measurement should be calculated, through the adaptive management framework.',
  },
] as const

export const REPRESENTATION_BREAKDOWNS = ['species', 'bec', 'age', 'site'] as const
export type RepresentationBreakdown = (typeof REPRESENTATION_BREAKDOWNS)[number]

export const BREAKDOWN_LABELS: Record<RepresentationBreakdown, string> = {
  species: 'Leading species group',
  bec: 'BEC variant',
  age: 'Age class',
  site: 'Site index class',
}

/**
 * Leading species groups, by the first letter of VRI's `SPECIES_CD_1` (the codes of the BC
 * species list). Pine is what the order calls affected; every other group, and a stand with no
 * species, is non-pine, as the non-pine figure counts it (`leadingGroup`).
 */
export const SPECIES_GROUPS = [
  ['pine', 'Pine (P)'],
  ['spruce', 'Spruce (S)'],
  ['fir', 'Subalpine and other true firs (B)'],
  ['douglas-fir', 'Douglas-fir (F)'],
  ['hemlock', 'Hemlock (H)'],
  ['cedar', 'Cedars (C, Y)'],
  ['larch', 'Larch (L)'],
  ['other-conifer', 'Other conifers (J, T)'],
  ['deciduous', 'Deciduous'],
  ['none', 'No species'],
] as const
export type SpeciesGroup = (typeof SPECIES_GROUPS)[number][0]

export function speciesGroup(code: string | null): SpeciesGroup {
  if (!code) return 'none'
  const byLetter: Record<string, SpeciesGroup> = {
    P: 'pine',
    S: 'spruce',
    B: 'fir',
    F: 'douglas-fir',
    H: 'hemlock',
    C: 'cedar',
    Y: 'cedar',
    L: 'larch',
    J: 'other-conifer',
    T: 'other-conifer',
  }
  return byLetter[code[0]] ?? 'deciduous'
}

/**
 * Neither the order nor the policy states age classes, so these are the provincial forest
 * inventory's (VRI `PROJ_AGE_CLASS_CD_1`): 1 is 1–20 years, then twenty-year classes to 7 (121–140),
 * 8 is 141–250 and 9 is 251 and older. Age 0 is class 1. Ground a harvest or disturbance after the
 * inventory reset is its own row, as is ground whose age in the year is unknown.
 */
export const AGE_CLASSES: { key: string; label: string; from: number; to: number }[] = [
  { key: '1', label: '1 (0–20 years)', from: 0, to: 20 },
  { key: '2', label: '2 (21–40)', from: 21, to: 40 },
  { key: '3', label: '3 (41–60)', from: 41, to: 60 },
  { key: '4', label: '4 (61–80)', from: 61, to: 80 },
  { key: '5', label: '5 (81–100)', from: 81, to: 100 },
  { key: '6', label: '6 (101–120)', from: 101, to: 120 },
  { key: '7', label: '7 (121–140)', from: 121, to: 140 },
  { key: '8', label: '8 (141–250)', from: 141, to: 250 },
  { key: '9', label: '9 (251 and older)', from: 251, to: Infinity },
]
const AGE_EXTRA: [string, string][] = [
  ['reset', 'Harvested or disturbed since the inventory'],
  ['unknown', 'Age unknown in the year (harvested later)'],
  ['none', 'No age in the VRI'],
]

export function ageClass(age: number | null): string {
  if (age === null) return 'none'
  return AGE_CLASSES.find((c) => age >= c.from && age <= c.to)?.key ?? 'none'
}

/**
 * Site index classes. The order and the policy state none, so these are PGMaps' own: five-metre
 * steps of VRI's `SITE_INDEX` (metres at 50 years, for the leading species), so the reviewer can
 * see whether old forest sits on the poorer or the richer sites of the land base.
 */
export const SITE_INDEX_STEP_METRES = 5
export const SITE_CLASSES: { key: string; label: string; from: number; to: number }[] = [
  { key: 'under-10', label: 'Under 10 m', from: -Infinity, to: 10 },
  { key: '10-15', label: '10 to under 15 m', from: 10, to: 15 },
  { key: '15-20', label: '15 to under 20 m', from: 15, to: 20 },
  { key: '20-25', label: '20 to under 25 m', from: 20, to: 25 },
  { key: '25-up', label: '25 m and over', from: 25, to: Infinity },
]

export function siteClass(siteIndex: number | null | undefined): string {
  if (siteIndex === null || siteIndex === undefined || !Number.isFinite(siteIndex)) return 'none'
  return SITE_CLASSES.find((c) => siteIndex >= c.from && siteIndex < c.to)!.key
}

/** The stand's BEC variant as read (zone, subzone and variant joined when the stands are read, as `SBS wk1`); null when the VRI gives none. */
export function becVariantOf(stand: Pick<Stand, 'bec'>): string | null {
  return stand.bec ?? null
}

/** Labels for every row key of a breakdown, in the order rows print. Unknown keys print as themselves. */
export function rowLabel(breakdown: RepresentationBreakdown, key: string): string {
  if (breakdown === 'species') return SPECIES_GROUPS.find(([k]) => k === key)?.[1] ?? key
  if (breakdown === 'age')
    return AGE_CLASSES.find((c) => c.key === key)?.label ?? AGE_EXTRA.find(([k]) => k === key)?.[1] ?? key
  if (breakdown === 'site') return SITE_CLASSES.find((c) => c.key === key)?.label ?? 'No site index in the VRI'
  return key === 'none' ? 'No BEC label in the VRI' : key
}

const ORDER: Record<RepresentationBreakdown, string[]> = {
  species: SPECIES_GROUPS.map(([k]) => k),
  age: [...AGE_CLASSES.map((c) => c.key), ...AGE_EXTRA.map(([k]) => k)],
  site: [...SITE_CLASSES.map((c) => c.key), 'none'],
  bec: [],
}

export interface RepresentationRow {
  key: string
  /** CFLB proxy ground (scaled by a stated CFLB as the figures are). */
  cflbHa: number
  /** Old forest held: old by age or counted whole under D.1, less reset ground. D.4 is never in it. */
  oldHa: number
  /** Of that, non-pine-leading old forest (as `nonPineOldHa` counts it). */
  nonPineOldHa: number
}

export interface RepresentationYear {
  year: number
  /** Old interior forest and, of it, interior on non-pine-leading old ground; null where interior was not calculated. */
  interiorHa: number | null
  interiorNonPineHa: number | null
  by: Record<RepresentationBreakdown, RepresentationRow[]>
}

/** The D.3 summary of one unit for the schedule under review, every year. */
export interface OldForestRepresentation {
  schedule: string
  years: RepresentationYear[]
}

/** The row keys a stand falls in, for every breakdown but age (which changes with the year). */
export interface StandKeys {
  species: string
  bec: string
  site: string
}

export const standKeys = (stand: Stand): StandKeys => ({
  species: speciesGroup(stand.leading),
  bec: becVariantOf(stand) ?? 'none',
  site: siteClass(stand.siteIndex),
})

type Sums = Map<string, { cflb: number; old: number; nonPine: number }>

/** Adds up one year's stands, row by row; areas in m², scaled once at the end. */
export class RepresentationTally {
  private sums: Record<RepresentationBreakdown, Sums> = {
    species: new Map(),
    bec: new Map(),
    age: new Map(),
    site: new Map(),
  }

  private add(breakdown: RepresentationBreakdown, key: string, cflb: number, old: number, nonPine: number) {
    const s = this.sums[breakdown].get(key) ?? { cflb: 0, old: 0, nonPine: 0 }
    s.cflb += cflb
    s.old += old
    s.nonPine += nonPine
    this.sums[breakdown].set(key, s)
  }

  /**
   * One stand's CFLB ground in the year, its old and its non-pine old ground. By age, the part a
   * reset made young goes in its own row and the rest, old ground included, in the stand's age class.
   */
  stand(keys: StandKeys, m2: { cflb: number; reset: number; old: number; nonPine: number }, ageKey: string) {
    for (const b of ['species', 'bec', 'site'] as const) this.add(b, keys[b], m2.cflb, m2.old, m2.nonPine)
    this.add('age', ageKey, m2.cflb - m2.reset, m2.old, m2.nonPine)
    if (m2.reset > 0) this.add('age', 'reset', m2.reset, 0, 0)
  }

  result(perHa: number): RepresentationYear['by'] {
    const rows = (b: RepresentationBreakdown): RepresentationRow[] => {
      const entries = [...this.sums[b]].filter(([, s]) => s.cflb > 0 || s.old > 0)
      const order = ORDER[b]
      entries.sort(([ka, a], [kb, b2]) =>
        order.length
          ? order.indexOf(ka) - order.indexOf(kb)
          : // BEC variants by CFLB, largest first; the unlabelled last.
            (ka === 'none' ? 1 : 0) - (kb === 'none' ? 1 : 0) || b2.cflb - a.cflb || ka.localeCompare(kb),
      )
      return entries.map(([key, s]) => ({
        key,
        cflbHa: s.cflb * perHa,
        oldHa: s.old * perHa,
        nonPineOldHa: s.nonPine * perHa,
      }))
    }
    return { species: rows('species'), bec: rows('bec'), age: rows('age'), site: rows('site') }
  }
}

/** Each row's share of its column's total, as fractions; null where the column is empty. */
export function shares(rows: RepresentationRow[]) {
  const total = rows.reduce(
    (t, r) => ({ cflb: t.cflb + r.cflbHa, old: t.old + r.oldHa, nonPine: t.nonPine + r.nonPineOldHa }),
    { cflb: 0, old: 0, nonPine: 0 },
  )
  const of = (v: number, t: number) => (t > 0 ? v / t : null)
  return rows.map((r) => ({
    ...r,
    cflbShare: of(r.cflbHa, total.cflb),
    oldShare: of(r.oldHa, total.old),
    nonPineShare: of(r.nonPineOldHa, total.nonPine),
    /** The row's old forest as a share of its own CFLB. */
    oldOfCflb: of(r.oldHa, r.cflbHa),
  }))
}

/**
 * Policy option (a) read as figures: non-pine-leading old forest's share of old forest beside the
 * non-pine-leading share of the CFLB, and the same for interior. Figures only, never a verdict.
 */
export function pineSplit(year: RepresentationYear) {
  const rows = year.by.species
  const total = (f: (r: RepresentationRow) => number) => rows.reduce((s, r) => s + f(r), 0)
  const cflb = total((r) => r.cflbHa)
  const old = total((r) => r.oldHa)
  const nonPineCflb = total((r) => (r.key === 'pine' ? 0 : r.cflbHa))
  return {
    nonPineCflbShare: cflb > 0 ? nonPineCflb / cflb : null,
    // As the non-pine figure counts it: old by age and not pine-leading. D.1 ground counted whole is in `old` only.
    nonPineOldShare: old > 0 ? total((r) => r.nonPineOldHa) / old : null,
    nonPineInteriorShare:
      year.interiorHa && year.interiorNonPineHa !== null ? year.interiorNonPineHa / year.interiorHa : null,
  }
}
