import { useMemo } from 'react'

import { MapMarker, MarkerContent } from '@/components/ui/map'
import { MapFillLayer } from '@/components/ui/map-layers'
import { cn } from '@/lib/utils'

import type { PlanShow } from './planLayers'
import { VIEW_OF_INTEREST_COLORS } from './planMapStyle'
import type { PolygonGeometry } from './visibility'
import type { ViewOfInterest } from './viewsOfInterest'
import { chosenArrowCollection, viewsOfInterestPlan } from './viewsOfInterestGeometry'

/**
 * The plan map's views of interest: each view's lens cone along its facing and a numbered point, the open one drawn
 * heavier; and the inventory arrows the views face along (and those the finder's open row would add, fainter). The
 * cones and arrows take no clicks. A point opens its row in step 2 (`onSelect`) and a view placed on the map can be
 * dragged (`onMove`); the page passes neither while the road view is open, when a plan click moves the road view, or
 * while something else is being drawn or picked.
 */
export function ViewsOfInterestLayers({
  views,
  blocks,
  openViewId,
  arrows,
  previewArrowIds,
  hidden,
  visible = true,
  onSelect,
  onMove,
}: {
  views: readonly ViewOfInterest[]
  blocks: ReadonlyArray<{ id: string; geometry: PolygonGeometry }>
  openViewId: string | null
  /** The inventory's arrows as the plan draws them (features carrying `arrowId`). */
  arrows: GeoJSON.FeatureCollection
  /** Arrows the finder's open row would add. */
  previewArrowIds: readonly string[]
  hidden: PlanShow['hidden']
  visible?: boolean
  onSelect: ((id: string) => void) | null
  onMove: ((id: string, point: { lng: number; lat: number }) => void) | null
}) {
  const plan = useMemo(() => viewsOfInterestPlan(views, blocks, openViewId), [views, blocks, openViewId])
  const chosenArrows = useMemo(
    () => chosenArrowCollection(arrows, views, previewArrowIds, openViewId),
    [arrows, views, previewArrowIds, openViewId],
  )
  const viewsShown = visible && !hidden.has('view-of-interest')
  const arrowsShown = visible && !hidden.has('view-arrow') && chosenArrows.features.length > 0
  const sources = useMemo(() => new Map(views.map((view) => [view.id, view.source.kind])), [views])
  return (
    <>
      <MapFillLayer
        data={chosenArrows}
        visible={arrowsShown}
        interactive={false}
        fillColor={VIEW_OF_INTEREST_COLORS.arrow}
        fillOpacity={['case', ['==', ['get', 'preview'], 1], 0.12, 0.35] as never}
        lineColor={VIEW_OF_INTEREST_COLORS.arrow}
        lineWidth={['case', ['==', ['get', 'open'], 1], 3.5, ['==', ['get', 'preview'], 1], 1.5, 2.5] as never}
        lineOpacity={0.95}
        sourceKey="forestry-views-of-interest-arrows"
      />
      <MapFillLayer
        data={plan.cones}
        visible={viewsShown && plan.cones.features.length > 0}
        interactive={false}
        fillColor={VIEW_OF_INTEREST_COLORS.view}
        fillOpacity={['case', ['==', ['get', 'open'], 1], 0.2, ['==', ['get', 'included'], 0], 0.03, 0.08] as never}
        lineColor={VIEW_OF_INTEREST_COLORS.view}
        lineWidth={['case', ['==', ['get', 'open'], 1], 2, 1] as never}
        lineOpacity={0.85}
        sourceKey="forestry-views-of-interest-cones"
      />
      {viewsShown &&
        plan.marks.map((mark) => {
          const movable = !!onMove && sources.get(mark.id) === 'map'
          return (
            <MapMarker
              key={mark.id}
              longitude={mark.lng}
              latitude={mark.lat}
              draggable={movable}
              onClick={
                onSelect
                  ? (event) => {
                      event.stopPropagation()
                      onSelect(mark.id)
                    }
                  : undefined
              }
              onDragEnd={movable ? (point) => onMove?.(mark.id, point) : undefined}
            >
              <MarkerContent>
                <span
                  role="img"
                  aria-label={`View ${mark.number}: ${mark.name}`}
                  title={`${mark.number}. ${mark.name}${mark.included ? '' : ' (left out of exports)'}${movable ? ' · drag to move' : ''}`}
                  data-testid="view-of-interest-marker"
                  data-view-id={mark.id}
                  className={cn(
                    'fixed-palette flex items-center justify-center rounded-full border-2 border-white font-semibold tabular-nums text-white shadow',
                    mark.open ? 'h-6 w-6 text-xs ring-2 ring-indigo-300' : 'h-5 w-5 text-2xs',
                    !mark.included && 'opacity-60',
                    onSelect && 'cursor-pointer',
                  )}
                  style={{ backgroundColor: VIEW_OF_INTEREST_COLORS.view }}
                >
                  {mark.number}
                </span>
              </MarkerContent>
            </MapMarker>
          )
        })}
    </>
  )
}
