import type { CurrentAssessment, CurrentBundle, CurrentSettings } from './currentAnalysis'
import type { CurrentAnalysisReport, CurrentAnalysisTable } from './currentAnalysisExport'
import { ratingLabel } from './legacyAnalysis'
import type { summarizeVotes } from './shinyReport'

type Summary = ReturnType<typeof summarizeVotes>

export const percentOrNoData = (value: number | null | undefined) =>
  value == null ? 'No data' : `${(value * 100).toFixed(1)}%`

/** Each species' period summary, in the assessment's species order; `null` where it was withheld. */
export function speciesSummaries(assessment: CurrentAssessment): (Summary | null)[] {
  return assessment.species.map(
    (row) => assessment.summaries.find((entry) => entry.species === row.species)?.summary ?? null,
  )
}

export function capabilityRows(assessment: CurrentAssessment) {
  return [
    { label: 'Weighted BGC predictions', available: assessment.capabilities.predictions },
    { label: 'Site-series overlap', available: assessment.capabilities.siteSeries },
    { label: 'Species suitability votes', available: assessment.capabilities.suitability },
    { label: 'Current-period suitability summaries', available: assessment.capabilities.summaries },
  ]
}

export function speciesSummaryTable(
  assessment: CurrentAssessment,
  summaries: (Summary | null)[],
): CurrentAnalysisTable {
  return {
    title: 'Current species suitability summary',
    columns: [
      'Species',
      'Baseline',
      'Establishment',
      'Maturation',
      'Stable / improving (%)',
      'Declining / unsuitable (%)',
    ],
    rows: assessment.species.map((row, index) => [
      row.species,
      ratingLabel(row.current),
      summaries[index] ? ratingLabel(summaries[index]!.establishment) : 'Not calculated',
      summaries[index] ? ratingLabel(summaries[index]!.maturation) : 'Not calculated',
      summaries[index]?.improve ?? null,
      summaries[index]?.decline ?? null,
    ]),
  }
}

/** The tables an export carries; probabilities stay as 0–1 proportions, unlike the dialog's percentages. */
export function assessmentTables(assessment: CurrentAssessment, summaries: (Summary | null)[]): CurrentAnalysisTable[] {
  return [
    {
      title: 'BGC probabilities',
      columns: ['Period', 'BGC', 'Probability (0–1)', 'Contributing members'],
      rows: assessment.bgcProbabilities.map((row) => [row.period, row.bgc, row.probability, row.members]),
    },
    {
      title: 'Site-series overlap',
      columns: ['Period', 'Predicted BGC', 'Predicted site series', 'Probability (0–1)'],
      rows: assessment.overlap.map((row) => [row.period, row.predictedBgc, row.predictedSeries, row.probability]),
    },
    speciesSummaryTable(assessment, summaries),
    {
      title: 'Species vote proportions',
      columns: [
        'Species',
        'Period',
        'High (0–1)',
        'Moderate (0–1)',
        'Low (0–1)',
        'Unsuitable (0–1)',
        'Novel climate (0–1)',
      ],
      rows: assessment.species.flatMap((row) =>
        Object.keys(row.votes)
          .sort()
          .map((period) => [
            row.species,
            period,
            ...[0, 1, 2, 3].map((index) => row.votes[period]?.[index] ?? null),
            row.novelty[period] ?? null,
          ]),
      ),
    },
  ]
}

/** The assessment report both downloads are written from. */
export function currentAnalysisReport(
  assessment: CurrentAssessment,
  bundle: CurrentBundle,
  settings: CurrentSettings,
  sourceFile: string,
  baselineBgc: string,
): CurrentAnalysisReport {
  return {
    schema: 'cciss-current-analysis-report-v1',
    generatedAt: new Date().toISOString(),
    sourceFile,
    provenance: Object.fromEntries(
      Object.entries({ ...bundle.provenance, independentShinyParityVerified: false }).filter(
        ([, value]) => value !== undefined,
      ),
    ),
    selection: {
      siteId: settings.siteId,
      baselineBgc,
      series: settings.series ?? null,
      modelWeights: settings.modelWeights,
      scenarioWeights: settings.scenarioWeights,
      noveltyCutoff: settings.noveltyCutoff,
      includeOutOfRange: settings.includeOutOfRange,
      establishmentWeights: settings.establishmentWeights,
      maturationWeights: settings.maturationWeights,
    },
    capabilities: capabilityRows(assessment)
      .filter((row) => row.available)
      .map((row) => row.label),
    limitations: [
      ...assessment.warnings,
      'Independent agreement with deployed Shiny results has not been established.',
    ],
    tables: assessmentTables(assessment, speciesSummaries(assessment)),
    calculation: assessment,
  }
}
