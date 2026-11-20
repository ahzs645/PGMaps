/**
 * The explicitly provisional construction price for an ordinary 600 mm CSP cross-drain.
 *
 * This small, versioned snapshot is copied onto a newly priced culvert; the catalogue stays lazy
 * and an old project never refreshes its price or source when the catalogue changes. Presence of
 * `costDefault` means its price still needs review, including after a direct rate or geometry edit.
 * An explicit review/adoption removes the marker. This is not a confirmed rate adoption.
 *
 * Free of DOM and network access. Guide: `bc-cost-evidence.md`, **Provisional cross-drain estimates**.
 */
import { int, object, oneOf, text } from '@/lib/jsonGuards'
import type { EvidenceCurrency } from './costEvidence/costEvidence'
import { projectCurrency } from './costPlaces/projectLocation'
import type { Culvert } from './engineeringTypes'
import type { RoadProject } from './types'

export interface CulvertCostDefault {
  recordId: string
  policyVersion: number
  status: 'unreviewed'
  currency: 'CAD'
  unit: '/m'
  unitCost: number
  fixedCost: number
  priceYear: number
  sourceTitle: string
  recordTitle: string
  sourceUrl: string
  specification: string
  dateNote: string
  sample: string
  locator: string
  checkedAt: string
}

/** Route-search planning assumption only; a placed culvert is priced on its own installed length. */
export const DEFAULT_CROSS_DRAIN_LENGTH_M = 12

/** Pinned to `costEvidence/external.generated.json`; the regression test checks the source fields. */
export const CROSS_DRAIN_COST_DEFAULT: Readonly<CulvertCostDefault> = Object.freeze({
  recordId: 'alberta-upa-2026-4',
  policyVersion: 1,
  status: 'unreviewed',
  currency: 'CAD',
  unit: '/m',
  unitCost: 372.67,
  fixedCost: 0,
  priceYear: 2026,
  sourceTitle: 'Alberta Transportation and Economic Corridors — Unit Price Averages, 2026 construction sheet',
  recordTitle: 'Culverts — Supply and Install (600 mm dia. CSP)',
  sourceUrl: 'https://www.alberta.ca/system/files/custom_downloaded_images/trans-unit-price-averages.xlsx',
  specification: '600 mm corrugated steel pipe, supply and installation as pay item; not a pipe-only price.',
  dateNote: '2026 construction prices; tenders May 1, 2025–September 30, 2026',
  sample: '6,024 m · 21 contracts',
  locator: "'2026 UPA '!B39:H39",
  checkedAt: '2026-11-12',
})

const price = (value: unknown, label: string, max: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max)
    throw Error(`${label} must be between 0 and ${max}.`)
  return value
}

/** Reads the saved observation, never replaces it with the current policy's observation. */
export function parseCulvertCostDefault(raw: unknown): CulvertCostDefault {
  const r = object(raw, 'Culvert provisional price')
  const recordId = text(r.recordId, 'Culvert provisional source record', 100)
  if (!/^[a-zA-Z0-9_.:-]+$/.test(recordId)) throw Error('Culvert provisional source record is invalid.')
  const sourceUrl = text(r.sourceUrl, 'Culvert provisional source URL', 2000)
  let validUrl = false
  try {
    validUrl = new URL(sourceUrl).protocol === 'https:'
  } catch {
    // The project parser reports one bounded, readable error for all malformed source URLs.
  }
  if (!validUrl) throw Error('Culvert provisional source URL must be an absolute HTTPS URL.')
  const checkedAt = text(r.checkedAt, 'Culvert provisional source checked date', 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkedAt))
    throw Error('Culvert provisional source checked date must be a YYYY-MM-DD date.')
  return {
    recordId,
    policyVersion: int(r.policyVersion, 'Culvert provisional price policy version', 1, 1000),
    status: oneOf(r.status, 'Culvert provisional price status', ['unreviewed']),
    currency: oneOf(r.currency, 'Culvert provisional price currency', ['CAD']),
    unit: oneOf(r.unit, 'Culvert provisional price unit', ['/m']),
    unitCost: price(r.unitCost, 'Culvert provisional cost per metre', 1000000),
    fixedCost: price(r.fixedCost, 'Culvert provisional fixed cost', 1e9),
    priceYear: int(r.priceYear, 'Culvert provisional price year', 1900, 2200),
    sourceTitle: text(r.sourceTitle, 'Culvert provisional source title', 500),
    recordTitle: text(r.recordTitle, 'Culvert provisional record title', 500),
    sourceUrl,
    specification: text(r.specification, 'Culvert provisional price specification', 2000),
    dateNote: text(r.dateNote, 'Culvert provisional price dates', 500),
    sample: text(r.sample, 'Culvert provisional price sample', 500),
    locator: text(r.locator, 'Culvert provisional source locator', 500),
    checkedAt,
  }
}

