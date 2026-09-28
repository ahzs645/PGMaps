import { Silvics } from './Silvics'
import { useEffect, useRef, useState } from 'react'
import { DialogShell } from '@/components/ui/dialog-shell'
import { InlineAlert, SidebarSection } from '@/components/ui/map-panels'
import { Button } from '@/components/ui/button'
import { TabBar } from '@/components/ui/tab-bar'
import { fetchGzipText } from '@/lib/fetchJson'
import { downloadText } from '@/lib/download'
import { ratingLabel } from './legacyAnalysis'
import {
  DEFAULT_ESTABLISHMENT,
  DEFAULT_MATURATION,
  ESTABLISHMENT_PERIODS,
  MATURATION_PERIODS,
  parseShinyReport,
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

export function ShinyReportDialog({ onClose }: { onClose: () => void }) {
  const [report, setReport] = useState<ShinyReport | null>(null)
  const [source, setSource] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [place, setPlace] = useState('')
  const [species, setSpecies] = useState('')
  const [tab, setTab] = useState<'report' | 'silvics' | 'inputs'>('report')
  const [est, setEst] = useState(DEFAULT_ESTABLISHMENT)
  const [mat, setMat] = useState(DEFAULT_MATURATION)
  const request = useRef(0)
  useEffect(
    () => () => {
      request.current++
    },
    [],
  )
  async function load(read: () => Promise<string>, name: string) {
    const id = ++request.current
    setLoading(true)
    setError('')
    try {
      const parsed = parseShinyReport(await read())
      if (id !== request.current) return
      setReport(parsed)
      setEst(DEFAULT_ESTABLISHMENT)
      setMat(DEFAULT_MATURATION)
      setSource(name)
      setPlace(JSON.stringify([parsed.rows[0].site, parsed.rows[0].series]))
      setSpecies(parsed.rows[0].species)
    } catch (e) {
      if (id === request.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (id === request.current) setLoading(false)
    }
  }
  const places = [...new Set(report?.rows.map((r) => JSON.stringify([r.site, r.series])) ?? [])]
  const rows = report?.rows.filter((r) => JSON.stringify([r.site, r.series]) === place) ?? []
  const selected = rows.find((r) => r.species === species) ?? rows[0]
  let weightError = ''
  const summaries = rows.map((r) => {
    try {
      return summarizeVotes(r, est, mat)
    } catch (e) {
      weightError = String(e)
      return null
    }
  })
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
            Import Shiny CSV
            <input
              className="mt-1 block max-w-xs text-sm"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) {
                  if (f.size > 5_000_000) setError('Please select a CSV smaller than 5 MB.')
                  else void load(() => f.text(), f.name)
                }
                e.target.value = ''
              }}
            />
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          In Shiny: generate the site results → Export → CSV, then unzip and choose cciss_export.csv. Files stay in this
          browser. RDS and ZIP imports are not supported here.
        </p>
        {loading && <p role="status">Loading report…</p>}
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        <TabBar
          label="CCISS report pages"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'report', label: 'Suitability report' },
            { value: 'silvics', label: 'Silvics' },
            { value: 'inputs', label: 'Calculation inputs' },
          ]}
        />
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
        {report && tab !== 'inputs' && (
          <>
            <p className="text-sm font-medium">{source}</p>
            {report.format === 'historical-raw' && (
              <InlineAlert tone="warning">
                This is an older published example. Its period IDs are retained exactly; current-period summary
                calculations are unavailable. It is not a result for the selected map point.
              </InlineAlert>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <label>
                Site and site series
                <select className={selectClass} value={place} onChange={(e) => setPlace(e.target.value)}>
                  {places.map((p) => (
                    <option key={p} value={p}>
                      {(JSON.parse(p) as string[]).join(' · ')}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Species detail
                <select
                  className={selectClass}
                  value={selected?.species ?? ''}
                  onChange={(e) => setSpecies(e.target.value)}
                >
                  {rows.map((r) => (
                    <option key={r.species}>{r.species}</option>
                  ))}
                </select>
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
                {selected && report.format === 'current-export' && selected.original.EstabFeas && (
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
                {report.format === 'current-export' && (
                  <details>
                    <summary className="cursor-pointer text-sm font-medium">Recalculate with period weights</summary>
                    <p className="my-2 text-xs text-muted-foreground">
                      Defaults come from the downloaded Shiny source. Each group is normalized to sum to one. Summaries
                      require complete votes for all six required period IDs. Novelty-scaled exports can be viewed but
                      are not reweighted here.
                    </p>
                    <Weights label="Establishment" periods={ESTABLISHMENT_PERIODS} values={est} onChange={setEst} />
                    <Weights label="Maturation" periods={MATURATION_PERIODS} values={mat} onChange={setMat} />
                  </details>
                )}
                {weightError && <p role="alert">{weightError}</p>}
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <caption className="mb-2 text-left font-semibold">Species summary</caption>
                    <thead>
                      <tr>
                        <th>Species</th>
                        <th>Baseline</th>
                        <th>Establishment¹</th>
                        <th>Maturation¹</th>
                        <th>Stable / improving¹</th>
                        <th>Declining / unsuitable¹</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={r.species} className="border-t">
                          <td className="py-2">{r.species}</td>
                          <td>{ratingLabel(r.current)}</td>
                          <td>{summaries[i] ? ratingLabel(summaries[i]!.establishment) : '—'}</td>
                          <td>{summaries[i] ? ratingLabel(summaries[i]!.maturation) : '—'}</td>
                          <td>{summaries[i] ? `${summaries[i]!.improve}%` : '—'}</td>
                          <td>{summaries[i] ? `${summaries[i]!.decline}%` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-muted-foreground">
                  ¹ Calculated in this browser from the imported votes. — means required periods or complete votes are
                  missing, or the export includes novelty-scaled votes. It does not mean unsuitable.
                </p>
                <Button onClick={downloadReport} disabled={!!weightError}>
                  Download printable HTML report
                </Button>
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
