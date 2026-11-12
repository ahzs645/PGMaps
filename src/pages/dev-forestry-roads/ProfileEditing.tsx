/**
 * Grade editing on the profile chart: Shift-drag a PVI to hold one grade, drag a tangent's grip to
 * raise or lower it, snap grades to round values, type a tangent's grade in a popover, Delete a
 * selected PVI, and junction markers with **Add control here**. The arithmetic is in `gradeEdit.ts`
 * and `profileJunctions.ts`; this file holds the pointer, key and popover plumbing only.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Magnet, Plus, X } from 'lucide-react'
import { AnchoredPopover } from '@/components/ui/anchored-popover'
import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { GradeEntryField } from './GradeEntryField'
import {
  dragPvi,
  dragTangent,
  GRADE_SNAP_STEP_PERCENT,
  MAX_EDIT_GRADE_PERCENT,
  MIN_TANGENT_DRAG_PX,
  MIN_TANGENT_GRIP_PX,
  placePvi,
  removePvi,
  setTangentGrade,
  shiftTangent,
  tangentGrade,
  type GradeHold,
  type SnappedGrade,
} from './gradeEdit'
import { signedValue } from './profileAnnotations'
import { controlForJunction, junctionControl, MAX_VERTICAL_CONTROLS, type ProfileJunction } from './profileJunctions'
import { junctionDifferenceShown, junctionLabelNames } from './profileLabelLayout'
import { formatStation } from './verticalStandards'
import type { VerticalControl, VerticalPoint } from './types'
import { isRemoveKey } from './historyShortcut'

/** What the overlays need of the chart's frame. */
export interface ProfileFrame {
  x: (chainage: number) => number
  y: (elevation: number) => number
  top: number
  left: number
  plotWidth: number
  plotHeight: number
}
/** Displayed chainage and elevation range: start, end, low, high. */
export type ChartDomain = [number, number, number, number]
/** Chart units per screen pixel, for the drag slack and the tangent drag. */
export interface PixelScale {
  chainageM: number
  elevationM: number
}

const JUNCTION_COLOR = '#c026d3'
const HELD_COLOR = '#b45309'
const SNAP_COLOR = '#0d9488'
const SNAP_STORAGE_KEY = 'pgmaps-road-profile-grade-snap'
const pct = (value: number) => signedValue(value, 2, ' %')
const metres = (value: number | null, digits = 2) => (value === null ? 'unknown' : `${value.toFixed(digits)} m`)
const signedMetres = (value: number) => signedValue(value, 2, ' m')

export const JUNCTION_LABEL_FONT_PX = 9
/** Where a junction's label goes, as the chart placed it. */
export interface JunctionLabelPlacement {
  x: number
  y: number
  anchor: 'start' | 'end'
  text: string
}
/** The diamond's y: on the other road's level when it is on the plot, else pinned to the top. */
export function junctionMarkerY(
  f: Pick<ProfileFrame, 'y' | 'top'>,
  j: ProfileJunction,
  height: number,
  bottom: number,
) {
  const levelY = j.level !== null && Number.isFinite(j.level) ? f.y(j.level) : null
  return levelY !== null && levelY >= f.top && levelY <= height - bottom ? levelY : f.top + 6
}
/** "name", with the level difference only when it is worth reading (`junctionDifferenceShown`). */
export const junctionLabelText = (j: ProfileJunction, name: string) =>
  junctionDifferenceShown(j.difference) ? `${name} ${signedMetres(j.difference!)}` : name
const finite = (n: number | null | undefined): n is number => n != null && Number.isFinite(n)

/** Focus is in a popover or nowhere, so closing it may hand focus back; a press elsewhere keeps its own. */
function focusIsLoose() {
  const active = document.activeElement
  return !active || active === document.body || !!active.closest('[data-floating-layer]')
}

/** Room the drag cursor's text needs right of the handle; nearer the plot's right edge it goes left. */
export const CURSOR_TEXT_PX = 184
/** Below the handle, the drag cursor's lines (snapped grade, held reasons) take this band of pixels. */
export const CURSOR_LINES_BELOW_PX = 48
/** Whether the drag cursor's text sits left of a handle at `x`, given the plot's right edge. */
export const cursorOnLeft = (x: number, plotRight: number) => x > plotRight - CURSOR_TEXT_PX

