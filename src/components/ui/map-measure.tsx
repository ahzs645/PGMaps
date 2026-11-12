/**
 * The measure tool: distance, area or a circle, drawn with `MapSketch` and read in a
 * `MapToolPanel`. `/dev/interact` measures with the same sketch through `MapMeasureOverlay`
 * (its phone sheets); the forestry plans put `MapMeasurePanel` where their other tool cards go.
 *
 * A page keeps the sketch (`useMapSketch`), renders `<MapSketch sketch={…} />` inside its map,
 * and places the panel and a button that starts it. While a measurement is drawing the page's own
 * map clicks stand aside.
 */
import { useEffect, useRef } from 'react'
import { Circle, Pentagon, Redo2, Ruler, Spline, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MapToolPanel } from '@/components/ui/map-tool-panel'
import { ReadoutGrid } from '@/components/ui/readout-grid'
import { SegmentedControl } from '@/components/ui/segmented-control'
import type { MapSketchController } from '@/components/ui/map-sketch'
import { formatSketchArea, formatSketchDistance, type SketchShape, type SketchStats } from '@/lib/geo/mapSketch'
import { cn } from '@/lib/utils'

export const MEASURE_SHAPES: ReadonlyArray<{ value: SketchShape; label: string; icon: typeof Ruler }> = [
  { value: 'line', label: 'Distance', icon: Spline },
  { value: 'polygon', label: 'Area', icon: Pentagon },
  { value: 'circle', label: 'Circle', icon: Circle },
]

/** What a click does next, in the words a card shows. */
export function measureHint(shape: SketchShape, drawing: boolean, points: number, touch = false): string {
  const click = touch ? 'Tap' : 'Click'
  if (!drawing) return 'Measurement shown for this session only.'
  if (shape === 'circle') return points === 0 ? `${click} the centre.` : `${click} the edge to set the radius.`
  if (shape === 'line')
    return points < 2 ? `${click} to add points.` : `${click} to add points; double-click or Finish to end.`
  return points < 3 ? `${click} to add points.` : `${click} the first point or double-click to close.`
}

/** The measured values, each in metres, kilometres or hectares as the size calls for. */
export function measureReadout(shape: SketchShape, stats: SketchStats | null) {
  const distance = (km: number | undefined) => (km === undefined ? '—' : formatSketchDistance(km))
  const area = stats && stats.area > 0 ? formatSketchArea(stats.area) : '—'
  if (shape === 'line') return [{ label: 'Length', value: distance(stats?.length) }]
  if (shape === 'circle')
    return [
      { label: 'Radius', value: distance(stats?.radius) },
      { label: 'Circumference', value: distance(stats?.length) },
      { label: 'Area', value: area },
    ]
  return [
    { label: 'Perimeter', value: distance(stats?.length) },
    { label: 'Area', value: area },
  ]
}

/**
 * Keys while measuring: Escape closes the tool, Backspace takes the last point back and Enter
 * finishes. ⌘/Ctrl+Z stays the page's own undo. `accepts` filters keys a field or dialog keeps.
 */
export function useMeasureKeys(
  sketch: MapSketchController,
  { active, onClose, accepts }: { active: boolean; onClose: () => void; accepts?: (event: KeyboardEvent) => boolean },
) {
  const latest = useRef({ sketch, onClose, accepts })
  useEffect(() => {
    latest.current = { sketch, onClose, accepts }
  })
  useEffect(() => {
    if (!active) return
    const keyDown = (event: KeyboardEvent) => {
      const { sketch, onClose, accepts } = latest.current
      const target = event.target as Element | null
      if (accepts ? !accepts(event) : target?.closest?.('input, textarea, select, [contenteditable="true"]')) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === 'Escape') onClose()
      else if (event.key === 'Backspace') sketch.undo()
      else if (event.key === 'Enter' && sketch.canFinish) sketch.finish()
      else return
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener('keydown', keyDown, true)
    return () => window.removeEventListener('keydown', keyDown, true)
  }, [active])
}

/**
 * The measure tool's card: the shape, what to click, the values and Undo / Redo / Finish. Picking
 * another shape starts again. Closing it clears the measurement.
 */
export function MapMeasurePanel({
  sketch,
  onClose,
  className,
}: {
  sketch: MapSketchController
  onClose: () => void
  className?: string
}) {
  const { state, stats } = sketch
  const drawing = state.mode === 'drawing'
  return (
    <MapToolPanel
      title="Measure"
      icon={Ruler}
      aria-label="Measure"
      data-testid="map-measure-panel"
      help="Measures along the ground's map projection, great-circle, without terrain. A polygon's area is its plan area. The measurement is not saved."
      helpLabel="About measuring"
      onClose={onClose}
      closeLabel="Close measure"
      hint={measureHint(state.shape, drawing, state.points.length)}
      className={className}
      actions={
        <>
          <Button
            size="xs"
            variant="ghost"
            aria-label="Undo point"
            title="Undo point · Backspace"
            disabled={!sketch.canUndo}
            onClick={sketch.undo}
          >
            <Undo2 className="size-3.5" />
          </Button>
          <Button
            size="xs"
            variant="ghost"
            className="mr-auto"
            aria-label="Redo point"
            title="Redo point"
            disabled={!sketch.canRedo}
            onClick={sketch.redo}
          >
            <Redo2 className="size-3.5" />
          </Button>
          {drawing ? (
            <Button size="xs" disabled={!sketch.canFinish} onClick={sketch.finish}>
              {state.shape === 'polygon' ? 'Close polygon' : state.shape === 'circle' ? 'Set circle' : 'Finish line'}
            </Button>
          ) : (
            <Button size="xs" variant="outline" onClick={() => sketch.start(state.shape)}>
              Measure again
            </Button>
          )}
        </>
      }
    >
      <SegmentedControl
        label="Measure"
        size="sm"
        value={state.shape}
        options={MEASURE_SHAPES}
        onChange={(shape) => sketch.start(shape)}
      />
      {/* The points are numbered on the map, so the card keeps its width for the values. */}
      <ReadoutGrid
        data-testid="map-measure-readout"
        minColumnWidth="6.5rem"
        className="text-xs"
        items={measureReadout(state.shape, stats)}
      />
    </MapToolPanel>
  )
}

/**
 * A Measure button for a map's control stack (`MapControls`), the Layers button's size. It shows
 * pressed while the tool is open.
 */
export function MapMeasureControl({
  active,
  onToggle,
  disabled,
  title = 'Measure distance or area',
}: {
  active: boolean
  onToggle: () => void
  disabled?: boolean
  title?: string
}) {
  return (
    <div className="overflow-hidden rounded-md border border-border bg-background shadow-sm">
      <button
        type="button"
        aria-label="Measure"
        aria-pressed={active}
        title={title}
        disabled={disabled}
        onClick={onToggle}
        className={cn(
          'flex size-11 items-center justify-center transition-colors hover:bg-accent disabled:opacity-50 dark:hover:bg-accent/40 workspace-desktop:size-8',
          active && 'bg-accent text-accent-foreground dark:bg-accent/40',
        )}
      >
        <Ruler className="size-4" />
      </button>
    </div>
  )
}
