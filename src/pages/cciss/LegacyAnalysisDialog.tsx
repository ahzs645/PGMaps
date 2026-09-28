import { useEffect, useMemo, useState } from 'react'
import { DialogShell } from '@/components/ui/dialog-shell'
import { InlineAlert, SidebarSection } from '@/components/ui/map-panels'
import { Button } from '@/components/ui/button'
import { TabBar } from '@/components/ui/tab-bar'
import { downloadText } from '@/lib/download'
import {
  ratingLabel,
  regionalOutlook,
  type Edatope,
  type LegacyManifest,
  type LegacyReference,
  type LegacyRegion,
} from './legacyAnalysis'
import { loadLegacyManifest, loadLegacyReference, loadLegacyRegion, loadLegacyPoint } from './legacyData'
import {
  compareLegacyPoint,
  memberKey,
  LEGACY_LIMITATION,
  legacyComparisonHtml,
  type LegacyPointSample,
  type LegacyComparisonReport,
} from './legacyComparison'
import { Silvics } from './Silvics'

const selectClass = 'mt-1 w-full rounded-md border border-border bg-background p-2 text-sm'
const percent = (n: number | null) => (n == null ? '—' : `${(n * 100).toFixed(1)}%`)
const periodLabel = (p: string) => p.replace('_', '–')
type Page = 'species' | 'models' | 'bgc' | 'region' | 'silvics' | 'report'
interface PointData {
  manifest: LegacyManifest
  reference: LegacyReference
  samples: LegacyPointSample[]
  species: string[]
}

