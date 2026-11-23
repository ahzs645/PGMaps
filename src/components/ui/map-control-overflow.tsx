/**
 * A map's stacked tool buttons that keep within the map: when the stack would run under the legend, MapLibre's
 * attribution, a phone's bottom sheet or off the map, the lowest-priority tools fold into a More menu at the foot
 * of the stack (`docs/shared-ui.md`, **Map overlays**). Render it inside `MapControls` with `showZoom={false}` and
 * `className="items-end"`: the zoom pair is one of its items (`zoom`), so a touch screen, which pinches, can fold it
 * first, and a two-column stack does not stretch it.
 *
 * The room is measured, not guessed: a hidden strip in the map container ends where the bottom-right chrome
 * begins (the same CSS variables that chrome stacks on), so a legend opened, a sheet dragged or a pane resized
 * folds or unfolds tools at once. The rule is `mapControlOverflow.ts`.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Ellipsis, Minus, Plus, type LucideIcon } from 'lucide-react'
import { ActionMenu, type ActionMenuItem } from '@/components/ui/action-menu'
import { useMap } from '@/components/ui/map-context'
import { useElementSize } from '@/hooks/useElementSize'
import { cn } from '@/lib/utils'
import { foldControls, steadySlots } from './mapControlOverflow'

type MapControlMenuRow = {
  icon: LucideIcon
  label: string
  /** Why it is off, or what it does, under the label. */
  description?: string
  /** The tool is in hand. */
  pressed?: boolean
  disabled?: boolean
  /** Keep the menu open after choosing it (zoom steps). */
  keepOpen?: boolean
  onSelect: () => void
}

export type MapControlOverflowItem = {
  id: string
  /** Higher stays in the stack longer. */
  priority: number
  /** The control as it sits in the stack (a `MapToolToggle`, a `MapLayersControl`…). */
  node: ReactNode
  /** Squares it takes in the stack (2 for a pair); 1 when left out. */
  slots?: number
  /** Its rows in the More menu. Leave it out for a control that never folds, such as Layers. */
  menu?: MapControlMenuRow | readonly MapControlMenuRow[]
}

/** Where the bottom-right chrome begins, measured up from the map's bottom edge (`MapControls`' own variables). */
const BOTTOM_RESERVE =
  'calc(var(--map-mobile-sheet-visible-height, 0px) + var(--map-safe-bottom-offset, 0px) + var(--map-timeline-height, 0px) + var(--map-legend-panel-visible-height, 0px) + var(--map-bottom-right-controls-height, 0px) + 0.5rem)'

/** The stack's square: 44 px on a phone, 32 px in a desktop workspace, 44 px there too under a finger. */
export const MAP_CONTROL_SQUARE = 'size-11 workspace-desktop:size-8 touch:!size-11'

/** One control square's size and the stack's gap, read from what is drawn. */
function readStack(group: HTMLElement | null): { size: number; gap: number } {
  // The tallest: a page's own control and the toolkit's may differ (44 and 32 px) at one width.
  const items = [...(group?.querySelectorAll<HTMLElement>('[data-map-control-item]:not([data-slots])') ?? [])]
  const size = Math.max(0, ...items.map((item) => item.offsetHeight)) || 44
  const gap = group?.parentElement ? parseFloat(getComputedStyle(group.parentElement).rowGap) || 6 : 6
  return { size, gap }
}

/**
 * A legend panel in the stack's column (the toolkit's `MapLegendPanel`, which sits on the bottom-right chrome). Its
 * footprint is published as `--map-legend-panel-visible-height` only while it is found in that corner, which a phone's
 * sheet sliding over it can miss, so the stack also reads where the legend is drawn.
 */
