import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { downloadText } from '@/lib/download'
import { NumberField, OptionalNumberField, roadFieldClass, RoadSelect } from './Controls'
import { runCooperatively } from './cooperative'
import { localFrame } from './junctionTurn'
import { TraceEditor, tracesFor } from './TraceEditor'
import {
  loopTurnaroundFit,
  placeTemplate,
  turningTemplate,
  type TurnaroundFit,
  type TurningTemplate,
} from './turningTemplate'
import type { Alignment, Coordinate, DesignVehicle } from './types'
import { articulationDegrees, steerText, vehicleOutline, type XY } from './vehicleKinematics'
import {
  defaultFilletRadius,
  DRIVE_LIMITS,
  DRIVE_PATH_BASIS,
  driveSteps,
  type DriveProgress,
  type DriveResult,
  type MultiPolygon,
  type TracePoint,
} from './vehiclePath'
import {
  areaPolygon,
  bounds,
  featureCollection,
  featuresToKml,
  formationFootprint,
  lineFeature,
  outlineFeatures,
  polygonFeatures,
  simplifyPath,
  SKETCH_SIMPLIFY_M,
  type VehicleToolSource,
} from './vehicleTools'

const m = (value: number) => `${value.toFixed(2)} m`
const m2 = (value: number) => `${value.toLocaleString('en-CA', { maximumFractionDigits: 1 })} m²`
const at = (s: number) => `${s.toFixed(1)} m along`

/** A path handed over by another tool, such as a junction turn. */
export interface DrivenPath {
  label: string
  coordinates: Coordinate[]
  filletRadiusM: number
}

type Frame = ReturnType<typeof localFrame>
/** `vehicleKey` is the vehicle it was driven with, as JSON: its poses fit no other vehicle. */
export type DriveRun = { result: DriveResult; frame: Frame; label: string; vehicleKey: string }

/**
 * Drive the design vehicle along a drawn line, an imported line or a junction turn, and place its
 * steady-state turning template on a pin or a landing. Results are view settings: nothing here is
 * saved with the project.
 */
