import { useMemo, useState } from 'react'
import { KeyValueRows } from '@/components/ui/map-panels'
import { NumberField } from './Controls'
import { formatRoadStation } from './Charts'
import {
  clearanceStretches,
  DEFAULT_CROSSFALL,
  existingCrossfall,
  LOWBED_EXAMPLE,
  profileK,
  vehicleClearance,
  type LowVehicle,
} from './profileGeometry'
import { RoadSection } from './SidebarParts'
import { designProfileSampler } from './sightDistance'
import type { RoadStation } from './types'
import type { RoadWorkspace } from './useRoadWorkspace'

const n = (value: number, digits = 1) =>
  value.toLocaleString('en-CA', { maximumFractionDigits: digits, minimumFractionDigits: digits })
/** K is read over this much road either side of each station on an existing road. */
const K_WINDOW_M = 40

/** Elevation along the road between calculated stations; null across a station without one. */
function stationProfile(stations: readonly RoadStation[]) {
  return (s: number) => {
    let lo = 0,
      hi = stations.length - 1
    if (hi < 1 || s < stations[0].chainage - 1e-6 || s > stations[hi].chainage + 1e-6) return null
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (stations[mid].chainage <= s) lo = mid
      else hi = mid
    }
    const a = stations[lo].designElevation,
      b = stations[hi].designElevation
    if (a === null || b === null) return null
    const span = stations[hi].chainage - stations[lo].chainage
    return span > 0 ? a + ((b - a) * (s - stations[lo].chainage)) / span : a
  }
}

/**
 * What the road's own profile and surface say: whether a long low vehicle clears its crests and sags,
 * and on a mapped road its existing crossfall and the tightest vertical curves. Computed while open.
 */
