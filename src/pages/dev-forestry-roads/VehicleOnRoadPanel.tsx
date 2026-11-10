import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { formatRoadStation } from './Charts'
import { NumberField, roadFieldClass, RoadSelect } from './Controls'
import { runCooperatively } from './cooperative'
import { TraceEditor, tracesFor } from './TraceEditor'
import type { Alignment, VehicleCheck } from './types'
import { steerText } from './vehicleKinematics'
import { roadTraceSteps, vehicleAtStation, type RoadTrace, type VehicleAtStation } from './vehicleOnRoad'
import type { TracePoint } from './vehiclePath'
import { featureCollection, outlineFeatures } from './vehicleTools'

const m = (value: number) => `${value.toFixed(2)} m`
/** Pinned footprints kept on the plan. */
const MAX_PINS = 6

export const vehicleLabel = (at: Pick<VehicleAtStation, 'steerSignedDegrees' | 'articulation'>) =>
  `Steer ${steerText(at.steerSignedDegrees)}${at.articulation.length ? ` · articulation ${Math.max(...at.articulation.map(Math.abs)).toFixed(0)}°` : ''}`

/**
 * The design vehicle drawn at a chosen station of the road, stepped a metre at a time, with
 * pinned snapshots, and traces of chosen points on it along the road.
 */
