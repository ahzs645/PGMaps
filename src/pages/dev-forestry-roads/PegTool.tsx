/**
 * Grade-held pegging on the plan (`pegCursor.ts`). The cursor aims; each click adds a leg one step
 * long at the target ground grade; Enter or a double-click adds the legs to the active road's end
 * in one edit. Escape drops them, right-click or Backspace removes the last. Alt-click, or Straight
 * legs, goes straight to the point clicked. With the map focused, ← and → turn the aim and Space
 * adds the leg; the panel's fields and buttons do the same from anywhere.
 */
import { mercatorMetresPerPixel, snapIndex, snapToRoads, type DrawSnap, type SnapLine } from './drawSnap'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { MapMouseEvent } from 'maplibre-gl'
import { Footprints } from 'lucide-react'
import { MapMarker, MarkerContent, useMap } from '@/components/ui/map'
import { Button } from '@/components/ui/button'
import { MapToolPanel } from '@/components/ui/map-tool-panel'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { NumberField, OptionalNumberField } from './Controls'
import { distance, offsetCoordinate } from './engine'
import { groundTrendTerrain, resolvedGroundWindow } from './groundTrend'
import {
  addPegLeg,
  CURSOR_LABEL_GAP_PX,
  cursorLabelSide,
  DEFAULT_PEG_TOOL,
  isSecondClickOfDouble,
  MAX_PEG_STEP_M,
  MAX_PEG_TARGET_GRADE,
  MAX_PEG_TOOL_LEGS,
  MIN_PEG_STEP_M,
  PEG_AIM_FINE_STEP_DEG,
  PEG_AIM_STEP_DEG,
  PEG_LEG_COLORS,
  pegChainEnd,
  pegChainFeatures,
  pegChainSummary,
  pegGradeError,
  pegLegLabel,
  pegStepError,
  removeLastPegLeg,
  solvePegCursor,
  type PegChain,
  type PegCursorResult,
  type PegToolSettings,
} from './pegCursor'
import { pegBearing } from './pegging'
import { isPlanToolKey, usePlanToolOverlay } from './PlanTools'
import type { Alignment, Coordinate, RoadProject, TerrainSource } from './types'

/** Where the next leg is aimed: at the cursor (Alt held or not), or along a typed or keyed bearing. */
type Aim = { kind: 'cursor'; coordinate: Coordinate; alt: boolean } | { kind: 'bearing'; bearing: number }

/** The last settings used, so the tool reopens with them during the session. */
let lastSettings: PegToolSettings = DEFAULT_PEG_TOOL

const fixed = (value: number | null, decimals = 1) =>
  value === null || !Number.isFinite(value) ? '—' : value.toFixed(decimals)
const signedPercent = (value: number | null) =>
  value === null || !Number.isFinite(value)
    ? 'unknown'
    : `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(1)} %`