function legendBeside(container: HTMLElement, group: HTMLElement | null): HTMLElement | null {
  const column = group?.getBoundingClientRect()
  if (!column) return null
  // The nearest ancestor holding a legend: a page draws it beside its map, not inside the map's own container.
  let panels: HTMLElement[] = []
  for (let scope = container.parentElement; scope && !panels.length; scope = scope.parentElement)
    panels = [...scope.querySelectorAll<HTMLElement>('[data-map-legend-panel]')]
  for (const panel of panels) {
    const rect = panel.getBoundingClientRect()
    const box = container.getBoundingClientRect()
    const inMap = rect.height > 0 && rect.left < box.right && rect.right > box.left
    if (inMap && rect.left < column.right && rect.right > column.left) return panel
  }
  return null
}

/** Where a legend in the stack's column begins, in the map container's coordinates; infinite without one. */
function legendTop(container: HTMLElement, group: HTMLElement, gap: number): number {
  const legend = legendBeside(container, group)
  if (!legend) return Number.POSITIVE_INFINITY
  const box = container.getBoundingClientRect()
  const top = legend.getBoundingClientRect().top - box.top
  // A legend above the stack's top (pushed up by a full sheet) is not under it.
  return top > group.getBoundingClientRect().top - box.top ? top - gap : Number.POSITIVE_INFINITY
}

const rowsOf = (menu: MapControlOverflowItem['menu']): readonly MapControlMenuRow[] =>
  !menu ? [] : 'label' in menu ? [menu as MapControlMenuRow] : (menu as readonly MapControlMenuRow[])

/** The zoom pair, drawn as `MapControls` draws its own. */
function ZoomPair({ onZoom }: { onZoom: (step: 1 | -1) => void }) {
  const button = 'flex items-center justify-center transition-colors hover:bg-accent dark:hover:bg-accent/40'
  return (
    <div className="flex flex-col overflow-hidden rounded-md border border-border bg-background shadow-sm">
      <button
        type="button"
        aria-label="Zoom in"
        className={cn(button, MAP_CONTROL_SQUARE, 'border-b border-border')}
        onClick={() => onZoom(1)}
      >
        <Plus className="size-4" />
      </button>
      <button type="button" aria-label="Zoom out" className={cn(button, MAP_CONTROL_SQUARE)} onClick={() => onZoom(-1)}>
        <Minus className="size-4" />
      </button>
    </div>
  )
}