export function VehicleOnRoadPanel({
  alignment,
  check,
  focusStation,
  onStation,
  onOverlay,
  showOnPlan,
}: {
  alignment: Alignment
  check: VehicleCheck
  /** A station another control asked to show the vehicle at (a turn's worst station). */
  focusStation: { station: number; direction: 'up' | 'down' } | null
  onStation: (chainage: number) => void
  onOverlay: (overlay: GeoJSON.FeatureCollection | null) => void
  showOnPlan: boolean
}) {
  const { vehicle } = check
  const [show, setShow] = useState(false)
  const [station, setStation] = useState(0)
  const [direction, setDirection] = useState<'up' | 'down'>(check.direction === 'down' ? 'down' : 'up')
  const [pins, setPins] = useState<VehicleAtStation[]>([])
  const [traces, setTraces] = useState<TracePoint[]>([])
  const [lastFocus, setLastFocus] = useState(focusStation)
  // A turn's "worst station" button shows the vehicle there.
  if (focusStation !== lastFocus) {
    setLastFocus(focusStation)
    if (focusStation) {
      setShow(true)
      setStation(focusStation.station)
      setDirection(focusStation.direction)
    }
  }
  const at = useMemo(() => {
    if (!show) return { value: null, error: '' }
    try {
      return { value: vehicleAtStation(alignment, vehicle, station, direction), error: '' }
    } catch (cause) {
      return { value: null, error: cause instanceof Error ? cause.message : 'The vehicle cannot be placed there.' }
    }
  }, [show, alignment, vehicle, station, direction])
  const active = useMemo(() => tracesFor(vehicle, traces), [vehicle, traces])
  const traceInputs = useMemo(
    () => ({ alignment, vehicle, direction, points: active }),
    [alignment, vehicle, direction, active],
  )
  const [traced, setTraced] = useState<{ inputs: typeof traceInputs; results: RoadTrace[]; error: string } | null>(null)
  useEffect(() => {
    if (!traceInputs.points.length) return
    const controller = new AbortController()
    const { alignment: road, vehicle: v, direction: d, points } = traceInputs
    runCooperatively(roadTraceSteps(road, v, d, points), { signal: controller.signal })
      .then((results) => setTraced({ inputs: traceInputs, results, error: '' }))
      .catch((cause) => {
        if (!controller.signal.aborted)
          setTraced({
            inputs: traceInputs,
            results: [],
            error: cause instanceof Error ? cause.message : 'Trace failed.',
          })
      })
    return () => controller.abort()
  }, [traceInputs])
  // Results are shown only for the inputs they were traced from.
  const current = traceInputs.points.length && traced?.inputs === traceInputs ? traced : null
  const tracing = traceInputs.points.length > 0 && !current
  const traceResults = useMemo(() => current?.results ?? [], [current])
  const traceError = current?.error ?? ''
  useEffect(() => {
    if (!showOnPlan) {
      onOverlay(null)
      return
    }
    const features: GeoJSON.Feature[] = []
    for (const pin of pins)
      features.push(
        ...outlineFeatures(
          pin.outline,
          (p) => pin.toCoordinate(p[0], p[1]),
          `Pinned at ${formatRoadStation(pin.station)}`,
          true,
        ),
      )
    if (at.value) {
      const v = at.value
      features.push(...outlineFeatures(v.outline, (p) => v.toCoordinate(p[0], p[1]), vehicleLabel(v)))
    }
    for (const t of traceResults)
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: t.coordinates },
        properties: { role: 'vehicle-trace', color: '#0891b2', label: `Trace: ${t.label}` },
      })
    onOverlay(features.length ? featureCollection(features) : null)
  }, [showOnPlan, pins, at, traceResults, onOverlay])
  useEffect(() => () => onOverlay(null), [onOverlay])
  const step = (by: number) => {
    setShow(true)
    setStation((s) => Math.max(0, s + by))
  }
  return (
    <details className="rounded-md border" data-testid="road-vehicle-at-station">
      <summary className="cursor-pointer p-2 font-medium">
        Vehicle at a station{' '}
        <span className="font-normal text-muted-foreground">
          · {at.value ? `${formatRoadStation(at.value.station)} · ${vehicleLabel(at.value)}` : 'hidden'}
          {active.length ? ` · ${active.length} trace${active.length === 1 ? '' : 's'}` : ''}
        </span>
      </summary>
      <div className="space-y-2 border-t p-2">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
          Show the vehicle
        </label>
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Steer axle at station (m)"
            value={station}
            min={0}
            max={100000}
            step={1}
            onChange={(value) => {
              setShow(true)
              setStation(value)
            }}
            hint="The vehicle is placed with its steer axle exactly here, having driven from the road’s start (or end)."
          />
          <RoadSelect
            className={`${roadFieldClass} self-end`}
            ariaLabel="Vehicle travel direction at the station"
            value={direction}
            onValueChange={(value) => setDirection(value as 'up' | 'down')}
          >
            <option value="up">Up-station</option>
            <option value="down">Down-station</option>
          </RoadSelect>
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" aria-label="Back 1 m" onClick={() => step(direction === 'up' ? -1 : 1)}>
            ◀ 1 m
          </Button>
          <Button size="sm" variant="outline" aria-label="Ahead 1 m" onClick={() => step(direction === 'up' ? 1 : -1)}>
            1 m ▶
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!at.value}
            onClick={() => at.value && setPins((p) => [...p, at.value!].slice(-MAX_PINS))}
          >
            Pin
          </Button>
          {!!pins.length && (
            <Button size="sm" variant="ghost" onClick={() => setPins([])}>
              Clear {pins.length} pinned
            </Button>
          )}
        </div>
        {at.value && (
          <p className="font-mono text-2xs tabular-nums" data-testid="road-vehicle-label">
            {formatRoadStation(at.value.station)} · {vehicleLabel(at.value)}{' '}
            <button type="button" className="underline underline-offset-2" onClick={() => onStation(at.value!.station)}>
              Go to station
            </button>
          </p>
        )}
        {at.error && <p className="text-destructive">{at.error}</p>}
        <h4 className="text-2xs font-medium">Trace points along the road</h4>
        <TraceEditor vehicle={vehicle} traces={active} onChange={setTraces} />
        {tracing && <p className="text-2xs text-muted-foreground">Tracing…</p>}
        {traceError && <p className="text-destructive">{traceError}</p>}
        {!!traceResults.length && (
          <ul className="space-y-1" aria-label="Traced points">
            {traceResults.map((t) => (
              <li key={t.label} className="rounded border p-1.5 text-2xs" data-testid="road-vehicle-trace">
                <p className="font-medium">{t.label}</p>
                <p className="font-mono tabular-nums">
                  Widest left {m(t.leftM)} at {formatRoadStation(t.leftStation)} · right {m(t.rightM)} at{' '}
                  {formatRoadStation(t.rightStation)}
                </p>
                <p className={t.beyondStation === null ? 'text-muted-foreground' : 'text-red-700 dark:text-red-300'}>
                  {t.beyondStation === null
                    ? 'Stays over the formation.'
                    : `Past the formation edge by ${m(Math.max(t.beyondLeftM, t.beyondRightM))} at ${formatRoadStation(t.beyondStation)}.`}
                </p>
              </li>
            ))}
          </ul>
        )}
        <p className="text-2xs text-muted-foreground">
          Pinned footprints and traces are view settings and are not saved. A trace past the formation edge is reported,
          not required to fit: a mirror or log tip may pass over a fill shoulder but strike a cut bank or a tree.
        </p>
      </div>
    </details>
  )
}
