import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { NativeSelect } from '@/components/ui/form-field'
import { Silvics } from './Silvics'
import type { ComparisonSnapshot } from './comparison'
import { shinySnapshot } from './comparisonAdapters'
import { ComparisonCapture } from './ComparisonCapture'
import { PublishedReferenceChecks } from './PublishedReferenceChecks'
import { useEffect, useRef, useState } from 'react'
import { DialogShell } from '@/components/ui/dialog-shell'
import { InlineAlert, SidebarSection } from '@/components/ui/map-panels'
import { Button } from '@/components/ui/button'
import { TabBar } from '@/components/ui/tab-bar'
import { fetchGzipText } from '@/lib/fetchJson'
import { downloadText } from '@/lib/download'
import { ratingLabel } from './legacyAnalysis'
import { openReportArchive, readReportCsv, REPORT_IMPORT_LIMITS, type ReportArchive } from './reportImport'
import {
  DEFAULT_ESTABLISHMENT,
  DEFAULT_MATURATION,
  SHINY_SUMMARY_POLICIES,
  createReportAnalysis,
  parseShinyReport,
  reportAnalysisCsv,
  reportSummaryStatus,
  supportedSummaryPolicies,
  summarizeVotes,
  type ShinyReport,
  type Votes,
} from './shinyReport'

