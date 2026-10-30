import { NumericRangeField } from '@/components/ui/numeric-range-field'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { KeyValueRows, MapSidebarShell, SidebarSection } from '@/components/ui/map-panels'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { useIsMobile } from '@/hooks/useIsMobile'
import { downloadText } from '@/lib/download'
import { ComparisonMap } from '../comparisons/ComparisonMap'
import type { Basemap } from '../basemaps'
import {
  checkVolumeExample,
  recoveredExampleVolume,
  volumeExampleColour,
  VOLUME_STEPS,
  HEIGHT_STEPS,
  type VolumeExample,
} from './example'
import exampleUrl from './example.generated.json?url'
import { useKeyedState } from '../useKeyedState'

export function CompletedVolumeExample({ basemap }: { basemap: Basemap }) {
  const [data, setData] = useState<VolumeExample | null>(null),
    [attempt, setAttempt] = useState(0)
  const [layer, setLayer] = useState('volume'),
    [showReferences, setShowReferences] = useState(true),
    [activeId, setActiveId] = useState(''),
    [referenceId, setReferenceId] = useState(''),
    [retention, setRetention] = useState(20),
    [recovery, setRecovery] = useState(90),
    [reset, setReset] = useState(0),
    [panelOpen, setPanelOpen] = useState<boolean | null>(null)
  const mobile = useIsMobile(),
    panel = panelOpen ?? !mobile
  const [error, setError] = useKeyedState(attempt, () => '')
  useEffect(() => {
    let active = true
    const abort = new AbortController(),
      timer = setTimeout(() => abort.abort(), 30000)
    fetch(exampleUrl, { signal: abort.signal })
      .then((r) => {
        if (!r.ok) throw Error('Completed volume example unavailable')
        return r.json()
      })
      .then((next: VolumeExample) => {
        if (active) setData(checkVolumeExample(next))
      })
      .catch((e) => {
        if (active) setError(String(e))
      })
      .finally(() => clearTimeout(timer))
    return () => {
      active = false
      abort.abort()
      clearTimeout(timer)
    }
  }, [attempt, setError])
  const features = useMemo(
    () =>
      data && {
        ...data.map.cells,
        features: data.map.cells.features.map((f) => ({
          ...f,
          properties: {
            ...f.properties,
            selected: f.properties.id === activeId,
            colour:
              layer === 'volume'
                ? volumeExampleColour(f.properties.volume_m3_ha)
                : volumeExampleColour(f.properties.height_p95_m, 'height'),
          },
        })),
      },
    [data, activeId, layer],
  )
  const active = data?.map.cells.features.find((f) => f.properties.id === activeId)?.properties
  const reference = data?.references.features.find((f) => f.properties.id === referenceId)?.properties
  if (!data || !features)
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-sm" role="status">
        {error || 'Loading completed LiDAR volume example…'}
        {error && (
          <Button className="ml-2" onClick={() => setAttempt((n) => n + 1)}>
            Retry
          </Button>
        )}
      </div>
    )
  const diag = data.model.diagnostics
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label="Completed forest volume example">
      <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 border-b px-3 py-2 text-xs">
        <div>
          <Badge tone="success">Completed example</Badge>
          <p className="mt-1 font-semibold">Forêt Montmorency · Québec · 2015–2016</p>
        </div>
        <div>
          <strong className="block text-lg tabular-nums">
            {Math.round(data.map.modelled_merchantable_m3).toLocaleString()} m³
          </strong>
          Modelled merchantable stem volume
        </div>
        <div>
          <strong className="block text-lg tabular-nums">{data.map.supported_area_ha.toFixed(2)} ha</strong>Supported
          forest grid
        </div>
        <div>
          <strong className="block text-lg tabular-nums">{data.map.mean_m3_ha.toFixed(1)} m³/ha</strong>Mean predicted
          volume
        </div>
        <Button
          className="ml-auto"
          size="sm"
          variant="outline"
          aria-expanded={panel}
          onClick={() => setPanelOpen(!panel)}
        >
          {panel ? 'Hide' : 'Show'} explanation
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        <aside
          hidden={!panel}
          className={`${panel ? 'flex' : 'hidden'} h-[32dvh] min-h-0 shrink-0 flex-col border-b md:h-full md:w-[310px] md:border-r`}
        >
          <MapSidebarShell title="What this result means" subtitle="A fitted model using real field-reference volumes.">
            <SidebarSection title="Read the map">
              <p className="text-xs leading-5">
                Darker green means more predicted merchantable stem wood per hectare. Each square is a native 20 × 20 m
                LiDAR metric cell. Cyan dots are field-reference plots; click a square to inspect it.
              </p>
              <p className="mt-2 text-xs leading-5">
                This is a historical Québec teaching example. It is separate from the BC tile and is not a current
                harvest appraisal.
              </p>
            </SidebarSection>
            <SidebarSection title="From LiDAR to wood volume">
              <ol className="list-decimal space-y-2 pl-4 text-xs leading-5">
                <li>Match field-derived merchantable volumes to LiDAR height, cover and vertical-shape metrics.</li>
                <li>
                  Fit a regression using {data.model.training_n} matched plots. Test predictions in five held-out
                  geographic bands ordered west to east.
                </li>
                <li>
                  Apply the final fit to the tutorial’s native metric grid. Remove non-forest, missing and unsupported
                  cells.
                </li>
                <li>Sum m³/ha × 0.04 ha for each supported cell.</li>
              </ol>
            </SidebarSection>
            <SidebarSection title="How well did it perform?">
              <KeyValueRows
                size="sm"
                rows={[
                  { label: 'Spatial CV RMSE', value: `${diag.rmse_m3_ha.toFixed(1)} m³/ha` },
                  { label: 'Spatial CV bias', value: `${diag.bias_m3_ha.toFixed(1)} m³/ha` },
                  { label: 'Spatial CV R²', value: diag.r2.toFixed(3) },
                  { label: 'Field-reference plots', value: String(data.model.training_n) },
                ]}
              />
              <p className="mt-2 text-[11px] leading-5">
                RMSE describes typical prediction error on the held-out plots. It is not a ± confidence interval for a
                cell or the total. The final map uses a refit on all plots.
              </p>
            </SidebarSection>
            <SidebarSection title="Illustrative harvest scenario">
              <p className="text-xs leading-5">
                Apply assumptions to this example’s predicted merchantable volume. These settings do not estimate
                access, decay, grades or harvest eligibility.
              </p>
              <NumericRangeField
                label="Volume retained"
                value={retention}
                onChange={setRetention}
                min={0}
                max={100}
                step={5}
                display={`${retention}%`}
                layout="inline"
                valueSeparator=" · "
                aria-label="Example volume retained"
                className="mt-2 space-y-0 text-xs"
                inputClassName="h-auto w-full"
              />
              <NumericRangeField
                label="Extraction recovery"
                value={recovery}
                onChange={setRecovery}
                min={0}
                max={100}
                step={5}
                display={`${recovery}%`}
                layout="inline"
                valueSeparator=" · "
                aria-label="Example extraction recovery"
                className="mt-2 space-y-0 text-xs"
                inputClassName="h-auto w-full"
              />
              <p className="mt-2 text-sm font-semibold" aria-label="Example recovered volume">
                {Math.round(
                  recoveredExampleVolume(data.map.modelled_merchantable_m3, retention, recovery),
                ).toLocaleString()}{' '}
                m³ scenario recovered
              </p>
              <p className="mt-1 text-[10px]">
                Predicted merchantable m³ × (1 − retained fraction) × recovery. The initial 20% and 90% are
                demonstration assumptions.
              </p>
            </SidebarSection>
            <SidebarSection title="Source and reproducibility">
              <a href={data.source.tutorial} target="_blank" rel="noreferrer" className="text-xs underline">
                UBC workshop: area-based forest inventory
              </a>
              <p className="mt-2 text-[10px] leading-5">
                {data.source.attribution}. The supplied metrics were precomputed; we reran the volume regression,
                spatial diagnostics and mapped predictions. {data.source.note}
              </p>
              <details className="mt-2 text-xs">
                <summary>Model, exclusions and limitations</summary>
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-[10px]">
                  {JSON.stringify(
                    {
                      model: data.model,
                      exclusions: data.map.exclusions,
                      mask: data.map.forest_mask_rule,
                      limitations: data.limitations,
                      source: data.source,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
              <Button
                className="mt-2"
                size="sm"
                variant="outline"
                onClick={() =>
                  downloadText(
                    JSON.stringify({
                      type: 'FeatureCollection',
                      features: data.map.cells.features,
                      metadata: {
                        dataset: data.dataset,
                        target: data.target,
                        source: data.source,
                        model: data.model,
                        map: { ...data.map, cells: undefined },
                        limitations: data.limitations,
                        scenario: {
                          retention_percent: retention,
                          recovery_percent: recovery,
                          recovered_m3: recoveredExampleVolume(data.map.modelled_merchantable_m3, retention, recovery),
                        },
                      },
                    }),
                    'completed-forest-volume-example.geojson',
                    'application/geo+json',
                  )
                }
              >
                Download completed result
              </Button>
            </SidebarSection>
          </MapSidebarShell>
        </aside>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b p-2 text-xs">
            <SegmentedControl
              label="Completed volume map layer"
              size="sm"
              fullWidth={false}
              value={layer}
              onChange={setLayer}
              options={[
                { value: 'volume', label: 'Wood volume' },
                { value: 'height', label: 'LiDAR height' },
              ]}
            />
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={showReferences} onChange={(e) => setShowReferences(e.target.checked)} />
              Field plots
            </label>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setReset((n) => n + 1)
                setActiveId('')
                setReferenceId('')
              }}
            >
              Fit example
            </Button>
          </div>
          <div className="relative min-h-[160px] flex-1 overflow-hidden">
            <ComparisonMap
              label="Completed merchantable volume map"
              centre={data.map.centre}
              focusKey={`fm-${reset}`}
              zoom={13.5}
              view="top"
              basemap={basemap}
              features={features}
              references={showReferences ? data.references : undefined}
              onFeaturePick={(id) => {
                setActiveId(id)
                setReferenceId('')
              }}
              onReferencePick={(id) => {
                setReferenceId(id)
                setActiveId('')
              }}
              overlayOpacity={0.7}
            />
            <div className="absolute bottom-8 left-2 right-12 rounded border bg-background/95 p-2 text-[10px]">
              <p className="font-semibold">
                {layer === 'volume' ? 'Predicted merchantable volume · m³/ha' : 'Return-height p95 · m'}
              </p>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                {(layer === 'volume' ? VOLUME_STEPS : HEIGHT_STEPS).map((step) => (
                  <span key={step.minimum} className="inline-flex items-center gap-1">
                    <span className="inline-block size-3 border" style={{ background: step.colour }} />
                    {step.label}
                  </span>
                ))}
                {layer === 'volume' && <span>Grey: volume withheld</span>}
              </div>
              <p className="mt-1">
                400 ha subset · {data.map.supported_area_ha.toFixed(2)} ha with supported predictions · native 20 m
                detail
              </p>
              {active && (
                <p className="mt-1 font-medium" role="status">
                  {active.id} · p95 {active.height_p95_m.toFixed(1)} m ·{' '}
                  {active.volume_m3_ha === null
                    ? active.status
                    : `${active.volume_m3_ha.toFixed(1)} m³/ha · ${(active.volume_m3_ha * 0.04).toFixed(2)} m³ per cell`}
                </p>
              )}
              {reference && (
                <p className="mt-1 font-medium" role="status">
                  Field plot {reference.id} · field-derived {reference.observed_m3_ha.toFixed(1)} m³/ha · held-out
                  prediction {reference.cv_m3_ha.toFixed(1)} m³/ha · fold {reference.fold}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
