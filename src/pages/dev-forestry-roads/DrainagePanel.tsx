import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { CollapsibleSection, InlineAlert } from '@/components/ui/map-panels'
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { StatGroup } from '@/components/ui/stat-group'
import { ReadoutGrid } from '@/components/ui/readout-grid'
import { InfoTip } from '@/components/ui/info-tip'
import { DrainageSettingField } from './SharedRoadFields'
import { DEFAULT_DRAINAGE_SETTINGS, type DrainageRun, type DrainageSettings } from './drainageRun'
import { formatRoadStation } from './Charts'
import { CROSS_DRAIN_SITE_M, DITCH_DETAIL_CELL_M, LOW_POINT_MIN_CELLS } from './hydrology'
import { parseDrainageSettings, type DrainageComparisonSnapshot, type DrainageEvidence } from './drainageEvidence'
import { DEFAULT_POUR_POINT_SNAP_M, type PourPoint } from './drainageCatchments'
import { DrainageRoutingFields, PourPointFields, routingSummary, WatershedFields } from './DrainageFields'
import { DRAINAGE_FIELDS } from './roadFieldDefinitions'
import { DrainageSensitivityPanel } from './DrainageSensitivityPanel'
import { DrainageIntensityEditor } from './DrainageIntensityEditor'
import type { CulvertTiming } from './timeOfConcentration'
import { depressionPolicyLabel, snapPolicyLabel } from './drainageSensitivity'
import { insetBox } from '@/components/ui/inset-box'
import { cn } from '@/lib/utils'
import { CrossDrainBatchPanel } from './CrossDrainBatchPanel'
import type { CrossDrainBatch } from './useCrossDrainBatch'
import type { StationEntry } from './stationEntry'

type PourPointOptions = Pick<PourPoint, 'surface' | 'snapRadiusM' | 'snapPolicy'>

export const DRAINAGE_SETTINGS_KEY = 'pgmaps-road-drainage-settings'
/**
 * The last drainage inputs this browser used. Runs themselves are not stored: they take seconds
 * to recompute and hold tens of megabytes of grids.
 */
export function readDrainageSettings(): DrainageSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(DRAINAGE_SETTINGS_KEY) ?? 'null') as Partial<DrainageSettings> | null
    return parseDrainageSettings({ ...DEFAULT_DRAINAGE_SETTINGS, ...saved })
  } catch {
    return DEFAULT_DRAINAGE_SETTINGS
  }
}

const n = (v: number, digits = 0) => v.toLocaleString('en-CA', { maximumFractionDigits: digits })
/** "Tc 12.4 min · 58.1 mm/h, 10-year" with the path it came from; a flagged one says so. */
// One formatter per precision: a per-row `toLocaleString` with options builds a new one each call.
const whole = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 0 }),
  tenth = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 1 })
const timingText = (t: CulvertTiming) =>
  `Tc ${tenth.format(t.tcMin)} min · ${tenth.format(t.intensityMmPerHr)} mm/h, ${whole.format(t.returnPeriodYears)}-year · path ${whole.format(t.pathLengthM)} m at ${
    t.pathSlope === null ? 'no measurable slope' : `${tenth.format(t.pathSlope * 100)}% (${t.slopeMethod})`
  }${t.flags.length ? ' · outside range, see notes' : ''}`

/**
 * Flow on the existing ground against flow on the design surface: streams the road carries along
 * its ditches, cross-drain candidates with no culvert, new ponding, and a Rational-method pipe check.
 */
// Each group is a row: its name on the left, then its inputs as wide as they need.
const groupRow = 'grid gap-1.5 sm:grid-cols-[6.5rem_minmax(0,1fr)] sm:items-end sm:gap-2'
const groupHeading = 'text-3xs font-semibold uppercase tracking-wide text-muted-foreground sm:pb-2.5'
const groupGrid = 'grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] items-end gap-2'
const selectGrid = 'grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] items-end gap-2'

