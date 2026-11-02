import {
  parseComparisonSnapshot,
  type ComparisonMetric,
  type ComparisonPeriod,
  type ComparisonSnapshot,
  type JSONValue,
} from './comparison'
import type { CurrentAssessment, CurrentProvenance, CurrentSettings } from './currentAnalysis'
import {
  DEFAULT_ESTABLISHMENT,
  DEFAULT_MATURATION,
  summarizeVotes,
  supportedSummaryPolicies,
  type ShinyReport,
  type SpeciesReport,
  type Votes,
} from './shinyReport'
import { normalizedShinyClass, originalShinySummary } from './referenceComparison'

const classes = ['1', '2', '3', 'X']
const ordinalScale = 'cciss-suitability-1-4'
const observedPeriodLimit =
  'Source token 1991 has conflicting observed-period labels in upstream generate.R and server.R. Its interval bounds remain unverified unless explicitly supplied with the dataset.'
const id = () => crypto.randomUUID()
const copyJson = (value: unknown): JSONValue => JSON.parse(JSON.stringify(value)) as JSONValue
const importedPlaceLimit = 1_000

/** Source-current IDs have defined intervals; historical midpoint tokens retain unknown bounds. */
function periodMetadata(token: string, current: boolean): ComparisonPeriod {
  if (current && token === '1991')
    return { label: '1991 (observed interval unverified)', startYear: null, endYear: null, kind: 'observed' }
  if (current && ['1961', '2021', '2041', '2061', '2081'].includes(token)) {
    const startYear = Number(token)
    return {
      label: token,
      startYear,
      endYear: startYear + (token === '1961' ? 29 : 19),
      kind: token === '1961' ? 'baseline' : 'projection',
    }
  }
  return { label: token, startYear: null, endYear: null, kind: 'source-period' }
}
function speciesMetrics(row: SpeciesReport, baselinePeriod: string | null = null): ComparisonMetric[] {
  return [
    {
      measure: 'species.baseline',
      entity: row.species,
      dimensions: {},
      period: baselinePeriod,
      value: normalizedShinyClass(row.current),
      unit: 'class',
      scale: ordinalScale,
      direction: 'lower-better',
    },
    ...[...new Set([...Object.keys(row.votes), ...Object.keys(row.novelty)])]
      .sort()
      .flatMap((period): ComparisonMetric[] => [
        ...classes.map(
          (className, index): ComparisonMetric => ({
            measure: 'species.vote',
            entity: row.species,
            dimensions: { class: className },
            period,
            value: row.votes[period]?.[index] ?? null,
            unit: 'probability',
            direction: 'neutral',
          }),
        ),
        {
          measure: 'species.novelty',
          entity: row.species,
          dimensions: {},
          period,
          value: row.novelty[period] ?? null,
          unit: 'probability',
          direction: 'neutral',
        },
      ]),
  ]
}
function summaryMetrics(
  species: string,
  summary: ReturnType<typeof originalShinySummary>,
  source: 'current' | 'shiny' | 'reweighted',
  periods: string[],
): ComparisonMetric[] {
  return Object.entries(summary).map(([measure, value]): ComparisonMetric => {
    const isClass = measure === 'establishment' || measure === 'maturation'
    const coverage = measure === 'establishment' ? ['1961', '1991', '2021'] : ['2021', '2041', '2061', '2081']
    return {
      measure: `species.summary.${measure}.${source}`,
      entity: species,
      dimensions: {},
      period: null,
      ...(coverage.every((period) => periods.includes(period)) ? { periodCoverage: coverage } : {}),
      value,
      unit: isClass ? 'class' : 'probability',
      ...(isClass ? { scale: ordinalScale } : {}),
      direction: measure === 'improve' ? 'higher-better' : 'lower-better',
    }
  })
}

