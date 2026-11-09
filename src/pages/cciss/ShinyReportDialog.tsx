import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { DialogShell } from '@/components/ui/dialog-shell'
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { SelectField } from '@/components/ui/form-field'
import { CollapsibleSection, InlineAlert, SidebarSection } from '@/components/ui/map-panels'
import { TabBar } from '@/components/ui/tab-bar'
import { downloadText } from '@/lib/download'
import type { ComparisonSnapshot } from './comparison'
import { shinySnapshot } from './comparisonAdapters'
import { ComparisonCapture } from './ComparisonCapture'
import { DownloadActions } from './DownloadActions'
import { FileImportField } from './FileImportField'
import { ratingLabel } from './legacyAnalysis'
import { PeriodWeightFields } from './PeriodWeightFields'
import { PublishedReferenceChecks } from './PublishedReferenceChecks'
import {
  DEFAULT_ESTABLISHMENT,
  DEFAULT_MATURATION,
  SHINY_SUMMARY_POLICIES,
  createReportAnalysis,
  reportAnalysisCsv,
  reportSummaryStatus,
  supportedSummaryPolicies,
  summarizeVotes,
  type ShinyReport,
} from './shinyReport'
import { shinySpeciesReportHtml } from './shinyReportExport'
import { Silvics } from './Silvics'
import { useShinyReportImport } from './useShinyReportImport'
import { VoteBars } from './VoteBars'

type Tab = 'report' | 'silvics' | 'inputs' | 'checks'
type Summary = ReturnType<typeof summarizeVotes>
type Policy = ReturnType<typeof supportedSummaryPolicies>[number]
const placeKey = (row: ShinyReport['rows'][number]) => JSON.stringify([row.site, row.series])

/** Browser summaries for each row; invalid weights withhold every summary and report why. */
function summarizeRows(rows: ShinyReport['rows'], est: number[], mat: number[], policy: Policy | null) {
  let weightError = ''
  const summaries = rows.map((row) => {
    try {
      return policy ? summarizeVotes(row, est, mat, policy) : null
    } catch (cause) {
      weightError = String(cause)
      return null
    }
  })
  return { summaries, weightError }
}

function SpeciesSummaryTable({ rows, summaries }: { rows: ShinyReport['rows']; summaries: (Summary | null)[] }) {
  return (
    <div className="overflow-x-auto">
      <EngineeringTable className="whitespace-normal text-xs [&_td]:py-2">
        <caption className="mb-2 text-left text-sm font-semibold">Species summary</caption>
        <thead>
          <tr>
            <ColumnHeader label="Species" className="text-left" />
            <ColumnHeader label="Baseline" className="text-left" />
            <ColumnHeader label="Establishment¹" className="text-left" />
            <ColumnHeader label="Maturation¹" className="text-left" />
            <ColumnHeader label="Stable / improving¹" />
            <ColumnHeader label="Declining / unsuitable¹" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.species}>
              <td className="text-left">{row.species}</td>
              <td className="text-left">{ratingLabel(row.current)}</td>
              <td className="text-left">{summaries[i] ? ratingLabel(summaries[i]!.establishment) : '—'}</td>
              <td className="text-left">{summaries[i] ? ratingLabel(summaries[i]!.maturation) : '—'}</td>
              <td>{summaries[i] ? `${summaries[i]!.improve}%` : '—'}</td>
              <td>{summaries[i] ? `${summaries[i]!.decline}%` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </EngineeringTable>
    </div>
  )
}

