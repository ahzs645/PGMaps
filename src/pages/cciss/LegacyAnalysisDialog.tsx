import { NativeSelect } from '@/components/ui/form-field'
import { useEffect, useMemo, useState } from 'react'
import { DialogShell } from '@/components/ui/dialog-shell'
import { InlineAlert, SidebarSection } from '@/components/ui/map-panels'
import { Button } from '@/components/ui/button'
import { TabBar } from '@/components/ui/tab-bar'
import { downloadText } from '@/lib/download'
import {
  ratingLabel,
  regionalOutlook,
  legacySiteConditions,
  legacySpecies,
  legacyConditionLabel,
  legacyScenarioLabel,
  preferredLegacyOption,
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
import type { ComparisonSnapshot } from './comparison'
import { legacyComparisonSnapshot } from './legacyComparisonAdapter'

const selectClass = 'mt-1 w-full rounded-md border border-border bg-background p-2 text-sm'
const percent = (n: number | null) => (n == null ? '—' : `${(n * 100).toFixed(1)}%`)
const periodLabel = (p: string) => p.replace('_', '–')
type Page = 'species' | 'models' | 'bgc' | 'region' | 'silvics' | 'report'
interface PointData {
  manifest: LegacyManifest
  reference: LegacyReference
  samples: LegacyPointSample[]
  summary?: LegacyRegion
  pointKey: string
}

export function LegacyAnalysisDialog({
  point,
  onPointChange,
  onClose,
  onCaptureComparison,
  onOpenComparison,
  comparisonCount = 0,
}: {
  point: [number, number]
  onPointChange: (p: [number, number]) => void
  onClose: () => void
  onCaptureComparison?: (snapshot: ComparisonSnapshot) => void
  onOpenComparison?: () => void
  comparisonCount?: number
}) {
  return (
    <DialogShell
      title="Legacy CCISS analysis"
      subtitle="Location → species comparison → report"
      onClose={onClose}
      size="xl"
    >
      <div className="space-y-4">
        <InlineAlert tone="warning">{LEGACY_LIMITATION}</InlineAlert>
        <Location key={`location:${point.join(',')}`} point={point} onChange={onPointChange} />
        <Comparison
          point={point}
          onCaptureComparison={onCaptureComparison}
          onOpenComparison={onOpenComparison}
          comparisonCount={comparisonCount}
        />
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
function Comparison({
  point,
  onCaptureComparison,
  onOpenComparison,
  comparisonCount,
}: {
  point: [number, number]
  onCaptureComparison?: (snapshot: ComparisonSnapshot) => void
  onOpenComparison?: () => void
  comparisonCount: number
}) {
  const pointKey = point.join(',')
  const [data, setData] = useState<PointData | null>(null)
  const [progress, setProgress] = useState<{ pointKey: string; message: string } | null>(null)
  const [error, setError] = useState<{ pointKey: string; message: string } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [tab, setTab] = useState<Page>('species')
  const [captureLabel, setCaptureLabel] = useState('')
  const [captureMessage, setCaptureMessage] = useState<{ message: string; error?: boolean } | null>(null)
  const [edatope, setEdatope] = useState<Edatope>('C4')
  const [scenario, setScenario] = useState('')
  const [modelKey, setModelKey] = useState('')
  const [period, setPeriod] = useState('2061_2080')
  const [species, setSpecies] = useState('Pl')
  const [region, setRegion] = useState('BC')
  const [regional, setRegional] = useState<{ id: string; value?: LegacyRegion; error?: string } | null>(null)
  useEffect(() => {
    let active = true
    loadLegacyManifest()
      .then(async (manifest) => {
        const defaultRegion = manifest.regions.find((r) => r.id === 'BC') ?? manifest.regions[0]
        const [reference, summary, samples] = await Promise.all([
          loadLegacyReference(manifest.reference.file),
          defaultRegion ? loadLegacyRegion(defaultRegion.file) : Promise.resolve(undefined),
          loadLegacyPoint(manifest, point, (done) => {
            if (active)
              setProgress({ pointKey, message: `Reading numeric rasters: ${done} / ${manifest.rasters.length}` })
          }),
        ])
        if (active) {
          setData({ manifest, reference, samples, summary, pointKey })
          setError(null)
        }
      })
      .catch((e: unknown) => {
        if (active) setError({ pointKey, message: String(e) })
      })
    return () => {
      active = false
    }
  }, [point, pointKey, attempt])
  const selectedRegion =
    data?.manifest.regions.find((r) => r.id === region) ??
    data?.manifest.regions.find((r) => r.id === 'BC') ??
    data?.manifest.regions[0]
  const regionId = selectedRegion?.id ?? ''
  useEffect(() => {
    let active = true
    if (!selectedRegion) return
    loadLegacyRegion(selectedRegion.file)
      .then((value) => {
        if (active) setRegional({ id: selectedRegion.id, value })
      })
      .catch((e: unknown) => {
        if (active) setRegional({ id: selectedRegion.id, error: String(e) })
      })
    return () => {
      active = false
    }
  }, [selectedRegion, attempt])
  const siteConditions = useMemo(() => (data ? legacySiteConditions(data.reference, data.summary) : []), [data])
  const condition = preferredLegacyOption(siteConditions, edatope)
  const comparison = useMemo(
    () =>
      data?.pointKey === pointKey && condition
        ? compareLegacyPoint(
            data.reference,
            data.samples,
            condition,
            legacySpecies(data.reference, data.summary, condition),
          )
        : null,
    [data, pointKey, condition],
  )
  if (error?.pointKey === pointKey)
    return (
      <div>
        <p role="alert">Could not load analysis: {error.message}</p>
        <Button
          onClick={() => {
            setError(null)
            setAttempt((n) => n + 1)
          }}
        >
          Retry analysis
        </Button>
      </div>
    )
  if (!data || !comparison)
    return <p role="status">{progress?.pointKey === pointKey ? progress.message : 'Loading dataset…'}</p>
  if (!comparison.members.length || !comparison.species.length || !siteConditions.length)
    return (
      <InlineAlert tone="warning">
        This dataset has no compatible model projections, site conditions or species to compare.
      </InlineAlert>
    )
  const scenarios = [...new Set(comparison.members.map((m) => m.scenario))]
  const selectedScenario = preferredLegacyOption(scenarios, scenario)
  const scenarioMembers = comparison.members.filter((m) => m.scenario === selectedScenario)
  // A model/run remains selected across scenario changes when the dataset contains that exact member.
  const requestedMember = comparison.members.find((m) => m.key === modelKey)
  const member =
    scenarioMembers.find((m) => m.key === modelKey) ??
    scenarioMembers.find((m) => m.model === requestedMember?.model && m.run === requestedMember?.run) ??
    scenarioMembers[0]
  const memberPeriods = comparison.projections
    .filter((r) => memberKey(r) === member.key)
    .map((r) => r.period)
    .sort()
  const selectedPeriod = preferredLegacyOption(memberPeriods, period)
  const selectedSpecies = comparison.species.find((s) => s.species === species) ?? comparison.species[0]
  const future = comparison.projections.find((r) => memberKey(r) === member.key && r.period === selectedPeriod)
  const regionError = regional?.id === regionId ? (regional.error ?? '') : ''
  const trends =
    regional?.id === regionId && regional.value
      ? regionalOutlook(regional.value, condition, selectedSpecies.species, member.model, {
          run: member.run,
          scenario: member.scenario,
          baselinePeriod: comparison.baseline?.period,
        })
      : []
  const report: LegacyComparisonReport = {
    schema: 'cciss-legacy-comparison-v1',
    method: LEGACY_LIMITATION,
    source: 'Province of British Columbia · CCISS_ShinyApp/Development/OLD/spatial_app',
    dataset: data.manifest.schema,
    provenance: data.manifest,
    longitude: point[0],
    latitude: point[1],
    edatope: condition,
    comparison,
    regional: {
      region: regionId || 'No regional summary',
      species: selectedSpecies.species,
      model: member.model,
      scenario: member.scenario,
      run: member.run,
      trends,
    },
  }
  const readyToExport = !selectedRegion || (regional?.id === regionId && Boolean(regional.value) && !regionError)
  const modelProjections = selectedSpecies.projections.filter((r) => r.member === member.key)
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <label className="text-sm">
          Site condition
          <NativeSelect
            aria-label="Analysis site condition"
            className={selectClass}
            value={condition}
            onChange={(e) => setEdatope(e.target.value as Edatope)}
          >
            {siteConditions.map((value) => (
              <option key={value} value={value}>
                {legacyConditionLabel(value)}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="text-sm">
          Emissions scenario
          <NativeSelect className={selectClass} value={selectedScenario} onChange={(e) => setScenario(e.target.value)}>
            {scenarios.map((value) => (
              <option key={value} value={value}>
                {legacyScenarioLabel(value)}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="text-sm">
          Climate model
          <NativeSelect className={selectClass} value={member.key} onChange={(e) => setModelKey(e.target.value)}>
            {scenarioMembers.map((m) => (
              <option key={m.key} value={m.key}>
                {m.model} · {m.run}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="text-sm">
          Projection period
          <NativeSelect className={selectClass} value={selectedPeriod} onChange={(e) => setPeriod(e.target.value)}>
            {memberPeriods.map((p) => (
              <option key={p} value={p}>
                {periodLabel(p)}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="text-sm">
          Comparison species
          <NativeSelect
            className={selectClass}
            value={selectedSpecies.species}
            onChange={(e) => setSpecies(e.target.value)}
          >
            {comparison.species.map((s) => (
              <option key={s.species} value={s.species}>
                {s.species} · {s.name}
              </option>
            ))}
          </NativeSelect>
        </label>
      </div>
      <p className="text-sm">
        {point[1].toFixed(5)}, {point[0].toFixed(5)} · Reference BGC:{' '}
        <strong>{comparison.baseline?.bgc ?? 'No data'}</strong> → Predicted BGC:{' '}
        <strong>{future?.bgc ?? 'No data'}</strong> ({periodLabel(selectedPeriod)})
      </p>
      {onCaptureComparison && (
        <SidebarSection title="Compare assessments">
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-56 flex-1 text-sm">
              Comparison label
              <input
                className={selectClass}
                value={captureLabel}
                placeholder={`${point[1].toFixed(5)}, ${point[0].toFixed(5)} · ${member.model} · ${legacyScenarioLabel(member.scenario)} · ${member.run ?? 'No run ID'} · ${condition}`}
                maxLength={160}
                onChange={(event) => setCaptureLabel(event.target.value)}
              />
            </label>
            <Button
              disabled={!readyToExport}
              onClick={() => {
                try {
                  const snapshot = legacyComparisonSnapshot(report, {
                    member: member.key,
                    reference: data.reference,
                    label: captureLabel.trim() || undefined,
                  })
                  onCaptureComparison(snapshot)
                  setCaptureMessage({ message: `Saved for comparison: ${snapshot.label}.` })
                } catch (error) {
                  setCaptureMessage({ message: error instanceof Error ? error.message : String(error), error: true })
                }
              }}
            >
              Save for comparison
            </Button>
            {onOpenComparison && (
              <Button variant="outline" onClick={onOpenComparison} disabled={comparisonCount === 0}>
                Open comparisons ({comparisonCount})
              </Button>
            )}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Saves this location, site condition and actual model run across all available species and periods. Saved
            results stay fixed when you change the controls. Regional ratios retain their separate named-area scope.
          </p>
          {captureMessage && (
            <p className="mt-2 text-sm" role={captureMessage.error ? 'alert' : 'status'}>
              {captureMessage.message}
            </p>
          )}
        </SidebarSection>
      )}
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
            {member.model} · {member.run} · {legacyScenarioLabel(member.scenario)}. Available model periods are shown;
            the outlined column is the selected period. Observed values come from a separate historical raster. No
            rating means no lookup result, not unsuitable.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Legacy species suitability</caption>
              <thead>
                <tr>
                  <th>Species</th>
                  <th>{comparison.baseline ? periodLabel(comparison.baseline.period) : 'Baseline'}</th>
                  <th>{comparison.observed ? `${periodLabel(comparison.observed.period)} observed` : 'Observed'}</th>
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
            run. The available runs and scenarios are listed separately; their counts are not ensemble probabilities.
          </p>
          <Matrix
            caption="Species by model and period"
            periods={comparison.periods}
            rows={comparison.members.map((m) => ({
              label: `${m.model} · ${m.run} · ${legacyScenarioLabel(m.scenario)}`,
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
            Baseline: {comparison.baseline?.bgc ?? 'No data'} · Observed{' '}
            {comparison.observed ? periodLabel(comparison.observed.period) : 'historical'}:{' '}
            {comparison.observed?.bgc ?? 'No data'}. Cells show the predicted BGC and its {condition} site-series
            lookup.
          </p>
          <Matrix
            caption="BGC by model and period"
            periods={comparison.periods}
            rows={comparison.members.map((m) => ({
              label: `${m.model} · ${m.run} · ${legacyScenarioLabel(m.scenario)}`,
              values: comparison.periods.map((p) => {
                const bgc = comparison.projections.find((r) => memberKey(r) === m.key && r.period === p)?.bgc
                return (
                  <span key={p}>
                    {bgc ?? 'No data'}
                    <small className="block text-muted-foreground">
                      {bgc ? (data.reference.sites[bgc]?.[condition] ?? 'Site series not mapped') : '—'}
                    </small>
                  </span>
                )
              }),
            }))}
          />
        </SidebarSection>
      )}
      {tab === 'region' && (
        <SidebarSection title={`Regional outlook · ${regionId || 'No region'}`}>
          <label className="block max-w-sm text-sm">
            Regional summary
            <NativeSelect
              className={selectClass}
              value={regionId}
              onChange={(e) => {
                setRegion(e.target.value)
              }}
            >
              {data.manifest.regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label ?? r.id}
                </option>
              ))}
            </NativeSelect>
          </label>
          <p className="my-3 text-sm">
            {selectedSpecies.species} · {member.model} · {member.run} · {legacyScenarioLabel(member.scenario)}. This
            named area is chosen independently of the map point.
          </p>
          <p className="my-2 text-xs text-muted-foreground">
            Persistence = retained suitable grid-cell count /{' '}
            {comparison.baseline ? periodLabel(comparison.baseline.period) : 'historical'} count. Expansion = newly
            suitable count / that same baseline. These are regional ratios, not point probabilities or hectares. A zero
            baseline gives no ratio.
          </p>
          {regionError ? (
            <p role="alert">{regionError}</p>
          ) : selectedRegion && regional?.id !== regionId ? (
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
            Regional selection: {regionId || 'None'} · {selectedSpecies.species} · {member.model} · {member.run} ·{' '}
            {legacyScenarioLabel(member.scenario)}. Choose Regional outlook to change it. Silvics reference tables are
            viewed separately and are not included in the calculation export.
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
              setError(null)
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
            <th>Model / run / scenario</th>
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
