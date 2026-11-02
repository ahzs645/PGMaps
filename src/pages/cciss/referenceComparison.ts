import type { CurrentAssessment, CurrentSettings } from './currentAnalysis'
import type { ShinyReport, SpeciesReport } from './shinyReport'

export const DEFAULT_REFERENCE_TOLERANCE = 1e-8
export const MAX_REFERENCE_TOLERANCE = 0.01
export type ReferenceMeasure = 'vote' | 'novelty' | 'baseline' | 'establishment' | 'maturation' | 'improve' | 'decline'
export interface ReferenceComparisonRow {
  key: string
  site: string
  series: string
  species: string
  period: string | null
  measure: ReferenceMeasure
  class: string | null
  browser: number | null
  reference: number | null
  /** Browser − imported reference; probabilities stay fractions, not percentages. */
  difference: number | null
  status: 'within-tolerance' | 'different' | 'browser-missing' | 'reference-missing' | 'both-missing'
  unit: 'probability' | 'class'
  /** Retained even when the user explicitly maps a SiteRef alias to the browser site ID. */
  referenceSite: string | null
}
export interface ShinyReferenceMetadata {
  datasetVersion?: string
  ccissrCommit?: string
  shinyCommit?: string
  parametersVerified?: boolean
  synthetic?: boolean
}
export interface ReferenceComparisonOptions {
  tolerance?: number
  settings?: CurrentSettings
  /** Filters imported rows; these never rename or remap either source's site or series. */
  referenceSite?: string
  referenceSeries?: string
  siteMappingConfirmed?: boolean
  referenceMetadata?: ShinyReferenceMetadata
}
export interface ReferenceComparison {
  schema: 'cciss-shiny-reference-comparison-v1'
  tolerance: number
  counts: {
    matched: number
    withinTolerance: number
    different: number
    missingBrowser: number
    missingReference: number
    bothMissing: number
  }
  maxAbsDifferenceByMeasure: Record<string, number | null>
  rows: ReferenceComparisonRow[]
  warnings: string[]
  scientificParityVerified: false
  alignment: {
    browserSite: string
    referenceSite: string | null
    browserSeries: string | null
    referenceSeries: string | null
    siteMappingConfirmed: boolean
    aliasApplied: boolean
  }
}

/** Shiny's 4/5/X source encodings describe the same unsuitable display class. */
export function normalizedShinyClass(value: unknown): number | null {
  if (value === null || value === undefined || value === '' || value === 'NA' || value === 'NaN') return null
  if (value === 'X') return 4
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isInteger(number) && number >= 1 && number <= 5 ? Math.min(number, 4) : null
}
export function originalShinySummary(row: SpeciesReport) {
  const probability = (value: string | undefined) => {
    if (value === undefined || value.trim() === '' || ['NA', 'NaN'].includes(value.trim())) return null
    const number = Number(value)
    return Number.isFinite(number) && number >= 0 && number <= 100 ? number / 100 : null
  }
  return {
    establishment: normalizedShinyClass(row.original.EstabFeas),
    maturation: normalizedShinyClass(row.original.ccissFeas),
    improve: probability(row.original.Improve),
    decline: probability(row.original.Decline),
  }
}