export function LegacyAnalysisDialog({
  point,
  onPointChange,
  onClose,
}: {
  point: [number, number]
  onPointChange: (p: [number, number]) => void
  onClose: () => void
}) {
  return (
    <DialogShell
      title="Legacy CCISS analysis"
      subtitle="Location → species comparison → report · SSP2-4.5"
      onClose={onClose}
      size="xl"
    >
      <div className="space-y-4">
        <InlineAlert tone="warning">{LEGACY_LIMITATION}</InlineAlert>
        <Location key={`location:${point.join(',')}`} point={point} onChange={onPointChange} />
        <Comparison key={`comparison:${point.join(',')}`} point={point} />
      </div>
    </DialogShell>
  )
}
function Location({ point, onChange }: { point: [number, number]; onChange: (p: [number, number]) => void }) {
  const [longitude, setLongitude] = useState(String(point[0]))
  const [latitude, setLatitude] = useState(String(point[1]))
  const [error, setError] = useState('')
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        const lng = Number(longitude),
          lat = Number(latitude)
        if (
          !longitude.trim() ||
          !latitude.trim() ||
          !Number.isFinite(lng) ||
          !Number.isFinite(lat) ||
          Math.abs(lng) > 180 ||
          Math.abs(lat) > 90
        ) {
          setError('Enter valid longitude (−180 to 180) and latitude (−90 to 90).')
          return
        }
        setError('')
        onChange([lng, lat])
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          Longitude
          <input
            className={selectClass}
            value={longitude}
            onChange={(e) => setLongitude(e.target.value)}
            inputMode="decimal"
          />
        </label>
        <label className="text-sm">
          Latitude
          <input
            className={selectClass}
            value={latitude}
            onChange={(e) => setLatitude(e.target.value)}
            inputMode="decimal"
          />
        </label>
        <Button type="submit">Analyse location</Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Use these coordinates or close this window and click the map. The analysis uses numeric rasters; the displayed
        map layer does not change its inputs.
      </p>
      {error && <p role="alert">{error}</p>}
    </form>
  )
}
function Comparison({ point }: { point: [number, number] }) {
  const [data, setData] = useState<PointData | null>(null)
  const [progress, setProgress] = useState('Loading dataset…')
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [tab, setTab] = useState<Page>('species')
  const [edatope, setEdatope] = useState<Edatope>('C4')
  const [modelKey, setModelKey] = useState('')
  const [period, setPeriod] = useState('2061_2080')
  const [species, setSpecies] = useState('Pl')
  const [region, setRegion] = useState('BC')
  const [regional, setRegional] = useState<{ id: string; value: LegacyRegion } | null>(null)
  const [regionError, setRegionError] = useState('')
  useEffect(() => {
    let active = true
    loadLegacyManifest()
      .then(async (manifest) => {
        const [reference, bc, samples] = await Promise.all([
          loadLegacyReference(manifest.reference.file),
          loadLegacyRegion('BC.json.gz'),
          loadLegacyPoint(manifest, point, (done) => {
            if (active) setProgress(`Reading numeric rasters: ${done} / ${manifest.rasters.length}`)
          }),
        ])
        if (active) setData({ manifest, reference, samples, species: bc.tables['PredSum.spp.C4'].columns })
      })
      .catch((e: unknown) => {
        if (active) setError(String(e))
      })
    return () => {
      active = false
    }
  }, [point, attempt])
  useEffect(() => {
    let active = true
    if (!data) return
    const r = data.manifest.regions.find((r) => r.id === region)
    Promise.resolve()
      .then(() => {
        if (!r) throw new Error('Region is absent from this dataset.')
        return loadLegacyRegion(r.file)
      })
      .then((value) => {
        if (active) setRegional({ id: region, value })
      })
      .catch((e: unknown) => {
        if (active) setRegionError(String(e))
      })
    return () => {
      active = false
    }
  }, [data, region, attempt])
  const comparison = useMemo(
    () => (data ? compareLegacyPoint(data.reference, data.samples, edatope, data.species) : null),
    [data, edatope],
  )
  if (error)
    return (
      <div>
        <p role="alert">Could not load analysis: {error}</p>
        <Button
          onClick={() => {
            setError('')
            setRegionError('')
            setAttempt((n) => n + 1)
          }}
        >
          Retry analysis
        </Button>
      </div>
    )
  if (!data || !comparison) return <p role="status">{progress}</p>
  const member = comparison.members.find((m) => m.key === modelKey) ?? comparison.members[0]
  const selectedSpecies = comparison.species.find((s) => s.species === species) ?? comparison.species[0]
  const selectedPeriod = comparison.periods.includes(period) ? period : comparison.periods[0]
  const future = comparison.projections.find((r) => memberKey(r) === member.key && r.period === selectedPeriod)
  const trends =
    regional?.id === region
      ? regionalOutlook(regional.value, edatope, selectedSpecies.species, member.model).filter(
          (r) => r.RUN === member.run && r.SSP === member.scenario,
        )
      : []
  const report: LegacyComparisonReport = {
    schema: 'cciss-legacy-comparison-v1',
    method: LEGACY_LIMITATION,
    source: 'Province of British Columbia · CCISS_ShinyApp/Development/OLD/spatial_app',
    dataset: data.manifest.schema,
    provenance: data.manifest,
    longitude: point[0],
    latitude: point[1],
    edatope,
    comparison,
    regional: { region, species: selectedSpecies.species, model: member.model, trends },
  }
  const readyToExport = regional?.id === region && !regionError
  const modelProjections = selectedSpecies.projections.filter((r) => r.member === member.key)
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="text-sm">
          Site condition
          <select
            aria-label="Analysis site condition"
            className={selectClass}
            value={edatope}
            onChange={(e) => setEdatope(e.target.value as Edatope)}
          >
            <option value="B2">B2 · Poor / subxeric</option>
            <option value="C4">C4 · Medium / mesic</option>
            <option value="D6">D6 · Rich / hygric</option>
          </select>
        </label>
        <label className="text-sm">
          Climate model
          <select className={selectClass} value={member.key} onChange={(e) => setModelKey(e.target.value)}>
            {comparison.members.map((m) => (
              <option key={m.key} value={m.key}>
                {m.model} · {m.run}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Projection period
          <select className={selectClass} value={selectedPeriod} onChange={(e) => setPeriod(e.target.value)}>
            {comparison.periods.map((p) => (
              <option key={p} value={p}>
                {periodLabel(p)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Comparison species
          <select className={selectClass} value={selectedSpecies.species} onChange={(e) => setSpecies(e.target.value)}>
            {comparison.species.map((s) => (
              <option key={s.species} value={s.species}>
                {s.species} · {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-sm">
        {point[1].toFixed(5)}, {point[0].toFixed(5)} · Reference BGC:{' '}
        <strong>{comparison.baseline?.bgc ?? 'No data'}</strong> → Predicted BGC:{' '}
        <strong>{future?.bgc ?? 'No data'}</strong> ({periodLabel(selectedPeriod)})
      </p>
      {(!comparison.baseline?.bgc || !future?.bgc) && (
        <InlineAlert tone="warning">
          This location has no valid BGC in one or both selected legacy rasters. Choose a land location inside BC.
          Missing results remain unknown; named-region summaries are still available.
        </InlineAlert>
      )}
      <TabBar
        label="Legacy analysis pages"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'species', label: 'Species' },
          { value: 'models', label: 'Model comparison' },
          { value: 'bgc', label: 'BGC changes' },
          { value: 'region', label: 'Regional outlook' },
          { value: 'silvics', label: 'Silvics' },
          { value: 'report', label: 'Report' },
        ]}
      />
      {tab === 'species' && (
        <SidebarSection title="Species suitability at the selected map point">
          <p className="mb-3 text-xs text-muted-foreground">
            {member.model} · {member.run}. All five model periods are shown; the outlined column is the selected period.
            Observed 2001–2020 is a separate historical raster. No rating means no lookup result, not unsuitable.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Legacy species suitability</caption>
              <thead>
                <tr>
                  <th>Species</th>
                  <th>1961–1990</th>
                  <th>2001–2020 observed</th>
                  {comparison.periods.map((p) => (
                    <th key={p} className={p === selectedPeriod ? 'bg-secondary' : ''}>
                      {periodLabel(p)} model
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {comparison.species.map((s) => (
                  <tr key={s.species} className="border-t">
                    <td className="py-2">
                      {s.species} · {s.name}
                    </td>
                    <td>
                      <Rating value={s.baseline} />
                    </td>
                    <td>
                      <Rating value={s.observed} />
                    </td>
                    {comparison.periods.map((p) => (
                      <td key={p} className={p === selectedPeriod ? 'ring-1 ring-inset ring-border' : ''}>
                        <Rating
                          value={s.projections.find((r) => r.member === member.key && r.period === p)?.rating ?? null}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SidebarSection>
      )}
      {tab === 'models' && (
        <SidebarSection title={`Model comparison · ${selectedSpecies.species}`}>
          <p className="mb-3 text-sm">
            {selectedSpecies.name} · baseline: {ratingLabel(selectedSpecies.baseline)}. Each row is one available model
            run. These six runs are not the full current ensemble, and their counts are not probabilities.
          </p>
          <Matrix
            caption="Species by model and period"
            periods={comparison.periods}
            rows={comparison.members.map((m) => ({
              label: `${m.model} · ${m.run}`,
              values: comparison.periods.map((p) => (
                <Rating
                  key={p}
                  value={selectedSpecies.projections.find((r) => r.member === m.key && r.period === p)?.rating ?? null}
                />
              )),
            }))}
          />
          <p className="mt-3 text-xs text-muted-foreground">
            The selected model's period ratings:{' '}
            {modelProjections.map((r) => `${periodLabel(r.period)} ${ratingLabel(r.rating)}`).join(' → ')}.
          </p>
        </SidebarSection>
      )}
      {tab === 'bgc' && (
        <SidebarSection title="BGC and site-series changes">
          <p className="mb-3 text-sm">
            Baseline: {comparison.baseline?.bgc ?? 'No data'} · Observed 2001–2020:{' '}
            {comparison.observed?.bgc ?? 'No data'}. Cells show the predicted BGC and its {edatope} site-series lookup.
          </p>
          <Matrix
            caption="BGC by model and period"
            periods={comparison.periods}
            rows={comparison.members.map((m) => ({
              label: `${m.model} · ${m.run}`,
              values: comparison.periods.map((p) => {
                const bgc = comparison.projections.find((r) => memberKey(r) === m.key && r.period === p)?.bgc
                return (
                  <span key={p}>
                    {bgc ?? 'No data'}
                    <small className="block text-muted-foreground">
                      {bgc ? (data.reference.sites[bgc]?.[edatope] ?? 'Site series not mapped') : '—'}
                    </small>
                  </span>
                )
              }),
            }))}
          />
        </SidebarSection>
      )}
      {tab === 'region' && (
        <SidebarSection title={`Regional outlook · ${region}`}>
          <label className="block max-w-sm text-sm">
            Regional summary
            <select
              className={selectClass}
              value={region}
              onChange={(e) => {
                setRegionError('')
                setRegion(e.target.value)
              }}
            >
              {data.manifest.regions.map((r) => (
                <option key={r.id}>{r.id}</option>
              ))}
            </select>
          </label>
          <p className="my-3 text-sm">
            {selectedSpecies.species} · {member.model} · {member.run}. This named area is chosen independently of the
            map point.
          </p>
          <p className="my-2 text-xs text-muted-foreground">
            Persistence = retained suitable grid-cell count / 1961–1990 count. Expansion = newly suitable count / that
            same baseline. These are regional ratios, not point probabilities or hectares. A zero baseline gives no
            ratio.
          </p>
          {regionError ? (
            <p role="alert">{regionError}</p>
          ) : regional?.id !== region ? (
            <p role="status">Loading regional summary…</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">Regional persistence and expansion</caption>
                  <thead>
                    <tr>
                      <th>Period / run</th>
                      <th>Persistence</th>
                      <th>Expansion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trends.map((r) => (
                      <tr className="border-t" key={`${r.PERIOD}|${r.RUN}`}>
                        <td className="py-2">
                          {periodLabel(r.PERIOD)} · {r.RUN}
                        </td>
                        <td>{percent(r.persistence)}</td>
                        <td>{percent(r.expansion)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!trends.length && <p>No regional rows for this selection.</p>}
            </>
          )}
        </SidebarSection>
      )}
      {tab === 'silvics' && <Silvics species={selectedSpecies.species} />}
      {tab === 'report' && (
        <SidebarSection title="Export this analysis">
          <p className="text-sm">
            Both exports contain this location and site condition, baseline and observed BGCs, all{' '}
            {comparison.members.length} available model runs and {comparison.periods.length} periods for{' '}
            {comparison.species.length} species, plus the selected named-region outlook. The report includes the source
            and provisional-codebook limitation.
          </p>
          <p className="mt-2 text-sm">
            Regional selection: {region} · {selectedSpecies.species} · {member.model}. Choose Regional outlook to change
            it. Silvics reference tables are viewed separately and are not included in the calculation export.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            No Shiny CSV import or Shiny server is required. Open the downloaded HTML and use the browser's Print / Save
            as PDF command for a printable copy.
          </p>
        </SidebarSection>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={!readyToExport}
          onClick={() =>
            downloadText(JSON.stringify(report, null, 2), 'cciss-legacy-analysis.json', 'application/json')
          }
        >
          Download analysis JSON
        </Button>
        <Button
          variant="outline"
          disabled={!readyToExport}
          onClick={() => downloadText(legacyComparisonHtml(report), 'cciss-legacy-comparison.html', 'text/html')}
        >
          Download printable report
        </Button>
      </div>
      {regionError && tab !== 'region' && (
        <p role="alert">
          Regional data unavailable: {regionError}.{' '}
          <button
            className="underline"
            onClick={() => {
              setError('')
              setRegionError('')
              setAttempt((n) => n + 1)
            }}
          >
            Retry
          </button>
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Source: Province of British Columbia, CCISS_ShinyApp / Development/OLD/spatial_app. Loaded numeric rasters are
        reused during this page session.
      </p>
    </div>
  )
}
function Rating({ value }: { value: number | null }) {
  const colours: Record<number, string> = { 1: '#006400', 2: '#1e90ff', 3: '#eec900', 4: '#d4d4d4' }
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap px-1 py-1">
      <span
        aria-hidden="true"
        className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
        style={{
          background: value == null ? 'transparent' : colours[value],
          border: value == null ? '1px dashed currentColor' : undefined,
        }}
      />
      {ratingLabel(value)}
    </span>
  )
}
function Matrix({
  caption,
  periods,
  rows,
}: {
  caption: string
  periods: string[]
  rows: { label: string; values: React.ReactNode[] }[]
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th>Model / run</th>
            {periods.map((p) => (
              <th key={p}>{periodLabel(p)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr className="border-t" key={r.label}>
              <td className="py-3">{r.label}</td>
              {r.values.map((v, i) => (
                <td key={periods[i]}>{v}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
