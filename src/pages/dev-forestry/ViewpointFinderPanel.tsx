import { Check, ListPlus, Loader2, MapPin, Plus, Radar } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { insetBox } from '@/components/ui/inset-box'
import { InlineAlert } from '@/components/ui/map-panels'
import { ToolSection } from '@/components/ui/tool-section'
import { ResultRow, ResultRowDetail } from '@/components/ui/result-list'
import { formatPercentValue } from '@/lib/format'
import { cn } from '@/lib/utils'

import type { ReverseRoadResult } from './reverseViewshed'
import {
  ARROW_AIM_DEGREES,
  type CandidateArrow,
  type ViewpointCandidate,
  type ViewpointInventory,
  viewpointCandidateSummary,
} from './viewpointInventory'
import type { PolygonGeometry } from './visibility'
import { compassPoint } from './visualsNarrative'
import { viewsForCandidate } from './viewsOfInterest'

/** One candidate to add to the views of interest, with the arrows it faces along (undefined: the default ones). */
export type CandidateViewRequest = { candidate: ViewpointCandidate; arrowIds?: string[] }

/**
 * The arrows a candidate adds as views for `facing` ('default', 'block' or `arrow:<id>`), as `viewsForCandidate`
 * picks them: the default is up to two aimed at the block, else none (one view facing it).
 */
export function arrowIdsForFacing(
  candidate: ViewpointCandidate,
  block: { id: string; name: string; geometry: PolygonGeometry } | null,
  facing: string,
): string[] {
  if (facing === 'block') return []
  if (facing.startsWith('arrow:')) return [facing.slice('arrow:'.length)]
  if (!block) return []
  return viewsForCandidate(candidate, block).flatMap((view) =>
    view.facing.kind === 'bearing' && view.facing.arrowId ? [view.facing.arrowId] : [],
  )
}

export type ViewpointInventoryState = {
  status: 'idle' | 'loading' | 'ready' | 'error'
  data: ViewpointInventory | null
  error: string | null
  /** The block the inventory was read around. */
  blockId: string | null
}

/** How long the finder's "Added …" line stays, milliseconds. */
export const ADD_MESSAGE_MS = 8000
const BULK_SCOPE = 'bulk'

/**
 * The facings a row offers: the default (the arrows aimed at the block that *Add to views* adds, when there are any),
 * the block itself, and each arrow.
 */
