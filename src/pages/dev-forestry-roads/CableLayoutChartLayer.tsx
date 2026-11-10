/**
 * What the D-line chart adds for a support layout being adjusted by hand: support names and
 * category symbols, the marks of the row picked in the sidebar, and the edit gestures.
 *
 * - Drag a support's handle sideways to move it along the line, or up and down to change its
 *   height (the first `MIN_SUPPORT_DRAG_PX` of movement picks which). The plan cursor follows it.
 * - Double-click the profile to add a support there.
 * - Shift-drag along the profile to draw a no-support sector.
 * - Escape cancels a drag. A focused handle takes the arrow keys (Shift: larger steps) and Delete;
 *   after Delete the focus moves to the next handle (else the previous one, an end, or the chart).
 *
 * Every gesture has a sidebar equivalent in the Intermediate supports section. Pure edits come
 * from `cableLayout/layoutEdit.ts`; this component only maps the pointer to them.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { textWidth } from '@/lib/mapSheet/textMetrics'
import {
  MIN_SUPPORT_DRAG_PX,
  SUPPORT_CATEGORY_LABELS,
  moveSupport,
  removeSupport,
  setEndHeight,
  stationFromChart,
  type EditedLayout,
  type SupportCategory,
} from './cableLayout/layoutEdit'
import type { CableLayoutOverlay, SupportHandle } from './cableLayout/overlay'
import type { CableChartEdit } from './cableLayout/useLayoutEdit'

export interface CableChartFrame {
  left: number
  top: number
  bottom: number
  plotWidth: number
  plotHeight: number
  x: (value: number) => number
  y: (value: number) => number
}
type Domain = readonly [number, number, number, number]

const MARK = '#be123c'
const SYMBOL = { tree: '#15803d', mast: '#475569', 'ground-anchor': '#92400e', other: '#6d28d9' }
const clamp = (v: number, low: number, high: number) => Math.min(high, Math.max(low, v))
const short = (name: string) => (name.length > 16 ? `${name.slice(0, 15)}…` : name)
const m1 = (v: number) => `${v.toFixed(1)} m`

/** The handle that takes the focus after support `index` is deleted, leaving `remaining` supports. */
export function handleAfterDelete(index: number, remaining: number): SupportHandle {
  if (index < remaining) return index
  return index > 0 ? index - 1 : 'end'
}

/**
 * Where a mark's label stands beside its line at `x`: to the right, or to the left (anchored at its
 * end) where it would run past the plot's right edge, so it stays inside the chart.
 */
export function markLabelPlacement(
  x: number,
  label: string,
  fontSize: number,
  plot: { left: number; right: number },
): { x: number; anchor: 'start' | 'end' } {
  // Sheet metrics are Helvetica; the page font can run a little wider.
  const width = textWidth(label, fontSize) * 1.15
  if (x + 3 + width <= plot.right || x - 3 - width < plot.left)
    return { x: Math.max(plot.left, Math.min(x + 3, plot.right - width)), anchor: 'start' }
  return { x: x - 3, anchor: 'end' }
}

interface Drag {
  handle: SupportHandle
  startX: number
  startY: number
  axis: 'x' | 'y' | null
  candidate: EditedLayout | null
}

function SupportSymbol({ category, cx, cy }: { category: SupportCategory; cx: number; cy: number }) {
  const color = SYMBOL[category]
  const shape =
    category === 'tree' ? (
      <path d={`M${cx},${cy - 11} L${cx + 5},${cy - 2} L${cx - 5},${cy - 2} z`} fill={color} />
    ) : category === 'mast' ? (
      <rect x={cx - 4} y={cy - 10} width={8} height={8} fill="none" stroke={color} strokeWidth={1.5} />
    ) : category === 'ground-anchor' ? (
      <path
        d={`M${cx - 5},${cy - 2} L${cx + 5},${cy - 2} M${cx},${cy - 2} L${cx},${cy - 10}`}
        stroke={color}
        strokeWidth={2}
      />
    ) : (
      <circle cx={cx} cy={cy - 6} r={4} fill="none" stroke={color} strokeWidth={1.5} />
    )
  return (
    <g data-testid="road-cable-support-symbol" data-category={category}>
      <title>{SUPPORT_CATEGORY_LABELS[category]}</title>
      {shape}
    </g>
  )
}

