import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { cn } from '@/lib/utils'
import {
  normalizeFractions,
  readStoredSizes,
  resizeFractions,
  resizeStacked,
  writeStoredSizes,
  type PaneLimits,
} from './pane-sizes'

export type ResizablePane = {
  id: string
  /** Names the pane in its separator's accessible label, e.g. "plan" in "Resize plan and profile". */
  label: string
  content: ReactNode
  /** Relative share of the split, before any stored size. */
  size?: number
  /** Pixel limits along the split direction. */
  min?: number
  max?: number
  /** Height when the panes stack on a narrow screen; `auto` for a pane that holds a nested split. */
  stackedHeight?: number | 'auto'
  className?: string
}

const STEP = 16

/**
 * Panes separated by draggable, keyboard-operable boundaries. `row` puts panes side by side
 * (drag left/right) and `column` stacks them (drag up/down); a `column` split needs a parent
 * of definite height. Below `splitQuery` every split stacks with its own pixel heights and a
 * handle under each fixed-height pane, so a phone page still resizes vertically. Sizes are
 * remembered per `storageKey`; double-click a boundary to restore the defaults.
 */
export function ResizableSplit({
  direction,
  panes,
  storageKey,
  splitQuery = '(min-width: 1280px)',
  className,
  ...props
}: {
  direction: 'row' | 'column'
  panes: ResizablePane[]
  storageKey?: string
  splitQuery?: string
  className?: string
} & Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'className'>) {
  const split = useMediaQuery(splitQuery)
  const container = useRef<HTMLDivElement>(null)
  const defaults = normalizeFractions(
    panes.map((pane) => pane.size ?? 1),
    panes.length,
  )
  const stackedDefaults = panes.map((pane) => (pane.stackedHeight === 'auto' ? 0 : (pane.stackedHeight ?? 360)))
  const stackedKey = storageKey && `${storageKey}:stacked`
  const [fractions, setFractions] = useState(
    () => normalizeFractions(readStoredSizes(storageKey, panes.length) ?? defaults, panes.length),
  )
  const [heights, setHeights] = useState(() => readStoredSizes(stackedKey, panes.length) ?? stackedDefaults)
  const [keys, setKeys] = useState({ storageKey, count: panes.length })
  if (keys.storageKey !== storageKey || keys.count !== panes.length) {
    // A different layout keeps its own sizes.
    setKeys({ storageKey, count: panes.length })
    setFractions(normalizeFractions(readStoredSizes(storageKey, panes.length) ?? defaults, panes.length))
    setHeights(readStoredSizes(stackedKey, panes.length) ?? stackedDefaults)
  }
  const drag = useRef<{ index: number; start: number; fractions: number[]; heights: number[]; size: number } | null>(
    null,
  )
  const [dragging, setDragging] = useState<number | null>(null)
  const isDragging = dragging !== null
  useEffect(() => {
    if (!isDragging) return
    const previous = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    return () => {
      document.body.style.userSelect = previous
    }
  }, [isDragging])

  const row = split && direction === 'row'
  const limits: PaneLimits[] = panes.map((pane) =>
    split ? { min: pane.min ?? 120, max: pane.max } : { min: Math.min(pane.min ?? 160, 160), max: 2400 },
  )
  const separators = (split ? panes.length - 1 : panes.filter((pane) => pane.stackedHeight !== 'auto').length) * 12
  const available = () => {
    const box = container.current?.getBoundingClientRect()
    return Math.max(1, (row ? (box?.width ?? 0) : (box?.height ?? 0)) - separators)
  }
  const persist = (next: { fractions: number[]; heights: number[] }) =>
    split ? writeStoredSizes(storageKey, next.fractions) : writeStoredSizes(stackedKey, next.heights)

  const onPointerDown = (event: PointerEvent<HTMLDivElement>, index: number) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { index, start: row ? event.clientX : event.clientY, fractions, heights, size: available() }
    setDragging(index)
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (!current) return
    const delta = (row ? event.clientX : event.clientY) - current.start
    if (split) setFractions(resizeFractions(current.fractions, current.index, delta, current.size, limits))
    else setHeights(resizeStacked(current.heights, current.index, delta, limits))
  }
  const endDrag = () => {
    if (!drag.current) return
    drag.current = null
    setDragging(null)
    persist({ fractions, heights })
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, index: number) => {
    const back = row ? 'ArrowLeft' : 'ArrowUp',
      forward = row ? 'ArrowRight' : 'ArrowDown'
    if (event.key !== back && event.key !== forward) return
    event.preventDefault()
    const delta = (event.key === forward ? 1 : -1) * (event.shiftKey ? STEP * 4 : STEP)
    const next = split
      ? { fractions: resizeFractions(fractions, index, delta, available(), limits), heights }
      : { fractions, heights: resizeStacked(heights, index, delta, limits) }
    setFractions(next.fractions)
    setHeights(next.heights)
    persist(next)
  }
  const reset = () => {
    setFractions(defaults)
    setHeights(stackedDefaults)
    if (split) writeStoredSizes(storageKey, null)
    else writeStoredSizes(stackedKey, null)
  }

  return (
    <div
      ref={container}
      className={cn('flex min-h-0 min-w-0', row ? 'flex-row' : 'flex-col', className)}
      data-split={split ? direction : 'stacked'}
      {...props}
    >
      {panes.map((pane, index) => {
        const next = panes[index + 1]
        const handle = split ? !!next : pane.stackedHeight !== 'auto'
        const total = split ? fractions[index] * 100 : heights[index]
        return (
          <Fragment key={pane.id}>
            <div
              id={`pane-${pane.id}`}
              data-pane={pane.id}
              className={cn('flex min-h-0 min-w-0 flex-col', pane.className)}
              style={
                split
                  ? { flex: `${fractions[index]} 1 0px` }
                  : pane.stackedHeight === 'auto'
                    ? { flex: 'none' }
                    : { flex: 'none', height: heights[index] }
              }
            >
              {pane.content}
            </div>
            {handle && (
              <div
                role="separator"
                tabIndex={0}
                aria-orientation={row ? 'vertical' : 'horizontal'}
                aria-label={split ? `Resize ${pane.label} and ${next!.label}` : `Resize ${pane.label} height`}
                aria-controls={`pane-${pane.id}`}
                aria-valuenow={Math.round(total)}
                aria-valuemin={split ? 0 : limits[index].min}
                aria-valuemax={split ? 100 : limits[index].max}
                title="Drag to resize · double-click to reset"
                data-dragging={dragging === index || undefined}
                className={cn(
                  'group relative flex shrink-0 touch-none items-center justify-center outline-none',
                  row ? 'w-3 cursor-col-resize' : 'h-3 cursor-row-resize',
                )}
                onPointerDown={(event) => onPointerDown(event, index)}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onLostPointerCapture={endDrag}
                onKeyDown={(event) => onKeyDown(event, index)}
                onDoubleClick={reset}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'rounded-full bg-border transition-colors group-hover:bg-primary/60 group-focus-visible:bg-primary group-data-[dragging]:bg-primary',
                    row ? 'h-10 w-1' : 'h-1 w-10',
                  )}
                />
              </div>
            )}
          </Fragment>
        )
      })}
    </div>
  )
}