/** A published or exported Shiny result: its votes per period, reweighted summaries and reference checks. */
export function ShinyReportDialog({
  onClose,
  onCaptureComparison,
  onOpenComparison,
  comparisonCount,
}: {
  onClose: () => void
  onCaptureComparison?: (snapshot: ComparisonSnapshot) => void
  onOpenComparison?: () => void
  comparisonCount?: number
}) {
  const [place, setPlace] = useState('')
  const [species, setSpecies] = useState('')
  const [tab, setTab] = useState<Tab>('report')
  const [est, setEst] = useState(DEFAULT_ESTABLISHMENT)
  const [mat, setMat] = useState(DEFAULT_MATURATION)
  const [policyId, setPolicyId] = useState(SHINY_SUMMARY_POLICIES[0].id)
  // A new report starts on its first site and species, with its own source-backed period weights.
  const imported = useShinyReportImport((parsed) => {
    const policy = supportedSummaryPolicies(parsed)[0] ?? SHINY_SUMMARY_POLICIES[0]
    setEst([...policy.establishment.weights])
    setMat([...policy.maturation.weights])
    setPolicyId(policy.id)
    setPlace(placeKey(parsed.rows[0]))
    setSpecies(parsed.rows[0].species)
  })
  const { report, source, archive } = imported

  const policies = report ? supportedSummaryPolicies(report) : []
  const policy = policies.find((p) => p.id === policyId) ?? policies[0] ?? null
  const places = [...new Set(report?.rows.map(placeKey) ?? [])]
  const rows = report?.rows.filter((row) => placeKey(row) === place) ?? []
  const selected = rows.find((row) => row.species === species) ?? rows[0]
  const { summaries, weightError } = summarizeRows(rows, est, mat, policy)

  function downloadAnalysis(format: 'json' | 'csv') {
    if (!report || weightError) return
    const analysis = createReportAnalysis(report, source, est, mat, policy)
    downloadText(
      format === 'json' ? JSON.stringify(analysis, null, 2) : reportAnalysisCsv(analysis),
      `cciss-species-analysis.${format}`,
      format === 'json' ? 'application/json' : 'text/csv',
    )
  }
  function downloadReport() {
    if (!report) return
    downloadText(
      shinySpeciesReportHtml({
        report,
        rows,
        summaries,
        source,
        place,
        establishmentWeights: est,
        maturationWeights: mat,
      }),
      'cciss-species-report.html',
      'text/html',
    )
  }
  const snapshot = (label: string | undefined, summarySource: 'original' | 'browser') => {
    const [site, series] = JSON.parse(place) as [string, string]
    return shinySnapshot(report!, {
      site,
      series,
      source,
      label,
      summarySource,
      ...(summarySource === 'browser' ? { establishmentWeights: est, maturationWeights: mat } : {}),
    })
  }

  return (
    <DialogShell
      title="CCISS species report"
      subtitle="Published results and browser calculations"
      onClose={onClose}
      size="xl"
    >
      <div className="space-y-4">
        <InlineAlert tone="info">
          Load an existing Shiny result to view its species probabilities and reports. This report uses the sites in the
          file, independently of the map point.
        </InlineAlert>
        <div className="flex flex-wrap items-start gap-3">
          <Button
            variant="outline"
            className="mt-5"
            disabled={imported.loading}
            onClick={() => void imported.loadExample()}
          >
            Load published example
          </Button>
          <div className="min-w-64 flex-1">
            <FileImportField
              label="Import Shiny CSV or ZIP"
              accept=".csv,.zip,text/csv,application/zip"
              buttonLabel="Import CSV or ZIP"
              onFile={(file) => void imported.importFile(file)}
              onError={imported.fail}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          In Shiny: generate the site results → Export → CSV, then choose the downloaded ZIP or cciss_export.csv. Files
          stay in this browser. CSV limit: 5 MB; ZIP limit: 20 MB. RDS imports are not supported.
        </p>
        {archive && (
          <SidebarSection title={`CSV files in ${archive.name}`}>
            <SelectField
              label="Archived result CSV"
              value={imported.archiveEntry}
              disabled={imported.loading}
              onChange={(event) => imported.chooseArchiveEntry(event.target.value)}
              description="Select the result file when an archive contains several CSVs. The last valid report stays available if another file cannot be read."
            >
              <option value="">Choose a suitability result CSV…</option>
              {archive.entries.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </SelectField>
          </SidebarSection>
        )}
        {imported.loading && <InlineAlert loading>Loading report…</InlineAlert>}
        {imported.error && <InlineAlert tone="error">{imported.error}</InlineAlert>}
        <TabBar
          label="CCISS report pages"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'report', label: 'Suitability report' },
            { value: 'silvics', label: 'Silvics' },
            { value: 'inputs', label: 'Calculation inputs' },
            { value: 'checks', label: 'Reference checks' },
          ]}
        />
        {tab === 'checks' && report && <PublishedReferenceChecks report={report} source={source} />}
        {tab === 'inputs' && (
          <SidebarSection title="Current site calculator">
            <p className="text-sm">
              Reference tables are downloaded. Full calculations for a new point still require matching model-member
              predictions, the CCISS site-ID grid, and deployed ecological-table versions. Imported aggregate votes
              support period reweighting; they cannot support changing GCM/SSP weights, site conditions or novelty
              filtering.
            </p>
            <p className="mt-2 text-sm">
              Implemented source stage: establishment and maturation suitability, plus improving/stable and
              declining/unsuitable proportions from exported votes. Site-series overlap and new BGC predictions are not
              run by this report.
            </p>
          </SidebarSection>
        )}
        {report && tab !== 'inputs' && tab !== 'checks' && (
          <>
            <p className="text-sm font-medium">{source}</p>
            {report.format === 'historical-raw' && (
              <InlineAlert tone="warning">
                This is an older published example. Its period IDs are retained exactly; current-period summary
                calculations are unavailable. It is not a result for the selected map point.
              </InlineAlert>
            )}
            <ComparisonCapture
              onCapture={onCaptureComparison}
              onOpen={onOpenComparison}
              count={comparisonCount}
              actions={[
                {
                  label: 'Save original Shiny for comparison',
                  create: (label) => snapshot(label, 'original'),
                },
                {
                  label: 'Save browser summary for comparison',
                  disabled: Boolean(weightError) || !policy,
                  create: (label) => snapshot(label, 'browser'),
                },
              ]}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField
                label="Site and site series"
                value={place}
                onChange={(event) => setPlace(event.target.value)}
              >
                {places.map((p) => (
                  <option key={p} value={p}>
                    {(JSON.parse(p) as string[]).join(' · ')}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label="Species detail"
                value={selected?.species ?? ''}
                onChange={(event) => setSpecies(event.target.value)}
              >
                {rows.map((row) => (
                  <option key={row.species}>{row.species}</option>
                ))}
              </SelectField>
            </div>
            {tab === 'silvics' && selected && <Silvics species={selected.species} />}
            {tab === 'report' && (
              <>
                {selected && (
                  <SidebarSection title={`Period votes · ${selected.species}`}>
                    <VoteBars periods={report.periods} votes={selected.votes} novelty={selected.novelty} />
                  </SidebarSection>
                )}
                {selected && ['EstabFeas', 'ccissFeas', 'Improve', 'Decline'].some((key) => selected.original[key]) && (
                  <SidebarSection title={`Original Shiny summary · ${selected.species}`}>
                    <p className="text-sm">
                      Establishment: {selected.original.EstabFeas}; maturation: {selected.original.ccissFeas ?? '—'};
                      stable / improving: {selected.original.Improve ?? '—'}%; declining / unsuitable:{' '}
                      {selected.original.Decline ?? '—'}%.
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Values preserved from the file. These do not change with the browser weights below. Source
                      ratings: 1 high, 2 moderate, 3 low, X unsuitable.
                    </p>
                  </SidebarSection>
                )}
                {policy && (
                  <CollapsibleSection
                    label="Recalculate with period weights"
                    collapseOn="always"
                    className="rounded-md border"
                    contentClassName="space-y-3 px-3 pb-3"
                  >
                    <p className="text-xs text-muted-foreground">
                      {policy.label}. Defaults come from the Shiny source. Each group is normalized to sum to one.
                      Summaries require complete votes for every policy period. Novelty-scaled exports can be viewed but
                      are not reweighted here.
                    </p>
                    {policies.length > 1 && (
                      <SelectField
                        label="Summary policy"
                        value={policy.id}
                        onChange={(event) => {
                          const next = policies.find((p) => p.id === event.target.value)!
                          setPolicyId(next.id)
                          setEst([...next.establishment.weights])
                          setMat([...next.maturation.weights])
                        }}
                      >
                        {policies.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label}
                          </option>
                        ))}
                      </SelectField>
                    )}
                    <PeriodWeightFields
                      label="Establishment"
                      periods={policy.establishment.periods}
                      weights={est}
                      onChange={setEst}
                    />
                    <PeriodWeightFields
                      label="Maturation"
                      periods={policy.maturation.periods}
                      weights={mat}
                      onChange={setMat}
                    />
                  </CollapsibleSection>
                )}
                {selected && <p className="text-xs text-muted-foreground">{reportSummaryStatus(selected, policy)}</p>}
                {weightError && <InlineAlert tone="error">{weightError}</InlineAlert>}
                <SpeciesSummaryTable rows={rows} summaries={summaries} />
                <p className="text-xs text-muted-foreground">
                  ¹ Calculated in this browser from the imported votes. — means required periods or complete votes are
                  missing, or the export includes novelty-scaled votes. It does not mean unsuitable.
                </p>
                <DownloadActions
                  actions={[
                    { label: 'Download printable HTML report', onClick: downloadReport, disabled: !!weightError },
                    {
                      label: 'Download analysis JSON',
                      onClick: () => downloadAnalysis('json'),
                      disabled: !!weightError,
                    },
                    { label: 'Download analysis CSV', onClick: () => downloadAnalysis('csv'), disabled: !!weightError },
                  ]}
                />
                <p className="text-xs text-muted-foreground">
                  HTML contains the selected site and site series. JSON and CSV include every imported site, series and
                  species, original results, period weights and browser summaries. JSON also retains all original CSV
                  rows.
                </p>
              </>
            )}
          </>
        )}
        {!report && tab !== 'inputs' && (
          <p className="text-sm text-muted-foreground">Load the published example or import a result to begin.</p>
        )}
      </div>
    </DialogShell>
  )
}