export function MapControlOverflow({
  items: pageItems,
  label = 'More map tools',
  maxColumns = 2,
  zoom,
}: {
  items: readonly MapControlOverflowItem[]
  /** The More button's name and the menu's. */
  label?: string
  /** Columns the stack may take before it hides a pinned control or the More button. */
  maxColumns?: number
  /** Draw the zoom pair first in the stack, folding at this priority (pass `showZoom={false}` to `MapControls`). */
  zoom?: { priority: number }
}) {
  const { map } = useMap()
  const container = map?.getContainer() ?? null
  const sentinelRef = useRef<HTMLDivElement>(null)
  const groupRef = useRef<HTMLDivElement>(null)
  const reserve = useElementSize(sentinelRef as RefObject<HTMLElement>)
  const [slots, setSlots] = useState<number | null>(null)
  const [stack, setStack] = useState({ size: 44, gap: 6 })
  const [legend, setLegend] = useState<HTMLElement | null>(null)
  // A legend opened or closed resizes it without moving anything the strip follows, and it slides with a phone's sheet
  // on a transition of its own, after the strip has moved: both measure the stack again.
  const legendSize = useElementSize(legend)
  const [settled, setSettled] = useState(0)
  useEffect(() => {
    if (!legend) return
    const settle = () => setSettled((count) => count + 1)
    legend.addEventListener('transitionend', settle)
    return () => legend.removeEventListener('transitionend', settle)
  }, [legend])
  useLayoutEffect(() => {
    if (container) setLegend(legendBeside(container, groupRef.current))
  }, [container, reserve.height, settled])

  const zoomBy = (step: 1 | -1) => map?.zoomTo(map.getZoom() + step, { duration: 300 })
  const items: readonly MapControlOverflowItem[] = zoom
    ? [
        {
          id: 'zoom',
          priority: zoom.priority,
          slots: 2,
          node: <ZoomPair onZoom={zoomBy} />,
          menu: [
            { icon: Plus, label: 'Zoom in', keepOpen: true, onSelect: () => zoomBy(1) },
            { icon: Minus, label: 'Zoom out', keepOpen: true, onSelect: () => zoomBy(-1) },
          ],
        },
        ...pageItems,
      ]
    : pageItems

  // The room is the strip's height less where the group starts (under the compass). Neither depends on how many
  // tools are folded, so this cannot feed itself.
  useLayoutEffect(() => {
    const group = groupRef.current
    if (!group || !container || !reserve.height) return
    const measured = readStack(group)
    if (measured.size !== stack.size || measured.gap !== stack.gap) setStack(measured)
    const box = container.getBoundingClientRect()
    const top = group.getBoundingClientRect().top - box.top
    const next = steadySlots(
      Math.min(reserve.height, legendTop(container, group, measured.gap)) - top,
      measured.size,
      measured.gap,
      slots,
    )
    if (next !== slots) setSlots(next)
  }, [container, reserve.height, legendSize.height, settled, items.length, stack.size, stack.gap, slots])

  const fold = foldControls(
    items.map((item) => ({ id: item.id, priority: item.priority, slots: item.slots, pinned: !item.menu })),
    slots ?? Number.MAX_SAFE_INTEGER,
    maxColumns,
  )
  const byId = new Map(items.map((item) => [item.id, item]))
  const rows = fold.folded.flatMap((id) =>
    rowsOf(byId.get(id)!.menu).map((row, index) => ({ id: `${id}-${index}`, row })),
  )
  const pressed = rows.some(({ row }) => row.pressed)
  const menuItems: ActionMenuItem[] = rows.map(({ id, row }) => {
    const { icon: Icon } = row
    return {
      id,
      label: row.label,
      description: row.description,
      icon: <Icon className="size-4" />,
      // Only a tool that can be in hand is a checkbox row; a zoom step is a plain action.
      checked: row.pressed === undefined ? undefined : row.pressed,
      disabled: row.disabled,
      keepOpen: row.keepOpen,
      onSelect: row.onSelect,
    }
  })
  const columns = rows.length ? fold.columns : 1
  const height = columns > 1 ? fold.slotsPerColumn * (stack.size + stack.gap) - stack.gap : undefined

  return (
    <>
      {container &&
        createPortal(
          <div
            ref={sentinelRef}
            aria-hidden="true"
            data-map-control-room=""
            className="pointer-events-none invisible absolute right-0 top-0 w-px"
            style={{ bottom: BOTTOM_RESERVE }}
          />,
          container,
        )}
      <div
        ref={groupRef}
        data-map-control-overflow=""
        data-folded={fold.folded.length || undefined}
        // A second column opens to the left of the first, towards the map's middle.
        className="flex flex-col flex-wrap-reverse content-start gap-1.5 self-end"
        style={height ? { maxHeight: height } : undefined}
      >
        {fold.inline.map((id) => {
          const item = byId.get(id)!
          return (
            <div
              key={id}
              data-map-control-item=""
              data-slots={(item.slots ?? 1) > 1 ? item.slots : undefined}
              className="flex justify-end"
            >
              {item.node}
            </div>
          )
        })}
        {rows.length > 0 && (
          <div data-map-control-item="" className="flex justify-end">
            <div className="overflow-hidden rounded-md border border-border bg-background shadow-sm">
              <ActionMenu
                label={label}
                items={menuItems}
                width={248}
                trigger={
                  <span className={cn('relative flex items-center justify-center', MAP_CONTROL_SQUARE)}>
                    <Ellipsis className="size-4" aria-hidden="true" />
                    {pressed && (
                      <span className="absolute right-1 top-1 size-1.5 rounded-full bg-primary" aria-hidden="true" />
                    )}
                  </span>
                }
                triggerClassName={cn(
                  'flex items-center justify-center transition-colors hover:bg-accent dark:hover:bg-accent/40',
                  pressed && 'bg-accent text-accent-foreground dark:bg-accent/40',
                )}
              />
            </div>
          </div>
        )}
      </div>
    </>
  )
}