export function DrivePathPanel({
  vehicle,
  clearanceM,
  alignments,
  sources,
  external,
  onOverlay,
  showOnPlan,
}: {
  vehicle: DesignVehicle
  clearanceM: number
  alignments: Alignment[]
  sources: VehicleToolSource[]
  external: DrivenPath | null
  onOverlay: (overlay: GeoJSON.FeatureCollection | null) => void
  showOnPlan: boolean
}) {
  // Stable lists: the plan overlay effect below depends on what is built from them.
  const paths = useMemo(() => sources.filter((s) => s.kind === 'path'), [sources])
  const areas = useMemo(() => sources.filter((s) => s.kind === 'area'), [sources])
  const places = useMemo(() => sources.filter((s) => s.kind === 'point' || s.kind === 'area'), [sources])
  const [open, setOpen] = useState(false)
  const [sourceId, setSourceId] = useState('')
  const [fillet, setFillet] = useState<number | null>(null)
  const [bearing, setBearing] = useState<number | null>(null)
  const [reverse, setReverse] = useState(false)
  const [footprintIds, setFootprintIds] = useState<string[]>([])
  const [includeRoads, setIncludeRoads] = useState(true)
  const [traces, setTraces] = useState<TracePoint[]>([])
  const [lastRun, setRun] = useState<DriveRun | null>(null)
  // A run is shown only with the vehicle it was driven with. Drawn with another (a unit added, a
  // load removed), the outline reads poses the run does not have.
  const vehicleKey = useMemo(() => JSON.stringify(vehicle), [vehicle])
  const run = lastRun?.vehicleKey === vehicleKey ? lastRun : null
  const [progress, setProgress] = useState<DriveProgress | null>(null)
  const [error, setError] = useState('')
  const [index, setIndex] = useState(0)
  const controller = useRef<AbortController | null>(null)
  const [lastExternal, setLastExternal] = useState(external)
  if (external !== lastExternal) {
    setLastExternal(external)
    if (external) {
      setOpen(true)
      setSourceId('external')
      setFillet(external.filletRadiusM)
      setRun(null)
    }
  }
  const chosen: { label: string; coordinates: Coordinate[]; freehand?: boolean; fillet?: number } | null =
    sourceId === 'external' && external
      ? { label: external.label, coordinates: external.coordinates, fillet: external.filletRadiusM }
      : (paths.find((p) => p.id === sourceId) ?? null)
  const filletRadiusM = fillet ?? chosen?.fillet ?? defaultFilletRadius(vehicle)
  useEffect(() => () => controller.current?.abort(), [])

  const drive = async () => {
    if (!chosen) return
    controller.current?.abort()
    const abort = new AbortController()
    controller.current = abort
    setError('')
    setRun(null)
    try {
      const coordinates = reverse ? [...chosen.coordinates].reverse() : chosen.coordinates
      const frame = localFrame(coordinates[0])
      let path: XY[] = coordinates.map(frame.toLocal)
      if (chosen.freehand) path = simplifyPath(path, SKETCH_SIMPLIFY_M)
      const footprint: MultiPolygon = areas
        .filter((a) => footprintIds.includes(a.id))
        .flatMap((a) => areaPolygon(a, frame.toLocal))
      if (includeRoads && footprint.length + alignments.length)
        footprint.push(...formationFootprint(alignments, frame.toLocal, bounds(path)))
      const result = await runCooperatively(
        driveSteps({
          path,
          filletRadiusM,
          vehicle,
          startBearingDeg: bearing,
          traces: tracesFor(vehicle, traces),
          footprint,
          clearanceM,
        }),
        { signal: abort.signal, onProgress: setProgress },
      )
      setRun({ result, frame, label: chosen.label, vehicleKey })
      setIndex(result.positions.length - 1)
    } catch (cause) {
      if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : 'The path could not be driven.')
    } finally {
      if (controller.current === abort) {
        controller.current = null
        setProgress(null)
      }
    }
  }

  // Turning template on a pin or a drawn area.
  const [templateAt, setTemplateAt] = useState('')
  const [side, setSide] = useState<'left' | 'right'>('left')
  const [templateRadius, setTemplateRadius] = useState<number | null>(null)
  const template = useMemo(() => {
    const place = places.find((p) => p.id === templateAt)
    if (!place) return null
    try {
      const t = turningTemplate(vehicle, { steerRadiusM: templateRadius, side, clearanceM })
      const frame = localFrame(place.coordinates[0])
      let fit: TurnaroundFit | null = null
      let centre: XY = [0, 0]
      if (place.kind === 'area') {
        fit = loopTurnaroundFit(t, areaPolygon(place, frame.toLocal))
        if (fit.disc) centre = fit.disc.centre
      }
      return { template: t, fit, frame, centre, label: place.label, error: '' }
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : 'The template could not be drawn.' }
    }
  }, [places, templateAt, vehicle, templateRadius, side, clearanceM])

  const runFeatures = useMemo(() => (run ? driveFeatures(run, vehicle, index) : []), [run, vehicle, index])
  useEffect(() => {
    const features: GeoJSON.Feature[] = []
    if (open && showOnPlan) {
      features.push(...runFeatures)
      if (template && 'template' in template && template.template)
        features.push(...templateFeatures(template.template, template.frame, template.centre))
    }
    onOverlay(features.length ? featureCollection(features) : null)
  }, [open, showOnPlan, runFeatures, template, onOverlay])
  useEffect(() => () => onOverlay(null), [onOverlay])

  const result = run?.result
  const position = result?.positions[Math.min(index, result.positions.length - 1)]
  const fp = result?.footprint
  return (
    <details
      className="rounded-md border"
      data-testid="road-drive-path"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer p-2 font-medium">
        Drive a path & turnarounds{' '}
        <span className="font-normal text-muted-foreground">
          ·{' '}
          {result
            ? `${m2(result.sweptAreaM2)} swept${fp ? (fp.wheelsFit ? ' · wheels fit' : ' · wheels off') : ''}${result.lockExceeded ? ' · beyond lock' : ''}`
            : 'landings, pull-outs, junctions'}
        </span>
      </summary>
      <div className="space-y-2 border-t p-2">
        <RoadSelect
          className={roadFieldClass}
          ariaLabel="Path to drive"
          value={sourceId}
          placeholder={paths.length || external ? 'Choose a path…' : 'Draw a line on the plan first'}
          disabled={!paths.length && !external}
          onValueChange={(value) => {
            setSourceId(value)
            setFillet(null)
            setRun(null)
          }}
        >
          {external && <option value="external">{external.label}</option>}
          {paths.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </RoadSelect>
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Corner fillet radius (m)"
            value={filletRadiusM}
            min={DRIVE_LIMITS.filletRadiusM[0]}
            max={DRIVE_LIMITS.filletRadiusM[1]}
            step={0.5}
            onChange={setFillet}
            hint="Radius of the arc the steer axle takes round each corner of the line. It starts at the vehicle’s steady minimum at its lock, rounded up to 0.5 m; 0 keeps the corners sharp, where the steering jumps."
          />
          <OptionalNumberField
            label="Parked heading (°)"
            value={bearing}
            min={DRIVE_LIMITS.startBearingDeg[0]}
            max={DRIVE_LIMITS.startBearingDeg[1]}
            step={1}
            placeholder="along the path"
            onChange={setBearing}
            hint="Bearing, clockwise from north, the vehicle is parked on at the start; every unit starts straight on it. Blank starts it along the path."
          />
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={reverse} onChange={(e) => setReverse(e.target.checked)} />
          Drive the line from its other end
        </label>
        {!!areas.length && (
          <fieldset className="space-y-1 rounded-md border p-2">
            <legend className="px-1 text-2xs font-medium">Stay on</legend>
            {areas.map((a) => (
              <label key={a.id} className="flex items-center gap-2 text-2xs">
                <input
                  type="checkbox"
                  checked={footprintIds.includes(a.id)}
                  onChange={(e) =>
                    setFootprintIds((ids) => (e.target.checked ? [...ids, a.id] : ids.filter((id) => id !== a.id)))
                  }
                />
                {a.label}
              </label>
            ))}
          </fieldset>
        )}
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={includeRoads} onChange={(e) => setIncludeRoads(e.target.checked)} />
          Count the design roads’ formations as room to drive
        </label>
        <TraceEditor vehicle={vehicle} traces={tracesFor(vehicle, traces)} onChange={setTraces} />
        <div className="flex gap-1">
          <Button size="sm" className="flex-1" disabled={!chosen || !!progress} onClick={drive}>
            {progress ? `Driving… ${progress.phase}` : 'Drive the path'}
          </Button>
          {progress && (
            <Button size="sm" variant="outline" onClick={() => controller.current?.abort()}>
              Cancel
            </Button>
          )}
        </div>
        {error && <p className="text-destructive">{error}</p>}
        {result && (
          <div className="space-y-1.5 rounded-md border p-2 text-2xs" data-testid="road-drive-result">
            <p className="font-medium">{run!.label}</p>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
              {(
                [
                  ['Length', m(result.lengthM)],
                  ['Largest steering', `${steerText(result.maxSteer.degrees)} at ${at(result.maxSteer.s)}`],
                  [
                    'Steering lock',
                    result.lockExceeded === null
                      ? 'not entered'
                      : result.lockExceeded
                        ? `exceeded on ${result.lockRuns.length} stretch${result.lockRuns.length === 1 ? '' : 'es'}`
                        : `within ${vehicle.steeringLockDeg}°`,
                  ],
                  ['Offtracking', `${m(result.maxOfftrackingM)} at ${at(result.offtrackingS)}`],
                  ['Articulation', `${result.maxArticulationDeg.toFixed(0)}°`],
                  ['Swept area', m2(result.sweptAreaM2)],
                  ['Wheel area', m2(result.wheelAreaM2)],
                  ...(fp
                    ? ([
                        ['Wheels', fp.wheelsFit ? 'stay on' : `${m(fp.wheelShortfallM)} off`],
                        ['Body past edge', m(fp.bodyBeyondM)],
                        ['Swept outside', m2(fp.bodyOutsideM2)],
                      ] as [string, string][])
                    : []),
                ] as [string, string][]
              ).map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <dt className="text-3xs text-muted-foreground">{label}</dt>
                  <dd className="break-words font-mono tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            {result.lockRuns.map((r) => (
              <p key={r.startS} className="text-danger">
                Beyond the lock from {r.startS.toFixed(1)} to {r.endS.toFixed(1)} m: {steerText(r.maxSteerDeg)}
              </p>
            ))}
            {!fp && (
              <p className="text-muted-foreground">No footprint chosen: the swept area is not compared with any.</p>
            )}
            {result.warnings.map((w) => (
              <p key={w} className="border-l-2 border-amber-500 pl-2 text-warning">
                {w}
              </p>
            ))}
            {position && (
              <label className="block">
                <span className="text-muted-foreground">
                  Vehicle at {at(position.s)} · Steer {steerText(position.pose.steerSignedDegrees)}
                  {position.articulation.length
                    ? ` · articulation ${Math.max(...articulationDegrees(position.pose).map(Math.abs)).toFixed(0)}°`
                    : ''}
                </span>
                <input
                  type="range"
                  className="w-full"
                  aria-label="Vehicle position along the path"
                  min={0}
                  max={result.positions.length - 1}
                  value={Math.min(index, result.positions.length - 1)}
                  onChange={(e) => setIndex(Number(e.target.value))}
                />
              </label>
            )}
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                onClick={() =>
                  downloadText(
                    JSON.stringify(featureCollection(driveFeatures(run!, vehicle, null)), null, 2) + '\n',
                    'swept-path.geojson',
                    'application/geo+json',
                  )
                }
              >
                GeoJSON
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                onClick={() =>
                  downloadText(
                    featuresToKml(`${vehicle.name} on ${run!.label}`, driveFeatures(run!, vehicle, null)),
                    'swept-path.kml',
                    'application/vnd.google-earth.kml+xml',
                  )
                }
              >
                KML
              </Button>
            </div>
          </div>
        )}
        <h4 className="text-2xs font-medium">
          Turning template{' '}
          <InfoTip label="About the turning template" bubbleClassName="w-80">
            The vehicle after it has driven long enough on a circle that nothing changes: every axle group moves square
            to its radius. It sweeps an annulus from the innermost wheel to the outermost corner of the body. On a drawn
            area the template is centred in the largest circle the area holds, and a loop turnaround fits when that
            circle’s radius is at least the outer body radius plus the wheel clearance. Entry and exit are not included:
            drive a path for those.
          </InfoTip>
        </h4>
        <div className="grid grid-cols-2 gap-2">
          <RoadSelect
            className={`${roadFieldClass} col-span-2`}
            ariaLabel="Where to place the turning template"
            value={templateAt}
            placeholder={places.length ? 'Place on a pin or an area…' : 'Drop a pin or draw an area first'}
            disabled={!places.length}
            onValueChange={setTemplateAt}
          >
            {places.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </RoadSelect>
          <OptionalNumberField
            label="Steer radius (m)"
            value={templateRadius}
            min={3}
            max={200}
            step={0.5}
            placeholder="at the lock"
            onChange={setTemplateRadius}
          />
          <RoadSelect
            className={`${roadFieldClass} self-end`}
            ariaLabel="Turning side"
            value={side}
            onValueChange={(value) => setSide(value as 'left' | 'right')}
          >
            <option value="left">Turning left</option>
            <option value="right">Turning right</option>
          </RoadSelect>
        </div>
        {template && 'error' in template && template.error && <p className="text-destructive">{template.error}</p>}
        {template && 'template' in template && template.template && (
          <TemplateSummary template={template.template} fit={template.fit} />
        )}
        <InfoTip label="How a path is driven" showLabel bubbleClassName="w-96">
          {DRIVE_PATH_BASIS}
        </InfoTip>
      </div>
    </details>
  )
}