const selectClass = 'mt-1 w-full rounded-md border border-border bg-background p-2 text-sm'
const colours = ['#006400', '#1e90ff', '#eec900', '#d4d4d4', '#a855f7']
const voteNames = ['High', 'Moderate', 'Low', 'Unsuitable', 'Novel climate']
const escapeHtml = (s: unknown) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )

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
  const [report, setReport] = useState<ShinyReport | null>(null)
  const [source, setSource] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [place, setPlace] = useState('')
  const [species, setSpecies] = useState('')
  const [tab, setTab] = useState<'report' | 'silvics' | 'inputs' | 'checks'>('report')
  const [est, setEst] = useState(DEFAULT_ESTABLISHMENT)
  const [mat, setMat] = useState(DEFAULT_MATURATION)
  const [policyId, setPolicyId] = useState(SHINY_SUMMARY_POLICIES[0].id)
  const [archive, setArchive] = useState<ReportArchive | null>(null)
  const [archiveEntry, setArchiveEntry] = useState('')
  const request = useRef(0)
  useEffect(
    () => () => {
      request.current++
    },
    [],
  )
  function acceptReport(parsed: ShinyReport, name: string) {
    const policy = supportedSummaryPolicies(parsed)[0] ?? SHINY_SUMMARY_POLICIES[0]
    setReport(parsed)
    setEst([...policy.establishment.weights])
    setMat([...policy.maturation.weights])
    setPolicyId(policy.id)
    setSource(name)
    setPlace(JSON.stringify([parsed.rows[0].site, parsed.rows[0].series]))
    setSpecies(parsed.rows[0].species)
  }
  async function load(read: () => Promise<string>, name: string, keepArchive = false) {
    const id = ++request.current
    setLoading(true)
    setError('')
    try {
      const parsed = parseShinyReport(await read())
      if (id !== request.current) return
      acceptReport(parsed, name)
      if (!keepArchive) {
        setArchive(null)
        setArchiveEntry('')
      }
    } catch (e) {
      if (id === request.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (id === request.current) setLoading(false)
    }
  }
  async function importFile(file: File) {
    const id = ++request.current
    setLoading(true)
    setError('')
    try {
      const isZip = /\.zip$/i.test(file.name)
      const limit = isZip ? REPORT_IMPORT_LIMITS.zipBytes : REPORT_IMPORT_LIMITS.csvBytes
      if (file.size > limit)
        throw new Error(isZip ? 'Please select a ZIP smaller than 20 MB.' : 'Please select a CSV smaller than 5 MB.')
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (id !== request.current) return
      if (isZip) {
        const nextArchive = await openReportArchive(file.name, bytes)
        if (id !== request.current) return
        setArchive(nextArchive)
        setArchiveEntry(nextArchive.preferred ?? '')
        if (nextArchive.preferred) {
          const parsed = parseShinyReport(await nextArchive.read(nextArchive.preferred))
          if (id === request.current) acceptReport(parsed, `${file.name} / ${nextArchive.preferred}`)
        }
      } else {
        const parsed = parseShinyReport(readReportCsv(bytes))
        acceptReport(parsed, file.name)
        setArchive(null)
        setArchiveEntry('')
      }
    } catch (e) {
      if (id === request.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (id === request.current) setLoading(false)
    }
  }
  const policies = report ? supportedSummaryPolicies(report) : []
  const policy = policies.find((p) => p.id === policyId) ?? policies[0] ?? null
  const places = [...new Set(report?.rows.map((r) => JSON.stringify([r.site, r.series])) ?? [])]
  const rows = report?.rows.filter((r) => JSON.stringify([r.site, r.series]) === place) ?? []
  const selected = rows.find((r) => r.species === species) ?? rows[0]
  let weightError = ''
  const summaries = rows.map((r) => {
    try {
      return policy ? summarizeVotes(r, est, mat, policy) : null
    } catch (e) {
      weightError = String(e)
      return null
    }
  })
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
    const headings = [
      'Species',
      'Baseline',
      ...report.periods.map((p) => `Period ${p}: high / moderate / low / unsuitable / novel climate (%)`),
      'Browser establishment',
      'Browser maturation',
      'Browser stable / improving (%)',
      'Browser declining / unsuitable (%)',
      'Original Shiny establishment',
      'Original Shiny maturation',
      'Original Shiny stable / improving (%)',
      'Original Shiny declining / unsuitable (%)',
    ]
    const body = rows
      .map(
        (r, i) =>
          '<tr>' +
          [
            r.species,
            ratingLabel(r.current),
            ...report.periods.map((p) =>
              r.votes[p]
                ? [
                    ...r.votes[p]!.map((v) => (100 * v).toFixed(1)),
                    r.novelty[p] == null ? 'Not exported' : (100 * r.novelty[p]!).toFixed(1),
                  ].join(' / ')
                : 'No data',
            ),
            summaries[i] ? ratingLabel(summaries[i]!.establishment) : 'Not calculated',
            summaries[i] ? ratingLabel(summaries[i]!.maturation) : 'Not calculated',
            summaries[i]?.improve ?? 'Not calculated',
            summaries[i]?.decline ?? 'Not calculated',
            r.original.EstabFeas ?? 'Not provided',
            r.original.ccissFeas ?? 'Not provided',
            r.original.Improve ?? 'Not provided',
            r.original.Decline ?? 'Not provided',
          ]
            .map((v) => `<td>${escapeHtml(v)}</td>`)
            .join('') +
          '</tr>',
      )
      .join('')
    downloadText(
      `<!doctype html><meta charset="utf-8"><title>CCISS species report</title><style>body{font:14px system-ui;margin:30px}table{border-collapse:collapse;width:100%}td,th{padding:8px;border:1px solid #ccc;text-align:left}@media print{body{margin:0}}</style><h1>CCISS species report</h1><p>Source: ${escapeHtml(source)}</p><p>Site / series: ${escapeHtml(place)}. Original period identifiers retained. Imported results are not recalculated for the map point.</p><p>Browser summaries use exported vote proportions and period weights, not new climate-model predictions. Historical periods, incomplete votes or novelty-scaled exports give no browser summary.</p><p>Establishment weights: ${escapeHtml(est.join(', '))}; maturation: ${escapeHtml(mat.join(', '))} (normalized for calculation).</p><table><thead><tr>${headings.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`,
      'cciss-species-report.html',
      'text/html',
    )
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
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            disabled={loading}
            onClick={() =>
              void load(
                () => fetchGzipText('/data/cciss/report-examples/williams-lake-raw.csv.gz'),
                'Published Williams Lake example · historical periods',
              )
            }
          >
            Load published example
          </Button>
          <label className="text-sm">
            Import Shiny CSV or ZIP
            <input
              className="mt-1 block max-w-xs text-sm"
              type="file"
              accept=".csv,.zip,text/csv,application/zip"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void importFile(f)
                e.target.value = ''
              }}
            />
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          In Shiny: generate the site results → Export → CSV, then choose the downloaded ZIP or cciss_export.csv. Files
          stay in this browser. CSV limit: 5 MB; ZIP limit: 20 MB. RDS imports are not supported.
        </p>
        {archive && (
          <SidebarSection title={`CSV files in ${archive.name}`}>
            <label className="block text-sm">
              Archived result CSV
              <NativeSelect
                className={selectClass}
                value={archiveEntry}
                disabled={loading}
                onChange={(event) => {
                  const entry = event.target.value
                  setArchiveEntry(entry)
                  if (entry) void load(() => archive.read(entry), `${archive.name} / ${entry}`, true)
                }}
              >
                <option value="">Choose a suitability result CSV…</option>
                {archive.entries.map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <p className="mt-2 text-xs text-muted-foreground">
              Select the result file when an archive contains several CSVs. The last valid report stays available if
              another file cannot be read.
            </p>
          </SidebarSection>
        )}
        {loading && <InlineAlert loading>Loading report…</InlineAlert>}
        {error && <InlineAlert tone="error">{error}</InlineAlert>}
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
                  create: (label) => {
                    const [site, series] = JSON.parse(place) as [string, string]
                    return shinySnapshot(report, { site, series, source, label, summarySource: 'original' })
                  },
                },
                {
                  label: 'Save browser summary for comparison',
                  disabled: Boolean(weightError) || !policy,
                  create: (label) => {
                    const [site, series] = JSON.parse(place) as [string, string]
                    return shinySnapshot(report, {
                      site,
                      series,
                      source,
                      label,
                      summarySource: 'browser',
                      establishmentWeights: est,
                      maturationWeights: mat,
                    })
                  },
                },
              ]}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <label>
                Site and site series
                <NativeSelect className={selectClass} value={place} onChange={(e) => setPlace(e.target.value)}>
                  {places.map((p) => (
                    <option key={p} value={p}>
                      {(JSON.parse(p) as string[]).join(' · ')}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <label>
                Species detail
                <NativeSelect
                  className={selectClass}
                  value={selected?.species ?? ''}
                  onChange={(e) => setSpecies(e.target.value)}
                >
                  {rows.map((r) => (
                    <option key={r.species}>{r.species}</option>
                  ))}
                </NativeSelect>
              </label>
            </div>
            {tab === 'silvics' && selected && <Silvics species={selected.species} />}
            {tab === 'report' && (
              <>
                {selected && (
                  <SidebarSection title={`Period votes · ${selected.species}`}>
                    <div className="mb-3 flex flex-wrap gap-4 text-xs">
                      {voteNames
                        .slice(0, Object.values(selected.novelty).some((n) => n != null) ? 5 : 4)
                        .map((n, i) => (
                          <span key={n}>
                            <span className="mr-1 inline-block h-3 w-3" style={{ background: colours[i] }} />
                            {n}
                          </span>
                        ))}
                    </div>
                    {report.periods.map((p) => (
                      <VoteBar key={p} period={p} votes={selected.votes[p]} novelty={selected.novelty[p]} />
                    ))}
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
                  <details>
                    <summary className="cursor-pointer text-sm font-medium">Recalculate with period weights</summary>
                    <p className="my-2 text-xs text-muted-foreground">
                      {policy.label}. Defaults come from the Shiny source. Each group is normalized to sum to one.
                      Summaries require complete votes for every policy period. Novelty-scaled exports can be viewed but
                      are not reweighted here.
                    </p>
                    {policies.length > 1 && (
                      <label className="block text-sm">
                        Summary policy
                        <NativeSelect
                          className={selectClass}
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
                        </NativeSelect>
                      </label>
                    )}
                    <Weights
                      label="Establishment"
                      periods={policy.establishment.periods}
                      values={est}
                      onChange={setEst}
                    />
                    <Weights label="Maturation" periods={policy.maturation.periods} values={mat} onChange={setMat} />
                  </details>
                )}
                {selected && <p className="text-xs text-muted-foreground">{reportSummaryStatus(selected, policy)}</p>}
                {weightError && <InlineAlert tone="error">{weightError}</InlineAlert>}
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
                      {rows.map((r, i) => (
                        <tr key={r.species}>
                          <td className="text-left">{r.species}</td>
                          <td className="text-left">{ratingLabel(r.current)}</td>
                          <td className="text-left">{summaries[i] ? ratingLabel(summaries[i]!.establishment) : '—'}</td>
                          <td className="text-left">{summaries[i] ? ratingLabel(summaries[i]!.maturation) : '—'}</td>
                          <td>{summaries[i] ? `${summaries[i]!.improve}%` : '—'}</td>
                          <td>{summaries[i] ? `${summaries[i]!.decline}%` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </EngineeringTable>
                </div>
                <p className="text-xs text-muted-foreground">
                  ¹ Calculated in this browser from the imported votes. — means required periods or complete votes are
                  missing, or the export includes novelty-scaled votes. It does not mean unsuitable.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={downloadReport} disabled={!!weightError}>
                    Download printable HTML report
                  </Button>
                  <Button variant="outline" onClick={() => downloadAnalysis('json')} disabled={!!weightError}>
                    Download analysis JSON
                  </Button>
                  <Button variant="outline" onClick={() => downloadAnalysis('csv')} disabled={!!weightError}>
                    Download analysis CSV
                  </Button>
                </div>
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
function Weights({
  label,
  periods,
  values,
  onChange,
}: {
  label: string
  periods: string[]
  values: number[]
  onChange: (v: number[]) => void
}) {
  return (
    <fieldset className="my-3">
      <legend className="text-sm">{label}</legend>
      <div className="flex flex-wrap gap-3">
        {periods.map((p, i) => (
          <label className="text-xs" key={p}>
            {p}
            <input
              aria-label={`${label} ${p}`}
              className="mt-1 block w-20 rounded border bg-background p-2"
              type="number"
              min="0"
              step="0.05"
              value={Number.isFinite(values[i]) ? values[i] : ''}
              onChange={(e) => onChange(values.map((v, j) => (j === i ? e.target.valueAsNumber : v)))}
            />
          </label>
        ))}
      </div>
    </fieldset>
  )
}
function VoteBar({
  period,
  votes,
  novelty,
}: {
  period: string
  votes: Votes | null | undefined
  novelty: number | null | undefined
}) {
  const values = votes ? (novelty == null ? votes : [...votes, novelty]) : null
  return (
    <div className="mb-3">
      <div className="mb-1 flex flex-wrap justify-between gap-2 text-xs">
        <span>Period {period}</span>
        <span>
          {values ? values.map((v, i) => `${voteNames[i]} ${(v * 100).toFixed(1)}%`).join(' · ') : 'No complete votes'}
        </span>
      </div>
      {values && (
        <div
          role="img"
          aria-label={`Period ${period} vote proportions`}
          className="flex h-5 overflow-hidden rounded bg-secondary"
        >
          {values.map((v, i) => (
            <div key={i} style={{ width: `${v * 100}%`, background: colours[i] }} />
          ))}
        </div>
      )}
    </div>
  )
}