interface Field {
  site: string
  series: string
  species: string
  period: string | null
  measure: ReferenceMeasure
  class: string | null
  value: number | null
  unit: 'probability' | 'class'
  sourceSite?: string
}
const key = (row: Field) => JSON.stringify([row.site, row.series, row.species, row.period, row.measure, row.class])
const classes = ['1', '2', '3', 'X']
function fields(row: SpeciesReport, periods: string[]): Field[] {
  const base = { site: row.site, series: row.series, species: row.species }
  return [
    {
      ...base,
      period: null,
      measure: 'baseline',
      class: null,
      value: normalizedShinyClass(row.current),
      unit: 'class',
    },
    ...periods.flatMap((period): Field[] => [
      ...classes.map(
        (className, i): Field => ({
          ...base,
          period,
          measure: 'vote',
          class: className,
          value: row.votes[period]?.[i] ?? null,
          unit: 'probability',
        }),
      ),
      { ...base, period, measure: 'novelty', class: null, value: row.novelty[period] ?? null, unit: 'probability' },
    ]),
  ]
}
function summaries(row: SpeciesReport, values: ReturnType<typeof originalShinySummary>): Field[] {
  return Object.entries(values).map(([measure, value]) => ({
    site: row.site,
    series: row.series,
    species: row.species,
    period: null,
    measure: measure as 'establishment' | 'maturation' | 'improve' | 'decline',
    class: null,
    value,
    unit: measure === 'establishment' || measure === 'maturation' ? 'class' : 'probability',
  }))
}