export function ProfileGeometryPanel({ workspace }: { workspace: RoadWorkspace }) {
  const { alignment, analysis, setStation } = workspace
  const mapped = !!alignment.mappedRoad
  const [open, setOpen] = useState(false)
  const [vehicle, setVehicle] = useState<LowVehicle>(LOWBED_EXAMPLE)
  const clearance = useMemo(() => {
    if (!open) return null
    const elevationAt = designProfileSampler(alignment, analysis.length) ?? stationProfile(analysis.stations)
    try {
      return { result: vehicleClearance(elevationAt, analysis.length, vehicle), error: null }
    } catch (cause) {
      return { result: null, error: cause instanceof Error ? cause.message : 'Not checked.' }
    }
  }, [open, alignment, analysis, vehicle])
  const existing = useMemo(() => {
    if (!open || !mapped) return null
    const k = profileK(
      analysis.stations.map((s) => ({ chainage: s.chainage, elevation: s.groundElevation })),
      K_WINDOW_M,
    )
    const tightest = (kind: 'crest' | 'sag') =>
      k
        .filter((p) => p.kind === kind && p.k !== null)
        .reduce<(typeof k)[number] | null>((best, p) => (!best || p.k! < best.k! ? p : best), null)
    const crossfall = existingCrossfall(analysis.stations, DEFAULT_CROSSFALL)
    const range = (key: 'leftPercent' | 'rightPercent') => {
      const values = crossfall.map((c) => c[key]).filter((v): v is number => v !== null)
      return values.length ? `${n(Math.min(...values))} to ${n(Math.max(...values))}%` : 'unknown'
    }
    return { crest: tightest('crest'), sag: tightest('sag'), left: range('leftPercent'), right: range('rightPercent') }
  }, [open, mapped, analysis.stations])
  const set = (patch: Partial<LowVehicle>) => setVehicle((v) => ({ ...v, ...patch, name: 'Entered vehicle' }))
  const stretches = useMemo(() => clearanceStretches(clearance?.result?.conflicts ?? []), [clearance])
  return (
    <RoadSection
      title="Vertical clearance"
      summary={`${vehicle.name} · W ${n(vehicle.wheelbaseM)} m`}
      open={open}
      onOpenChange={setOpen}
      help={
        <>
          Drives a long low vehicle along the profile every half metre. Its underside between the axle groups hangs up
          where the road rises above the line joining its tyres raised by the clearance; an overhang scrapes where the
          road rises above that line extended, with clearance growing from nothing at the axle to the overhang&rsquo;s
          end. On a crest this is the textbook W²·r/8 &gt; c. Missing elevation is reported, not passed.
          {mapped && (
            <>
              {' '}
              On a mapped road the section also reads its crossfall at ±3 m from the ground (crown at the centreline,
              smoothed over 9 stations; negative falls away from the centre) and the tightest crest and sag K from a
              least-squares parabola over {K_WINDOW_M} m.
            </>
          )}
        </>
      }
      data-testid="road-vertical-clearance-section"
    >
      <div className="grid grid-cols-2 items-end gap-2">
        <NumberField
          label="Wheelbase (m)"
          value={vehicle.wheelbaseM}
          min={1}
          max={40}
          step={0.5}
          onChange={(v) => set({ wheelbaseM: v })}
        />
        <NumberField
          label="Underside clearance (m)"
          value={vehicle.clearanceM}
          min={0}
          max={2}
          step={0.01}
          onChange={(v) => set({ clearanceM: v })}
        />
        <NumberField
          label="Front overhang (m)"
          value={vehicle.frontOverhangM}
          min={0}
          max={20}
          step={0.5}
          onChange={(v) => set({ frontOverhangM: v })}
        />
        <NumberField
          label="Rear overhang (m)"
          value={vehicle.rearOverhangM}
          min={0}
          max={20}
          step={0.5}
          onChange={(v) => set({ rearOverhangM: v })}
        />
        <NumberField
          label="Overhang end clearance (m)"
          value={vehicle.overhangClearanceM}
          min={0}
          max={3}
          step={0.01}
          onChange={(v) => set({ overhangClearanceM: v })}
        />
      </div>
      {clearance?.error && <p className="text-2xs text-destructive">{clearance.error}</p>}
      {clearance?.result && (
        <p className="text-2xs text-muted-foreground" data-testid="road-vertical-clearance-result">
          {stretches.length
            ? `Touches the road in ${stretches.length} ${stretches.length === 1 ? 'place' : 'places'}; the worst is ${n(stretches[0].depthM, 2)} m deep.`
            : 'Clears the road everywhere it was checked.'}
          {clearance.result.unknownM > 0 ? ` ${n(clearance.result.unknownM, 0)} m not checked: missing elevation.` : ''}
        </p>
      )}
      {stretches.length > 0 && (
        <ul className="space-y-0.5 text-xs">
          {stretches.slice(0, 6).map((stretch) => (
            <li key={`${stretch.fromM}-${stretch.kind}`}>
              <button
                type="button"
                className="tabular-nums text-red-700 underline decoration-dotted underline-offset-2 dark:text-red-400"
                onClick={() => setStation(stretch.worstChainage)}
              >
                {formatRoadStation(stretch.worstChainage)} · {stretch.kind.replace('-', ' ')} {n(stretch.depthM, 2)} m
                {stretch.toM > stretch.fromM ? ` over ${n(stretch.toM - stretch.fromM, 1)} m` : ''}
              </button>
            </li>
          ))}
          {stretches.length > 6 && <li className="text-muted-foreground">and {stretches.length - 6} more</li>}
        </ul>
      )}
      {existing && (
        <KeyValueRows
          variant="grid"
          valueClassName="tabular-nums"
          rows={[
            {
              key: 'crest',
              label: 'Tightest crest',
              value: existing.crest
                ? `K ${n(existing.crest.k!)} at ${formatRoadStation(existing.crest.chainage)}`
                : '—',
            },
            {
              key: 'sag',
              label: 'Tightest sag',
              value: existing.sag ? `K ${n(existing.sag.k!)} at ${formatRoadStation(existing.sag.chainage)}` : '—',
            },
            { key: 'left', label: 'Crossfall left', value: existing.left },
            { key: 'right', label: 'Crossfall right', value: existing.right },
          ]}
        />
      )}
    </RoadSection>
  )
}