export interface CurrentSnapshotOptions {
  id?: string
  label?: string
  settings?: CurrentSettings
  sourceFile?: string
  periods?: Record<string, ComparisonPeriod>
}
function weightLabel(weights: Record<string, number> | undefined, plural: 'models' | 'scenarios'): string {
  if (!weights || !Object.keys(weights).length) return `all ${plural}`
  const positive = Object.entries(weights).filter(([, value]) => value > 0)
  if (positive.length === 1) return positive[0][0]
  return positive.length === Object.keys(weights).length && positive.every(([, value]) => value === positive[0][1])
    ? `all ${plural}`
    : `custom ${plural}`
}
function currentLabel(assessment: CurrentAssessment, settings: CurrentSettings | undefined) {
  const label = `Current site ${assessment.siteId} · ${assessment.series ?? 'BGC only'} · ${weightLabel(settings?.modelWeights, 'models')} · ${weightLabel(settings?.scenarioWeights, 'scenarios')}`
  return label.length <= 200 ? label : label.slice(0, 199) + '…'
}
export function currentSnapshot(
  assessment: CurrentAssessment,
  options: CurrentSnapshotOptions = {},
): ComparisonSnapshot {
  const periods = [
    ...new Set([
      ...assessment.bgcProbabilities.map((row) => row.period),
      ...assessment.species.flatMap((row) => [...Object.keys(row.votes), ...Object.keys(row.novelty)]),
    ]),
  ]
  const metrics: ComparisonMetric[] = assessment.bgcProbabilities.map((row) => ({
    measure: 'bgc.probability',
    entity: row.bgc,
    dimensions: {},
    period: row.period,
    value: row.probability,
    unit: 'probability',
    direction: 'neutral',
    probabilityGroup: `bgc:${row.period}`,
  }))
  for (const row of assessment.overlap)
    metrics.push({
      measure: 'site-series.overlap',
      entity: row.predictedSeries,
      dimensions: { bgc: row.predictedBgc },
      period: row.period,
      value: row.probability,
      unit: 'probability',
      direction: 'neutral',
    })
  for (const row of assessment.species) {
    metrics.push(...speciesMetrics(row, periods.includes('1961') ? '1961' : null))
    const summary = assessment.summaries.find((entry) => entry.species === row.species)?.summary
    metrics.push(
      ...summaryMetrics(
        row.species,
        summary
          ? {
              establishment: summary.establishment,
              maturation: summary.maturation,
              improve: summary.improve / 100,
              decline: summary.decline / 100,
            }
          : { establishment: null, maturation: null, improve: null, decline: null },
        'current',
        periods,
      ),
    )
  }
  return parseComparisonSnapshot({
    schema: 'cciss-comparison-snapshot-v1',
    id: options.id ?? id(),
    label: options.label ?? currentLabel(assessment, options.settings),
    family: 'current-analysis',
    provenance: {
      source: assessment.provenance.source,
      version: assessment.provenance.datasetVersion,
      method: 'CCISS current browser source-stage calculation',
      synthetic: assessment.provenance.synthetic === true,
      limitations: [
        ...assessment.warnings,
        ...(periods.includes('1991') && !options.periods?.['1991'] ? [observedPeriodLimit] : []),
      ],
      metadata: copyJson({
        ccissrCommit: assessment.provenance.ccissrCommit ?? null,
        shinyCommit: assessment.provenance.shinyCommit ?? null,
        supplierVersionMatched: assessment.provenance.versionMatched,
        independentShinyParityVerified: false,
      }),
    },
    context: {
      site: String(assessment.siteId),
      series: assessment.series,
      baselineBgc: assessment.bgc,
      sourceFile: options.sourceFile ?? null,
      settings: options.settings ? copyJson(options.settings) : null,
      voteBasis: 'novelty-scaled display',
      summaryBasis: 'conditional non-novel votes before display scaling',
    },
    periods: Object.fromEntries(
      periods.map((period) => [period, options.periods?.[period] ?? periodMetadata(period, true)]),
    ),
    metrics,
    probabilityGroups: periods
      .filter((period) => assessment.bgcProbabilities.some((row) => row.period === period))
      .map((period) => ({
        id: `bgc:${period}`,
        measure: 'bgc.probability',
        period,
        entity: null,
        dimensions: {},
        categoryDimensions: [],
        complete:
          Math.abs(
            assessment.bgcProbabilities
              .filter((row) => row.period === period)
              .reduce((sum, row) => sum + row.probability, 0) - 1,
          ) <= 1e-8,
      })),
  })
}