function TemplateSummary({ template: t, fit }: { template: TurningTemplate; fit: TurnaroundFit | null }) {
  return (
    <div className="space-y-1 rounded-md border p-2 text-2xs" data-testid="road-turning-template">
      {fit && (
        <p className={`font-medium ${fit.fits ? 'text-success' : 'text-danger'}`} data-fits={fit.fits}>
          {fit.fits
            ? `Loop turnaround fits: the area holds R ${m(fit.disc!.radiusM)}, the loop needs R ${m(fit.neededRadiusM)}.`
            : `Loop turnaround does not fit: it needs R ${m(fit.neededRadiusM)}, the area holds ${fit.disc ? `R ${m(fit.disc.radiusM)}` : 'no circle'} (${m(fit.shortM)} short).`}
        </p>
      )}
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
        {(
          [
            ['Steer radius', `${m(t.steerRadiusM)} · ${t.steerDegrees.toFixed(1)}°`],
            ['Outer body radius', m(t.outerBodyRadiusM)],
            ['Inner wheel radius', m(t.innerWheelRadiusM)],
            ['Swept annulus', m(t.annulusWidthM)],
            ['Offtracking', m(t.offtrackingM)],
            ['Turnaround diameter', `${m(t.turnaroundDiameterM)} (${m(t.clearanceM)} clearance)`],
          ] as [string, string][]
        ).map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-3xs text-muted-foreground">{label}</dt>
            <dd className="font-mono tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {t.lockExceeded && <p className="text-danger">That radius needs more than the steering lock.</p>}
    </div>
  )
}

/** Plan features of a drive: swept area, wheel area, steer path, lock runs, traces and (unless null) the vehicle at a kept position. */
export function driveFeatures(run: DriveRun, vehicle: DesignVehicle, index: number | null): GeoJSON.Feature[] {
  const { result, frame } = run
  const to = frame.fromLocal
  const features: GeoJSON.Feature[] = [
    ...polygonFeatures(result.swept, to, { role: 'swept-area', color: '#7c3aed', label: 'Swept area (body and load)' }),
    ...result.wheels.flatMap((polygon) =>
      polygon.flatMap((ring) => lineFeature(ring, to, { role: 'swept-wheels', color: '#ea580c', label: 'Wheel area' })),
    ),
    ...lineFeature(result.steerPath, to, { role: 'vehicle-trace', color: '#475569', label: 'Steer path' }),
  ]
  // Lock runs along the steer path.
  let s = 0
  const along = result.steerPath.map((p, i) => {
    if (i) s += Math.hypot(p[0] - result.steerPath[i - 1][0], p[1] - result.steerPath[i - 1][1])
    return s
  })
  for (const r of result.lockRuns)
    features.push(
      ...lineFeature(
        result.steerPath.filter((_, i) => along[i] >= r.startS - 1e-6 && along[i] <= r.endS + 1e-6),
        to,
        { role: 'vehicle-lock', color: '#dc2626', label: 'Beyond the steering lock' },
      ),
    )
  for (const t of result.traces)
    features.push(...lineFeature(t.points, to, { role: 'vehicle-trace', color: '#0891b2', label: `Trace: ${t.label}` }))
  const position = index === null ? null : result.positions[Math.min(index, result.positions.length - 1)]
  if (position)
    features.push(
      ...outlineFeatures(
        vehicleOutline(position.pose, vehicle),
        to,
        `Steer ${steerText(position.pose.steerSignedDegrees)}`,
      ),
    )
  return features
}

/** Plan features of a turning template centred at `centre` (local metres of `frame`). */
export function templateFeatures(t: TurningTemplate, frame: Frame, centre: XY): GeoJSON.Feature[] {
  const placed = placeTemplate(t, centre)
  const to = frame.fromLocal
  return [
    ...polygonFeatures([[placed.circle(t.outerBodyRadiusM), placed.circle(t.innerSweptRadiusM).reverse()]], to, {
      role: 'swept-area',
      color: '#7c3aed',
      label: 'Turning template: swept annulus',
    }),
    ...lineFeature(placed.circle(t.steerRadiusM), to, {
      role: 'vehicle-template',
      color: '#475569',
      label: 'Steer-axle circle',
    }),
    ...lineFeature(placed.circle(t.outerBodyRadiusM + t.clearanceM), to, {
      role: 'vehicle-template',
      color: '#0f172a',
      label: 'Turnaround needed (outer body + clearance)',
    }),
    ...outlineFeatures({ bodies: placed.bodies, loads: placed.loads, axles: placed.axles }, to, 'Steady pose'),
  ]
}
