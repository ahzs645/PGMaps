import { NumericRangeField } from '@/components/ui/numeric-range-field'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { MapSidebarShell, SidebarSection, KeyValueRows } from '@/components/ui/map-panels'
import { downloadText } from '@/lib/download'
import { useIsMobile } from '@/hooks/useIsMobile'
import type { AnalysisSummary } from '../types'
import type { ForestData } from '../forestry'
import type { Basemap } from '../basemaps'
import forestUrl from '../forestry.generated.json?url'
import { ComparisonMap } from '../comparisons/ComparisonMap'
import {
  fitVolumeModel,
  harvestScenario,
  parseVolumeReferences,
  predictVolume,
  volumeEligible,
  type VolumeModel,
} from './model'

const SOURCES = [
  ['NRCan · model development and application guide', 'https://publications.gc.ca/site/eng/9.843782/publication.html'],
  ['lidR · area-based forest modelling', 'https://r-lidar.github.io/lidRbook/modelling.html'],
  [
    'BC · LiDAR-enhanced forest inventories',
    'https://www2.gov.bc.ca/gov/content/industry/forestry/managing-our-forest-resources/forest-inventory/forest-cover-inventories/light-detection-and-ranging',
  ],
]
export function ForestVolumeWorkspace({
  summary,
  basemap,
  error: summaryError,
}: {
  summary: AnalysisSummary | null
  basemap: Basemap
  error: string
}) {
  const [data, setData] = useState<ForestData | null>(null),
    [loadError, setLoadError] = useState(''),
    [attempt, setAttempt] = useState(0)
  const [csv, setCsv] = useState(''),
    [referenceSource, setReferenceSource] = useState(''),
    [model, setModel] = useState<VolumeModel | null>(null),
    [fitError, setFitError] = useState(''),
    [selected, setSelected] = useState(new Set<string>()),
    [activeId, setActiveId] = useState(''),
    [reset, setReset] = useState(0),
    [merchantable, setMerchantable] = useState(100),
    [retention, setRetention] = useState(0),
    [recovery, setRecovery] = useState(100),
    [showPanel, setShowPanel] = useState<boolean | null>(null)
  const mobile = useIsMobile(),
    panel = showPanel ?? !mobile
  useEffect(() => {
    if (!summary) return
    let active = true
    const abort = new AbortController(),
      timer = setTimeout(() => abort.abort(), 30000)
    setLoadError('')
    setData(null)
    setModel(null)
    setSelected(new Set())
    fetch(forestUrl, { signal: abort.signal })
      .then((r) => {
        if (!r.ok) throw Error('Forest metrics unavailable')
        return r.json()
      })
      .then((next: ForestData) => {
        if (next.schema_version !== 1 || next.source_sha256 !== summary.source_sha256 || !next.plots.features.length)
          throw Error('Forest metric source mismatch')
        if (active) setData(next)
      })
      .catch((e) => {
        if (active) setLoadError(String(e))
      })
      .finally(() => clearTimeout(timer))
    return () => {
      active = false
      abort.abort()
      clearTimeout(timer)
    }
  }, [summary, attempt])
  const rows = useMemo(
    () => data?.plots.features.map((f) => ({ feature: f, prediction: predictVolume(model, f.properties) })) ?? [],
    [data, model],
  )
  const maximum = Math.max(1, ...rows.map((r) => r.prediction.volume_m3_ha ?? 0))
  const features = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: rows.map(({ feature, prediction }) => {
        const p = feature.properties,
          value = model ? prediction.volume_m3_ha : p.surface_p95_m,
          t = value === null ? null : Math.max(0, Math.min(1, value / (model ? maximum : 50)))
        const palette = ['#f0fdf4', '#bbf7d0', '#4ade80', '#16a34a', '#166534']
        return {
          ...feature,
          properties: {
            id: p.id,
            selected: selected.has(p.id),
            height_p95_m: p.surface_p95_m,
            canopy_percent: p.canopy_percent,
            volume_m3_ha: prediction.volume_m3_ha,
            volume_status: prediction.status,
            colour: t === null ? '#cbd5e1' : palette[Math.min(4, Math.floor(t * 5))],
          },
        }
      }),
    }),
    [rows, model, maximum, selected],
  )
  const eligible = useMemo(() => data?.plots.features.filter((f) => volumeEligible(f.properties)) ?? [], [data])
  const chosen = rows.filter((r) => selected.has(r.feature.properties.id)),
    scenario = harvestScenario(
      chosen.map((r) => r.prediction.volume_m3_ha),
      merchantable / 100,
      retention / 100,
      recovery / 100,
    )
  const active = rows.find((r) => r.feature.properties.id === activeId)
  const centre: [number, number] = summary
    ? [(summary.bounds_wgs84[0] + summary.bounds_wgs84[2]) / 2, (summary.bounds_wgs84[1] + summary.bounds_wgs84[3]) / 2]
    : [-122.81, 53.89]
  const toggle = (id: string) => {
    setActiveId(id)
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const fit = () => {
    if (!data) return
    setFitError('')
    try {
      if (!referenceSource.trim()) throw Error('Add the reference dataset and survey year.')
      setModel(fitVolumeModel(data, parseVolumeReferences(csv, data)))
      setSelected(new Set())
    } catch (e) {
      setModel(null)
      setFitError(String(e))
    }
  }
  const template = () => {
    const ranked = [...eligible].sort((a, b) => a.properties.surface_p95_m - b.properties.surface_p95_m)
    const candidates = Array.from(
      { length: Math.min(20, ranked.length) },
      (_, i) => ranked[Math.round((i * (ranked.length - 1)) / Math.max(1, Math.min(20, ranked.length) - 1))],
    )
    downloadText(
      'plot_id,volume_m3_ha\n' + candidates.map((f) => `${f.properties.id},`).join('\n') + '\n',
      'volume-reference-template.csv',
      'text/csv',
    )
  }
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label="Forest volume workspace">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b p-2">
        <h1 className="mr-auto text-sm font-semibold">Forest volume & harvest scenarios</h1>
        <Badge tone={model ? 'warning' : 'neutral'}>
          {model ? 'Experimental local estimate' : 'Calibration required'}
        </Badge>
        <Button size="sm" variant="outline" onClick={() => setShowPanel(!panel)}>
          {panel ? 'Hide' : 'Show'} volume inputs
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        <aside
          hidden={!panel}
          className={`${panel ? 'flex' : 'hidden'} h-[40dvh] min-h-0 shrink-0 flex-col overflow-hidden border-r md:h-full md:w-[340px]`}
        >
          <MapSidebarShell title="Estimate volume" subtitle="Gross stem m³/ha from matched ground-reference plots.">
            <SidebarSection title="1 · Prepare reference data">
              <p className="text-xs leading-5">
                The tile has 50 × 50 m height/cover plots, but no measured stem volumes. Supply gross stem volume per
                hectare for the same complete footprints and a compatible survey period. Canopy height alone is not
                timber volume.
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                <Button size="sm" variant="outline" disabled={!eligible.length} onClick={template}>
                  CSV template
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!data}
                  onClick={() =>
                    downloadText(
                      JSON.stringify(
                        {
                          type: 'FeatureCollection',
                          features: eligible.map((f) => ({
                            ...f,
                            properties: {
                              id: f.properties.id,
                              area_m2: 2500,
                              surface_p95_m: f.properties.surface_p95_m,
                              canopy_percent: f.properties.canopy_percent,
                            },
                          })),
                          metadata: {
                            source_sha256: data?.source_sha256,
                            scope: 'Field-reference footprints; no volume labels supplied',
                          },
                        },
                        null,
                        2,
                      ),
                      'volume-reference-footprints.geojson',
                      'application/geo+json',
                    )
                  }
                >
                  Plot footprints
                </Button>
              </div>
              <p className="mt-2 text-[10px] text-muted-foreground">
                Fill at least 10 template rows and remove unused rows. The 10–200 row limit is a software constraint,
                not an adequate survey-design guarantee.
              </p>
            </SidebarSection>
            <SidebarSection title="2 · Fit a local model">
              <label className="block text-xs">
                Reference dataset, year & volume definition
                <input
                  aria-label="Volume reference source"
                  className="mt-1 w-full rounded border bg-background p-2"
                  value={referenceSource}
                  onChange={(e) => {
                    setReferenceSource(e.target.value)
                    setModel(null)
                  }}
                  placeholder="Field inventory · year · bark/DBH conventions"
                />
              </label>
              <label className="mt-2 block text-xs">
                Reference CSV
                <input
                  aria-label="Upload volume reference CSV"
                  type="file"
                  accept=".csv,text/csv"
                  className="mt-1 block w-full text-xs"
                  onChange={async (e) => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    if (file.size > 2_000_000) {
                      setFitError('Reference CSV exceeds 2 MB.')
                      return
                    }
                    setModel(null)
                    setCsv(await file.text())
                    setFitError('')
                  }}
                />
              </label>
              <textarea
                aria-label="Volume reference CSV"
                className="mt-2 w-full rounded border bg-background p-2 font-mono text-[10px]"
                rows={5}
                value={csv}
                onChange={(e) => {
                  setCsv(e.target.value)
                  setModel(null)
                }}
                placeholder={'plot_id,volume_m3_ha\nforest-50-1-1,'}
              />
              <Button size="sm" className="mt-2" disabled={!data || !csv} onClick={fit}>
                Fit volume model
              </Button>
              {fitError && (
                <p className="mt-2 text-xs" role="alert">
                  {fitError}
                </p>
              )}
              <p className="mt-2 text-[10px] text-muted-foreground">
                CSV stays in this browser. OLS uses CHM surface p95 and canopy fraction. Predictions outside the
                reference predictor hull are withheld.
              </p>
            </SidebarSection>
            {model && (
              <SidebarSection title="Model diagnostics">
                <KeyValueRows
                  size="sm"
                  rows={[
                    { label: 'Reference plots', value: String(model.diagnostics.n) },
                    { label: 'Leave-one-out RMSE', value: model.diagnostics.loo_rmse_m3_ha.toFixed(1) + ' m³/ha' },
                    { label: 'Leave-one-out bias', value: model.diagnostics.loo_bias_m3_ha.toFixed(1) + ' m³/ha' },
                    { label: 'Leave-one-out R²', value: model.diagnostics.loo_r2?.toFixed(3) ?? 'Unavailable' },
                    {
                      label: 'Supported predictions',
                      value: String(rows.filter((r) => r.prediction.volume_m3_ha !== null).length),
                    },
                  ]}
                />
                <p className="mt-2 text-[10px] text-muted-foreground">
                  Leave-one-out diagnostics are not spatially independent field validation or confidence intervals.
                  Errors may be larger outside the surveyed stand types.
                </p>
                <details className="mt-2 text-xs">
                  <summary>Model and reference values</summary>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-[10px]">
                    {JSON.stringify(
                      {
                        method: model.method,
                        coefficients: model.coefficients,
                        referenceSource,
                        diagnostics: model.diagnostics,
                      },
                      null,
                      2,
                    )}
                  </pre>
                </details>
              </SidebarSection>
            )}
            <SidebarSection title="3 · Select a planning area">
              <p className="text-xs leading-5">
                Click mapped plots to add/remove them. Only fully supported 0.25 ha plots with in-domain volume
                predictions contribute to totals.
              </p>
              <div className="mt-2 flex gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!model}
                  onClick={() =>
                    setSelected(
                      new Set(
                        rows.filter((r) => r.prediction.volume_m3_ha !== null).map((r) => r.feature.properties.id),
                      ),
                    )
                  }
                >
                  Select supported plots
                </Button>
                <Button size="sm" variant="outline" onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
              </div>
              {active && (
                <p className="mt-2 text-xs">
                  {active.feature.properties.id} · p95 {active.feature.properties.surface_p95_m.toFixed(1)} m · cover{' '}
                  {active.feature.properties.canopy_percent.toFixed(0)}% ·{' '}
                  {active.prediction.volume_m3_ha === null
                    ? active.prediction.status
                    : active.prediction.volume_m3_ha.toFixed(1) + ' m³/ha'}
                </p>
              )}
            </SidebarSection>
            <SidebarSection title="4 · Harvest scenario">
              {[
                [merchantable, setMerchantable, 'Merchantable share'],
                [retention, setRetention, 'Volume retained'],
                [recovery, setRecovery, 'Extraction recovery'],
              ].map(([value, set, label]) => (
                <NumericRangeField
                  key={String(label)}
                  label={String(label)}
                  layout="inline"
                  valueSeparator=" · "
                  display={`${Number(value)}%`}
                  className="mt-2 space-y-0 text-xs"
                  inputClassName="h-auto w-full"
                  aria-label={`Volume ${String(label).toLowerCase()}`}
                  min={0}
                  max={100}
                  step={5}
                  value={Number(value)}
                  onChange={set as (value: number) => void}
                />
              ))}
              <KeyValueRows
                size="sm"
                rows={[
                  { label: 'Selected supported area', value: scenario.area_ha.toFixed(2) + ' ha' },
                  { label: 'Selected unsupported plots', value: String(scenario.unsupported_plots) },
                  {
                    label: 'Modelled gross stem volume',
                    value: model && scenario.supported_plots ? scenario.gross_stem_m3.toFixed(1) + ' m³' : '—',
                  },
                  {
                    label: 'Scenario delivered volume',
                    value: model && scenario.supported_plots ? scenario.scenario_delivered_m3.toFixed(1) + ' m³' : '—',
                  },
                ]}
              />
              <p className="mt-2 text-[10px] text-muted-foreground">
                Delivered scenario = gross × merchantable share × (1 − volume retained) × recovery. These are user
                assumptions, not estimated log grades, defects, access, or a timber-cruise result.
              </p>
              <Button
                className="mt-2"
                size="sm"
                variant="outline"
                disabled={!model}
                onClick={() =>
                  downloadText(
                    JSON.stringify(
                      {
                        type: 'FeatureCollection',
                        features: features.features.filter((f) => selected.has(f.properties.id)),
                        metadata: {
                          source_sha256: data?.source_sha256,
                          referenceSource,
                          model,
                          scenario,
                          assumptions: {
                            merchantable_share: merchantable / 100,
                            retention_fraction: retention / 100,
                            recovery_fraction: recovery / 100,
                          },
                          status: 'Experimental calibration and harvest scenario; not a validated timber cruise',
                        },
                      },
                      null,
                      2,
                    ),
                    'forest-volume-scenario.geojson',
                    'application/geo+json',
                  )
                }
              >
                Export selected volume scenario
              </Button>
            </SidebarSection>
            <SidebarSection title="Research & methods">
              <div className="space-y-2">
                {SOURCES.map(([title, url]) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer" className="block text-xs underline">
                    {title}
                  </a>
                ))}
              </div>
            </SidebarSection>
          </MapSidebarShell>
        </aside>
        <div className="relative min-h-[180px] flex-1 overflow-hidden">
          {!summary || !data ? (
            <div className="flex h-full items-center justify-center p-4 text-sm" role="status">
              {loadError || summaryError || 'Loading verified forest plot metrics…'}
              {loadError && (
                <Button size="sm" onClick={() => setAttempt((n) => n + 1)}>
                  Retry
                </Button>
              )}
            </div>
          ) : (
            <ComparisonMap
              label="Forest volume planning map"
              centre={centre}
              focusKey={`volume-${reset}`}
              zoom={15.5}
              view="top"
              basemap={basemap}
              features={features}
              onFeaturePick={toggle}
              overlayOpacity={0.65}
            />
          )}
          <div className="absolute bottom-8 left-3 right-12 rounded border bg-background/95 p-2 text-xs">
            <strong>
              {model
                ? `Experimental gross stem volume · 0–${maximum.toFixed(0)} m³/ha`
                : 'Height context only · CHM p95 0–50 m'}
            </strong>
            <p className="mt-1 text-[10px]">
              {model
                ? 'Light to dark green: increasing predicted volume. Grey: unsupported or outside calibration domain. Black outline: selected.'
                : 'No forest volume is inferred until matched reference data are supplied. Green shows canopy height context.'}
            </p>
            <Button size="sm" variant="ghost" onClick={() => setReset((n) => n + 1)}>
              Fit tile
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
