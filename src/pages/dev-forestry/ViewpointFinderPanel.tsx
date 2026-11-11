import { Loader2, MapPin, Radar } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { CollapsibleSection, InlineAlert } from '@/components/ui/map-panels'
import { cn } from '@/lib/utils'

import type { ReverseRoadResult } from './reverseViewshed'
import { ARROW_AIM_DEGREES, type ViewpointCandidate, type ViewpointInventory } from './viewpointInventory'
import { compassPoint } from './visualsNarrative'

export type ViewpointInventoryState = {
  status: 'idle' | 'loading' | 'ready' | 'error'
  data: ViewpointInventory | null
  error: string | null
  /** The block the inventory was read around. */
  blockId: string | null
}

/** Reverse-run classes that mark a viewpoint row rather than a road. */
export const VIEWPOINT_ROAD_CLASSES: ReadonlySet<string> = new Set(['vli-viewpoint', 'rec-site'])

/**
 * Step 1: the places BC's inventories say a block is looked at from — Visual
 * Landscape Inventory viewpoints with their direction arrows, and recreation
 * sites — ranked nearest and aimed-at-the-block first, then checked by the
 * same reverse sightlines as "Which roads see the block".
 */
export function ViewpointFinderPanel({
  blockName,
  state,
  candidates,
  reverseRows,
  reverseRunning,
  onLoad,
  onCheck,
  onUse,
  onShow,
  standingName = null,
  backName = null,
  onBack,
}: {
  blockName: string | null
  state: ViewpointInventoryState
  candidates: ReadonlyArray<ViewpointCandidate>
  /** The last reverse run's rows, by candidate key. */
  reverseRows: ReadonlyMap<string, ReverseRoadResult>
  reverseRunning: boolean
  onLoad: () => void
  onCheck: () => void
  onUse: (candidate: ViewpointCandidate) => void
  onShow: (candidate: ViewpointCandidate) => void
  /** Where you are standing now, if a stand replaced the road. */
  standingName?: string | null
  backName?: string | null
  onBack?: () => void
}) {
  const data = state.data
  const shown = candidates.slice(0, 10)
  return (
    <CollapsibleSection
      label="Viewpoints and rec sites"
      toggleProps={{ 'data-forestry-disclosure': 'inventory-viewpoints' }}
      // The section remounts after the road view; once loaded, it reopens on its list.
      defaultOpen={!!data}
      summary={
        data
          ? `${data.viewpoints.length} viewpoints · ${data.arrows.length} arrows · ${data.recSites.length} rec sites`
          : 'BC Visual Landscape Inventory'
      }
      summaryWhenCollapsedOnly
      className="-mx-4 border-b-0 border-t border-border/60"
    >
      {standingName && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-md border border-primary/40 bg-primary/5 p-2 text-2xs">
          <span className="min-w-0">
            Standing at <span className="font-medium text-foreground">{standingName}</span>
          </span>
          {onBack && backName && (
            <Button type="button" variant="outline" size="sm" className="h-7 shrink-0 px-2 text-2xs" onClick={onBack}>
              Back to {backName}
            </Button>
          )}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="flex-1"
          disabled={!blockName || state.status === 'loading'}
          onClick={onLoad}
        >
          {state.status === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
          {state.status === 'loading' ? 'Reading DataBC…' : data ? 'Reload around the block' : 'Load around the block'}
        </Button>
        <InfoTip label="About the viewpoint layers">
          VLI viewing points and their landscape arrows (WHSE_FOREST_VEGETATION), recreation sites, inventory screenings
          and tenure road names (WHSE_FOREST_TENURE), read live from DataBC within 12 km of the block. The arrows carry
          no bearing of their own, so each is read from its viewpoint to its tip. An arrow within {ARROW_AIM_DEGREES}°
          of the block ranks its viewpoint higher; one aimed elsewhere does not drop it, because people at a site look
          around. Every viewpoint in the inventory carries a past expiry date, so expiry is not used to filter them;
          rows the inventory typed ERROR are left out.
        </InfoTip>
      </div>
      {!blockName && <p className="mt-1 text-3xs text-muted-foreground">Add a cutblock first.</p>}
      {state.error && (
        <InlineAlert className="mt-2" tone="error">
          {state.error}
        </InlineAlert>
      )}
      {data && data.failed.length > 0 && (
        <InlineAlert className="mt-2" tone="warning">
          Not read: {data.failed.map((entry) => entry.layer).join(', ')}. The rest loaded.
        </InlineAlert>
      )}
      {data && shown.length === 0 && (
        <p className="mt-2 text-2xs text-muted-foreground">No inventory viewpoint or rec site within 12 km.</p>
      )}
      {shown.length > 0 && (
        <>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-2 w-full"
            disabled={reverseRunning}
            onClick={onCheck}
          >
            {reverseRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radar className="h-4 w-4" />}
            {reverseRunning ? 'Tracing sightlines…' : 'Check which of them see the block'}
          </Button>
          <ul className="mt-2 space-y-1.5" aria-label="Inventory viewpoints near the block">
            {shown.map((candidate) => {
              const row = reverseRows.get(candidate.key)
              return (
                <li key={candidate.key} className="rounded-md border border-border p-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <button
                      type="button"
                      className="min-w-0 truncate text-left text-xs font-medium text-foreground hover:underline"
                      onClick={() => onShow(candidate)}
                    >
                      {candidate.name}
                    </button>
                    {row && (
                      <span
                        className={cn(
                          'shrink-0 text-xs font-semibold tabular-nums',
                          row.maxVisiblePercent > 0 ? 'text-rose-600' : 'text-muted-foreground',
                        )}
                        title="Share of the block's ground in view from here, bare earth"
                      >
                        {row.maxVisiblePercent > 0 ? `${row.maxVisiblePercent.toFixed(0)}% seen` : 'Hidden'}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-3xs leading-4 text-muted-foreground">
                    {candidate.kind === 'rec-site' ? 'Rec site' : 'VLI viewpoint'} ·{' '}
                    {(candidate.distanceMeters / 1000).toFixed(1)} km {compassPoint(candidate.bearingToBlock + 180)} of
                    the block
                    {candidate.arrow
                      ? candidate.arrow.aims
                        ? ' · arrow points at it'
                        : ` · arrow points ${compassPoint(candidate.arrow.bearing)}, ${Math.round(candidate.arrow.offsetDegrees)}° off`
                      : ''}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-1 h-7 px-2 text-2xs"
                    title="Open the road view standing here, facing the block"
                    onClick={() => onUse(candidate)}
                  >
                    Stand here
                  </Button>
                </li>
              )
            })}
          </ul>
          <p className="mt-2 text-3xs leading-4 text-muted-foreground">
            Rows the block is in view from go into the step 5 Visuals paragraph. The check is bare earth from one point;
            Stand here runs the full assessment there and opens the view.
          </p>
        </>
      )}
      {data && data.droppedErrorViewpoints > 0 && (
        <p className="mt-1 text-3xs text-muted-foreground">
          {data.droppedErrorViewpoints} viewpoint{data.droppedErrorViewpoints === 1 ? '' : 's'} typed ERROR in the
          inventory left out.
        </p>
      )}
    </CollapsibleSection>
  )
}