export interface ShinySnapshotOptions {
  site: string
  series: string
  id?: string
  label?: string
  source?: string
  reference?: boolean
  /** Explicitly recorded even when omitted: original source summaries are the default. */
  summarySource?: 'original' | 'browser'
  establishmentWeights?: number[]
  maturationWeights?: number[]
  synthetic?: boolean
}
export function shinySnapshot(report: ShinyReport, options: ShinySnapshotOptions): ComparisonSnapshot {
  const rows = report.rows.filter((row) => row.site === options.site && row.series === options.series)
  if (!rows.length) throw new Error('Choose an exact site and site series present in the imported report.')
  const source = options.summarySource ?? 'original'
  const policy = supportedSummaryPolicies(report)[0] ?? null
  const est = options.establishmentWeights ?? DEFAULT_ESTABLISHMENT
  const mat = options.maturationWeights ?? DEFAULT_MATURATION
  const metrics = rows.flatMap((row) => {
    const summary = source === 'browser' && policy ? summarizeVotes(row, est, mat, policy) : null
    return [
      ...speciesMetrics(row, report.format === 'current-export' && report.periods.includes('1961') ? '1961' : null),
      ...summaryMetrics(
        row.species,
        source === 'original'
          ? originalShinySummary(row)
          : summary
            ? {
                establishment: summary.establishment,
                maturation: summary.maturation,
                improve: summary.improve / 100,
                decline: summary.decline / 100,
              }
            : { establishment: null, maturation: null, improve: null, decline: null },
        source === 'original' ? 'shiny' : 'reweighted',
        report.periods,
      ),
    ]
  })
  return parseComparisonSnapshot({
    schema: 'cciss-comparison-snapshot-v1',
    id: options.id ?? id(),
    label:
      options.label ??
      `${source === 'original' ? 'Original Shiny' : 'Browser reweighted'} · ${options.site} · ${options.series}`,
    family: report.format === 'current-export' ? 'shiny-imported' : 'shiny-historical-imported',
    provenance: {
      source: options.source ?? 'Imported Shiny report',
      method: 'Imported Shiny display votes; original and browser-reweighted summaries use separate measures',
      synthetic: options.synthetic === true,
      limitations: [
        'Model inputs, source table versions and calculation parameters are unverified.',
        ...(report.format === 'current-export' && report.periods.includes('1991') ? [observedPeriodLimit] : []),
        ...(report.format === 'historical-raw'
          ? ['Historical period IDs retain unknown interval bounds. They are never mapped to modern periods.']
          : []),
      ],
      metadata: {
        reference: options.reference === true,
        inputAndParametersVerified: false,
        rawOriginalSummaries: copyJson(
          rows.map((row) => ({
            species: row.species,
            EstabFeas: row.original.EstabFeas ?? null,
            ccissFeas: row.original.ccissFeas ?? null,
            Improve: row.original.Improve ?? null,
            Decline: row.original.Decline ?? null,
          })),
        ),
      },
    },
    context: {
      site: options.site,
      series: options.series,
      summarySource: source,
      establishmentWeights: [...est],
      maturationWeights: [...mat],
      summaryPolicy: policy?.id ?? null,
      voteBasis: 'exported display votes; no de-scaling or missing-value inference',
      summaryBasis:
        source === 'original'
          ? 'original exported Shiny summaries'
          : 'browser reweighting of complete unscaled exported votes',
    },
    periods: Object.fromEntries(
      report.periods.map((period) => [period, periodMetadata(period, report.format === 'current-export')]),
    ),
    metrics,
  })
}