export function CableLayoutChartLayer({
  layout,
  edit,
  frame: f,
  domain,
  height,
  onDistance,
}: {
  layout: CableLayoutOverlay
  edit?: CableChartEdit
  frame: CableChartFrame
  domain: Domain
  height: number
  onDistance?: (distance: number) => void
}) {
  const group = useRef<SVGGElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [sector, setSector] = useState<{ a: number; b: number } | null>(null)
  const latest = useRef({ edit, f, domain, layout })
  useEffect(() => {
    latest.current = { edit, f, domain, layout }
  })
  const dragRef = useRef<Drag | null>(null)
  // Handles by what they edit, to move the focus after a keyboard Delete.
  const handleNodes = useRef(new Map<SupportHandle, { focus: () => void }>())
  const [refocus, setRefocus] = useState<SupportHandle | null>(null)
  const setDragState = (next: Drag | null) => {
    dragRef.current = next
    setDrag(next)
  }

  /** Chart distance and elevation under a pointer, and whether it is inside the plot. */
  const toChart = (svg: SVGSVGElement, clientX: number, clientY: number) => {
    const { f, domain } = latest.current
    const r = svg.getBoundingClientRect()
    const tx = (clientX - r.left - f.left) / f.plotWidth
    const ty = (clientY - r.top - f.top) / f.plotHeight
    return {
      x: domain[0] + clamp(tx, 0, 1) * (domain[1] - domain[0]),
      z: domain[3] - clamp(ty, 0, 1) * (domain[3] - domain[2]),
      inside: tx >= 0 && tx <= 1 && ty >= 0 && ty <= 1,
    }
  }

  // Double-click to add and Shift-drag to draw a sector act on the whole chart, so they listen on
  // the svg itself; a Shift-press is kept from the chart's own cursor drag.
  useEffect(() => {
    const svg = group.current?.ownerSVGElement
    if (!svg || !edit) return
    const station = (x: number) => {
      const e = latest.current.edit!
      return stationFromChart({ lengthM: e.lengthM, yarderAtEnd: e.yarderAtEnd }, x)
    }
    const dblclick = (event: MouseEvent) => {
      const at = toChart(svg, event.clientX, event.clientY)
      if (!at.inside || (event.target as Element | null)?.closest?.('[data-support-handle]')) return
      event.preventDefault()
      latest.current.edit?.addSupport(station(at.x))
    }
    let cleanup: (() => void) | null = null
    const pointerdown = (event: globalThis.PointerEvent) => {
      if (event.button !== 0 || !event.shiftKey) return
      const at = toChart(svg, event.clientX, event.clientY)
      if (!at.inside) return
      event.stopPropagation()
      event.preventDefault()
      let current = { a: at.x, b: at.x }
      setSector(current)
      const move = (e: globalThis.PointerEvent) => {
        current = { a: current.a, b: toChart(svg, e.clientX, e.clientY).x }
        setSector(current)
      }
      const finish = (commit: boolean) => {
        cleanup?.()
        setSector(null)
        if (commit) latest.current.edit?.addSector(station(current.a), station(current.b))
      }
      const up = () => finish(true)
      const key = (e: globalThis.KeyboardEvent) => {
        if (e.key === 'Escape') finish(false)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('keydown', key)
      cleanup = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('keydown', key)
        cleanup = null
      }
    }
    svg.addEventListener('dblclick', dblclick)
    svg.addEventListener('pointerdown', pointerdown, { capture: true })
    return () => {
      svg.removeEventListener('dblclick', dblclick)
      svg.removeEventListener('pointerdown', pointerdown, { capture: true })
      cleanup?.()
    }
    // `toChart` reads the latest frame through a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(edit)])

  // Escape cancels a support drag.
  const dragging = Boolean(drag)
  useEffect(() => {
    if (!dragging) return
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setDragState(null)
      latest.current.edit?.preview(null)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [dragging])

  const editing = layout.editing
  const edited = edit?.edited
  // After Delete, focus the next handle once it is drawn; else an end's, else the chart itself.
  useEffect(() => {
    if (refocus === null) return
    const nodes = handleNodes.current
    const node = nodes.get(refocus) ?? nodes.get('end') ?? nodes.get('start')
    setRefocus(null)
    if (node) node.focus()
    else (group.current?.ownerSVGElement as { focus?: () => void } | null | undefined)?.focus?.()
  }, [refocus, edited])
  const frameOf = edit ? { lengthM: edit.lengthM, yarderAtEnd: edit.yarderAtEnd } : null

  /** The edited layout with `handle` changed. */
  const changed = (base: EditedLayout, handle: SupportHandle, patch: { stationM?: number; heightM?: number }) =>
    handle === 'start' || handle === 'end'
      ? patch.heightM === undefined
        ? base
        : setEndHeight(base, handle, patch.heightM)
      : moveSupport(base, handle, patch, edit!.lengthM)

  const supportOf = (base: EditedLayout, handle: SupportHandle) =>
    handle === 'start'
      ? { stationM: 0, heightM: base.start.heightM }
      : handle === 'end'
        ? { stationM: edit!.lengthM, heightM: base.end.heightM }
        : base.supports[handle]

  const onHandleDown = (event: PointerEvent<SVGElement>, handle: SupportHandle) => {
    if (event.button !== 0 || event.shiftKey || !edited) return
    event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setDragState({ handle, startX: event.clientX, startY: event.clientY, axis: null, candidate: null })
  }
  const onHandleMove = (event: PointerEvent<SVGElement>) => {
    const d = dragRef.current
    if (!d || !edited || !frameOf || !editing) return
    event.stopPropagation()
    const dx = event.clientX - d.startX
    const dy = event.clientY - d.startY
    let axis = d.axis
    if (!axis) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < MIN_SUPPORT_DRAG_PX) return
      axis = typeof d.handle === 'number' && Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y'
    }
    const svg = event.currentTarget.ownerSVGElement
    if (!svg) return
    const at = toChart(svg, event.clientX, event.clientY)
    const before = supportOf(edited, d.handle)
    let candidate: EditedLayout
    if (axis === 'x') candidate = changed(edited, d.handle, { stationM: stationFromChart(frameOf, at.x) })
    else {
      const ground = editing.groundAt(layout.supports.find((s) => s.handle === d.handle)?.x ?? at.x)
      if (ground === null) return
      candidate = changed(edited, d.handle, { heightM: at.z - ground })
    }
    const after = supportOf(candidate, d.handle)
    setDragState({ ...d, axis, candidate })
    edit!.preview(candidate)
    if (after.stationM !== before.stationM || axis === 'x') onDistance?.(stationFromChart(frameOf, after.stationM))
  }
  const onHandleUp = (event: PointerEvent<SVGElement>) => {
    const d = dragRef.current
    if (!d) return
    event.stopPropagation()
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    setDragState(null)
    if (d.candidate && d.candidate !== edited) edit?.commit(d.candidate)
    else if (frameOf && edited) onDistance?.(stationFromChart(frameOf, supportOf(edited, d.handle).stationM))
  }
  const onHandleKey = (event: KeyboardEvent<SVGElement>, handle: SupportHandle) => {
    if (!edited || !frameOf) return
    const big = event.shiftKey
    const s = supportOf(edited, handle)
    let next: EditedLayout | null = null
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      if (typeof handle !== 'number') return
      const x = stationFromChart(frameOf, s.stationM) + (event.key === 'ArrowRight' ? 1 : -1) * (big ? 10 : 1)
      next = changed(edited, handle, { stationM: stationFromChart(frameOf, x) })
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown')
      next = changed(edited, handle, { heightM: s.heightM + (event.key === 'ArrowUp' ? 1 : -1) * (big ? 2 : 0.5) })
    else if ((event.key === 'Delete' || event.key === 'Backspace') && typeof handle === 'number')
      next = removeSupport(edited, handle)
    else return
    event.preventDefault()
    event.stopPropagation()
    if (next !== edited) {
      edit!.commit(next)
      if (event.key === 'Delete' || event.key === 'Backspace')
        setRefocus(handleAfterDelete(handle as number, next.supports.length))
      if (typeof handle === 'number' && next.supports[handle] && event.key.startsWith('Arrow'))
        onDistance?.(stationFromChart(frameOf, next.supports[handle].stationM))
    }
  }

  const plotBottom = height - f.bottom
  const ghost = (() => {
    if (!drag?.candidate || !frameOf || !editing) return null
    const s = supportOf(drag.candidate, drag.handle)
    const x = stationFromChart(frameOf, s.stationM)
    const ground = editing.groundAt(x)
    if (ground === null) return null
    return { x, ground, top: ground + s.heightM, s }
  })()

  return (
    <g ref={group} data-testid="road-cable-edit-layer">
      {layout.focus?.range && (
        <rect
          data-testid="road-cable-focus-range"
          x={f.x(clamp(layout.focus.range[0], domain[0], domain[1]))}
          y={f.top}
          width={Math.max(
            1,
            f.x(clamp(layout.focus.range[1], domain[0], domain[1])) -
              f.x(clamp(layout.focus.range[0], domain[0], domain[1])),
          )}
          height={Math.max(0, plotBottom - f.top)}
          fill={MARK}
          opacity={0.07}
          pointerEvents="none"
        />
      )}
      {layout.focus?.points.map((p, i) => {
        const x = f.x(clamp(p.x, domain[0], domain[1]))
        const at = markLabelPlacement(x, p.label, 9, { left: f.left, right: f.left + f.plotWidth })
        return (
          <g key={`focus-${i}`} data-testid="road-cable-focus" pointerEvents="none">
            <line x1={x} x2={x} y1={f.top} y2={plotBottom} stroke={MARK} strokeWidth={1.4} strokeDasharray="3 2" />
            <text x={at.x} y={f.top + 9 + (i % 3) * 10} textAnchor={at.anchor} fontSize="9" fill={MARK}>
              {p.label}
            </text>
          </g>
        )
      })}
      {layout.supports.map((s, i) => (
        <g key={`identity-${i}`} pointerEvents="none">
          {s.category && <SupportSymbol category={s.category} cx={f.x(s.x)} cy={f.y(s.ground)} />}
          {s.name && (
            <text
              x={f.x(s.x)}
              y={f.y(s.top) - 14}
              textAnchor="middle"
              fontSize="8"
              fill="hsl(var(--muted-foreground))"
              data-testid="road-cable-support-name"
            >
              {short(s.name)}
            </text>
          )}
        </g>
      ))}
      {sector && (
        <rect
          data-testid="road-cable-sector-draft"
          x={f.x(Math.min(sector.a, sector.b))}
          y={f.top}
          width={Math.max(1, Math.abs(f.x(sector.b) - f.x(sector.a)))}
          height={Math.max(0, plotBottom - f.top)}
          fill={MARK}
          opacity={0.15}
          pointerEvents="none"
        />
      )}
      {ghost && (
        <g pointerEvents="none" data-testid="road-cable-support-ghost">
          <line
            x1={f.x(ghost.x)}
            x2={f.x(ghost.x)}
            y1={f.y(ghost.ground)}
            y2={f.y(ghost.top)}
            stroke={MARK}
            strokeWidth={2}
            strokeDasharray="4 2"
          />
          {(() => {
            const label = `${Math.round(ghost.s.stationM)} m · ${m1(ghost.s.heightM)}`
            const at = markLabelPlacement(f.x(ghost.x) + 3, label, 9, { left: f.left, right: f.left + f.plotWidth })
            return (
              <text x={at.x} y={f.y(ghost.top)} textAnchor={at.anchor} fontSize="9" fill={MARK}>
                {label}
              </text>
            )
          })()}
        </g>
      )}
      {edit &&
        edited &&
        layout.supports
          .filter((s) => s.handle !== undefined)
          .map((s) => {
            const handle = s.handle!
            const what =
              handle === 'start' ? 'Start support' : handle === 'end' ? 'End support' : `Support ${handle + 1}`
            const station = typeof handle === 'number' ? edited.supports[handle]?.stationM : null
            return (
              <circle
                key={`handle-${handle}`}
                data-support-handle={handle}
                data-testid="road-cable-support-handle"
                cx={f.x(s.x)}
                cy={f.y(s.top)}
                r={5}
                fill="hsl(var(--background))"
                stroke={MARK}
                strokeWidth={1.8}
                ref={(node) => {
                  if (node) handleNodes.current.set(handle, node)
                  else handleNodes.current.delete(handle)
                }}
                tabIndex={0}
                role="button"
                aria-roledescription="draggable support"
                aria-label={`${what}${s.name ? ` (${s.name})` : ''}${station === null || station === undefined ? '' : ` at ${Math.round(station)} m`}, ${m1(s.top - s.ground)} high. ${typeof handle === 'number' ? 'Drag or use the arrow keys to move it or change its height; Delete removes it.' : 'Drag up or down, or use the up and down arrow keys, to change its height.'}`}
                className="cursor-move outline-none focus-visible:stroke-[3px]"
                onPointerDown={(e) => onHandleDown(e, handle)}
                onPointerMove={onHandleMove}
                onPointerUp={onHandleUp}
                onPointerCancel={() => {
                  setDragState(null)
                  edit.preview(null)
                }}
                onKeyDown={(e) => onHandleKey(e, handle)}
              >
                <title>
                  {typeof handle === 'number'
                    ? `${what}: drag sideways to move, up or down to change the height`
                    : `${what}: drag up or down to change the height`}
                </title>
              </circle>
            )
          })}
    </g>
  )
}
