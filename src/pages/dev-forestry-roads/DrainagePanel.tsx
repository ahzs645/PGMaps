import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { AppSelect } from '@/components/ui/select'
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { StatGroup } from '@/components/ui/stat-group'
import { ReadoutGrid } from '@/components/ui/readout-grid'
import { NumberField } from './Controls'
import { DEFAULT_DRAINAGE_SETTINGS, type DrainageRun, type DrainageSettings } from './drainageRun'
import { formatRoadStation } from './Charts'
import { parseDrainageSettings, type DrainageEvidence } from './drainageEvidence'
import type { PourPoint } from './drainageCatchments'

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

/**
 * Flow on the existing ground against flow on the design surface: streams the road carries along
 * its ditches, ditch low points with no culvert, new ponding, and a Rational-method pipe check.
 */
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
  onPickPourPoint?: (options: Pick<PourPoint, 'surface' | 'snapRadiusM'>) => void
  pourPointPicking?: boolean
  watershedMinAreaHa?: number
  onWatershedMinAreaChange?: (minimumAreaHa: number | undefined) => void
  evidence?: DrainageEvidence
  onExport?: (kind: 'geojson' | 'evidence') => void
}) {
  const [pointOptions, setPointOptions] = useState<Pick<PourPoint, 'surface' | 'snapRadiusM'>>({
    surface: 'design',
    snapRadiusM: 10,
  })
  const pointSurface = pourPoint?.surface ?? pointOptions.surface
  const pointRadius = pourPoint?.snapRadiusM ?? pointOptions.snapRadiusM
  const setPointOptionsAndApply = (patch: Partial<Pick<PourPoint, 'surface' | 'snapRadiusM'>>) => {
    setPointOptions({ surface: pointSurface, snapRadiusM: pointRadius, ...patch })
    if (pourPoint) onPourPointChange?.({ ...pourPoint, ...patch })
  }
  const set = (patch: Partial<DrainageSettings>) => onSettings({ ...settings, ...patch })
  const redirected = run?.crossings.filter((c) => c.redirected && !c.throughCulvertId) ?? []
  const uncovered = run?.lowPoints.filter((p) => !p.throughCulvert) ?? []
  const undersized = run?.culverts.filter((c) => !c.adequate) ?? []
  const station = (chainage: number) => (
    <button className="underline" onClick={() => onStation(chainage)}>
      {formatRoadStation(chainage)}
    </button>
  )
  return (
    <div className="h-full space-y-3 overflow-auto text-xs" data-testid="road-drainage">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2">
        <NumberField
          label="Rainfall (mm/h)"
          value={settings.rainfallMmPerHr}
          min={1}
          max={500}
          step={1}
          onChange={(v) => set({ rainfallMmPerHr: v })}
        />
        <NumberField
          label="Runoff C"
          value={settings.runoffCoefficient}
          min={0.05}
          max={1}
          step={0.05}
          onChange={(v) => set({ runoffCoefficient: v })}
        />
        <NumberField
          label="Pipe Manning n"
          value={settings.manningN}
          min={0.009}
          max={0.05}
          step={0.001}
          onChange={(v) => set({ manningN: v })}
        />
        <NumberField
          label="Stream from (ha)"
          value={settings.streamThresholdHa}
          min={0.05}
          max={500}
          step={0.1}
          onChange={(v) => set({ streamThresholdHa: v })}
        />
        <NumberField
          label="Upslope buffer (m)"
          value={settings.bufferM}
          min={20}
          max={2000}
          step={10}
          onChange={(v) => set({ bufferM: v })}
        />
        <div className="flex items-end">
          <Button size="sm" className="w-full" disabled={busy} onClick={onRun}>
            {run ? 'Re-run drainage' : 'Run drainage check'}
          </Button>
        </div>
      </div>
      {onPickPourPoint && (
        <section className="space-y-2 rounded-md border p-2" aria-label="Catchment and watershed tools">
          <h3 className="font-medium">Drain to a point</h3>
          <p className="text-muted-foreground">
            Choose a point on the plan. Snapping selects the greatest contributing area within the entered distance.
          </p>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] items-end gap-2">
            <label className="space-y-1">
              <span className="block">Catchment surface</span>
              <AppSelect
                value={pointSurface}
                onValueChange={(surface) => setPointOptionsAndApply({ surface: surface as PourPoint['surface'] })}
                options={[
                  { value: 'existing', label: 'Existing ground' },
                  { value: 'design', label: 'Design surface' },
                ]}
                triggerAriaLabel="Catchment surface"
                triggerClassName="h-9 w-full text-xs"
              />
            </label>
            <NumberField
              label="Pour-point snap (m)"
              value={pointRadius}
              min={0}
              max={2000}
              step={1}
              onChange={(snapRadiusM) => setPointOptionsAndApply({ snapRadiusM })}
            />
            <Button
              size="sm"
              className="h-auto min-h-9 min-w-0 whitespace-normal py-2 touch:min-h-10"
              variant={pourPointPicking ? 'default' : 'outline'}
              disabled={busy}
              onClick={() => onPickPourPoint({ surface: pointSurface, snapRadiusM: pointRadius })}
            >
              {pourPointPicking
                ? 'Cancel point selection'
                : pourPoint
                  ? 'Move pour point on plan'
                  : 'Select pour point on plan'}
            </Button>
          </div>
          {pourPointPicking && <p role="status">Tap a terrain location on the plan to set the pour point.</p>}
          {pourPoint && onPourPointChange && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <NumberField
                  label="Pour-point longitude"
                  value={pourPoint.coordinate[0]}
                  min={-180}
                  max={180}
                  step={0.00001}
                  onChange={(lon) => onPourPointChange({ ...pourPoint, coordinate: [lon, pourPoint.coordinate[1]] })}
                />
                <NumberField
                  label="Pour-point latitude"
                  value={pourPoint.coordinate[1]}
                  min={-84.99999}
                  max={84.99999}
                  step={0.00001}
                  onChange={(lat) => onPourPointChange({ ...pourPoint, coordinate: [pourPoint.coordinate[0], lat] })}
                />
              </div>
              <Button size="sm" variant="ghost" className="touch:min-h-10" onClick={() => onPourPointChange(undefined)}>
                Remove pour point
              </Button>
            </>
          )}
          {onWatershedMinAreaChange && (
            <div className="space-y-2 border-t pt-2">
              <label className="flex min-h-10 items-center gap-2">
                <input
                  type="checkbox"
                  aria-label="Delineate watershed polygons"
                  checked={watershedMinAreaHa !== undefined}
                  onChange={(event) => onWatershedMinAreaChange(event.target.checked ? 0.4 : undefined)}
                />
                Delineate watershed polygons
              </label>
              {watershedMinAreaHa !== undefined && (
                <NumberField
                  label="Minimum watershed (ha)"
                  value={watershedMinAreaHa}
                  min={0.01}
                  max={100000}
                  step={0.1}
                  onChange={onWatershedMinAreaChange}
                />
              )}
              <p className="text-muted-foreground">
                Partitions the pour-point surface, or design surface when no point is selected, by its sampled D8
                outlets. Catchments touching the sample edge or missing terrain may be incomplete.
              </p>
            </div>
          )}
          {(pourPoint || watershedMinAreaHa !== undefined) && (
            <p className="text-muted-foreground">Run drainage after changing point, surface or watershed settings.</p>
          )}
        </section>
      )}
      {evidence && !run && (
        <section className="space-y-2 rounded-md border p-2" aria-label="Saved drainage evidence">
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
            <p role="status" className="text-amber-800 dark:text-amber-300">
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
      {!run && (
        <p className="text-muted-foreground">
          Burns the road prism and its culverts into the terrain, then routes flow (filled depressions, D8) on the
          existing ground and on that design surface. Streams the road turns, ditch low points without a culvert and new
          ponding then show on the plan.
        </p>
      )}
      {run && (
        <>
          <p className="text-muted-foreground">
            Select a station to inspect it on the plan. Enter known or proposed culverts in Engineering → Drainage, then
            re-run to check whether flow reaches them.
          </p>
          {stale && (
            <p role="status" className="rounded border border-amber-300 bg-amber-50 p-2 text-amber-900">
              The road, its culverts, the road settings, the terrain or these inputs changed since this run. It is not
              drawn on the plan until you re-run it.
            </p>
          )}
          <StatGroup
            variant="tiles"
            size="sm"
            columns={5}
            items={[
              { label: 'Crossings', value: n(run.crossings.length) },
              { label: 'Redirected', value: n(redirected.length) },
              { label: 'Cross-drains', value: n(uncovered.length) },
              { label: 'New ponding', value: `${n(run.newPonding.areaM2)} m²` },
              { label: 'Undersized', value: `${n(undersized.length)} of ${n(run.culverts.length)}` },
            ]}
          />
          {run.catchment && (
            <section className="space-y-2 rounded-md border p-2" aria-label="Selected catchment">
              <h3 className="font-medium">Selected catchment · {run.catchment.feature.properties.surface}</h3>
              <ReadoutGrid
                minColumnWidth="8rem"
                items={[
                  { label: 'Area', value: `${n(run.catchment.feature.properties.areaHa, 3)} ha` },
                  { label: 'Supported cells', value: n(run.catchment.feature.properties.cells) },
                  { label: 'Snap distance', value: `${n(run.catchment.snappedDistanceM, 1)} m` },
                ]}
              />
              <p
                className={
                  run.catchment.feature.properties.truncated
                    ? 'text-amber-800 dark:text-amber-300'
                    : 'text-muted-foreground'
                }
              >
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
                        <td className={bad ? 'font-medium text-red-700 dark:text-red-400' : undefined}>
                          {n(c.divertedM)}
                        </td>
                        <td className="text-left">
                          {c.throughCulvertId
                            ? 'Passes through'
                            : c.culvertId
                              ? 'Nearby, bypassed'
                              : bad
                                ? 'None: road redirects it'
                                : 'None'}
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
          <section aria-label="Ditch low points">
            <h3 className="mb-1 font-medium">Ditch low points and outlets</h3>
            {run.lowPoints.length ? (
              <EngineeringTable>
                <thead>
                  <tr>
                    <ColumnHeader label="Station" className="text-left" />
                    <ColumnHeader label="Side" />
                    <ColumnHeader label="Kind" />
                    <ColumnHeader label="Draining" unit="ha" />
                    <ColumnHeader label="Depth" unit="m" />
                    <ColumnHeader label="Culvert" className="text-left" />
                  </tr>
                </thead>
                <tbody>
                  {run.lowPoints.map((p) => (
                    <tr key={p.id}>
                      <td className="text-left">{station(p.chainage)}</td>
                      <td>{p.side}</td>
                      <td>{p.kind === 'pond' ? 'ponds' : 'leaves prism'}</td>
                      <td>{n(p.areaHa, 2)}</td>
                      <td>{p.kind === 'pond' ? n(p.depthM, 2) : '—'}</td>
                      <td className="text-left">{p.throughCulvert ? 'Through culvert' : 'Cross-drain candidate'}</td>
                    </tr>
                  ))}
                </tbody>
              </EngineeringTable>
            ) : (
              <p className="text-muted-foreground">No ditch collects more than 0.05 ha.</p>
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
                      className="rounded-md border p-2"
                    >
                      <p className="break-words font-medium">
                        {c.name} · {station(c.chainage)}
                      </p>
                      <p
                        className={c.adequate ? 'text-muted-foreground' : 'font-medium text-red-700 dark:text-red-400'}
                      >
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
                          <td className={c.adequate ? undefined : 'font-medium text-red-700 dark:text-red-400'}>
                            {n(c.capacityM3s, 3)}
                          </td>
                          <td title={c.slopeAssumed ? 'Assumed: inverts missing or not falling' : undefined}>
                            {n(c.slope * 100, 1)}
                            {c.slopeAssumed ? '*' : ''}
                          </td>
                          <td>
                            {n(c.diameterM, 2)} / {c.minimumDiameterM === null ? '> 3.0' : n(c.minimumDiameterM, 2)}
                          </td>
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
            <ul className="list-disc pl-4 text-amber-800 dark:text-amber-300">
              {run.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-muted-foreground">
            {n(run.cells)} cells at {n(run.cellM, 2)} m; {n(run.changedCells)} changed by the road. Planning estimate,
            not a hydrotechnical design: surface runoff only, D8 routing, the Rational method with no time of
            concentration, and pipes at full flow without inlet control. * slope assumed 2 %.
          </p>
        </>
      )}
    </div>
  )
}
