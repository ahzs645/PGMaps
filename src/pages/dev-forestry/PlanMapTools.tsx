import { useEffect, type ReactNode } from 'react'
import { Car, MapPinPlus, Route, ScanEye, SquareDashed, Trees } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { FORM_INPUT_CLASS, StyledSelect } from '@/components/ui/form-field'
import { MapToolPanel } from '@/components/ui/map-tool-panel'
import { MapToolToggle } from '@/components/ui/map-tool-toggle'
import { cn } from '@/lib/utils'

import { ROUTE_VIEWSHED_HELP } from './RouteViewshedPanel'
import type { DrawMode } from './Sidebar'

/** The draw modes started from the plan map's own tools; the others start from the sidebar. */
export type PlanDrawTool = Extract<DrawMode, 'view' | 'corridor' | 'block' | 'wildlife-tree-patch'>
export const isPlanDrawTool = (mode: DrawMode): mode is PlanDrawTool =>
  mode === 'view' || mode === 'corridor' || mode === 'block' || mode === 'wildlife-tree-patch'

/**
 * The plan map's tool icons, in its control stack under Measure: place a view of interest, draw the road, draw a
 * block, and the route preview. Each puts its tool in hand and shows its card (`PlanMapToolCard`); files are still
 * imported from the sidebar.
 */
export function PlanMapToolButtons({
  drawMode,
  routePreviewOpen,
  routePreviewOn,
  addViewDisabled,
  patchDisabled,
  onDraw,
  onRoutePreview,
  look,
}: {
  drawMode: DrawMode
  routePreviewOpen: boolean
  /** The road viewshed is drawn on the plan, whether or not its card is open. */
  routePreviewOn: boolean
  /** Why a view cannot be placed now, or null. */
  addViewDisabled: string | null
  /** Why a wildlife tree patch cannot be drawn now, or null. */
  patchDisabled: string | null
  onDraw: (mode: PlanDrawTool | 'none') => void
  onRoutePreview: (open: boolean) => void
  /**
   * *Look from the road*: opens the road view on the scene's road, or, with none yet, asks for a click on a road the
   * basemap draws and opens it there.
   */
  look: { open: boolean; picking: boolean; disabled: string | null; onLook: () => void }
}) {
  const toggle = (mode: PlanDrawTool) => () => onDraw(drawMode === mode ? 'none' : mode)
  return (
    <>
      <MapToolToggle
        icon={Car}
        label="Look from the road"
        title={
          look.disabled ??
          (look.picking
            ? 'Look from the road · click a road on the map, or click here to stop'
            : 'Look from the road · opens the eye-level road view; with no road yet, click one on the map')
        }
        active={look.open || look.picking}
        disabled={!look.picking && !!look.disabled}
        onToggle={look.onLook}
      />
      <MapToolToggle
        icon={MapPinPlus}
        label="Add a view of interest"
        title={addViewDisabled ?? 'Add a view of interest · click the plan where the view stands'}
        active={drawMode === 'view'}
        disabled={drawMode !== 'view' && !!addViewDisabled}
        onToggle={toggle('view')}
      />
      <MapToolToggle
        icon={Route}
        label="Draw the road"
        title="Draw the road · click along it, double-click to end"
        active={drawMode === 'corridor'}
        onToggle={toggle('corridor')}
      />
      <MapToolToggle
        icon={SquareDashed}
        label="Draw block"
        title="Draw a cutblock · click its corners, double-click to close"
        active={drawMode === 'block'}
        onToggle={toggle('block')}
      />
      <MapToolToggle
        icon={Trees}
        label="Draw a wildlife tree patch"
        title={patchDisabled ?? 'Draw a wildlife tree patch · kept standing in the run; the road view stays open'}
        active={drawMode === 'wildlife-tree-patch'}
        disabled={drawMode !== 'wildlife-tree-patch' && !!patchDisabled}
        onToggle={toggle('wildlife-tree-patch')}
      />
      <MapToolToggle
        icon={ScanEye}
        label="Route preview"
        title={`Route preview · terrain seen from the road${routePreviewOn ? ' · on' : ''}`}
        active={routePreviewOpen}
        on={routePreviewOn}
        onToggle={() => onRoutePreview(!routePreviewOpen)}
      />
    </>
  )
}