export function facingOptions(
  candidate: ViewpointCandidate,
  defaultArrowIds: readonly string[],
): Array<{ key: string; label: string }> {
  return [
    ...(defaultArrowIds.length
      ? [
          {
            key: 'default',
            label:
              defaultArrowIds.length === 1
                ? 'The arrow at the block'
                : `The ${defaultArrowIds.length} arrows at the block`,
          },
        ]
      : []),
    { key: 'block', label: 'The block' },
    ...candidate.arrows.map((entry, index) => ({
      key: `arrow:${entry.id}`,
      label: `Arrow ${index + 1} · ${compassPoint(entry.bearing)}${entry.aims ? ' · at the block' : ''}`,
    })),
  ]
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
  block = null,
  listedKeys,
  onAddViews,
  onHighlightArrows,
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
  /** The block the list is ranked for and views are added for (`blockName`'s). */
  block?: { id: string; name: string; geometry: PolygonGeometry } | null
  /** Candidate keys already in the views of interest (`ViewOfInterest.source.key`). */
  listedKeys?: ReadonlySet<string>
  /** Adds candidates to the views of interest; returns a line saying what was added. */
  onAddViews?: (requests: CandidateViewRequest[]) => string | null
  /** The arrows the open row would add, highlighted on the plan; empty when no row is open. */
  onHighlightArrows?: (arrowIds: string[]) => void
}) {
  const data = state.data
  const shown = candidates.slice(0, 10)
  // One row open at a time: its directions and its one Stand here, rather than a button under every row.
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  // 'default' until the reviewer picks: *Stand here* then faces the block, and *Add to views* adds the arrows aimed at
  // it (up to two), else one view facing it. Picking the block or an arrow sets both.
  const [facing, setFacing] = useState<string>('default')
  // The last add's outcome, where it was asked for: under the row it came from, or under the bulk button. It goes
  // when the block changes, another row opens, or after `ADD_MESSAGE_MS`.
  const [addMessage, setAddMessage] = useState<{ scope: string; text: string } | null>(null)
  const blockId = block?.id ?? null
  useEffect(() => setAddMessage(null), [blockId])
  useEffect(() => {
    if (!addMessage) return
    const timer = window.setTimeout(() => setAddMessage(null), ADD_MESSAGE_MS)
    return () => window.clearTimeout(timer)
  }, [addMessage])
  const select = (candidate: ViewpointCandidate) => {
    setSelectedKey(candidate.key)
    setFacing('default')
    setAddMessage(null)
    onShow(candidate)
  }
  const selectedCandidate = shown.find((candidate) => candidate.key === selectedKey) ?? null
  const highlighted = useMemo(
    () => (selectedCandidate ? arrowIdsForFacing(selectedCandidate, block, facing) : []),
    [selectedCandidate, block, facing],
  )
  const highlightKey = JSON.stringify(highlighted)
  useEffect(() => {
    onHighlightArrows?.(JSON.parse(highlightKey) as string[])
    // Keyed by the ids, so a re-render with the same arrows does not write the page's state again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightKey])
  useEffect(() => () => onHighlightArrows?.([]), [onHighlightArrows])
  // Every row the reverse run found the block in view from, else every viewpoint with an arrow at the block.
  const seen = shown.filter((candidate) => (reverseRows.get(candidate.key)?.maxVisiblePercent ?? 0) > 0)
  const bulk = (reverseRows.size > 0 ? seen : shown.filter((candidate) => candidate.arrows.some((a) => a.aims))).filter(
    (candidate) => !listedKeys?.has(candidate.key),
  )
  const add = (scope: string, requests: CandidateViewRequest[]) => {
    const text = onAddViews?.(requests) ?? null
    setAddMessage(text ? { scope, text } : null)
  }
  return (
    <ToolSection
      title="Add from viewpoints and rec sites"
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
          <em>Add</em> on a row lists it in the views of interest above for this block: by default up to two of its
          arrows aimed at the block, else one view facing it. Open a row to see its arrows on the map, add just one
          direction, or stand there now (the assessment runs from it and the road view opens). Rows the block is in view
          from go into the step 5 Visuals paragraph; the check is bare earth from one point.
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
              <Button type="button" variant="outline" size="xs" className="shrink-0 text-2xs" onClick={onBack}>
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
          className={cn(insetBox({ padding: 'none' }), 'divide-y divide-border overflow-hidden')}
          aria-label="Inventory viewpoints near the block"
        >
          {shown.map((candidate) => {
            const row = reverseRows.get(candidate.key)
            const selected = candidate.key === selectedKey
            const arrow = candidate.arrows.find((entry) => `arrow:${entry.id}` === facing) ?? null
            // The arrows the default adds for this row (`viewsForCandidate`): up to two aimed at the block.
            const defaultArrows = selected ? arrowIdsForFacing(candidate, block, 'default') : []
            // What the row's own *Add* adds without opening it: the default views, at least one.
            const addCount = Math.max(1, arrowIdsForFacing(candidate, block, 'default').length)
            const listed = !!listedKeys?.has(candidate.key)
            return (
              <li key={candidate.key}>
                <div className="flex items-stretch">
                  <ResultRow
                    className="min-w-0 flex-1 px-2 py-1.5"
                    selected={selected}
                    onClick={() => select(candidate)}
                    title={
                      <span className="text-xs">
                        {candidate.name}
                        {listedKeys?.has(candidate.key) && (
                          <span className="ml-1 font-normal text-muted-foreground">· in views</span>
                        )}
                      </span>
                    }
                    subtitle={
                      <span className="whitespace-normal text-3xs leading-4">
                        {viewpointCandidateSummary(candidate)}
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
                  {onAddViews && (
                    // The row's own *Add*, beside it rather than inside its button: the default views for this block.
                    <Button
                      type="button"
                      variant={listed ? 'ghost' : 'outline'}
                      size="2xs"
                      className={cn('my-1.5 mr-1.5 shrink-0 self-center', selected && 'bg-background')}
                      disabled={!block || listed}
                      aria-label={listed ? `${candidate.name} is in the views` : `Add ${candidate.name} to the views`}
                      title={
                        listed
                          ? 'Already in the views of interest for this block'
                          : block
                            ? addCount > 1
                              ? `Adds ${addCount} views: the arrows aimed at ${block.name}`
                              : `Adds one view facing ${block.name}`
                            : 'Add a cutblock first'
                      }
                      onClick={() => add(candidate.key, [{ candidate }])}
                    >
                      {listed ? (
                        <>
                          <Check className="h-3 w-3" />
                          Added
                        </>
                      ) : (
                        <>
                          <Plus className="h-3 w-3" />
                          Add{addCount > 1 ? ` ${addCount}` : ''}
                        </>
                      )}
                    </Button>
                  )}
                </div>
                {!selected && addMessage?.scope === candidate.key && (
                  <p className="px-2 pb-1.5 text-3xs text-muted-foreground" role="status">
                    {addMessage.text}
                  </p>
                )}
                {selected && (
                  <ResultRowDetail className="space-y-2 pl-2">
                    {candidate.arrows.length > 0 && (
                      <div
                        role="radiogroup"
                        aria-label={`Face from ${candidate.name}`}
                        className="flex flex-wrap gap-1"
                      >
                        {facingOptions(candidate, defaultArrows).map((option) => {
                          // With arrows aimed at the block, the default is its own choice (the arrows *Add* adds);
                          // without, the default faces the block.
                          const checked =
                            facing === option.key ||
                            (facing === 'default' && option.key === (defaultArrows.length ? 'default' : 'block'))
                          return (
                            <button
                              key={option.key}
                              type="button"
                              role="radio"
                              aria-checked={checked}
                              onClick={() => setFacing(option.key)}
                              className={cn(
                                'rounded-md border px-2 py-1 text-2xs transition-colors touch:min-h-10',
                                checked
                                  ? 'border-primary bg-primary text-primary-foreground'
                                  : 'border-border bg-background text-foreground hover:bg-accent',
                              )}
                            >
                              {option.label}
                            </button>
                          )
                        })}
                      </div>
                    )}
                    <div className={cn('grid gap-1.5', onAddViews && 'grid-cols-2')}>
                      <Button
                        type="button"
                        size="xs"
                        className="whitespace-normal"
                        title="Run the assessment from here and open the road view"
                        onClick={() => onUse(candidate, arrow)}
                      >
                        Stand here{arrow ? `, facing ${compassPoint(arrow.bearing)}` : ', facing the block'}
                      </Button>
                      {onAddViews && (
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          className="whitespace-normal"
                          disabled={!block}
                          title={
                            block
                              ? `Plan ${facing === 'default' && highlighted.length > 1 ? 'these views' : 'this view'} for ${block.name} in step 2, without opening the road view`
                              : 'Add a cutblock first'
                          }
                          onClick={() =>
                            add(candidate.key, [
                              { candidate, arrowIds: facing === 'default' ? undefined : highlighted },
                            ])
                          }
                        >
                          <ListPlus className="h-3.5 w-3.5" />
                          {facing === 'default' && highlighted.length > 1
                            ? `Add ${highlighted.length} views`
                            : 'Add to views'}
                        </Button>
                      )}
                    </div>
                    {facing === 'default' && highlighted.length > 0 && onAddViews && (
                      <p className="text-3xs text-muted-foreground">
                        Adds {highlighted.length === 1 ? 'the arrow' : `the ${highlighted.length} arrows`} aimed at the
                        block, shown on the map. Pick a direction above to add just that one.
                      </p>
                    )}
                    {addMessage?.scope === candidate.key && (
                      <p className="text-3xs text-muted-foreground" role="status">
                        {addMessage.text}
                      </p>
                    )}
                  </ResultRowDetail>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {onAddViews && block && bulk.length > 0 && (
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="w-full whitespace-normal"
          title={`Plan them as views of interest for ${block.name} in step 2`}
          onClick={() =>
            add(
              BULK_SCOPE,
              bulk.map((candidate) => ({ candidate })),
            )
          }
        >
          <ListPlus className="h-3.5 w-3.5" />
          {reverseRows.size > 0
            ? `Add the ${bulk.length} that see the block to views`
            : `Add the ${bulk.length} with arrows at the block to views`}
        </Button>
      )}
      {addMessage?.scope === BULK_SCOPE && (
        <p className="text-3xs text-muted-foreground" role="status">
          {addMessage.text}
        </p>
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