type ObjectRow = Record<string, unknown>
function object(value: unknown, label: string): ObjectRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}: expected an object.`)
  return value as ObjectRow
}
function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 5_000) throw new Error(`${label}: expected text.`)
  return value
}
function array(value: unknown, label: string, max = 50_000): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${label}: invalid array.`)
  return value
}
function number(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw new Error(`${label}: invalid number.`)
  return value
}
function nullableNumber(value: unknown, label: string, min: number, max: number): number | null {
  return value === null ? null : number(value, label, min, max)
}
function strings(value: unknown, label: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(object(value, label)).map(([key, value]) => {
      if (typeof value !== 'string') throw new Error(`${label}: expected original string fields.`)
      return [key, value]
    }),
  )
}
function periodToken(value: unknown): string {
  const result = text(value, 'Period')
  if (!/^\d{4}$/.test(result)) throw new Error('Period IDs must retain their exact four-digit source tokens.')
  return result
}
function readSpecies(value: unknown): SpeciesReport {
  const row = object(value, 'Species report')
  const votes = Object.fromEntries(
    Object.entries(object(row.votes, 'Votes')).map(([period, value]) => {
      periodToken(period)
      if (value === null) return [period, null]
      const values = array(value, 'Vote classes', 4)
      if (values.length !== 4) throw new Error('Each vote vector must contain four original class values.')
      const numeric = values.map((value) => number(value, 'Vote', 0, 1)) as Votes
      if (numeric.reduce((sum, value) => sum + value, 0) > 1.021) throw new Error('Vote totals exceed probability one.')
      return [period, numeric]
    }),
  )
  const novelty = Object.fromEntries(
    Object.entries(object(row.novelty, 'Novelty')).map(([period, value]) => [
      periodToken(period),
      nullableNumber(value, 'Novelty', 0, 1),
    ]),
  )
  const current = nullableNumber(row.current, 'Baseline class', 1, 5)
  if (current !== null && !Number.isInteger(current)) throw new Error('Baseline classes must be integers.')
  return {
    site: text(row.site, 'Site'),
    series: text(row.series, 'Site series'),
    species: text(row.species, 'Species'),
    current,
    votes,
    novelty,
    original: strings(row.original, 'Original source row'),
  }
}
function readReport(value: unknown): ShinyReport {
  const report = object(value, 'Imported report')
  if (report.format !== 'current-export' && report.format !== 'historical-raw')
    throw new Error('Unsupported Shiny report format.')
  const periods = array(report.periods, 'Periods', 100).map(periodToken)
  const rows = array(report.rows, 'Species rows').map(readSpecies)
  if (!periods.length || !rows.length || new Set(periods).size !== periods.length)
    throw new Error('Missing or duplicate imported report periods or rows.')
  const keys = rows.map((row) => JSON.stringify([row.site, row.series, row.species]))
  if (new Set(keys).size !== keys.length) throw new Error('Duplicate imported site/series/species rows.')
  if (
    rows.some((row) =>
      [...Object.keys(row.votes), ...Object.keys(row.novelty)].some((period) => !periods.includes(period)),
    )
  )
    throw new Error('Species rows refer to undeclared source periods.')
  return { format: report.format, periods, rows }
}
function readProvenance(value: unknown): CurrentProvenance {
  const row = object(value, 'Current provenance')
  if (typeof row.versionMatched !== 'boolean' || (row.synthetic !== undefined && typeof row.synthetic !== 'boolean'))
    throw new Error('Current provenance requires explicit version and synthetic flags.')
  return {
    datasetVersion: text(row.datasetVersion, 'Dataset version'),
    source: text(row.source, 'Source'),
    versionMatched: row.versionMatched,
    ...(row.synthetic === undefined ? {} : { synthetic: row.synthetic as boolean }),
    ...(row.ccissrCommit === undefined ? {} : { ccissrCommit: text(row.ccissrCommit, 'ccissr commit') }),
    ...(row.shinyCommit === undefined ? {} : { shinyCommit: text(row.shinyCommit, 'Shiny commit') }),
  }
}
function readSummary(value: unknown): NonNullable<ReturnType<typeof summarizeVotes>> | null {
  if (value === null) return null
  const row = object(value, 'Current summary')
  const establishment = number(row.establishment, 'Establishment class', 1, 4),
    maturation = number(row.maturation, 'Maturation class', 1, 4)
  if (!Number.isInteger(establishment) || !Number.isInteger(maturation))
    throw new Error('Summary classes must be integers.')
  return {
    establishment,
    maturation,
    establishmentScore: number(row.establishmentScore, 'Establishment score', 1, 5),
    maturationScore: number(row.maturationScore, 'Maturation score', 1, 5),
    improve: number(row.improve, 'Improving percentage', 0, 100),
    decline: number(row.decline, 'Declining percentage', 0, 100),
  }
}
/** Validate original numeric results; rendered tables are never treated as calculation data. */
export function readCurrentAssessment(value: unknown): CurrentAssessment {
  const row = object(value, 'Current calculation')
  const siteId = number(row.siteId, 'Site ID', 0, Number.MAX_SAFE_INTEGER)
  if (!Number.isSafeInteger(siteId)) throw new Error('Site IDs must be safe integers.')
  const series = row.series === null ? null : text(row.series, 'Current site series')
  const species = array(row.species, 'Current species').map(readSpecies)
  if (
    species.some((item) => item.site !== String(siteId) || item.series !== series) ||
    new Set(species.map((item) => item.species)).size !== species.length
  )
    throw new Error('Current species rows do not match the assessment site and series.')
  const capabilities = object(row.capabilities, 'Current capabilities')
  for (const field of ['predictions', 'siteSeries', 'suitability', 'summaries'])
    if (typeof capabilities[field] !== 'boolean') throw new Error('Current capability flags must be explicit booleans.')
  const summaries = array(row.summaries, 'Current summaries').map((value) => {
    const item = object(value, 'Current summary row')
    return { species: text(item.species, 'Summary species'), summary: readSummary(item.summary) }
  })
  if (
    new Set(summaries.map((item) => item.species)).size !== summaries.length ||
    summaries.some((item) => !species.some((s) => s.species === item.species))
  )
    throw new Error('Duplicate or unmatched current species summaries.')
  return {
    siteId,
    bgc: text(row.bgc, 'Baseline BGC'),
    series,
    species,
    summaries,
    provenance: readProvenance(row.provenance),
    warnings: array(row.warnings, 'Warnings', 200).map((value) => text(value, 'Warning')),
    capabilities: {
      predictions: capabilities.predictions as boolean,
      siteSeries: capabilities.siteSeries as boolean,
      suitability: capabilities.suitability as boolean,
      summaries: capabilities.summaries as boolean,
    },
    bgcProbabilities: array(row.bgcProbabilities, 'BGC probabilities').map((value) => {
      const item = object(value, 'BGC probability')
      const members = number(item.members, 'Member count', 0, Number.MAX_SAFE_INTEGER)
      if (!Number.isSafeInteger(members)) throw new Error('Member counts must be integers.')
      return {
        period: periodToken(item.period),
        bgc: text(item.bgc, 'Predicted BGC'),
        probability: number(item.probability, 'BGC probability', 0, 1),
        members,
      }
    }),
    overlap: array(row.overlap, 'Site-series overlap').map((value) => {
      const item = object(value, 'Overlap row')
      return {
        period: periodToken(item.period),
        predictedBgc: text(item.predictedBgc, 'Predicted BGC'),
        predictedSeries: text(item.predictedSeries, 'Predicted site series'),
        probability: number(item.probability, 'Overlap probability', 0, 1),
      }
    }),
  }
}
function readWeights(value: unknown, label: string, size: number): number[] {
  const values = array(value, label, size).map((item) => number(item, label, 0, Number.MAX_VALUE))
  const sum = values.reduce((sum, value) => sum + value, 0)
  if (values.length !== size || !Number.isFinite(sum) || sum <= 0) throw new Error(`${label}: invalid weight group.`)
  return values
}
function readSettings(value: unknown): CurrentSettings {
  const row = object(value, 'Assessment settings')
  const siteId = number(row.siteId, 'Settings site ID', 0, Number.MAX_SAFE_INTEGER)
  if (!Number.isSafeInteger(siteId)) throw new Error('Settings site IDs must be integers.')
  const map = (value: unknown) =>
    Object.fromEntries(
      Object.entries(object(value, 'Model/scenario weights')).map(([key, value]) => [
        key,
        number(value, 'Weight', 0, Number.MAX_VALUE),
      ]),
    )
  return {
    siteId,
    ...(row.series == null ? {} : { series: text(row.series, 'Settings site series') }),
    ...(row.modelWeights === undefined ? {} : { modelWeights: map(row.modelWeights) }),
    ...(row.scenarioWeights === undefined ? {} : { scenarioWeights: map(row.scenarioWeights) }),
    ...(row.establishmentWeights === undefined
      ? {}
      : { establishmentWeights: readWeights(row.establishmentWeights, 'Establishment weights', 3) }),
    ...(row.maturationWeights === undefined
      ? {}
      : { maturationWeights: readWeights(row.maturationWeights, 'Maturation weights', 4) }),
    ...(row.noveltyCutoff === undefined
      ? {}
      : { noveltyCutoff: row.noveltyCutoff === null ? null : number(row.noveltyCutoff, 'Novelty cutoff', 1, 8) }),
    ...(row.includeOutOfRange === undefined
      ? {}
      : {
          includeOutOfRange: (() => {
            if (typeof row.includeOutOfRange !== 'boolean') throw new Error('Out-of-range flag must be boolean.')
            return row.includeOutOfRange
          })(),
        }),
  }
}

