/**
 * B.C. riparian stream classes under the Forest Planning and Practices Regulation, section 47.
 * Pure rules with no DOM or project access, so a suggestion can be checked outside a browser.
 *
 * A suggestion explains itself and is never a determination. Missing evidence stays missing: a stream
 * with no fish finding is not S5 or S6, because those classes need the absence of fish and a location
 * outside any community watershed to be established.
 */
export const RIPARIAN_RULES = {
  id: 'fppr-s47',
  citation: 'Forest Planning and Practices Regulation, B.C. Reg. 14/2004, s. 47',
  /** The consolidation the thresholds were read from. */
  consolidatedTo: '2026-11-03',
} as const

export const RIPARIAN_CLASSES = ['S1-A', 'S1-B', 'S2', 'S3', 'S4', 'S5', 'S6'] as const
export type RiparianClass = (typeof RIPARIAN_CLASSES)[number]

/** Minimum widths each side of the stream, in slope distance, from s. 47. */
export const RIPARIAN_WIDTHS: Record<RiparianClass, { reserveM: number; managementM: number }> = {
  'S1-A': { reserveM: 0, managementM: 100 },
  'S1-B': { reserveM: 50, managementM: 20 },
  S2: { reserveM: 30, managementM: 20 },
  S3: { reserveM: 20, managementM: 20 },
  S4: { reserveM: 0, managementM: 30 },
  S5: { reserveM: 0, managementM: 30 },
  S6: { reserveM: 0, managementM: 20 },
}

export type FishDetermination = 'present' | 'presumed' | 'absent-assessed' | 'unresolved'
export type WatershedDetermination = 'inside' | 'outside' | 'unresolved'
export type WidthBasis = 'field' | 'imagery' | 'source' | 'estimate'

export const FISH_LABELS: Record<FishDetermination, string> = {
  unresolved: 'Unresolved',
  present: 'Present',
  presumed: 'Presumed fish stream',
  'absent-assessed': 'Absence supported by assessment',
}
export const WATERSHED_LABELS: Record<WatershedDetermination, string> = {
  unresolved: 'Unresolved',
  inside: 'In a community watershed',
  outside: 'Outside confirmed',
}
export const WIDTH_BASIS_LABELS: Record<WidthBasis, string> = {
  field: 'Field measurement',
  imagery: 'Measured on imagery',
  source: 'From a source dataset',
  estimate: 'Estimate',
}

export interface StreamAssessment {
  /** Measured channel width between banks, not the water's width on the day. */
  channelWidthM: number | null
  widthBasis?: WidthBasis
  widthDate?: string
  /** The greater of stream or active flood plain width, averaged over 1 km. Decides S1-A. */
  oneKmAverageWidthM?: number | null
  fish: FishDetermination
  communityWatershed: WatershedDetermination
  /** The class a source file gave, kept as supplied even where the rules disagree. */
  importedClass?: string
  /** A person's decision. Never written by a suggestion. */
  reviewedClass?: RiparianClass
  /** What the review rested on; a later change to it sends the stream back for review. */
  reviewedFingerprint?: string
  reviewedRules?: string
  assessor?: string
  assessedOn?: string
  evidenceUrl?: string
  notes?: string
}

export const EMPTY_STREAM_ASSESSMENT: StreamAssessment = {
  channelWidthM: null,
  fish: 'unresolved',
  communityWatershed: 'unresolved',
}

export type StreamStatus = 'unassessed' | 'provisional' | 'reviewed' | 'needs-review'
export const STREAM_STATUS_LABELS: Record<StreamStatus, string> = {
  unassessed: 'Unassessed',
  provisional: 'Provisional',
  reviewed: 'Reviewed',
  'needs-review': 'Needs review',
}

export interface ClassSuggestion {
  /** Null while the evidence does not settle a class. */
  riparianClass: RiparianClass | null
  /** Why the rules reached this result, one fact per line. */
  basis: string[]
  /** What is still needed, in the order to resolve it. */
  outstanding: string[]
  /** With the width known but fish or watershed status not: the class on each outcome. */
  alternatives?: { ifFishOrWatershed: RiparianClass; ifNeither: RiparianClass }
}

/** S1-A to S4: a fish stream, or any stream in a community watershed. */
function protectedClass(widthM: number, oneKmAverageM: number | null | undefined): RiparianClass {
  if (oneKmAverageM != null && oneKmAverageM >= 100) return 'S1-A'
  if (widthM > 20) return 'S1-B'
  if (widthM >= 5) return 'S2'
  if (widthM >= 1.5) return 'S3'
  return 'S4'
}

/** S5 and S6: not a fish stream and outside a community watershed. */
const unprotectedClass = (widthM: number): RiparianClass => (widthM > 3 ? 'S5' : 'S6')