/** Exact-field agreement is evidence about this pair of files, never automatic scientific parity. */
export function compareShinyReference(
  assessment: CurrentAssessment,
  report: ShinyReport,
  options: ReferenceComparisonOptions = {},
): ReferenceComparison {
  const tolerance = options.tolerance ?? DEFAULT_REFERENCE_TOLERANCE
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > MAX_REFERENCE_TOLERANCE)
    throw new Error(`Probability tolerance must be finite and between 0 and ${MAX_REFERENCE_TOLERANCE}.`)
  const warnings = [
    'This comparison measures agreement of exported fields for the exact site, series, species, period and class keys. It does not establish global Shiny parity.',
    'Default probability tolerance is 1e-8. Rounded reference exports may need an explicitly chosen tolerance; no source values are rounded or repaired.',
    'Species votes use the exported novelty-scaled display basis. Current summaries are compared only with original Shiny summaries, calculated before novelty display scaling.',
    'Unsuitable source summary encodings 4, 5 and X are compared as display class 4. Class comparisons are exact regardless of probability tolerance.',
  ]
  const metadata = options.referenceMetadata
  if (!metadata?.datasetVersion || !metadata.ccissrCommit || !metadata.shinyCommit || !metadata.parametersVerified)
    warnings.push(
      'Reference dataset versions and calculation parameters are unverified. Value agreement alone cannot verify matching model weights, scenario weights, novelty cutoff, site attribution or ecological inputs.',
    )
  else
    warnings.push(
      'Reference version and parameter assertions were supplied by the importer and have not been independently verified.',
    )
  if (metadata?.datasetVersion && metadata.datasetVersion !== assessment.provenance.datasetVersion)
    warnings.push('The supplied reference dataset version differs from the browser dataset version.')
  if (metadata?.ccissrCommit && metadata.ccissrCommit !== assessment.provenance.ccissrCommit)
    warnings.push('The supplied reference ccissr commit differs from the browser provenance.')
  if (metadata?.shinyCommit && metadata.shinyCommit !== assessment.provenance.shinyCommit)
    warnings.push('The supplied reference Shiny commit differs from the browser provenance.')
  if (assessment.provenance.synthetic || metadata?.synthetic)
    warnings.push(
      'Synthetic verification input is present. These invented results cannot validate ecological predictions.',
    )
  if (
    options.settings &&
    (options.settings.siteId !== assessment.siteId || (options.settings.series ?? null) !== assessment.series)
  )
    throw new Error('Comparison settings do not identify the assessed site and site series.')
  const referenceRows = report.rows.filter(
    (row) =>
      (options.referenceSite === undefined || row.site === options.referenceSite) &&
      (options.referenceSeries === undefined || row.series === options.referenceSeries),
  )
  if (!referenceRows.length) throw new Error('No imported Shiny rows match the selected exact site and site series.')
  if (options.siteMappingConfirmed && !options.referenceSite)
    throw new Error('Choose an explicit reference SiteRef before confirming an alias mapping.')
  const aliasApplied = Boolean(options.siteMappingConfirmed && options.referenceSite !== String(assessment.siteId))
  if (aliasApplied)
    warnings.push(
      `User-asserted site mapping: imported SiteRef ${options.referenceSite} is treated as browser SiteNo ${assessment.siteId}. This alias has not been independently verified; site-series identifiers must still match exactly.`,
    )
  if (
    !referenceRows.some(
      (row) => (row.site === String(assessment.siteId) || aliasApplied) && row.series === assessment.series,
    )
  )
    warnings.push(
      'The selected reference site or site-series identifiers do not match the browser assessment. Keys remain unmatched; no aliases are inferred.',
    )
  const browser = new Map<string, Field>()
  for (const row of assessment.species) {
    for (const field of fields(row, [...new Set([...Object.keys(row.votes), ...Object.keys(row.novelty)])]))
      browser.set(key(field), field)
    const summary = assessment.summaries.find((entry) => entry.species === row.species)?.summary
    const values = summary
      ? {
          establishment: summary.establishment,
          maturation: summary.maturation,
          improve: summary.improve / 100,
          decline: summary.decline / 100,
        }
      : { establishment: null, maturation: null, improve: null, decline: null }
    for (const field of summaries(row, values)) browser.set(key(field), field)
  }
  const reference = new Map<string, Field>()
  for (const row of referenceRows) {
    for (const field of [...fields(row, report.periods), ...summaries(row, originalShinySummary(row))]) {
      const aligned = aliasApplied ? { ...field, site: String(assessment.siteId), sourceSite: field.site } : field
      reference.set(key(aligned), aligned)
    }
  }
  const counts = {
    matched: 0,
    withinTolerance: 0,
    different: 0,
    missingBrowser: 0,
    missingReference: 0,
    bothMissing: 0,
  }
  const maxAbsDifferenceByMeasure: Record<string, number | null> = {}
  const resultRows = [...new Set([...browser.keys(), ...reference.keys()])].sort().map((id): ReferenceComparisonRow => {
    const left = browser.get(id),
      right = reference.get(id)
    const field = left ?? right!
    const leftValue = left?.value ?? null,
      rightValue = right?.value ?? null
    let status: ReferenceComparisonRow['status']
    let difference: number | null = null
    if (leftValue === null && rightValue === null) {
      status = 'both-missing'
      counts.bothMissing++
    } else if (leftValue === null) {
      status = 'browser-missing'
      counts.missingBrowser++
    } else if (rightValue === null) {
      status = 'reference-missing'
      counts.missingReference++
    } else {
      difference = leftValue - rightValue
      counts.matched++
      status = Math.abs(difference) <= (field.unit === 'class' ? 0 : tolerance) ? 'within-tolerance' : 'different'
      if (status === 'within-tolerance') counts.withinTolerance++
      else counts.different++
      maxAbsDifferenceByMeasure[field.measure] = Math.max(
        maxAbsDifferenceByMeasure[field.measure] ?? 0,
        Math.abs(difference),
      )
    }
    if (!(field.measure in maxAbsDifferenceByMeasure)) maxAbsDifferenceByMeasure[field.measure] = null
    return {
      key: id,
      site: field.site,
      series: field.series,
      species: field.species,
      period: field.period,
      measure: field.measure,
      class: field.class,
      browser: leftValue,
      reference: rightValue,
      referenceSite: right ? (right.sourceSite ?? right.site) : null,
      difference,
      status,
      unit: field.unit,
    }
  })
  return {
    schema: 'cciss-shiny-reference-comparison-v1',
    tolerance,
    counts,
    maxAbsDifferenceByMeasure,
    rows: resultRows,
    warnings,
    scientificParityVerified: false,
    alignment: {
      browserSite: String(assessment.siteId),
      referenceSite: options.referenceSite ?? null,
      browserSeries: assessment.series,
      referenceSeries: options.referenceSeries ?? null,
      siteMappingConfirmed: options.siteMappingConfirmed === true,
      aliasApplied,
    },
  }
}