/** Import actual exported result JSON, never formatted table cells or arbitrary objects. */
export function comparisonInputSnapshots(input: string): ComparisonSnapshot[] {
  if (input.length > 25_000_000) throw new Error('Comparison input exceeds the 25 MB result-file limit.')
  const value = object(JSON.parse(input), 'Comparison input')
  if (value.schema === 'cciss-comparison-snapshot-v1') return [parseComparisonSnapshot(value)]
  if (value.schema === 'cciss-comparison-report-v1')
    return [parseComparisonSnapshot(value.left), parseComparisonSnapshot(value.right)]
  if (value.schema === 'cciss-current-analysis-report-v1') {
    const assessment = readCurrentAssessment(value.calculation)
    const settings = readSettings(value.selection)
    if (settings.siteId !== assessment.siteId || (settings.series ?? null) !== assessment.series)
      throw new Error('Export settings and calculation identify different sites or site series.')
    return [currentSnapshot(assessment, { sourceFile: text(value.sourceFile, 'Export source file'), settings })]
  }
  if (value.schema === 'cciss-imported-report-analysis-v1') {
    const report = readReport(value.report)
    const policy = value.policy === null ? null : object(value.policy, 'Export summary policy')
    if (policy && !supportedSummaryPolicies(report).some((supported) => supported.id === policy.id))
      throw new Error('Unsupported exported summary policy.')
    const establishmentWeights = policy
      ? readWeights(policy.establishmentWeights, 'Establishment weights', 3)
      : undefined
    const maturationWeights = policy ? readWeights(policy.maturationWeights, 'Maturation weights', 4) : undefined
    const source = text(value.source, 'Imported report source')
    const places = new Map<string, { site: string; series: string; rows: SpeciesReport[] }>()
    for (const row of report.rows) {
      const key = JSON.stringify([row.site, row.series])
      const place = places.get(key) ?? { site: row.site, series: row.series, rows: [] }
      place.rows.push(row)
      places.set(key, place)
      if (places.size > importedPlaceLimit)
        throw new Error(
          'This comparison import contains more than 1,000 site/series pairs. Import the source CSV or ZIP and choose one site, or export a smaller result collection.',
        )
    }
    return [...places.values()].map((place) =>
      shinySnapshot(
        { ...report, rows: place.rows },
        {
          site: place.site,
          series: place.series,
          source,
          summarySource: policy ? 'browser' : 'original',
          establishmentWeights,
          maturationWeights,
          synthetic: value.synthetic === true,
        },
      ),
    )
  }
  throw new Error(
    'Supported comparison JSON formats: a comparison snapshot/report, a current-analysis report, or an imported Shiny report analysis. Raw pilot inputs and formatted tables are not result snapshots.',
  )
}