const DRAW_CARDS = {
  corridor: { title: 'Draw the road', icon: Route, noun: 'road' },
  block: { title: 'Draw block', icon: SquareDashed, noun: 'cutblock' },
  'wildlife-tree-patch': { title: 'Draw a wildlife tree patch', icon: Trees, noun: 'patch' },
} as const

/** The card of the plan tool in hand, for the plan's top-left corner. Escape puts a drawing tool down. */
export function PlanMapToolCard({
  drawMode,
  pointCount,
  onFinish,
  onCancel,
  view,
  routePreview,
  routePreviewSummary,
  onCloseRoutePreview,
}: {
  drawMode: DrawMode
  pointCount: number
  onFinish: () => void
  onCancel: () => void
  view: {
    blocks: ReadonlyArray<{ id: string; name: string }>
    blockId: string | null
    onBlockId: (id: string) => void
    /** Placed from step 1's *Assess from: A view*: the assessment runs from it once placed. */
    assessing: boolean
  }
  /** The route preview's controls while its card is open, else null. */
  routePreview: ReactNode | null
  routePreviewSummary: string
  onCloseRoutePreview: () => void
}) {
  const drawing = isPlanDrawTool(drawMode) ? drawMode : null
  useEffect(() => {
    if (!drawing) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawing, onCancel])

  if (drawing === 'view') {
    const facing = view.blocks.find((block) => block.id === view.blockId)?.name ?? 'the block'
    return (
      <MapToolPanel
        title="Add a view of interest"
        icon={MapPinPlus}
        aria-label="Add a view of interest"
        data-testid="plan-tool-card"
        closeLabel="Cancel placing"
        onClose={onCancel}
        hint={`Click the plan where the view stands, facing ${facing}.${view.assessing ? ' The assessment then runs from it.' : ''}`}
      >
        {view.blocks.length > 1 && !view.assessing && (
          <StyledSelect
            aria-label="Block a new view is for"
            className={cn(FORM_INPUT_CLASS, 'w-full py-1 text-xs')}
            value={view.blockId ?? ''}
            onValueChange={view.onBlockId}
          >
            {view.blocks.map((block) => (
              <option key={block.id} value={block.id}>
                For {block.name}
              </option>
            ))}
          </StyledSelect>
        )}
      </MapToolPanel>
    )
  }
  if (drawing) {
    const road = drawing === 'corridor'
    const { title, icon, noun } = DRAW_CARDS[drawing]
    return (
      <MapToolPanel
        title={title}
        icon={icon}
        aria-label={title}
        data-testid="plan-tool-card"
        closeLabel="Cancel drawing"
        onClose={onCancel}
        hint={`Click the map to trace the ${noun}; double-click or Finish to ${road ? 'end the line' : 'close the shape'}.`}
        status={`${pointCount} ${pointCount === 1 ? 'point' : 'points'} added`}
        actions={
          <>
            <Button variant="outline" size="sm" className="touch:h-10" onClick={onCancel}>
              Cancel drawing
            </Button>
            <Button size="sm" className="touch:h-10" disabled={pointCount < (road ? 2 : 3)} onClick={onFinish}>
              Finish drawing
            </Button>
          </>
        }
      />
    )
  }
  if (routePreview)
    return (
      <MapToolPanel
        title="Route preview"
        icon={ScanEye}
        aria-label="Route preview"
        data-testid="plan-tool-card"
        help={ROUTE_VIEWSHED_HELP}
        helpLabel="About route preview"
        closeLabel="Close route preview"
        closeKeys=""
        onClose={onCloseRoutePreview}
        hint={routePreviewSummary}
      >
        {routePreview}
      </MapToolPanel>
    )
  return null
}