export function PegTool({
  project,
  alignment,
  source,
  onPeg,
  snapLines,
  onClose,
  panelHost,
}: {
  project: RoadProject
  alignment: Alignment
  source: TerrainSource
  onPeg: (coordinates: Coordinate[]) => boolean
  /**
   * Roads a straight leg snaps onto (`drawSnap.ts`): a straight leg clicked within reach of one ends
   * exactly on it, so the run can join or branch onto it. Legs at grade land where the grade puts
   * them, never moved onto a road.
   */
  snapLines?: SnapLine[]
  onClose: () => void
  panelHost: HTMLElement | null
}) {
  const { map, isLoaded } = useMap()
  const limit = project.settings.maxGradePercent
  const [settings, setSettingsState] = useState(lastSettings)
  const end = alignment.points.at(-1)?.coordinate ?? null
  const [chain, setChain] = useState<PegChain | null>(end ? { origin: end, legs: [] } : null)
  const [note, setNote] = useState('')
  const setSettings = (next: PegToolSettings) => {
    lastSettings = next
    setSettingsState(next)
    // A changed grade, direction or step answers the last refusal, so its note goes.
    setNote('')
  }
  // The road's end moved under the chain (an undo, or an edit elsewhere): start again from it.
  if (end && (!chain || distance(chain.origin, end) > 0.001)) {
    setChain({ origin: end, legs: [] })
    setNote(chain?.legs.length ? 'The road’s end moved, so pegging started again from it.' : '')
  }
  const [aim, setAim] = useState<Aim | null>(null)
  // Grades are held on the ground trend, as the route searches read them on LiDAR.
  const windowM = resolvedGroundWindow(project.routeSearch, project.terrain.resolutionM)
  const ground = useMemo(() => groundTrendTerrain(source, windowM), [source, windowM])
  const from = chain ? pegChainEnd(chain) : null
  const solve = (target: Aim | null): PegCursorResult | null => {
    if (!from || !target) return null
    const point = target.kind === 'cursor' ? target.coordinate : offsetCoordinate(from, target.bearing, settings.stepM)
    return solvePegCursor(from, point, settings, ground, limit, {
      straight: settings.straight || (target.kind === 'cursor' && target.alt),
    })
  }
  const preview = solve(aim)
  const aimPoint =
    aim && from ? (aim.kind === 'cursor' ? aim.coordinate : offsetCoordinate(from, aim.bearing, settings.stepM)) : null
  const aimBearing =
    aim?.kind === 'bearing'
      ? aim.bearing
      : from && aimPoint && distance(from, aimPoint) > 0.01
        ? pegBearing(from, aimPoint)
        : null

  // Other roads only: the run pegs on from this road's own end.
  const roads = useMemo(
    () => (snapLines ? snapIndex(snapLines.filter((line) => line.id !== alignment.id)) : null),
    [snapLines, alignment.id],
  )
  const commit = (target: Aim | null, snap?: DrawSnap | null) => {
    if (!chain) return
    const result = solve(target)
    if (!result) {
      setNote('Aim first: move the cursor over the plan, or enter an aim.')
      return
    }
    if (!result.ok) {
      setNote(`No leg added. ${result.message}`)
      return
    }
    if (chain.legs.length >= MAX_PEG_TOOL_LEGS) {
      setNote(`A run takes at most ${MAX_PEG_TOOL_LEGS} legs. Finish it, then peg on.`)
      return
    }
    setChain(addPegLeg(chain, result.leg))
    setNote(snap ? `This leg ends ${snap.at === 'line' ? 'on' : `at the ${snap.at} of`} ${snap.name}.` : '')
  }
  const undo = () => {
    if (!chain?.legs.length) return
    setChain(removeLastPegLeg(chain))
    setNote('')
  }
  const finish = () => {
    if (!chain?.legs.length) return onClose()
    if (onPeg(chain.legs.map((leg) => leg.end))) onClose()
    else setNote('The road did not take these pegs: see the message above the plan.')
  }
  const turn = (degrees: number) =>
    setAim({ kind: 'bearing', bearing: ((((aimBearing ?? 0) + degrees) % 360) + 360) % 360 })

  const legs = chain?.legs.length ?? 0
  const straightAlways = settings.straight
  const live = useRef({ commit, undo, finish, cancel: onClose, turn, aim, legs, roads, straightAlways })
  useEffect(() => {
    live.current = { commit, undo, finish, cancel: onClose, turn, aim, legs, roads, straightAlways }
  })

  useEffect(() => {
    if (!map || !isLoaded) return
    const container = map.getContainer()
    container.classList.add('road-plan-tool-active')
    let frame = 0
    let pending: Aim | null = null
    let lastClick: { time: number; x: number; y: number } | null = null
    // A straight leg goes to the point clicked, so it snaps onto a road within reach; a leg at
    // grade is placed by the grade and keeps the cursor only as its aim.
    const snapFor = (e: MapMouseEvent) => {
      const { roads, straightAlways } = live.current
      if (!roads || !(straightAlways || e.originalEvent.altKey)) return null
      return snapToRoads([e.lngLat.lng, e.lngLat.lat], roads, mercatorMetresPerPixel(map.getZoom(), e.lngLat.lat))
    }
    const at = (e: MapMouseEvent): Coordinate => snapFor(e)?.coordinate ?? [e.lngLat.lng, e.lngLat.lat]
    const move = (e: MapMouseEvent) => {
      pending = { kind: 'cursor', coordinate: at(e), alt: e.originalEvent.altKey }
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0
          setAim(pending)
        })
    }
    const click = (e: MapMouseEvent) => {
      const press = { time: e.originalEvent.timeStamp, x: e.point.x, y: e.point.y }
      // The second click of a double-click finishes; it does not add a leg of its own.
      if (isSecondClickOfDouble(lastClick, press)) return
      lastClick = press
      const snap = snapFor(e)
      const target: Aim = {
        kind: 'cursor',
        coordinate: snap?.coordinate ?? [e.lngLat.lng, e.lngLat.lat],
        alt: e.originalEvent.altKey,
      }
      setAim(target)
      live.current.commit(target, snap)
    }
    const dblclick = (e: MapMouseEvent) => {
      e.preventDefault()
      live.current.finish()
    }
    const contextmenu = (e: MapMouseEvent) => {
      e.preventDefault()
      e.originalEvent.preventDefault()
      live.current.undo()
    }
    map.on('mousemove', move)
    map.on('click', click)
    map.on('dblclick', dblclick)
    map.on('contextmenu', contextmenu)
    const keydown = (event: KeyboardEvent) => {
      if (!isPlanToolKey(event)) return
      const tool = live.current
      // Ctrl/Cmd+Z takes back a held leg; with none held it stays the project's Undo.
      const undoKey = (event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'z'
      if (undoKey && !tool.legs) return
      if (event.key === 'Escape') tool.cancel()
      else if (event.key === 'Enter') tool.finish()
      else if (event.key === ' ') tool.commit(tool.aim)
      else if (event.key === 'Backspace' || event.key === 'Delete' || undoKey) tool.undo()
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
        tool.turn((event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? PEG_AIM_FINE_STEP_DEG : PEG_AIM_STEP_DEG))
      else return
      // The tool in hand owns these keys: the map does not pan, and the page does not delete a point.
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener('keydown', keydown, true)
    return () => {
      cancelAnimationFrame(frame)
      container.classList.remove('road-plan-tool-active')
      map.off('mousemove', move)
      map.off('click', click)
      map.off('dblclick', dblclick)
      map.off('contextmenu', contextmenu)
      window.removeEventListener('keydown', keydown, true)
    }
  }, [map, isLoaded])

  const labelAt = preview?.ok ? preview.leg.end : aimPoint
  // Near the plan's right edge the label turns to the left of its point, so it is not cut off.
  const labelSide = map && labelAt ? cursorLabelSide(map.project(labelAt).x, map.getContainer().clientWidth) : 'right'
  const features = useMemo(() => {
    const collection = chain
      ? pegChainFeatures(chain, preview, limit)
      : { type: 'FeatureCollection' as const, features: [] }
    return from
      ? {
          ...collection,
          features: [
            ...collection.features,
            {
              type: 'Feature' as const,
              geometry: { type: 'Point' as const, coordinates: from },
              properties: { role: 'peg-from', color: '#facc15' },
            },
          ],
        }
      : collection
  }, [chain, preview, limit, from])
  usePlanToolOverlay(features)

  const summary = chain ? pegChainSummary(chain) : { legs: 0, lengthM: 0, gradePercent: null }
  const status = preview
    ? preview.ok
      ? pegLegLabel(preview, limit)
      : preview.message
    : 'Aim with the cursor, or enter an aim.'
  return (
    <>
      {aim?.kind === 'cursor' && labelAt && preview && (
        <MapMarker
          longitude={labelAt[0]}
          latitude={labelAt[1]}
          anchor={labelSide === 'right' ? 'left' : 'right'}
          offset={[labelSide === 'right' ? CURSOR_LABEL_GAP_PX : -CURSOR_LABEL_GAP_PX, 0]}
        >
          <MarkerContent>
            <div
              className={`pointer-events-none max-w-56 rounded-sm border px-1.5 py-0.5 text-3xs font-medium shadow ${
                preview.ok
                  ? 'bg-background/95 text-foreground'
                  : 'border-warning-border bg-warning-surface text-warning-foreground'
              }`}
              data-testid="road-peg-cursor-label"
              data-side={labelSide}
            >
              {preview.ok && (
                <span
                  className="mr-1 inline-block size-2 rounded-full"
                  style={{ backgroundColor: PEG_LEG_COLORS[preview.legClass] }}
                  aria-hidden
                />
              )}
              {status}
            </div>
          </MarkerContent>
        </MapMarker>
      )}
      {panelHost &&
        createPortal(
          <PegToolPanel
            settings={settings}
            onSettings={setSettings}
            aimBearing={aimBearing}
            onAimBearing={(bearing) => setAim({ kind: 'bearing', bearing })}
            status={status}
            statusOk={!!preview?.ok}
            note={note}
            legs={summary.legs}
            lengthM={summary.lengthM}
            gradePercent={summary.gradePercent}
            limitPercent={limit}
            windowM={windowM}
            onAdd={() => commit(aim)}
            onUndo={undo}
            onFinish={finish}
            onCancel={onClose}
          />,
          panelHost,
        )}
    </>
  )
}