/** A junction's `difference` (its level − this formation) in words, so the sign cannot be misread. */
export function junctionDifferenceText(difference: number) {
  const size = Math.abs(difference)
  if (size < 0.005) return 'Level with this formation'
  return `Its level is ${size.toFixed(2)} m ${difference > 0 ? 'above' : 'below'} this formation`
}

/** After a PVI is deleted, focus the handle now at `index` (or the last), else the chart itself. */
export function focusAfterRemoval(chart: SVGSVGElement, index: number) {
  const active = document.activeElement
  if (active && active !== document.body) return
  const handles = chart.querySelectorAll<SVGElement>('[data-pvi][tabindex]')
  const next = handles[Math.min(index, handles.length - 1)] ?? (chart.hasAttribute('tabindex') ? chart : null)
  next?.focus({ preventScroll: true })
}

function readSnap() {
  try {
    return window.localStorage.getItem(SNAP_STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

type Drag =
  | { kind: 'pvi'; id: string; points: VerticalPoint[] }
  | { kind: 'tangent'; index: number; points: VerticalPoint[]; startY: number; moved: boolean }

interface Readout {
  chainage: number
  elevation: number
  lines: { text: string; tone: 'snap' | 'held' | 'plain' }[]
}

function snapLine(snapped: SnappedGrade | undefined, tangent: boolean) {
  if (!snapped) return []
  const name = tangent
    ? snapped.side === 'back'
      ? 'Grade before'
      : 'Grade after'
    : snapped.side === 'back'
      ? 'Grade in'
      : 'Grade out'
  return [{ text: `${name} ${pct(snapped.gradePercent)} · snapped`, tone: 'snap' as const }]
}

export interface ProfileEditingOptions {
  /** The profile's PVIs in station order. */
  sorted: VerticalPoint[]
  editable: boolean
  roadLength: number
  controls?: VerticalControl[]
  onVerticalChange?: (points: VerticalPoint[]) => void
  onStation: (chainage: number) => void
  /** Hold the chart's axes still during a drag; null releases them. */
  freezeDomain: (domain: ChartDomain | null) => void
  junctions?: ProfileJunction[]
  onAddControl?: (control: VerticalControl) => void
  /**
   * Brackets a drag for the undo history (`useRoadWorkspace` `editGesture`): one step for the whole
   * drag, and Escape ('cancel') returns to the pre-drag project with no step. Without it, Escape puts
   * the PVIs back as an ordinary edit.
   */
  onEditGesture?: (phase: 'start' | 'end' | 'cancel') => void
}

export function useProfileEditing(options: ProfileEditingOptions) {
  const { sorted, editable, onVerticalChange, onStation, freezeDomain } = options
  const drag = useRef<Drag | null>(null)
  const [dragging, setDragging] = useState(false)
  // The PVI being dragged, for the chart's grade and cut/fill readout (`pviDragReadout`).
  const [draggedPviId, setDraggedPviId] = useState<string | null>(null)
  const [readout, setReadout] = useState<Readout | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [snap, setSnapState] = useState(readSnap)
  const [status, setStatus] = useState('')
  const [gradeEditor, setGradeEditor] = useState<{ backId: string } | null>(null)
  const [hold, setHold] = useState<GradeHold>('back')
  const [openJunction, setOpenJunction] = useState<string | null>(null)
  const gradeAnchor = useRef<HTMLSpanElement>(null)
  const junctionAnchor = useRef<HTMLSpanElement>(null)
  const grips = useRef(new Map<string, SVGElement>())
  const markers = useRef(new Map<string, SVGElement>())
  const latest = useRef(options)
  useEffect(() => {
    latest.current = options
  })
  const snapStep = snap ? GRADE_SNAP_STEP_PERCENT : null

  const setSnap = (on: boolean) => {
    setSnapState(on)
    try {
      window.localStorage.setItem(SNAP_STORAGE_KEY, on ? 'on' : 'off')
    } catch {
      /* A per-viewer convenience: without storage the toggle lasts the visit. */
    }
  }
  const say = useCallback((text: string) => setStatus(text), [])
  useEffect(() => {
    if (!status) return
    const timer = setTimeout(() => setStatus(''), 5000)
    return () => clearTimeout(timer)
  }, [status])

  const finish = useCallback(() => {
    drag.current = null
    setDragging(false)
    setDraggedPviId(null)
    setReadout(null)
    latest.current.freezeDomain(null)
  }, [])

  // Escape puts a drag back where it started.
  useEffect(() => {
    if (!dragging) return
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || !drag.current) return
      event.preventDefault()
      event.stopPropagation()
      const { onEditGesture, onVerticalChange: change } = latest.current
      if (onEditGesture) onEditGesture('cancel')
      else change?.(drag.current.points)
      finish()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [dragging, finish])

  const startPvi = (event: PointerEvent<SVGElement>, id: string, domain: ChartDomain) => {
    if (!editable) return false
    setSelectedId(id)
    event.currentTarget.focus({ preventScroll: true })
    drag.current = { kind: 'pvi', id, points: sorted }
    options.onEditGesture?.('start')
    setDragging(true)
    setDraggedPviId(id)
    freezeDomain(domain)
    return true
  }

  const startTangent = (event: PointerEvent<SVGElement>, index: number, domain: ChartDomain) => {
    if (!editable) return
    event.stopPropagation()
    event.preventDefault()
    event.currentTarget.focus({ preventScroll: true })
    drag.current = { kind: 'tangent', index, points: sorted, startY: event.clientY, moved: false }
    options.onEditGesture?.('start')
    setDragging(true)
    freezeDomain(domain)
    event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId)
  }

  /** A pointer move while one of this file's drags is active; false leaves the move to the chart. */
  const move = (event: PointerEvent<SVGElement>, chainage: number, elevation: number, scale: PixelScale) => {
    const active = drag.current
    if (!active || !onVerticalChange) return false
    if (active.kind === 'pvi') {
      const index = active.points.findIndex((p) => p.id === active.id)
      if (index < 0) return true
      const outcome = dragPvi({
        sorted: active.points,
        index,
        chainage,
        elevation,
        roadLength: options.roadLength,
        holdGrade: event.shiftKey,
        snapStep,
        controls: options.controls,
        slack: { chainageM: 3 * scale.chainageM, elevationM: 3 * scale.elevationM },
      })
      onVerticalChange(placePvi(active.points, active.id, outcome, !!outcome.snapped))
      onStation(outcome.chainage)
      setReadout({
        chainage: outcome.chainage,
        elevation: outcome.elevation,
        lines: [...snapLine(outcome.snapped, false), ...outcome.held.map((text) => ({ text, tone: 'held' as const }))],
      })
      return true
    }
    if (!active.moved && Math.abs(event.clientY - active.startY) < MIN_TANGENT_DRAG_PX) return true
    active.moved = true
    const outcome = dragTangent({
      sorted: active.points,
      index: active.index,
      deltaM: (active.startY - event.clientY) * scale.elevationM,
      snapStep,
      controls: options.controls,
      slackM: 3 * scale.elevationM,
    })
    onVerticalChange(shiftTangent(active.points, active.index, outcome.deltaM, !!outcome.snapped))
    const back = active.points[active.index],
      ahead = active.points[active.index + 1]
    setReadout({
      chainage: (back.chainage + ahead.chainage) / 2,
      elevation: (back.elevation + ahead.elevation) / 2 + outcome.deltaM,
      lines: [
        { text: `Tangent ${signedMetres(outcome.deltaM)}`, tone: 'plain' },
        ...snapLine(outcome.snapped, true),
        ...outcome.held.map((text) => ({ text, tone: 'held' as const })),
      ],
    })
    return true
  }

  /** Pointer up: a tangent grip pressed without a drag opens its grade. */
  const end = () => {
    const active = drag.current
    if (!active) return
    latest.current.onEditGesture?.('end')
    finish()
    if (active.kind === 'tangent' && !active.moved) {
      setOpenJunction(null)
      setGradeEditor({ backId: active.points[active.index].id })
    }
  }

  const remove = (id: string, chart?: SVGSVGElement | null) => {
    if (!onVerticalChange) return
    const index = sorted.findIndex((p) => p.id === id)
    const result = removePvi(sorted, id)
    if ('error' in result) return say(result.error)
    onVerticalChange(result.points)
    setSelectedId(null)
    say(`V${index + 1} removed. Undo brings it back.`)
    // The focused handle is gone: hand focus to the PVI that now holds its place (or the one
    // before it, at the end), else the chart, so the keyboard keeps its place.
    if (chart) requestAnimationFrame(() => focusAfterRemoval(chart, index))
  }

  /** Keys on a focused PVI handle; true when handled. */
  const pviKeyDown = (event: KeyboardEvent<SVGElement>, id: string) => {
    if (!editable || !onVerticalChange) return false
    if (isRemoveKey(event)) {
      event.preventDefault()
      event.stopPropagation()
      remove(id, event.currentTarget?.ownerSVGElement)
      return true
    }
    if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      // Slide 5 m along the grade the keys move away from, as a Shift-drag does.
      event.preventDefault()
      event.stopPropagation()
      const index = sorted.findIndex((p) => p.id === id)
      if (index < 0) return true
      const outcome = dragPvi({
        sorted,
        index,
        chainage: sorted[index].chainage + (event.key === 'ArrowRight' ? 5 : -5),
        elevation: sorted[index].elevation,
        roadLength: options.roadLength,
        holdGrade: true,
        snapStep: null,
        controls: options.controls,
      })
      onVerticalChange(placePvi(sorted, id, outcome))
      onStation(outcome.chainage)
      const why = outcome.held.filter((text) => !text.startsWith('Holding'))
      if (why.length) say(why.join('. '))
      return true
    }
    return false
  }

  /** Keys on a focused tangent grip: Enter opens its grade, arrows raise or lower it. */
  const tangentKeyDown = (event: KeyboardEvent<SVGElement>, index: number) => {
    if (!editable || !onVerticalChange) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      event.stopPropagation()
      setOpenJunction(null)
      setGradeEditor({ backId: sorted[index].id })
      return
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      event.stopPropagation()
      const step = (event.shiftKey ? 1 : 0.1) * (event.key === 'ArrowUp' ? 1 : -1)
      const outcome = dragTangent({ sorted, index, deltaM: step, controls: options.controls })
      if (outcome.deltaM !== 0) onVerticalChange(shiftTangent(sorted, index, outcome.deltaM))
      if (outcome.held.length) say(outcome.held.join('. '))
    }
  }

  /** Applies a typed grade; returns why it was refused, and then nothing moves. */
  const typeGrade = (backId: string, grade: number, end: GradeHold) => {
    if (!onVerticalChange) return 'This profile cannot be edited here.'
    const result = setTangentGrade(sorted, backId, grade, end, options.controls)
    if ('error' in result) return result.error
    onVerticalChange(result.points)
  }

  const closeGrade = useCallback(() => {
    const id = gradeEditor?.backId
    setGradeEditor(null)
    if (id && focusIsLoose()) grips.current.get(id)?.focus({ preventScroll: true })
  }, [gradeEditor])
  const closeJunction = useCallback(() => {
    const id = openJunction
    setOpenJunction(null)
    if (id && focusIsLoose()) markers.current.get(id)?.focus({ preventScroll: true })
  }, [openJunction])

  const openJunctionAt = (junction: ProfileJunction) => {
    onStation(junction.chainage)
    setGradeEditor(null)
    setOpenJunction(junction.id)
  }

  /**
   * Grips, junction markers: drawn under the PVI handles. `labels` are the junction labels the chart
   * placed (`profileLabelLayout.ts`); a junction left out of it shows no label, only its tooltip.
   */
  const layers = (
    f: ProfileFrame,
    height: number,
    bottom: number,
    domain: ChartDomain,
    labels?: ReadonlyMap<string, JunctionLabelPlacement>,
  ) => (
    <>
      {(options.junctions ?? [])
        .filter((j) => j.chainage >= domain[0] && j.chainage <= domain[1])
        .map((j) => {
          const x = f.x(j.chainage)
          const levelY = finite(j.level) ? f.y(j.level) : null
          const shownY = levelY !== null && levelY >= f.top && levelY <= height - bottom ? levelY : null
          const label: JunctionLabelPlacement | undefined = labels
            ? labels.get(j.id)
            : {
                x: x + 8,
                y: junctionMarkerY(f, j, height, bottom) + 3,
                anchor: 'start',
                text: junctionLabelText(j, junctionLabelNames(j.otherRoadName)[0]),
              }
          return (
            <g
              key={j.id}
              ref={(node) => {
                if (node) markers.current.set(j.id, node)
                else markers.current.delete(j.id)
              }}
              role="button"
              tabIndex={0}
              aria-haspopup="dialog"
              aria-expanded={openJunction === j.id}
              aria-label={`${j.otherRoadName} ${j.kind} this road at ${formatStation(j.chainage)}; ${j.levelKind === 'design' ? 'formation' : 'ground'} ${metres(j.level)}. Enter for Add control here.`}
              data-testid="road-profile-junction"
              className="cursor-pointer outline-none [&:focus-visible_.junction-diamond]:stroke-[3]"
              onPointerDown={(event) => {
                event.stopPropagation()
                openJunctionAt(j)
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                event.stopPropagation()
                openJunctionAt(j)
              }}
            >
              <rect x={x - 5} y={f.top} width={10} height={f.plotHeight} fill="transparent" />
              <line
                x1={x}
                x2={x}
                y1={f.top}
                y2={height - bottom}
                stroke={JUNCTION_COLOR}
                strokeWidth={1.2}
                strokeDasharray="6 3"
                opacity={0.75}
              />
              <path
                className="junction-diamond"
                d={`M${x},${(shownY ?? f.top + 6) - 6} L${x + 6},${shownY ?? f.top + 6} L${x},${(shownY ?? f.top + 6) + 6} L${x - 6},${shownY ?? f.top + 6} Z`}
                fill={shownY === null ? 'hsl(var(--background))' : JUNCTION_COLOR}
                stroke={JUNCTION_COLOR}
                strokeWidth={1.5}
              />
              {label && (
                <text
                  x={label.x}
                  y={label.y}
                  textAnchor={label.anchor}
                  fontSize={JUNCTION_LABEL_FONT_PX}
                  fill={JUNCTION_COLOR}
                  stroke="hsl(var(--background))"
                  strokeWidth={3}
                  paintOrder="stroke"
                  data-junction-label
                >
                  {label.text}
                </text>
              )}
              <title>
                {j.otherRoadName} {j.kind} at {formatStation(j.chainage)} ·{' '}
                {j.levelKind === 'design' ? 'formation' : 'ground'} {metres(j.level)}
                {j.difference !== null ? ` · ${signedMetres(j.difference)} from this formation` : ''}
              </title>
            </g>
          )
        })}
      {editable &&
        sorted.slice(0, -1).map((back, index) => {
          const ahead = sorted[index + 1]
          const x1 = f.x(back.chainage),
            x2 = f.x(ahead.chainage)
          if (x2 - x1 < MIN_TANGENT_GRIP_PX) return null
          const mid = (back.chainage + ahead.chainage) / 2,
            level = (back.elevation + ahead.elevation) / 2
          const x = f.x(mid),
            y = f.y(level)
          if (x < f.left || x > f.left + f.plotWidth || y < f.top || y > f.top + f.plotHeight) return null
          const grade = tangentGrade(back, ahead)
          const open = gradeEditor?.backId === back.id
          return (
            <g
              key={`grip-${back.id}`}
              ref={(node) => {
                if (node) grips.current.set(back.id, node)
                else grips.current.delete(back.id)
              }}
              role="button"
              tabIndex={0}
              aria-haspopup="dialog"
              aria-expanded={open}
              aria-label={`Tangent V${index + 1} to V${index + 2}, grade ${pct(grade)}. Enter types its grade; up and down arrows raise or lower it.`}
              data-testid="road-profile-tangent-grip"
              className="cursor-ns-resize outline-none [&:focus-visible_rect]:stroke-[3]"
              onPointerDown={(event) => startTangent(event, index, domain)}
              onKeyDown={(event) => tangentKeyDown(event, index)}
            >
              <rect
                x={x - 6}
                y={y - 3.5}
                width={12}
                height={7}
                rx={2}
                transform={`rotate(${((Math.atan2(f.y(ahead.elevation) - f.y(back.elevation), x2 - x1) * 180) / Math.PI).toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})`}
                fill={open ? '#0d9488' : 'hsl(var(--background))'}
                stroke="#0d9488"
                strokeWidth={1.5}
              />
              <title>
                V{index + 1}–V{index + 2} {pct(grade)}. Drag to raise or lower the tangent; click to type its grade.
              </title>
            </g>
          )
        })}
    </>
  )

  /** The cursor readout: what a drag snapped to and what holds it. Drawn over everything. */
  // `_width` is the svg's; the side is judged on the plot's right edge, as the PVI readout box judges it.
  const cursor = (f: ProfileFrame, _width?: number) => {
    if (!readout || !readout.lines.length) return null
    const x = f.x(readout.chainage),
      y = f.y(readout.elevation)
    const right = cursorOnLeft(x, f.left + f.plotWidth)
    return (
      <g pointerEvents="none" data-testid="road-profile-drag-readout" aria-live="polite">
        {readout.lines.map((line, i) => (
          <text
            key={i}
            x={x + (right ? -12 : 12)}
            y={Math.max(f.top + 10, y + 16 + i * 12)}
            textAnchor={right ? 'end' : 'start'}
            fontSize="10"
            fontWeight={line.tone === 'plain' ? 400 : 600}
            fill={line.tone === 'held' ? HELD_COLOR : line.tone === 'snap' ? SNAP_COLOR : 'hsl(var(--foreground))'}
            stroke="hsl(var(--background))"
            strokeWidth={3}
            paintOrder="stroke"
          >
            {line.text}
          </text>
        ))}
      </g>
    )
  }

  const editorTangent = gradeEditor ? sorted.findIndex((p) => p.id === gradeEditor.backId) : -1
  const junction = (options.junctions ?? []).find((j) => j.id === openJunction)

  /** Popovers and the status line, positioned over the chart. */
  const html = (f: ProfileFrame) => {
    const back = editorTangent >= 0 ? sorted[editorTangent] : undefined,
      ahead = editorTangent >= 0 ? sorted[editorTangent + 1] : undefined
    const existing = junction ? junctionControl(options.controls, junction) : undefined
    const controlsFull = (options.controls?.length ?? 0) >= MAX_VERTICAL_CONTROLS
    return (
      <>
        {back && ahead && (
          <span
            ref={gradeAnchor}
            aria-hidden
            className="pointer-events-none absolute size-2"
            style={{
              left: f.x((back.chainage + ahead.chainage) / 2) - 4,
              top: f.y((back.elevation + ahead.elevation) / 2) - 4,
            }}
          />
        )}
        <AnchoredPopover
          anchorRef={gradeAnchor}
          open={!!(back && ahead && gradeEditor)}
          onClose={closeGrade}
          role="dialog"
          ariaLabel="Tangent grade"
          initialFocus
          className="z-workspace-popover w-64 max-w-[calc(100vw-2rem)] rounded-lg p-3"
        >
          {back && ahead && (
            <div className="space-y-2 text-xs" data-testid="road-profile-grade-editor">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">
                  Tangent V{editorTangent + 1}–V{editorTangent + 2}
                </h3>
                <Button size="icon-2xs" variant="ghost" aria-label="Close" onClick={closeGrade}>
                  <X className="size-3.5" />
                </Button>
              </div>
              <GradeEntryField
                key={back.id}
                label="Grade (%)"
                value={Math.round(tangentGrade(back, ahead) * 1e4) / 1e4}
                max={MAX_EDIT_GRADE_PERCENT}
                autoFocus
                onGrade={(grade) => typeGrade(back.id, grade, hold)}
              />
              <SegmentedControl
                label="End that holds"
                size="sm"
                value={hold}
                onChange={setHold}
                options={[
                  { value: 'back', label: `V${editorTangent + 1} holds` },
                  { value: 'ahead', label: `V${editorTangent + 2} holds` },
                ]}
              />
              <p className="tabular-nums text-muted-foreground">
                {(ahead.chainage - back.chainage).toFixed(1)} m · V{editorTangent + 1} {back.elevation.toFixed(2)} m · V
                {editorTangent + 2} {ahead.elevation.toFixed(2)} m
              </p>
            </div>
          )}
        </AnchoredPopover>
        {junction && (
          <span
            ref={junctionAnchor}
            aria-hidden
            className="pointer-events-none absolute size-2"
            style={{
              left: f.x(junction.chainage) - 4,
              top:
                (finite(junction.level)
                  ? Math.max(f.top, Math.min(f.top + f.plotHeight, f.y(junction.level)))
                  : f.top) - 4,
            }}
          />
        )}
        <AnchoredPopover
          anchorRef={junctionAnchor}
          open={!!junction}
          onClose={closeJunction}
          role="dialog"
          ariaLabel="Junction"
          initialFocus
          className="z-workspace-popover w-64 max-w-[calc(100vw-2rem)] rounded-lg p-3"
        >
          {junction && (
            <div className="space-y-1.5 text-xs" data-testid="road-profile-junction-card">
              <div className="flex items-center justify-between gap-2">
                <h3 className="truncate font-semibold">
                  {junction.otherRoadName} {junction.kind}
                </h3>
                <Button size="icon-2xs" variant="ghost" aria-label="Close" onClick={closeJunction}>
                  <X className="size-3.5" />
                </Button>
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 tabular-nums">
                <dt className="text-muted-foreground">Here</dt>
                <dd>{formatStation(junction.chainage)}</dd>
                <dt className="text-muted-foreground">On {junction.otherRoadName}</dt>
                <dd>{formatStation(junction.otherChainage)}</dd>
                <dt className="text-muted-foreground">
                  Its {junction.levelKind === 'design' ? 'formation' : 'ground'}
                </dt>
                <dd>{metres(junction.level)}</dd>
                <dt className="text-muted-foreground">This formation</dt>
                <dd>{metres(junction.designHere)}</dd>
                {junction.difference !== null && (
                  <>
                    <dt className="text-muted-foreground">Difference</dt>
                    <dd data-testid="road-profile-junction-difference">
                      {junctionDifferenceText(junction.difference)}
                    </dd>
                  </>
                )}
              </dl>
              {existing ? (
                <p className="text-muted-foreground">
                  A control already stands at {formatStation(existing.chainage)}
                  {existing.elevation !== null ? `: ${existing.elevation.toFixed(2)} m` : ''}.
                </p>
              ) : (
                <Button
                  size="xs"
                  variant="outline"
                  className="w-full"
                  data-autofocus
                  disabled={!options.onAddControl || junction.level === null || controlsFull}
                  onClick={() => {
                    const control = controlForJunction(junction, crypto.randomUUID())
                    if (!control || !options.onAddControl) return
                    options.onAddControl(control)
                    say(`Control added at ${formatStation(control.chainage)}: ${control.elevation!.toFixed(2)} m.`)
                    closeJunction()
                  }}
                >
                  <Plus className="mr-1 size-3" />
                  Add control here
                </Button>
              )}
              {junction.level === null && <p className="text-muted-foreground">Its level is unknown here.</p>}
              {controlsFull && !existing && (
                <p className="text-muted-foreground">
                  This road holds {MAX_VERTICAL_CONTROLS} controls, the most it keeps.
                </p>
              )}
            </div>
          )}
        </AnchoredPopover>
        <p
          role="status"
          className="pointer-events-none absolute max-w-[70%] rounded-sm bg-background/90 px-1.5 text-2xs text-foreground shadow-sm empty:hidden"
          style={{ left: f.left + 4, top: f.top + f.plotHeight - 18 }}
          data-testid="road-profile-edit-status"
        >
          {status}
        </p>
      </>
    )
  }

  /** The snap toggle for the chart's toolbar. */
  const snapToggle = (className: string) =>
    editable ? (
      <Button
        className={className}
        size="sm"
        variant="ghost"
        aria-pressed={snap}
        aria-label={`Snap grades to ${GRADE_SNAP_STEP_PERCENT} % while dragging`}
        title={`Snap grades to ${GRADE_SNAP_STEP_PERCENT} % while dragging · ${snap ? 'on' : 'off'}`}
        onClick={() => setSnap(!snap)}
      >
        <Magnet className={`size-3.5 ${snap ? 'text-foreground' : 'opacity-60'}`} aria-hidden />
      </Button>
    ) : null

  return {
    startPvi,
    move,
    end,
    pviKeyDown,
    selectedId,
    deselect: () => setSelectedId(null),
    layers,
    cursor,
    html,
    snapToggle,
    dragging,
    draggedPviId,
  }
}