export function suggestRiparianClass(assessment: StreamAssessment): ClassSuggestion {
  const { channelWidthM: width, fish, communityWatershed: watershed, oneKmAverageWidthM: average } = assessment
  const basis: string[] = []
  const outstanding: string[] = []
  if (width === null || !Number.isFinite(width) || width <= 0) outstanding.push('Measure the channel width')
  else
    basis.push(
      `Channel width ${width} m${assessment.widthBasis ? `, ${WIDTH_BASIS_LABELS[assessment.widthBasis].toLowerCase()}` : ''}`,
    )
  if (fish === 'unresolved') outstanding.push('Determine whether it is a fish stream')
  else basis.push(`Fish stream: ${FISH_LABELS[fish].toLowerCase()}`)
  if (watershed === 'unresolved') outstanding.push('Check for a community watershed designation')
  else basis.push(WATERSHED_LABELS[watershed])

  const measured = outstanding[0] !== 'Measure the channel width'
  const fishBearing = fish === 'present' || fish === 'presumed'
  const protectedStream = fishBearing || watershed === 'inside'
  const unprotectedStream = fish === 'absent-assessed' && watershed === 'outside'
  if (!measured) return { riparianClass: null, basis, outstanding }
  const widthM = width as number
  if (protectedStream) {
    const riparianClass = protectedClass(widthM, average)
    if (riparianClass === 'S1-B' && average == null) outstanding.push('Check the 1 km average width for S1-A')
    return { riparianClass, basis, outstanding }
  }
  if (unprotectedStream) return { riparianClass: unprotectedClass(widthM), basis, outstanding }
  return {
    riparianClass: null,
    basis,
    outstanding,
    alternatives: { ifFishOrWatershed: protectedClass(widthM, average), ifNeither: unprotectedClass(widthM) },
  }
}

const FISH_VALUES = Object.keys(FISH_LABELS)
const WATERSHED_VALUES = Object.keys(WATERSHED_LABELS)
const WIDTH_BASES = Object.keys(WIDTH_BASIS_LABELS)
const dateText = /^\d{4}-\d{2}-\d{2}$/

/** Reads saved or imported values. Anything unusable is refused rather than read as a class. */
export function parseStreamAssessment(value: unknown): StreamAssessment {
  if (!value || typeof value !== 'object') throw Error('Stream assessment must be an object.')
  const r = value as Record<string, unknown>
  const width = (input: unknown, label: string) => {
    if (input === null || input === undefined) return null
    if (typeof input !== 'number' || !Number.isFinite(input) || input <= 0 || input > 100000)
      throw Error(`${label} must be a positive number of metres.`)
    return input
  }
  const text = (input: unknown, label: string, max: number) => {
    if (input === undefined) return undefined
    if (typeof input !== 'string' || input.length > max)
      throw Error(`${label} must be text of at most ${max} characters.`)
    return input
  }
  const choice = <T extends string>(
    input: unknown,
    allowed: readonly string[],
    fallback: T | undefined,
    label: string,
  ) => {
    if (input === undefined) return fallback
    if (typeof input !== 'string' || !allowed.includes(input)) throw Error(`${label} is not a recognised value.`)
    return input as T
  }
  const date = (input: unknown, label: string) => {
    if (input === undefined) return undefined
    if (typeof input !== 'string' || !dateText.test(input)) throw Error(`${label} must be a date.`)
    return input
  }
  const reviewedClass = choice<RiparianClass>(r.reviewedClass, RIPARIAN_CLASSES, undefined, 'Reviewed class')
  const oneKmAverageWidthM = width(r.oneKmAverageWidthM, 'One kilometre average width')
  const optional = {
    widthBasis: choice<WidthBasis>(r.widthBasis, WIDTH_BASES, undefined, 'Width basis'),
    widthDate: date(r.widthDate, 'Width date'),
    importedClass: text(r.importedClass, 'Imported class', 50),
    reviewedClass,
    reviewedFingerprint: reviewedClass ? text(r.reviewedFingerprint, 'Review fingerprint', 40) : undefined,
    reviewedRules: reviewedClass ? text(r.reviewedRules, 'Review rules', 50) : undefined,
    assessor: text(r.assessor, 'Assessor', 200),
    assessedOn: date(r.assessedOn, 'Assessment date'),
    evidenceUrl: text(r.evidenceUrl, 'Evidence link', 2000),
    notes: text(r.notes, 'Assessment notes', 2000),
  }
  return {
    channelWidthM: width(r.channelWidthM, 'Channel width'),
    fish: choice<FishDetermination>(r.fish, FISH_VALUES, 'unresolved', 'Fish determination')!,
    communityWatershed: choice<WatershedDetermination>(
      r.communityWatershed,
      WATERSHED_VALUES,
      'unresolved',
      'Community watershed status',
    )!,
    ...(oneKmAverageWidthM === null ? {} : { oneKmAverageWidthM }),
    ...Object.fromEntries(Object.entries(optional).filter(([, entry]) => entry !== undefined)),
  }
}

const hash = (text: string) => {
  let value = 5381
  for (let i = 0; i < text.length; i++) value = ((value * 33) ^ text.charCodeAt(i)) >>> 0
  return value.toString(36)
}

/** The inputs a review rests on, including the reach it was made for. */
export function assessmentFingerprint(assessment: StreamAssessment, coordinates: unknown) {
  return hash(
    JSON.stringify([
      assessment.channelWidthM,
      assessment.oneKmAverageWidthM ?? null,
      assessment.fish,
      assessment.communityWatershed,
      coordinates,
    ]),
  )
}

export function streamStatus(assessment: StreamAssessment | undefined, coordinates: unknown): StreamStatus {
  if (!assessment) return 'unassessed'
  if (assessment.reviewedClass)
    return assessment.reviewedFingerprint === assessmentFingerprint(assessment, coordinates) &&
      assessment.reviewedRules === `${RIPARIAN_RULES.id}@${RIPARIAN_RULES.consolidatedTo}`
      ? 'reviewed'
      : 'needs-review'
  const touched =
    assessment.channelWidthM !== null ||
    assessment.fish !== 'unresolved' ||
    assessment.communityWatershed !== 'unresolved' ||
    !!assessment.importedClass
  return touched ? 'provisional' : 'unassessed'
}

/** The class to show: a person's decision first, then the rules, never a guess. */
export const effectiveClass = (assessment: StreamAssessment | undefined) =>
  assessment?.reviewedClass ?? (assessment ? suggestRiparianClass(assessment).riparianClass : null)