export function PegToolPanel(props: {
  settings: PegToolSettings
  onSettings: (settings: PegToolSettings) => void
  aimBearing: number | null
  onAimBearing: (bearing: number) => void
  status: string
  statusOk: boolean
  note: string
  legs: number
  lengthM: number
  gradePercent: number | null
  limitPercent: number
  windowM: number
  onAdd: () => void
  onUndo: () => void
  onFinish: () => void
  onCancel: () => void
}) {
  const { settings, onSettings } = props
  return (
    <MapToolPanel
      title="Peg at grade"
      icon={Footprints}
      aria-label="Peg at grade"
      data-testid="road-peg-tool"
      helpLabel="About pegging at grade"
      help={
        <>
          Move the cursor to aim. The next peg lands one step from the last at the target ground grade, on the heading
          nearest the cursor. A click adds the leg; Alt-click (Option-click) adds a straight leg to the point clicked,
          whatever its grade. Right-click or Backspace removes the last leg. Enter or a double-click adds the legs to
          the end of the road in one edit; Escape drops them. With the map focused, ← and → turn the aim (
          {PEG_AIM_STEP_DEG}°, Shift {PEG_AIM_FINE_STEP_DEG}°) and Space adds the leg. Grades are read between peg ends
          on the ground trend
          {props.windowM > 0 ? ` (${props.windowM} m window)` : ''}, as the route searches read them; the profile and
          sections use the terrain itself. Legs are coloured up, down, or red over the {props.limitPercent} % limit. New
          pegs are angle points: give them radii in the pegging table or with curve fitting.
        </>
      }
      onClose={props.onCancel}
      closeLabel="Cancel pegging"
      actions={
        <>
          <Button
            size="xs"
            variant="ghost"
            className="mr-auto"
            disabled={!props.legs}
            onClick={props.onUndo}
            title="Remove the last leg · right-click or Backspace"
          >
            Undo leg
          </Button>
          <Button
            size="xs"
            variant="outline"
            disabled={props.aimBearing === null}
            onClick={props.onAdd}
            title={
              props.aimBearing === null
                ? 'Aim first: move the cursor over the plan, or enter an aim'
                : 'Add this leg · click or Space'
            }
          >
            Add leg
          </Button>
          <Button
            size="xs"
            disabled={!props.legs}
            onClick={props.onFinish}
            title="Add the legs to the road · Enter or double-click"
          >
            Finish
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
        <NumberField
          label="Grade (%)"
          value={settings.gradePercent}
          min={0}
          max={MAX_PEG_TARGET_GRADE}
          step={0.5}
          precision={2}
          clampOn="never"
          error={pegGradeError(settings.gradePercent)}
          onChange={(gradePercent) => onSettings({ ...settings, gradePercent })}
        />
        <SegmentedControl
          label="Grade direction"
          size="sm"
          fullWidth={false}
          value={settings.direction}
          onChange={(direction) => onSettings({ ...settings, direction })}
          options={[
            { value: 'up', label: 'Up' },
            { value: 'down', label: 'Down' },
          ]}
        />
        <NumberField
          label="Step (m)"
          value={settings.stepM}
          min={MIN_PEG_STEP_M}
          max={MAX_PEG_STEP_M}
          step={1}
          precision={1}
          clampOn="never"
          error={pegStepError(settings.stepM)}
          onChange={(stepM) => onSettings({ ...settings, stepM })}
        />
      </div>
      <div className="grid grid-cols-2 items-end gap-2">
        {/* Blank until there is an aim: a 0 here read as an aim due north the tool did not hold. */}
        <OptionalNumberField
          label="Aim (°)"
          value={props.aimBearing === null ? null : Number(props.aimBearing.toFixed(1))}
          min={0}
          max={360}
          step={1}
          placeholder="none"
          onChange={(bearing) => bearing !== null && props.onAimBearing(bearing % 360)}
        />
        <label className="flex h-8 items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={settings.straight}
            onChange={(event) => onSettings({ ...settings, straight: event.target.checked })}
          />
          Straight legs
        </label>
      </div>
      <div className="space-y-0.5 border-t pt-2">
        <p
          role="status"
          aria-live="polite"
          className={props.statusOk ? 'text-foreground' : 'text-warning'}
          data-testid="road-peg-tool-status"
        >
          {props.note || `Next leg: ${props.status}`}
        </p>
        <p className="tabular-nums text-muted-foreground" data-testid="road-peg-tool-summary">
          {props.legs
            ? `${props.legs} ${props.legs === 1 ? 'leg' : 'legs'} · ${fixed(props.lengthM)} m · overall ${signedPercent(props.gradePercent)}`
            : 'No legs yet'}
        </p>
      </div>
    </MapToolPanel>
  )
}
