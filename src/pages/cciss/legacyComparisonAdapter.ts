import { parseComparisonSnapshot, type ComparisonMetric, type ComparisonSnapshot, type JSONValue } from './comparison'
import { memberKey, type LegacyComparisonReport } from './legacyComparison'
import { legacyScenarioLabel, type LegacyReference } from './legacyAnalysis'

export interface LegacySnapshotOptions {
  /** Exact model/run/scenario key from compareLegacyPoint, never a display abbreviation. */
  member: string
  reference: LegacyReference
  label?: string
  id?: string
  capturedAt?: string
}

/** Capture the selected actual member; source arrays and controls never remain live references. */
export function legacyComparisonSnapshot(
  report: LegacyComparisonReport,
  options: LegacySnapshotOptions,
): ComparisonSnapshot {
  const comparison = report.comparison
  const member = comparison.members.find((value) => value.key === options.member)
  if (!member) throw new Error('Choose an available model run before saving a comparison.')
  const projections = comparison.projections.filter((value) => memberKey(value) === member.key)
  if (!projections.length) throw new Error('The selected model run has no sampled periods.')
  if (
    report.regional.trends.some(
      (row) => row.GCM !== member.model || row.SSP !== member.scenario || row.RUN !== member.run,
    )
  )
    throw new Error('The regional results do not match the selected model, scenario and run.')
  const periods: ComparisonSnapshot['periods'] = {}
  const metrics: ComparisonMetric[] = []
  let unclassifiedRatings = 0
  const addPeriod = (token: string) => {
    const bounds = /^(\d{4})_(\d{4})$/.exec(token)
    periods[token] = {
      label: token.replace('_', '–'),
      startYear: bounds ? Number(bounds[1]) : null,
      endYear: bounds ? Number(bounds[2]) : null,
      kind: bounds ? 'calendar-interval' : 'source-period',
    }
  }
  const pointRows = [
    ...(comparison.baseline ? [{ raster: comparison.baseline, stage: 'baseline' }] : []),
    ...(comparison.observed ? [{ raster: comparison.observed, stage: 'observed' }] : []),
    ...projections.map((raster) => ({ raster, stage: 'modelled' })),
  ]
  for (const { raster, stage } of pointRows) {
    addPeriod(raster.period)
    const dimensions = { scope: 'point', stage }
    metrics.push(
      {
        measure: 'bgc',
        entity: 'site',
        label: 'BGC',
        dimensions,
        period: raster.period,
        value: raster.bgc,
        unit: 'category',
        direction: 'neutral',
      },
      {
        measure: 'site-series',
        entity: 'site',
        label: 'Site series',
        dimensions,
        period: raster.period,
        value: raster.bgc ? (options.reference.sites[raster.bgc]?.[report.edatope] ?? null) : null,
        unit: 'category',
        direction: 'neutral',
      },
    )
    for (const species of comparison.species) {
      const value =
        stage === 'baseline'
          ? species.baseline
          : stage === 'observed'
            ? species.observed
            : (species.projections.find((row) => row.member === member.key && row.period === raster.period)?.rating ??
              null)
      const classified = value === null || [1, 2, 3, 4].includes(value)
      if (!classified) {
        unclassifiedRatings++
        metrics.push({
          measure: 'species-source-code',
          entity: species.species,
          label: 'Unclassified source rating',
          dimensions,
          period: raster.period,
          value: String(value),
          unit: 'category',
          direction: 'neutral',
        })
      }
      metrics.push({
        measure: 'species-suitability',
        entity: species.species,
        label: 'Species suitability',
        dimensions,
        period: raster.period,
        value: classified ? value : null,
        unit: 'class',
        scale: 'cciss-suitability-1-4',
        direction: 'lower-better',
      })
    }
  }
  const baselineCounts = new Set<string>()
  for (const row of report.regional.trends) {
    addPeriod(row.PERIOD)
    const dimensions = { scope: 'named-region' }
    const base = { entity: report.regional.species, dimensions, period: row.PERIOD, direction: 'neutral' as const }
    metrics.push(
      {
        ...base,
        measure: 'regional-persistence',
        label: 'Regional persistence',
        value: row.persistence,
        unit: 'ratio',
      },
      { ...base, measure: 'regional-expansion', label: 'Regional expansion', value: row.expansion, unit: 'ratio' },
      {
        ...base,
        measure: 'regional-suitable-cells',
        label: 'Suitable grid cells',
        value: row.total ?? null,
        unit: 'count',
      },
    )
    const baselinePeriod = row.baselinePeriod ?? comparison.baseline?.period
    if (baselinePeriod && !baselineCounts.has(baselinePeriod)) {
      addPeriod(baselinePeriod)
      baselineCounts.add(baselinePeriod)
      metrics.push({
        ...base,
        period: baselinePeriod,
        measure: 'regional-baseline-cells',
        label: 'Historical suitable grid cells',
        value: row.baseline ?? null,
        unit: 'count',
      })
    }
  }
  const json = (value: unknown): JSONValue => JSON.parse(JSON.stringify(value ?? null)) as JSONValue
  return parseComparisonSnapshot({
    schema: 'cciss-comparison-snapshot-v1',
    id: options.id ?? `legacy-${crypto.randomUUID()}`,
    label:
      options.label?.trim() ||
      `${report.latitude.toFixed(5)}, ${report.longitude.toFixed(5)} · ${member.model} · ${legacyScenarioLabel(member.scenario)} · ${member.run ?? 'No run ID'} · ${report.edatope}`,
    family: 'cciss-legacy-spatial',
    provenance: {
      source: report.source,
      method: report.method,
      limitations: [
        report.method,
        ...(unclassifiedRatings
          ? [
              `${unclassifiedRatings} source ratings use codes outside the defined 1–4 suitability scale. Their raw codes are retained as unclassified categories and ordinal suitability remains unknown.`,
            ]
          : []),
        'Regional grid-cell ratios and counts describe the selected named area independently of the point. Counts are not hectares; ratios are not site probabilities.',
      ],
      metadata: {
        datasetSchema: report.dataset,
        capturedAt: options.capturedAt ?? new Date().toISOString(),
        sourceManifest: json(report.provenance),
        sampledRasters: json(pointRows.map(({ raster, stage }) => ({ ...raster, stage }))),
        regionalRows: json(report.regional.trends),
      },
    },
    context: {
      longitude: report.longitude,
      latitude: report.latitude,
      siteCondition: report.edatope,
      model: member.model,
      scenario: member.scenario,
      run: member.run,
      regionalArea: report.regional.region,
      regionalSpecies: report.regional.species,
      regionalScope: 'Named area selected independently of the point',
      regionalStatus: report.regional.trends.length
        ? 'Available for the selected member'
        : 'No matching regional results',
    },
    periods,
    metrics,
  })
}