/** Why the current culvert does not match this default's narrowly defined specification. */
export function culvertCostDefaultProblem(culvert: Culvert, currency: EvidenceCurrency = 'CAD'): string | null {
  if (currency !== 'CAD') return 'This provisional price is in CAD; enter a price in the project’s currency.'
  if (culvert.kind !== 'cross-drain' || culvert.sourceFeatureId)
    return 'This provisional price is for an ordinary cross-drain, not a natural-stream crossing.'
  if ((culvert.shape ?? 'round') !== 'round') return 'This provisional price is for a round pipe.'
  if (Math.abs(culvert.diameterM - 0.6) > 1e-6) return 'This provisional price is for a 600 mm pipe.'
  if (culvert.material !== undefined && culvert.material !== 'csp')
    return 'This provisional price assumes corrugated steel pipe (CSP).'
  if ((culvert.embedmentM ?? 0) !== 0) return 'An embedded culvert needs its own installed price.'
  if ((culvert.barrels ?? 1) !== 1) return 'A multiple-barrel installation needs its own installed price.'
  return null
}

/**
 * Gives a new or explicitly selected, unpriced cross-drain the provisional price. Zero in a saved
 * project can mean included elsewhere: this helper is never called by parsing or calculation.
 * Imported, already priced, and previously edited provisional records keep their exact values.
 */
export function withCulvertCostDefault(culvert: Culvert, currency: EvidenceCurrency = 'CAD'): Culvert {
  if (
    culvert.unitCost !== 0 ||
    culvert.fixedCost !== 0 ||
    culvert.costDefault ||
    culvert.roadEng ||
    culvert.roadEngDesign ||
    culvertCostDefaultProblem(culvert, currency)
  )
    return culvert
  return {
    ...culvert,
    unitCost: CROSS_DRAIN_COST_DEFAULT.unitCost,
    fixedCost: CROSS_DRAIN_COST_DEFAULT.fixedCost,
    costDefault: { ...CROSS_DRAIN_COST_DEFAULT },
  }
}

/**
 * The explicit "Use provisional estimates" action. The caller commits its result as one undo
 * step. Optional ids restrict it to the calculated, unreplaced culverts the caller offered.
 */
export function withUnpricedCrossDrainDefaults(
  project: RoadProject,
  alignmentId: string,
  culvertIds?: readonly string[],
): RoadProject {
  const alignment = project.alignments.find((road) => road.id === alignmentId)
  if (!alignment?.engineering) return project
  const allowed = culvertIds && new Set(culvertIds)
  const currency = projectCurrency(project.costLocation)
  const culverts = alignment.engineering.culverts.map((culvert) =>
    allowed && !allowed.has(culvert.id) ? culvert : withCulvertCostDefault(culvert, currency),
  )
  if (culverts.every((culvert, index) => culvert === alignment.engineering!.culverts[index])) return project
  return {
    ...project,
    alignments: project.alignments.map((road) =>
      road === alignment ? { ...road, engineering: { ...alignment.engineering!, culverts } } : road,
    ),
  }
}

export interface CulvertCostDefaultStatus {
  edited: boolean
  specChanged: boolean
  currencyChanged: boolean
  /** The current mismatch, if any, before the general prompt to confirm a local installed price. */
  problem: string | null
  /** One line for a list or a field: "Provisional CAD 372.67/m · Alberta 2026 tender average". */
  headline: string
  /** What the headline leaves out (the material assumption, the prompt to confirm), for an (i). */
  notes: string[]
  /** Headline, problem and notes as one paragraph, for the schedule, the report and the CSV. */
  summary: string
}

/** Every surface reads the same provenance; changing a number alone never validates the default. */
export function culvertCostDefaultStatus(
  culvert: Culvert,
  currency: EvidenceCurrency = 'CAD',
): CulvertCostDefaultStatus | null {
  const source = culvert.costDefault
  if (!source) return null
  const edited = culvert.unitCost !== source.unitCost || culvert.fixedCost !== source.fixedCost
  const specChanged = culvertCostDefaultProblem(culvert, source.currency) !== null
  const currencyChanged = currency !== source.currency
  const problem = culvertCostDefaultProblem(culvert, currency)
  const basis = `${source.currency} ${source.unitCost.toFixed(2)}${source.unit} · Alberta ${source.priceYear} tender average`
  const headline = `${edited ? 'Edited from provisional' : 'Provisional'} ${basis}`
  const material =
    culvert.material === undefined ? 'CSP is a cost assumption; pipe material has not been confirmed.' : ''
  const confirm = 'Confirm a current local supply-and-install price and any site-specific work.'
  return {
    edited,
    specChanged,
    currencyChanged,
    problem,
    headline,
    notes: [material, confirm].filter(Boolean),
    summary: [`${headline}; review required.`, material, problem ?? '', confirm].filter(Boolean).join(' '),
  }
}
