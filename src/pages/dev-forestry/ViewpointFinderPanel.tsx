import { Loader2, MapPin, Radar } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import { ToolSection } from '@/components/ui/tool-section'
import { ResultRow, ResultRowDetail } from '@/components/ui/result-list'
import { formatMeasure, formatPercentValue } from '@/lib/format'
import { cn } from '@/lib/utils'

import type { ReverseRoadResult } from './reverseViewshed'
import {
  ARROW_AIM_DEGREES,
  type CandidateArrow,
  type ViewpointCandidate,
  type ViewpointInventory,
} from './viewpointInventory'
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
/** One arrow as a direction to face: its number, compass point and bearing, and whether it is aimed at the block. */
export function arrowLabel(arrow: CandidateArrow, index: number): string {
  return `Arrow ${index + 1} · looks ${compassPoint(arrow.bearing)} (${Math.round(arrow.bearing)}°)${arrow.aims ? ' · at the block' : ''}`
}

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
  /** Stands at the viewpoint, facing the block, or along one of its arrows when given. */
  onUse: (candidate: ViewpointCandidate, arrow?: CandidateArrow | null) => void
  onShow: (candidate: ViewpointCandidate) => void
  /** Where you are standing now, if a stand replaced the road. */
  standingName?: string | null
  backName?: string | null
  onBack?: () => void
}) {
  const data = state.data
  const shown = candidates.slice(0, 10)
  // One row open at a time: its directions and its one Stand here, rather than a button under every row.
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [facing, setFacing] = useState<string>('block')
  const select = (candidate: ViewpointCandidate) => {
    setSelectedKey(candidate.key)
    // A newly picked row faces the block until one of its arrows is chosen.
    setFacing('block')
    onShow(candidate)
  }
  return (
    <ToolSection
      title="Viewpoints and rec sites"
      toggleProps={{ 'data-forestry-disclosure': 'inventory-viewpoints' }}
      // The section remounts after the road view; once loaded, it reopens on its list.
      defaultOpen={!!data}
      summary={
        data
          ? `${data.viewpoints.length} viewpoints · ${data.arrows.length} arrows · ${data.recSites.length} rec sites`
          : 'BC Visual Landscape Inventory'
      }
      help={
        <>
          VLI viewing points and their landscape arrows (WHSE_FOREST_VEGETATION), recreation sites, inventory screenings
          and tenure road names (WHSE_FOREST_TENURE), read live from DataBC within 12 km of the block. The arrows carry
          no bearing of their own, so each is read from its viewpoint to its tip; a viewpoint often has several. An
          arrow within {ARROW_AIM_DEGREES}° of the block ranks its viewpoint higher; one aimed elsewhere does not drop
          it, because people at a site look around. Every viewpoint in the inventory carries a past expiry date, so
          expiry is not used to filter them; rows the inventory typed ERROR are left out.
          <br />
          Pick a row to see it on the map, choose which way to face — the block or one of its arrows — and stand there:
          the full assessment runs from it and the road view opens. Rows the block is in view from go into the step 5
          Visuals paragraph; the check is bare earth from one point.
        </>
      }
    >
      {standingName && (
        <InlineAlert tone="info">
          <span className="flex items-center justify-between gap-2">
            <span className="min-w-0">
              Standing at <span className="font-medium text-foreground">{standingName}</span>
            </span>
            {onBack && backName && (
              <Button type="button" variant="outline" size="sm" className="h-7 shrink-0 px-2 text-2xs" onClick={onBack}>
                Back to {backName}
              </Button>
            )}
          </span>
        </InlineAlert>
      )}
      <div className="grid grid-cols-2 gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-auto min-h-8 whitespace-normal px-2 text-xs"
          disabled={!blockName || state.status === 'loading'}
          onClick={onLoad}
        >
          {state.status === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
          {state.status === 'loading' ? 'Reading DataBC…' : data ? 'Reload' : 'Load around the block'}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-auto min-h-8 whitespace-normal px-2 text-xs"
          disabled={reverseRunning || shown.length === 0}
          onClick={onCheck}
          title="Trace bare-earth sightlines from each of them to the block"
        >
          {reverseRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radar className="h-4 w-4" />}
          {reverseRunning ? 'Tracing…' : 'Which see the block'}
        </Button>
      </div>
      {!blockName && <p className="text-3xs text-muted-foreground">Add a cutblock first.</p>}
      {state.error && <InlineAlert tone="error">{state.error}</InlineAlert>}
      {data && data.failed.length > 0 && (
        <InlineAlert tone="warning">
          Not read: {data.failed.map((entry) => entry.layer).join(', ')}. The rest loaded.
        </InlineAlert>
      )}
      {data && shown.length === 0 && (
        <p className="text-2xs text-muted-foreground">No inventory viewpoint or rec site within 12 km.</p>
      )}
      {shown.length > 0 && (
        <ul
          className="divide-y divide-border overflow-hidden rounded-md border border-border"
          aria-label="Inventory viewpoints near the block"
        >
          {shown.map((candidate) => {
            const row = reverseRows.get(candidate.key)
            const selected = candidate.key === selectedKey
            const arrow = candidate.arrows.find((entry) => `arrow:${entry.id}` === facing) ?? null
            return (
              <li key={candidate.key}>
                <ResultRow
                  className="px-2 py-1.5"
                  selected={selected}
                  onClick={() => select(candidate)}
                  title={<span className="text-xs">{candidate.name}</span>}
                  subtitle={
                    <span className="whitespace-normal text-3xs leading-4">
                      {candidate.kind === 'rec-site' ? 'Rec site' : 'VLI viewpoint'} ·{' '}
                      {formatMeasure(candidate.distanceMeters / 1000, 'km', {
                        minimumFractionDigits: 1,
                        maximumFractionDigits: 1,
                      })}{' '}
                      {compassPoint(candidate.bearingToBlock + 180)} of the block
                      {candidate.arrows.length > 1
                        ? ` · ${candidate.arrows.length} arrows${candidate.arrows.some((entry) => entry.aims) ? ', one at it' : ''}`
                        : candidate.arrow
                          ? candidate.arrow.aims
                            ? ' · arrow points at it'
                            : ` · arrow points ${compassPoint(candidate.arrow.bearing)}, ${Math.round(candidate.arrow.offsetDegrees)}° off`
                          : ''}
                    </span>
                  }
                  trailing={
                    row && (
                      <span
                        className={cn(
                          'text-xs',
                          row.maxVisiblePercent > 0 ? 'text-rose-600' : 'font-normal text-muted-foreground',
                        )}
                        title="Share of the block's ground in view from here, bare earth"
                      >
                        {row.maxVisiblePercent > 0
                          ? `${formatPercentValue(row.maxVisiblePercent, { maximumFractionDigits: 0 })} seen`
                          : 'Hidden'}
                      </span>
                    )
                  }
                />
                {selected && (
                  <ResultRowDetail className="space-y-2 pl-2">
                    {candidate.arrows.length > 0 && (
                      <div
                        role="radiogroup"
                        aria-label={`Face from ${candidate.name}`}
                        className="flex flex-wrap gap-1"
                      >
                        {[
                          { key: 'block', label: 'The block' },
                          ...candidate.arrows.map((entry, index) => ({
                            key: `arrow:${entry.id}`,
                            label: `Arrow ${index + 1} · ${compassPoint(entry.bearing)}${entry.aims ? ' · at the block' : ''}`,
                          })),
                        ].map((option) => (
                          <button
                            key={option.key}
                            type="button"
                            role="radio"
                            aria-checked={facing === option.key}
                            onClick={() => setFacing(option.key)}
                            className={cn(
                              'rounded-md border px-2 py-1 text-2xs transition-colors touch:min-h-10',
                              facing === option.key
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-border bg-background text-foreground hover:bg-accent',
                            )}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 w-full text-xs"
                      title="Run the assessment from here and open the road view"
                      onClick={() => onUse(candidate, arrow)}
                    >
                      Stand here{arrow ? `, facing ${compassPoint(arrow.bearing)}` : ', facing the block'}
                    </Button>
                  </ResultRowDetail>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {data && data.droppedErrorViewpoints > 0 && (
        <p className="text-3xs text-muted-foreground">
          {data.droppedErrorViewpoints} viewpoint{data.droppedErrorViewpoints === 1 ? '' : 's'} typed ERROR in the
          inventory left out.
        </p>
      )}
    </ToolSection>
  )
}
