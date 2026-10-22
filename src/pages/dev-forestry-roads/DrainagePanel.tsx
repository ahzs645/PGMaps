import { Button } from '@/components/ui/button'
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { StatGroup } from '@/components/ui/stat-group'
import { NumberField } from './Controls'
import { DEFAULT_DRAINAGE_SETTINGS, type DrainageRun, type DrainageSettings } from './drainageRun'
import { formatRoadStation } from './Charts'

export const DRAINAGE_SETTINGS_KEY = 'pgmaps-road-drainage-settings'
/**
 * The last drainage inputs this browser used. Runs themselves are not stored: they take seconds
 * to recompute and hold tens of megabytes of grids.
 */
export function readDrainageSettings(): DrainageSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(DRAINAGE_SETTINGS_KEY) ?? 'null') as Partial<DrainageSettings> | null
    const merged = { ...DEFAULT_DRAINAGE_SETTINGS, ...saved }
    return Object.values(merged).every((v) => typeof v === 'number' && Number.isFinite(v) && v > 0)
      ? merged
      : DEFAULT_DRAINAGE_SETTINGS
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
}: {
  run: DrainageRun | null
  stale: boolean
  settings: DrainageSettings
  onSettings: (settings: DrainageSettings) => void
  onRun: () => void
  busy: boolean
  onStation: (chainage: number) => void
}) {
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
      {!run && (
        <p className="text-muted-foreground">
          Burns the road prism and its culverts into the terrain, then routes flow (filled depressions, D8) on the
          existing ground and on that design surface. Streams the road turns, ditch low points without a culvert and new
          ponding then show on the plan.
        </p>
      )}
      {run && (
        <>
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
