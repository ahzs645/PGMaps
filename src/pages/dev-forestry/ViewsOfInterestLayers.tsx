import { useMemo, useState } from 'react'

import { MapMarker, MapPopup, MarkerContent } from '@/components/ui/map'
import { MapFillLayer } from '@/components/ui/map-layers'
import { MapPopupCard } from '@/components/ui/map-popup-card'
import { MapTurnHandle } from '@/components/ui/map-turn-handle'
import { cn } from '@/lib/utils'

import type { PlanShow } from './planLayers'
import { VIEW_OF_INTEREST_COLORS } from './planMapStyle'
import type { PolygonGeometry } from './visibility'
import type { ViewOfInterest } from './viewsOfInterest'
import {
  chosenArrowCollection,
  groupMarks,
  nextMarkAt,
  viewConeLengthMeters,
  viewsOfInterestPlan,
} from './viewsOfInterestGeometry'

/**
 * The plan map's views of interest: each view's lens cone along its facing and a numbered point, the open one drawn
 * heavier; and the inventory arrows the views face along (and those the finder's open row would add, fainter). The
 * cones and arrows take no clicks. A point opens its row in step 2 (`onSelect`) and a card to stand there
 * (`onStand`), as an inventory viewpoint's does; a view placed on the map can be dragged (`onMove`). The open
 * view's handle rides its cone's arc and the cone turns with it as it is dragged (`MapTurnHandle`). The page passes
 * no `onSelect` or `onMove` while the road view is open, when a plan click moves the road view, and none of the three
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
  onTurn = null,
  onStand = null,
  standingViewId = null,
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
  /** Stands at a view (the capture's `standAt`): the click card's *Stand here*. Null while it cannot. */
  onStand?: ((id: string) => void) | null
  /** Turns a view to a compass bearing: the open view's cone tip is a handle, as the road view's own is. */
  onTurn?: ((id: string, bearing: number) => void) | null
  /**
   * The view the road view stands at: drawn by the road view's own viewer (its cone and handles), so its point and
   * cone are left out here rather than drawn twice.
   */
  standingViewId?: string | null
}) {
  // The bearing the open view's handle is being turned to. The cone follows it here, on the plan
  // alone; the view itself turns once, when the handle is let go (`onTurn`).
  const [turn, setTurn] = useState<{ id: string; bearing: number } | null>(null)
  const drawnViews = useMemo(
    () =>
      turn
        ? views.map((view) =>
            view.id === turn.id ? { ...view, facing: { kind: 'bearing' as const, degrees: turn.bearing } } : view,
          )
        : views,
    [views, turn],
  )
  const shownViews = useMemo(
    () => (standingViewId ? views.filter((view) => view.id !== standingViewId) : views),
    [views, standingViewId],
  )
  // Numbers stay the list's: a view left out here keeps the others' numbers.
  const plan = useMemo(() => {
    const full = viewsOfInterestPlan(drawnViews, blocks, openViewId)
    if (!standingViewId) return full
    return {
      marks: full.marks.filter((mark) => mark.id !== standingViewId),
      cones: { ...full.cones, features: full.cones.features.filter((feature) => feature.id !== standingViewId) },
    }
  }, [drawnViews, blocks, openViewId, standingViewId])
  // The open view's turn handle, on the middle of its cone's arc.
  const turning = useMemo(() => {
    if (!onTurn || !openViewId) return null
    const view = shownViews.find((entry) => entry.id === openViewId)
    const mark = plan.marks.find((entry) => entry.id === openViewId)
    if (!view || !mark || mark.bearing === null) return null
    const block = blocks.find((entry) => entry.id === view.blockId) ?? null
    return { view, bearing: mark.bearing, lengthMeters: viewConeLengthMeters(view, block) }
  }, [onTurn, openViewId, shownViews, plan.marks, blocks])
  const chosenArrows = useMemo(
    () => chosenArrowCollection(arrows, views, previewArrowIds, openViewId),
    [arrows, views, previewArrowIds, openViewId],
  )
  const viewsShown = visible && !hidden.has('view-of-interest')
  const arrowsShown = visible && !hidden.has('view-arrow') && chosenArrows.features.length > 0
  const sources = useMemo(() => new Map(views.map((view) => [view.id, view.source.kind])), [views])
  // Views at one place share a marker ("2·3"); a click there opens each in turn.
  const markers = useMemo(() => groupMarks(plan.marks), [plan.marks])
  // The view whose card is open: the one a click on its point chose.
  const [cardId, setCardId] = useState<string | null>(null)
  const card = useMemo(() => {
    if (!cardId || !onStand || !viewsShown) return null
    const mark = plan.marks.find((entry) => entry.id === cardId)
    const view = views.find((entry) => entry.id === cardId)
    if (!mark || !view) return null
    const marker = markers.find((entry) => entry.marks.some((other) => other.id === cardId))
    const blockMissing = !!view.blockId && !blocks.some((block) => block.id === view.blockId)
    return { mark, view, at: marker ?? mark, blockMissing }
  }, [cardId, onStand, viewsShown, plan.marks, views, markers, blocks])
  const clickable = !!onSelect || !!onStand
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
      {viewsShown && turning && onTurn && (
        <MapTurnHandle
          key={`turn-${turning.view.id}`}
          origin={turning.view}
          bearing={turning.bearing}
          lengthMeters={turning.lengthMeters}
          // Turning the view is the job now: its click card would only sit over the cone being turned.
          onTurnStart={() => setCardId(null)}
          onTurning={(bearing) => setTurn(bearing === null ? null : { id: turning.view.id, bearing })}
          onTurn={(bearing) => onTurn(turning.view.id, bearing)}
        >
          <span
            role="img"
            aria-label={`${turning.view.name}: drag to turn`}
            title="Drag to turn this view"
            data-testid="view-of-interest-turn"
            data-bearing={Math.round(turning.bearing)}
            className="fixed-palette block h-3.5 w-3.5 cursor-grab rounded-full border-2 bg-white shadow active:cursor-grabbing"
            style={{ borderColor: VIEW_OF_INTEREST_COLORS.view }}
          />
        </MapTurnHandle>
      )}
      {viewsShown &&
        markers.map((marker) => {
          const single = marker.marks.length === 1
          const movable = !!onMove && single && sources.get(marker.id) === 'map'
          const names = marker.marks.map((mark) => `${mark.number}. ${mark.name}`).join('; ')
          return (
            <MapMarker
              key={marker.id}
              longitude={marker.lng}
              latitude={marker.lat}
              draggable={movable}
              onClick={
                clickable
                  ? (event) => {
                      event.stopPropagation()
                      const id = onSelect
                        ? nextMarkAt(marker)
                        : (marker.marks.find((mark) => mark.id !== cardId)?.id ?? marker.id)
                      onSelect?.(id)
                      setCardId(id)
                    }
                  : undefined
              }
              onDragEnd={movable ? (point) => onMove?.(marker.id, point) : undefined}
            >
              <MarkerContent>
                <span
                  role="img"
                  aria-label={`View${single ? '' : 's'} ${marker.label}: ${marker.marks.map((mark) => mark.name).join('; ')}`}
                  title={`${names}${marker.included ? '' : ' (left out of exports)'}${clickable ? ' · click to stand here' : ''}${movable ? ' · drag to move' : ''}${single ? '' : ' · click again for the next'}`}
                  data-testid="view-of-interest-marker"
                  data-view-id={marker.id}
                  data-view-ids={marker.marks.map((mark) => mark.id).join(' ')}
                  className={cn(
                    'fixed-palette flex items-center justify-center rounded-full border-2 border-white font-semibold tabular-nums text-white shadow',
                    marker.open ? 'h-6 min-w-6 text-xs ring-2 ring-indigo-300' : 'h-5 min-w-5 text-2xs',
                    !single && 'px-1',
                    !marker.included && 'opacity-60',
                    clickable && 'cursor-pointer',
                  )}
                  style={{ backgroundColor: VIEW_OF_INTEREST_COLORS.view }}
                >
                  {marker.label}
                </span>
              </MarkerContent>
            </MapMarker>
          )
        })}
      {card && onStand && (
        <MapPopup key={card.view.id} longitude={card.at.lng} latitude={card.at.lat} onClose={() => setCardId(null)}>
          <MapPopupCard
            className="w-48"
            eyebrow={`View of interest ${card.mark.number}`}
            title={card.view.name}
            subtitle={card.blockMissing ? 'Its block is gone: choose another in its row.' : undefined}
            onClose={() => setCardId(null)}
            footerActions={[
              {
                label: 'Stand here',
                primary: true,
                disabled: card.blockMissing,
                onClick: () => {
                  setCardId(null)
                  onStand(card.view.id)
                },
              },
            ]}
          />
        </MapPopup>
      )}
    </>
  )
}
