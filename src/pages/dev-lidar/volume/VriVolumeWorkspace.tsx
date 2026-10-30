import { NumericRangeField } from '@/components/ui/numeric-range-field'
import { NativeSelect, NumberField } from '@/components/ui/form-field'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { MapSidebarShell, SidebarSection, KeyValueRows } from '@/components/ui/map-panels'
import { StatGroup } from '@/components/ui/stat-group'
import { ResultRow } from '@/components/ui/result-list'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { useIsMobile } from '@/hooks/useIsMobile'
import { downloadText } from '@/lib/download'
import {
  VRI_BASELINE_RULES,
  VRI_PG_SCENARIO,
  type VriVolumeRules,
  type VriDeadRule,
  type VriUtilizationRule,
} from '@/lib/forestry/vriVolume'
import type { Basemap } from '../basemaps'
import type { AnalysisSummary } from '../types'
import { ComparisonMap } from '../comparisons/ComparisonMap'
import { volumeExampleColour, VOLUME_STEPS, HEIGHT_STEPS } from './example'
import { useVriVolumeData } from './useVriVolumeData'
import { vriRows, vriTotals } from './vri'

const m3 = (n: number | null) => (n === null ? '—' : `${Math.round(n).toLocaleString('en-CA')} m³`)
const ha = (n: number) => `${n.toFixed(2)} ha`
export function VriVolumeWorkspace({ summary, basemap }: { summary: AnalysisSummary | null; basemap: Basemap }) {
  const { data, error, retry } = useVriVolumeData(summary?.source_sha256)
  const [rules, setRules] = useState<VriVolumeRules>({ ...VRI_BASELINE_RULES }),
    [layer, setLayer] = useState('volume'),
    [retention, setRetention] = useState(0),
    [recovery, setRecovery] = useState(100),
    [audit, setAudit] = useState(false),
    [scope, setScope] = useState<'all' | 'selected'>('all'),
    [selected, setSelected] = useState(new Set<string>()),
    [activeId, setActiveId] = useState(''),
    [panelOpen, setPanelOpen] = useState<boolean | null>(null),
    [reset, setReset] = useState(0)
  const mobile = useIsMobile(),
    panel = panelOpen ?? !mobile
  const rows = useMemo(() => (data ? vriRows(data, rules) : []), [data, rules])
  const chosen = rows.filter((r) => (scope === 'all' ? r.inventory.treed : selected.has(r.feature.properties.id))),
    totals = vriTotals(chosen, retention, recovery),
    active = rows.find((r) => r.feature.properties.id === activeId)
  const features = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: rows.map((row) => {
        const { feature, inventory, result } = row,
          value = layer === 'height' ? feature.properties.lidar.surface_p95_m : result.density
        return {
          ...feature,
          properties: {
            id: feature.properties.id,
            selected: scope === 'selected' && selected.has(feature.properties.id),
            colour: inventory.treed ? volumeExampleColour(value, layer) : '#e2e8f0',
            volume_m3_ha: result.density,
            volume_m3: row.volume_m3,
            status: result.status,
            area_ha: feature.properties.area_ha,
            complete: result.complete,
          },
        }
      }),
    }),
    [rows, layer, scope, selected],
  )
  const patch = (p: Partial<VriVolumeRules>) => setRules((previous) => ({ ...previous, ...p }))
  const toggle = (id: string) => {
    setActiveId(id)
    setSelected((previous) => {
      const next = scope === 'all' ? new Set<string>() : new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setScope('selected')
  }
  if (!data)
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-sm" role="status">
        {error || 'Loading BC VRI volume estimates…'}
        {error && (
          <Button className="ml-2" onClick={retry}>
            Retry VRI
          </Button>
        )}
      </div>
    )
  const partial = totals.partial_dead_ha > 0
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label="BC VRI volume workspace">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
        <div className="mr-auto">
          <Badge tone="success">BC inventory estimate</Badge>
          <p className="mt-1 text-xs font-medium">
            093G086 · projected to {data.source.projected_dates.map((s) => s.replace(/Z$/, '')).join(', ')}
          </p>
        </div>
        <Button size="sm" variant="outline" aria-expanded={panel} onClick={() => setPanelOpen(!panel)}>
          {panel ? 'Hide' : 'Show'} VRI controls
        </Button>
      </div>
      <div className="shrink-0 border-b px-2 py-2" aria-label="VRI volume summary">
        <StatGroup
          variant="inline"
          size="sm"
          columns={3}
          items={[
            {
              label: partial ? 'Known net volume · partial dead data' : 'Inventory net volume',
              value: m3(totals.known_net_m3),
            },
            { label: scope === 'all' ? 'Supported treed area' : 'Selected supported area', value: ha(totals.area_ha) },
            {
              label: 'Area-weighted density',
              value: totals.mean_m3_ha === null ? '—' : `${totals.mean_m3_ha.toFixed(1)} m³/ha`,
            },
          ]}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        <aside
          hidden={!panel}
          className={`${panel ? 'flex' : 'hidden'} h-[34dvh] min-h-0 shrink-0 flex-col border-b md:h-full md:w-[330px] md:border-r`}
        >
          <MapSidebarShell
            title="VRI assumptions & selection"
            subtitle="Ready to inspect; no field-data upload needed."
          >
            <SidebarSection title="Inventory rules">
              <div className="flex flex-wrap gap-1">
                <Button size="sm" variant="outline" onClick={() => setRules({ ...VRI_BASELINE_RULES })}>
                  Inventory baseline
                </Button>
                <Button size="sm" variant="outline" onClick={() => setRules({ ...VRI_PG_SCENARIO })}>
                  PG planning rules
                </Button>
              </div>
              <label className="mt-3 block text-xs">
                Utilization level
                <NativeSelect
                  aria-label="VRI utilization"
                  className="mt-1 w-full rounded border bg-background p-2"
                  value={String(rules.utilization)}
                  onChange={(e) =>
                    patch({
                      utilization: (e.target.value === 'species'
                        ? 'species'
                        : Number(e.target.value)) as VriUtilizationRule,
                    })
                  }
                >
                  <option value="125">12.5 cm · all stands</option>
                  <option value="175">17.5 cm · all stands</option>
                  <option value="225">22.5 cm · unreported in this tile</option>
                  <option value="species">Pine 12.5 cm · others 17.5 cm</option>
                </NativeSelect>
              </label>
              <p className="mt-1 text-[10px] leading-5">
                Same utilization choices as PGMaps AVAST. These are inventory DBH utilization levels, not measured top
                diameters.
              </p>
              <label className="mt-2 block text-xs">
                Dead volume
                <NativeSelect
                  aria-label="VRI dead volume"
                  className="mt-1 w-full rounded border bg-background p-2"
                  value={rules.dead}
                  onChange={(e) => patch({ dead: e.target.value as VriDeadRule })}
                >
                  <option value="none">Live only</option>
                  <option value="full">Live + reported dead</option>
                  <option value="shelf">Live + reported dead · PG shelf-life scenario</option>
                </NativeSelect>
              </label>
              <NumberField
                label="Minimum projected stand age · years"
                aria-label="VRI minimum stand age"
                value={rules.minAge}
                min={0}
                max={500}
                clampOn="never"
                blankValue="zero"
                fieldClassName="mt-2"
                contentClassName="text-xs"
                inputClassName="mt-1 w-full rounded border bg-background p-2"
                onValueChange={(value) => patch({ minAge: Math.max(0, value || 0) })}
              />
              <p className="mt-1 text-[10px] leading-5">
                0 includes all recorded ages. PG planning rules use age ≥60; an unknown age is excluded when a minimum
                is applied.
              </p>
              {rules.dead === 'shelf' && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <NumberField
                    label="Years dead if unknown"
                    aria-label="VRI unknown years dead"
                    value={rules.unknownDeathYears}
                    min={0}
                    clampOn="never"
                    blankValue="zero"
                    contentClassName="text-xs"
                    inputClassName="mt-1 w-full rounded border bg-background p-2"
                    onValueChange={(value) => patch({ unknownDeathYears: Math.max(0, value || 0) })}
                  />
                  <NumberField
                    label="Shelf-life year"
                    aria-label="VRI shelf life year"
                    value={rules.asOfYear}
                    min={1900}
                    max={2200}
                    clampOn="never"
                    blankValue="zero"
                    contentClassName="text-xs"
                    inputClassName="mt-1 w-full rounded border bg-background p-2"
                    onValueChange={(value) => patch({ asOfYear: Math.max(1900, Math.min(2200, value || 2026)) })}
                  />
                  <p className="col-span-2 text-[10px] leading-5">
                    AVAST's PG curve: 100% through year 1, 80% at year 2, declining to 40% at year 15+. Earliest
                    disturbance is only a proxy for death. This does not project inventory growth to the chosen year.
                  </p>
                </div>
              )}
            </SidebarSection>
            <SidebarSection title="Choose an area">
              <p className="text-xs leading-5">
                Totals start with all treed inventory pieces inside the LiDAR footprint. Click pieces to select a
                planning area; their full clipped areas are used.
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setScope('all')
                    setSelected(new Set())
                  }}
                >
                  All treed stands
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setScope('selected')
                    setSelected(new Set())
                  }}
                >
                  Clear selection
                </Button>
              </div>
              <p className="mt-2 text-xs" role="status">
                {scope === 'all'
                  ? `All ${rows.filter((r) => r.inventory.treed).length} treed pieces`
                  : `${selected.size} selected pieces`}{' '}
                · {ha(totals.missing_treed_ha)} treed area excluded or unavailable.
              </p>
              {partial && (
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-300" role="status">
                  Dead volume is unreported over {ha(totals.partial_dead_ha)}. The sum includes known live volume there;
                  the missing dead component is not inferred.
                </p>
              )}
            </SidebarSection>
            {active && (
              <SidebarSection title={`Inspect ${active.feature.properties.id}`}>
                <KeyValueRows
                  size="sm"
                  rows={[
                    { label: 'Clipped inventory area', value: ha(active.feature.properties.area_ha) },
                    {
                      label: 'Leading species / age',
                      value: `${active.inventory.speciesCode ?? '—'} / ${active.inventory.ageYears ?? '—'} years`,
                    },
                    { label: 'Rule result', value: active.result.status },
                    {
                      label: 'Known net density',
                      value: active.result.density === null ? '—' : `${active.result.density.toFixed(1)} m³/ha`,
                    },
                    { label: 'Known net volume', value: m3(active.volume_m3) },
                    {
                      label: 'VRI leading-species height',
                      value:
                        active.inventory.heightMeters === null ? '—' : `${active.inventory.heightMeters.toFixed(1)} m`,
                    },
                    {
                      label: 'LiDAR CHM surface p95',
                      value:
                        active.feature.properties.lidar.surface_p95_m === null
                          ? '—'
                          : `${active.feature.properties.lidar.surface_p95_m.toFixed(1)} m`,
                    },
                    {
                      label: 'LiDAR canopy ≥2 m',
                      value:
                        active.feature.properties.lidar.canopy_percent === null
                          ? '—'
                          : `${active.feature.properties.lidar.canopy_percent.toFixed(1)}%`,
                    },
                    { label: 'Inventory interpretation', value: active.inventory.interpretationDate ?? '—' },
                    { label: 'Inventory reference year', value: String(active.inventory.referenceYear ?? '—') },
                  ]}
                />
                <p className="mt-2 text-[10px] leading-5">
                  The two height statistics describe different things. They do not calibrate or automatically rescale
                  volume.
                </p>
              </SidebarSection>
            )}
            <SidebarSection title="Harvest scenario">
              {[
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
                  aria-label={`VRI ${String(label).toLowerCase()}`}
                  min={0}
                  max={100}
                  step={5}
                  value={Number(value)}
                  onChange={set as (value: number) => void}
                />
              ))}
              <p className="mt-2 text-sm font-semibold" aria-label="VRI recovered volume">
                {m3(totals.scenario_recovered_m3)} scenario recovered
              </p>
              <p className="mt-1 text-[10px] leading-5">
                Known net m³ × (1 − volume retained) × recovery. VRI net volumes already deduct decay, waste and
                breakage; no extra defect factor is applied. Defaults of 0% retained and 100% recovery are neutral
                assumptions.
              </p>
            </SidebarSection>
            <SidebarSection title="Compare with the existing AVAST tool">
              <label className="flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  aria-label="VRI historical audit comparison"
                  checked={audit}
                  onChange={(e) => setAudit(e.target.checked)}
                />
                Historical PG audit comparison
              </label>
              {audit && (
                <>
                  <p className="mt-2 text-sm font-semibold">
                    {m3(totals.historical_audit_m3)} historical audit scenario
                  </p>
                  <p className="mt-1 text-[10px] leading-5">
                    Same species ratios used by AVAST: pine 0.836, spruce 0.946, balsam 1.246, other 1.159. Applied to
                    the known net sum; this is a sensitivity comparison, not a confidence interval or validation of this
                    tile.
                  </p>
                </>
              )}
              <a
                className="mt-2 block text-xs underline"
                href="https://pgmaps.ahmadjalil.com/dev/forestry/avast-volume"
                target="_blank"
                rel="noreferrer"
              >
                Open PGMaps AVAST volume tool
              </a>
            </SidebarSection>
            <SidebarSection title="Coverage & source">
              <KeyValueRows
                size="sm"
                rows={[
                  { label: 'LiDAR support footprint', value: ha(data.coverage.supported_ha) },
                  { label: 'Treed inventory coverage', value: ha(data.coverage.treed_ha) },
                  { label: 'Non-treed inventory coverage', value: ha(data.coverage.non_treed_ha) },
                  { label: 'Inventory unmapped', value: ha(data.coverage.unmapped_ha) },
                ]}
              />
              <p className="mt-2 text-[10px] leading-5">
                {data.area_method} No substand LiDAR volume model is implied. This snapshot does not automatically
                remove disturbance after its projected date.
              </p>
              <a className="mt-2 block text-xs underline" href={data.source.catalogue} target="_blank" rel="noreferrer">
                BC VRI rank-1 · data catalogue
              </a>
              <a
                className="mt-2 block text-xs underline"
                href={data.source.dictionary}
                target="_blank"
                rel="noreferrer"
              >
                VRI net-volume field definitions
              </a>
              <p className="mt-2 text-[10px]">
                {data.source.licence} · retrieved {data.source.retrieved_utc.slice(0, 10)}
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                disabled={!chosen.length}
                onClick={() =>
                  downloadText(
                    JSON.stringify({
                      type: 'FeatureCollection',
                      features: chosen.map((r) => ({
                        ...r.feature,
                        properties: {
                          ...r.feature.properties,
                          calculation: r.result,
                          known_net_m3: r.volume_m3,
                          historical_audit_ratio: r.audit_ratio,
                        },
                      })),
                      metadata: {
                        source_sha256: data.source_sha256,
                        height_sha256: data.height_sha256,
                        source: data.source,
                        area_method: data.area_method,
                        rules,
                        totals,
                        assumptions: {
                          retention_percent: retention,
                          recovery_percent: recovery,
                          historical_audit_comparison_shown: audit,
                        },
                        limitations: data.limitations,
                      },
                    }),
                    'bc-vri-volume-scenario.geojson',
                    'application/geo+json',
                  )
                }
              >
                Download VRI scenario
              </Button>
            </SidebarSection>
            <SidebarSection title="Inventory pieces">
              <div className="space-y-1">
                {rows
                  .filter((r) => r.inventory.treed)
                  .map((r) => (
                    <ResultRow
                      key={r.feature.properties.id}
                      title={`${r.inventory.speciesCode ?? 'Unknown'} · ${r.inventory.featureId}`}
                      subtitle={`${ha(r.feature.properties.area_ha)} · ${r.result.density === null ? r.result.status : r.result.density.toFixed(1) + ' m³/ha'}`}
                      selected={scope === 'selected' && selected.has(r.feature.properties.id)}
                      onClick={() => toggle(r.feature.properties.id)}
                    />
                  ))}
              </div>
            </SidebarSection>
          </MapSidebarShell>
        </aside>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b p-2 text-xs">
            <SegmentedControl
              label="VRI map layer"
              fullWidth={false}
              size="sm"
              value={layer}
              onChange={setLayer}
              options={[
                { value: 'volume', label: 'VRI net volume' },
                { value: 'height', label: 'LiDAR p95 by stand' },
              ]}
            />
            <Button size="sm" variant="outline" onClick={() => setReset((n) => n + 1)}>
              Fit BC tile
            </Button>
            <Link className="underline" to="/dev/lidar/canopy/">
              Detailed canopy heatmap
            </Link>
          </div>
          <div className="relative min-h-[170px] flex-1 overflow-hidden">
            <ComparisonMap
              label="BC VRI volume map"
              centre={data.centre}
              bounds={data.bounds}
              focusKey={`vri-${reset}`}
              zoom={15}
              view="top"
              basemap={basemap}
              features={features}
              onFeaturePick={toggle}
              overlayOpacity={0.65}
            />
            <div className="absolute bottom-8 left-2 right-12 rounded border bg-background/95 p-2 text-[10px]">
              <p className="font-semibold">
                {layer === 'volume'
                  ? 'VRI net volume · m³/ha · clipped stand pieces'
                  : 'LiDAR CHM surface p95 · m · per inventory piece'}
              </p>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                {(layer === 'volume' ? VOLUME_STEPS : HEIGHT_STEPS).map((step) => (
                  <span className="inline-flex items-center gap-1" key={step.minimum}>
                    <span className="inline-block size-3 border" style={{ background: step.colour }} />
                    {step.label}
                  </span>
                ))}
                <span>
                  {layer === 'volume'
                    ? 'Grey: excluded / volume unavailable / non-treed'
                    : 'Grey: non-treed / height unavailable'}
                </span>
              </div>
              <p className="mt-1">
                {partial
                  ? 'Known live + reported dead components; missing dead data remain unreported.'
                  : 'Inventory-based planning estimate. LiDAR supplies footprint and height context.'}
              </p>
              {active && (
                <p className="mt-1 font-medium" role="status">
                  {active.feature.properties.id} · {ha(active.feature.properties.area_ha)} ·{' '}
                  {active.result.density === null
                    ? active.result.status
                    : `${active.result.density.toFixed(1)} m³/ha · ${m3(active.volume_m3)}`}{' '}
                  · {active.inventory.speciesCode ?? 'No leading species'}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