export function DrainagePanel({
  run,
  stale,
  settings,
  onSettings,
  onRun,
  busy,
  onStation,
  pourPoint,
  onPourPointChange,
  onPickPourPoint,
  pourPointPicking = false,
  watershedMinAreaHa,
  onWatershedMinAreaChange,
  evidence,
  onExport,
  onShowCulverts,
  comparisons = [],
  totalComparisonRecords = 0,
  onSaveComparison,
  onRemoveComparison,
  onExportComparisons,
  batch,
  stations,
  roadLength,
}: {
  run: DrainageRun | null
  stale: boolean
  settings: DrainageSettings
  onSettings: (settings: DrainageSettings) => void
  onRun: () => void
  busy: boolean
  onStation: (chainage: number) => void
  pourPoint?: PourPoint
  onPourPointChange?: (point: PourPoint | undefined) => void
  onPickPourPoint?: (options: PourPointOptions) => void
  pourPointPicking?: boolean
  watershedMinAreaHa?: number
  onWatershedMinAreaChange?: (minimumAreaHa: number | undefined) => void
  evidence?: DrainageEvidence
  onExport?: (kind: 'geojson' | 'evidence') => void
  onShowCulverts?: (chainage?: number) => void
  comparisons?: DrainageComparisonSnapshot[]
  totalComparisonRecords?: number
  onSaveComparison?: (label: string) => void
  onRemoveComparison?: (id: string) => void
  onExportComparisons?: (baselineId: string) => void
  /** Batch placement of cross-drains (`useCrossDrainBatch.ts`); omitted, the table has no selection. */
  batch?: CrossDrainBatch
  stations?: StationEntry
  roadLength?: number
}) {
  const [pointOptions, setPointOptions] = useState<PourPointOptions>({
    surface: 'design',
    snapRadiusM: DEFAULT_POUR_POINT_SNAP_M,
    snapPolicy: 'max-accumulation',
  })
  // The inputs fold away once there is a run to read; their summary line keeps them in view.
  const [inputsOpen, setInputsOpen] = useState(!run)
  const pointOptionsNow: PourPointOptions = {
    surface: pourPoint?.surface ?? pointOptions.surface,
    snapRadiusM: pourPoint?.snapRadiusM ?? pointOptions.snapRadiusM,
    snapPolicy: (pourPoint ? pourPoint.snapPolicy : pointOptions.snapPolicy) ?? 'max-accumulation',
  }
  const setPointOptionsAndApply = (patch: Partial<PourPointOptions>) => {
    setPointOptions({ ...pointOptionsNow, ...patch })
    if (pourPoint) onPourPointChange?.({ ...pourPoint, ...patch })
  }
  const set = (patch: Partial<DrainageSettings>) => onSettings({ ...settings, ...patch })
  const routing = {
    streamThresholdHa: settings.streamThresholdHa,
    reachM: settings.bufferM,
    workingResolutionM: settings.workingResolutionM,
    depressionPolicy: settings.depressionPolicy,
  }
  const inputsSummary = [
    settings.concentration?.enabled ? 'intensity per culvert' : `${n(settings.rainfallMmPerHr)} mm/h`,
    `C ${n(settings.runoffCoefficient, 2)}`,
    routingSummary(routing),
    pourPoint && 'pour point set',
    watershedMinAreaHa !== undefined && 'watersheds',
  ]
    .filter(Boolean)
    .join(' · ')
  const redirected = run?.crossings.filter((c) => c.redirected && !c.throughCulvertId) ?? []
  const uncovered = run?.lowPoints.filter((p) => !p.throughCulvert) ?? []
  const undersized = run?.culverts.filter((c) => !c.adequate) ?? []
  const station = (chainage: number) => (
    <button className="underline" onClick={() => onStation(chainage)}>
      {formatRoadStation(chainage)}
    </button>
  )
  return (
    <div className="h-full space-y-3 overflow-auto overscroll-none text-xs" data-testid="road-drainage">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="xs"
          className="shrink-0"
          disabled={busy}
          onClick={() => {
            // The first run folds the inputs; a re-run leaves them as they are, for changing one at a time.
            if (!run) setInputsOpen(false)
            onRun()
          }}
        >
          {run ? 'Re-run drainage' : 'Run drainage check'}
        </Button>
        {/* The culverts this check routes through are entered in the sidebar, under Engineering → Drainage. */}
        {onShowCulverts && (
          <Button
            size="xs"
            variant="outline"
            className="shrink-0"
            data-testid="road-drainage-culvert-inputs"
            onClick={() => onShowCulverts()}
          >
            Culvert inputs
          </Button>
        )}
        <InfoTip label="About the drainage check" bubbleClassName="max-w-80">
          Routes flow (D8) over the existing ground and over a design surface with the road and its culverts burned in,
          then marks redirected streams, cross-drain candidates without a culvert and new ponding. To route the ground
          alone over an area, with or without a road, use Terrain → Existing-ground drainage: it shares these routing
          settings&apos; labels and defaults but keeps its own.
        </InfoTip>
      </div>
      <section className={insetBox({ padding: 'none' })} aria-label="Drainage inputs">
        <CollapsibleSection
          label="Inputs"
          summary={inputsSummary}
          open={inputsOpen}
          onOpenChange={setInputsOpen}
          contentClassName="space-y-2.5 p-3"
        >
          <div role="group" aria-label="Design storm" className={groupRow}>
            <span className={groupHeading}>Design storm</span>
            <div className={groupGrid}>
              <DrainageSettingField field="rainfallMmPerHr" settings={settings} onSettings={onSettings} />
              <DrainageSettingField field="runoffCoefficient" settings={settings} onSettings={onSettings} />
              <DrainageSettingField field="manningN" settings={settings} onSettings={onSettings} />
            </div>
          </div>
          <div role="group" aria-label="Culvert intensity" className={groupRow}>
            <span className={groupHeading}>Intensity</span>
            <DrainageIntensityEditor settings={settings} onSettings={onSettings} />
          </div>
          <div role="group" aria-label="Flow routing" className={groupRow}>
            <span className={groupHeading}>Routing</span>
            <div className={selectGrid}>
              <DrainageRoutingFields
                value={routing}
                reach={{
                  min: DRAINAGE_FIELDS.bufferM.min,
                  max: DRAINAGE_FIELDS.bufferM.max,
                  hint: "Ground sampled beyond the road's catch lines, so catchments upslope of it are not cut off.",
                }}
                customCellM={run?.cellM ?? 5}
                onChange={({ reachM, ...patch }) => set(reachM === undefined ? patch : { ...patch, bufferM: reachM })}
              />
            </div>
          </div>
          {onPickPourPoint && (
            <div role="group" aria-label="Catchments and watersheds" className={cn(groupRow, 'sm:items-start')}>
              {/* A group of several rows: its name stands level with the first row's fields. */}
              <span className={cn(groupHeading, 'sm:pb-0 sm:pt-7')}>Catchments</span>
              <div className="space-y-2">
                <PourPointFields
                  surfaces
                  options={pointOptionsNow}
                  onOptions={setPointOptionsAndApply}
                  point={pourPoint?.coordinate}
                  onPoint={(coordinate) =>
                    onPourPointChange?.(coordinate && pourPoint ? { ...pourPoint, coordinate } : undefined)
                  }
                  picking={pourPointPicking}
                  onPick={() => onPickPourPoint(pointOptionsNow)}
                  disabled={busy}
                />
                {onWatershedMinAreaChange && (
                  <WatershedFields
                    minAreaHa={watershedMinAreaHa}
                    onChange={onWatershedMinAreaChange}
                    note="Splits the pour-point surface, or the design surface without one, by its D8 outlets. Watersheds touching the sample edge or missing terrain may be incomplete."
                  />
                )}
                <p className="text-muted-foreground">
                  The catchment above the pour point and the watersheds are drawn by the next run.
                </p>
              </div>
            </div>
          )}
        </CollapsibleSection>
      </section>
      {evidence && !run && (
        <section className={cn(insetBox(), 'space-y-2')} aria-label="Saved drainage evidence">
          <h3 className="font-medium">Saved drainage evidence</h3>
          <p>
            {evidence.summary.crossings} crossings · {evidence.summary.lowPoints} cross-drain candidates ·{' '}
            {n(evidence.summary.pondingAreaM2)} m² new ponding.
          </p>
          <p className="break-words text-muted-foreground">
            Run {evidence.createdAt} on {evidence.terrain.name} at {n(evidence.grid.cellM, 2)} m cells. The compact
            record and settings travel with this project; full flow grids are recomputed.
          </p>
          {stale && (
            <p role="status" className="text-warning">
              Saved drainage evidence is out of date. Re-run before using or exporting current results.
            </p>
          )}
        </section>
      )}
      {onExport && (run || evidence) && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            className="touch:min-h-10"
            variant="outline"
            disabled={busy || stale}
            onClick={() => onExport('geojson')}
          >
            Export drainage GeoJSON
          </Button>
          <Button
            size="sm"
            className="touch:min-h-10"
            variant="outline"
            disabled={busy || stale}
            onClick={() => onExport('evidence')}
          >
            Export drainage evidence
          </Button>
        </div>
      )}
      {onSaveComparison && onRemoveComparison && onExportComparisons && (
        <DrainageSensitivityPanel
          records={comparisons}
          totalRecords={totalComparisonRecords}
          evidence={evidence}
          stale={stale}
          busy={busy}
          onSave={onSaveComparison}
          onRemove={onRemoveComparison}
          onExport={onExportComparisons}
        />
      )}
      {run && (
        <>
          {stale && (
            <div role="status">
              <InlineAlert tone="warning">
                The road or these inputs changed. Re-run to draw this on the plan.
              </InlineAlert>
            </div>
          )}
          <StatGroup
            variant="tiles"
            size="sm"
            columns={5}
            items={[
              { label: 'Crossings', value: n(run.crossings.length) },
              { label: 'Redirected', value: n(redirected.length) },
              { label: 'Cross-drain candidates', value: n(uncovered.length) },
              { label: 'New ponding', value: `${n(run.newPonding.areaM2)} m²` },
              { label: 'Undersized', value: `${n(undersized.length)} of ${n(run.culverts.length)}` },
            ]}
          />
          {onShowCulverts && (redirected.length > 0 || uncovered.length > 0 || undersized.length > 0) && (
            <div className="flex items-center gap-2">
              <Button size="xs" variant="outline" onClick={() => onShowCulverts()}>
                Add or size culverts
              </Button>
              <span className="text-muted-foreground">Then re-run to see whether flow reaches them.</span>
            </div>
          )}
          <p className="text-muted-foreground">
            {depressionPolicyLabel(run.settings)} · {n(run.cellM, 2)} m actual cells. Ponding shows potential storage to
            the spill level, independent of routing treatment.
          </p>
          {run.catchment && (
            <section className={cn(insetBox(), 'space-y-2')} aria-label="Selected catchment">
              <h3 className="font-medium">Selected catchment · {run.catchment.feature.properties.surface}</h3>
              <ReadoutGrid
                minColumnWidth="18rem"
                className="text-xs leading-5"
                items={[
                  { label: 'Area', value: `${n(run.catchment.feature.properties.areaHa, 3)} ha` },
                  { label: 'Supported cells', value: n(run.catchment.feature.properties.cells) },
                  { label: 'Snap distance', value: `${n(run.catchment.snappedDistanceM, 1)} m` },
                  { label: 'Outlet cell', value: String(run.catchment.outletCell) },
                  { label: 'Snap policy', value: snapPolicyLabel({ snapPolicy: run.catchment.snapPolicy }) },
                  { label: 'Selected outlet', value: run.catchment.snappedCoordinate.map((v) => n(v, 6)).join(', ') },
                ]}
              />
              <p className={run.catchment.feature.properties.truncated ? 'text-warning' : 'text-muted-foreground'}>
                {run.catchment.feature.properties.truncated
                  ? 'Boundary contact: contributing area may continue beyond the sampled grid or a terrain gap.'
                  : 'No sampled edge or no-data contact. This is a raster drainage boundary, not a surveyed watershed.'}
              </p>
            </section>
          )}
          {run.watersheds && (
            <p>
              {n(run.watersheds.features.length)} watershed polygons meet the minimum area.{' '}
              {run.watersheds.features.filter((f) => f.properties.truncated).length} touch a sampled boundary or missing
              terrain.
            </p>
          )}
          <section aria-label="Stream crossings">
            <h3 className="mb-1 font-medium">Stream crossings</h3>
            {run.crossings.length ? (
              <EngineeringTable>
                <thead>
                  <tr>
                    <ColumnHeader label="Enters" unit="station" className="text-left" />
                    <ColumnHeader label="Catchment" unit="ha" />
                    <ColumnHeader label="Leaves" unit="station" />
                    <ColumnHeader label="Carried" unit="m" />
                    <ColumnHeader label="Culvert" className="text-left" />
                  </tr>
                </thead>
                <tbody>
                  {run.crossings.map((c) => {
                    const bad = c.redirected && !c.throughCulvertId
                    return (
                      <tr key={c.id} data-state={bad ? 'redirected' : 'ok'}>
                        <td className="text-left">{station(c.chainage)}</td>
                        <td>{n(c.areaHa, 2)}</td>
                        <td>{station(c.exitChainage)}</td>
                        <td className={bad ? 'font-medium text-danger' : undefined}>{n(c.divertedM)}</td>
                        <td className="text-left">
                          {c.throughCulvertId
                            ? 'Passes through'
                            : c.culvertId
                              ? 'Nearby, bypassed'
                              : bad
                                ? 'None: road redirects it'
                                : 'None'}
                          {!c.throughCulvertId && onShowCulverts && (
                            <button className="ml-2 underline" onClick={() => onShowCulverts(c.chainage)}>
                              Add culvert
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </EngineeringTable>
            ) : (
              <p className="text-muted-foreground">
                No stream above the threshold crosses the road on existing ground.
              </p>
            )}
          </section>
          <section aria-label="Cross-drain candidates">
            <h3 className="mb-1 font-medium">Cross-drain candidates</h3>
            <p className="mb-1 text-muted-foreground">
              Where flow leaves the road or ponds against it. Outlets within {CROSS_DRAIN_SITE_M} m of each other are
              one site; the plan shades each site's stretch and, zoomed in, marks a dashed line across the road at its
              largest outlet.
            </p>
            {run.cellM > DITCH_DETAIL_CELL_M && (
              <InlineAlert tone="warning" data-testid="road-drainage-cross-drain-screening">
                Screening only: {n(run.cellM, 1)} m cells cannot resolve a ditch, so water reads as leaving the road
                wherever the ground falls away. Use terrain of {DITCH_DETAIL_CELL_M} m cells or finer before placing
                cross-drains.
              </InlineAlert>
            )}
            {run.lowPoints.length ? (
              <EngineeringTable>
                <thead>
                  <tr>
                    {batch && <ColumnHeader label="Pick" />}
                    <ColumnHeader label="Station" className="text-left" />
                    <ColumnHeader label="Stretch" className="text-left" />
                    <ColumnHeader label="Side" />
                    <ColumnHeader label="Kind" />
                    <ColumnHeader label="Outlets" />
                    <ColumnHeader label="Draining" unit="ha" />
                    <ColumnHeader label="Depth" unit="m" />
                    <ColumnHeader label="Culvert" className="text-left" />
                  </tr>
                </thead>
                <tbody>
                  {run.lowPoints.map((p) => (
                    <tr key={p.id}>
                      {batch && (
                        <td>
                          {!p.throughCulvert && (
                            <input
                              type="checkbox"
                              aria-label={`Pick site at ${formatRoadStation(p.chainage)}`}
                              checked={batch.selected.has(p.id)}
                              disabled={stale}
                              onChange={() => batch.toggle(p.id)}
                            />
                          )}
                        </td>
                      )}
                      <td className="text-left">{station(p.chainage)}</td>
                      <td className="text-left">
                        {p.toChainage > p.fromChainage
                          ? `${formatRoadStation(p.fromChainage)}–${formatRoadStation(p.toChainage)}`
                          : '—'}
                      </td>
                      <td>{p.sides.length > 1 ? 'both' : p.side}</td>
                      <td>{p.kind === 'pond' ? 'ponds' : 'leaves road'}</td>
                      <td>{n(p.outlets)}</td>
                      <td>{n(p.areaHa, 2)}</td>
                      <td>{p.depthM > 0 ? n(p.depthM, 2) : '—'}</td>
                      <td className="text-left">{p.throughCulvert ? 'Through culvert' : 'None'}</td>
                    </tr>
                  ))}
                </tbody>
              </EngineeringTable>
            ) : (
              <p className="text-muted-foreground">
                No flow of {n(Math.max(0.05, (LOW_POINT_MIN_CELLS * run.cellM ** 2) / 10_000), 2)} ha or more leaves the
                road.
              </p>
            )}
            {batch && stations && roadLength !== undefined && (
              <CrossDrainBatchPanel
                batch={batch}
                stations={stations}
                roadLength={roadLength}
                selectable={uncovered.length}
                runCurrent={!stale}
              />
            )}
          </section>
          <section aria-label="Culvert sizing">
            <h3 className="mb-1 font-medium">Culvert sizing (Rational method, full-pipe Manning)</h3>
            {run.culverts.length ? (
              <>
                <div className="space-y-2 md:hidden">
                  {run.culverts.map((c) => (
                    <article
                      key={c.id}
                      aria-label={`Culvert check ${c.name}`}
                      data-adequate={c.adequate}
                      className={insetBox()}
                    >
                      <p className="break-words font-medium">
                        {c.name} · {station(c.chainage)}
                      </p>
                      <p className={c.adequate ? 'text-muted-foreground' : 'font-medium text-danger'}>
                        {c.adequate ? 'Capacity carries the modeled peak' : 'Modeled peak exceeds pipe capacity'}
                      </p>
                      <ReadoutGrid
                        className="mt-2"
                        minColumnWidth="100%"
                        items={[
                          { label: 'Peak Q', value: `${n(c.designFlowM3s, 3)} m³/s` },
                          {
                            label: 'Capacity',
                            value: `${n(c.capacityM3s, 3)} m³/s`,
                            tone: c.adequate ? 'default' : 'warning',
                          },
                          { label: 'Catchment D/E (ha)', value: `${n(c.designAreaHa, 2)} / ${n(c.existingAreaHa, 2)}` },
                          {
                            label: 'Diameter / min (m)',
                            value: `${n(c.diameterM, 2)} / ${c.minimumDiameterM === null ? '> 3.0' : n(c.minimumDiameterM, 2)}`,
                          },
                          { label: 'Slope', value: `${n(c.slope * 100, 1)}%${c.slopeAssumed ? ' (assumed)' : ''}` },
                          ...(c.timing
                            ? [
                                {
                                  label: 'Tc · intensity',
                                  value: timingText(c.timing),
                                  tone: c.timing.flags.length ? ('warning' as const) : ('default' as const),
                                },
                              ]
                            : []),
                        ]}
                      />
                    </article>
                  ))}
                </div>
                <div className="hidden md:block">
                  <EngineeringTable>
                    <thead>
                      <tr>
                        <ColumnHeader label="Culvert" className="text-left" />
                        <ColumnHeader label="Catchment" unit="ha design / existing" />
                        <ColumnHeader label="Peak Q" unit="m³/s" />
                        <ColumnHeader label="Capacity" unit="m³/s" />
                        <ColumnHeader label="Slope" unit="%" />
                        <ColumnHeader label="Diameter" unit="m entered / min" />
                        {run.culverts.some((c) => c.timing) && (
                          <ColumnHeader label="Tc · intensity" unit="min · mm/h" className="text-left" />
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {run.culverts.map((c) => (
                        <tr key={c.id} data-adequate={c.adequate}>
                          <td className="text-left">
                            {c.name} · {station(c.chainage)}
                          </td>
                          <td>
                            {n(c.designAreaHa, 2)} / {n(c.existingAreaHa, 2)}
                          </td>
                          <td>{n(c.designFlowM3s, 3)}</td>
                          <td className={c.adequate ? undefined : 'font-medium text-danger'}>{n(c.capacityM3s, 3)}</td>
                          <td title={c.slopeAssumed ? 'Assumed: inverts missing or not falling' : undefined}>
                            {n(c.slope * 100, 1)}
                            {c.slopeAssumed ? '*' : ''}
                          </td>
                          <td>
                            {n(c.diameterM, 2)} / {c.minimumDiameterM === null ? '> 3.0' : n(c.minimumDiameterM, 2)}
                          </td>
                          {run.culverts.some((x) => x.timing) && (
                            <td
                              className={cn('text-left', c.timing?.flags.length && 'text-warning')}
                              title={c.timing?.idf}
                            >
                              {c.timing ? timingText(c.timing) : '—'}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </EngineeringTable>
                </div>
              </>
            ) : (
              <p className="text-muted-foreground">
                This road has no culverts. Add them in the sidebar's culvert inventory.
              </p>
            )}
          </section>
          {run.warnings.length > 0 && (
            <ul className="list-disc pl-4 text-warning">
              {run.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <p className="text-2xs text-muted-foreground" data-testid="road-drainage-cells">
            {n(run.cells)} cells routed at {n(run.cellM, 2)} m within {n(run.settings.bufferM)} m of the road&apos;s
            catch lines, of {n(run.domain.boxCells)} in the box around it; {n(run.changedCells)} changed by the road.
          </p>
          <p className="text-2xs text-muted-foreground">
            Planning estimate, not a hydrotechnical design: surface runoff only, D8 routing, the Rational method{' '}
            {run.culverts.some((c) => c.timing)
              ? 'at each culvert’s Kirpich time of concentration'
              : 'with no time of concentration'}
            , and pipes at full flow (headwater is checked with the culverts). * slope assumed 2 %.
          </p>
        </>
      )}
    </div>
  )
}
