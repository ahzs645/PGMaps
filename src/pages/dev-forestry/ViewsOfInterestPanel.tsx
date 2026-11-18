import { Camera, Download, Footprints, History, Loader2, Trash2 } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import {
  CheckboxField,
  FORM_INPUT_CLASS,
  FormField,
  NumberField,
  SelectField,
  unitInside,
} from '@/components/ui/form-field'
import { InfoTip } from '@/components/ui/info-tip'
import { insetBox } from '@/components/ui/inset-box'
import { InlineAlert } from '@/components/ui/map-panels'
import { ResultRow, ResultRowDetail } from '@/components/ui/result-list'
import { SegmentedControl, type SegmentedOption } from '@/components/ui/segmented-control'
import { ToolSection } from '@/components/ui/tool-section'
import { cn } from '@/lib/utils'

import { VIEW_OF_INTEREST_COLORS } from './planMapStyle'
import { groupLeadOf, groupMembers, groupSuggestion, handOver, joinGroup, leaveGroup } from './viewGroups'
import type { ViewCaptureApi } from './useViewCapture'
import { arrowLabel } from './ViewpointFinderPanel'
import { ARROW_AIM_DEGREES, type CandidateArrow, type ViewpointInventory } from './viewpointInventory'
import { bearingDegrees, type PolygonGeometry } from './visibility'
import { compassPoint } from './visualsNarrative'
import {
  blockCentre,
  isIncluded,
  LENS_FOCAL_LENGTHS,
  MAX_VIEWS_OF_INTEREST,
  needsCapture,
  lensLabel,
  normalizeBearing,
  orphanedViews,
  captureChangeText,
  captureKeyChanges,
  viewBearing,
  viewCaptureState,
  type SavedViewCapture,
  type ViewCaptureState,
  type ViewOfInterest,
  type ViewOfInterestFacing,
} from './viewsOfInterest'

/** How many views one *Capture* takes; the last is every view the plan can hold. */
const CAPTURE_BATCH_SIZES = [1, 3, 6, MAX_VIEWS_OF_INTEREST] as const

type Block = { id: string; name: string; geometry: PolygonGeometry }

export type ViewsOfInterestPanelProps = {
  views: readonly ViewOfInterest[]
  /** Writes the list (`setViewsOfInterest`): out of the run, so no edit here stales it. */
  onChange: (update: (views: ViewOfInterest[]) => ViewOfInterest[]) => void
  /** The scene's cutblocks, in scene order. */
  blocks: readonly Block[]
  /** Every scene target, to flag a view whose block or landform is gone. */
  targets: ReadonlyArray<{ id: string; role: string }>
  /** Every saved view, here and shelved: a planned view is captured while one carries its id and current key. */
  savedViews: ReadonlyArray<SavedViewCapture>
  /**
   * Whether a saved view has its analysis sheet (`viewImages[id].figure`): one saved without it reads *Saved, no
   * analysis sheet* and is captured again (`viewCaptureState`).
   */
  hasFigure?: (savedViewId: string) => boolean
  capture: ViewCaptureApi
  /** The view whose row is open, highlighted on the plan. */
  openViewId: string | null
  onOpenView: (id: string | null) => void
  /** A view is being placed with the plan map's tool (`drawMode === 'view'`): capture waits. */
  placing?: boolean
  /** BC's viewpoint inventory as loaded in step 1, for a VLI view's arrows. */
  inventory: ViewpointInventory | null
  /** Opens Save & export. Absent (the list shown inside Save & export): no *Export…* button. */
  onOpenExport?: () => void
  /** Brings a view into sight on the plan. */
  onShowView?: (view: ViewOfInterest) => void
  /** Extra control in the open row, such as the landform seen from the view. */
  landformControl?: (view: ViewOfInterest) => ReactNode
  /** The view's Table 3 record (significance, type, why chosen, experience, duration), in its open row. */
  recordControl?: (view: ViewOfInterest) => ReactNode
  /** Whether the view is its block's (or the blocks') key viewpoint for the reports, in its open row. */
  keyControl?: (view: ViewOfInterest) => ReactNode
  /** The layout crew's check that the view is real and reachable (`viewFieldCheck`), in its open row. */
  fieldCheckControl?: (view: ViewOfInterest) => { summary: string; node: ReactNode } | null
  /** The field photographs linked to the view (`FieldRecord.viewId`), and adding one, in its open row. */
  photoControl?: (view: ViewOfInterest) => { count: number; node: ReactNode } | null
  /**
   * The view the run stands at (`currentPlannedView`): its row says so, and only it shows `standingControl`, what
   * belongs to the place stood at (the surveyed eye, the street-level photo the road view lines up with).
   */
  standingViewId?: string | null
  standingControl?: (view: ViewOfInterest) => ReactNode
  /** Reopens the view's saved capture in the road view, where it was saved under the current scene. */
  onReopenSaved?: (viewId: string) => void
  /** Whether a capture of the view is saved under the current scene, so it can be reopened. */
  canReopenSaved?: (viewId: string) => boolean
  /**
   * The groups whose step 4 assessment holds something, by their lead's id (`ViaReview.stations`). Given, each open
   * row offers *Step 4 assessed with* and the perspective suggestion (`viewGroups.ts`).
   */
  assessedGroups?: ReadonlySet<string>
  /** A group passed to another lead (its lead left it or was removed): its step 4 record moves with it. */
  onLeadChanged?: (from: string, to: string) => void
  /** A view renamed: its record, held by name, follows it. */
  onRenamed?: (from: string, to: string) => void
  /** The last add's outcome, from the map or the finder ("Added 2 views", "Already listed"). */
  message?: string | null
  /** Who draws the exported figures (Save & export's *Figures drawn by*), and opening that choice. */
  renderer?: { label: string; id: string }
  onChangeRenderer?: () => void
  /**
   * Whether a planned view's capture was saved where the reviewer stands now: an engine redraws only those
   * (`renderJobFor`); the rest keep PGMaps' picture.
   */
  capturedHere?: (viewId: string) => boolean
  /**
   * A photo viewpoint's photo (`ViewOfInterest.photo`): its record's name and image, for the row's thumbnail; the
   * image is null when the record is no longer in the workspace.
   */
  photoOf?: (view: ViewOfInterest) => { name: string; thumbUrl: string | null } | null
}

const SOURCE_LABELS: Record<ViewOfInterest['source']['kind'], string> = {
  map: 'Picked on the map',
  vli: 'VLI viewpoint',
  'rec-site': 'Rec site',
}

/**
 * Where a view came from, in the row's words: a photo viewpoint is an aerial photo when its camera has an altitude
 * (taken from the air), else a field photo; every other view by its source.
 */
export function viewSourceLabel(view: Pick<ViewOfInterest, 'source' | 'photo'>): string {
  if (view.photo) {
    const tilt = Math.round(view.photo.pitch)
    const look = tilt < 0 ? `${-tilt}° down` : tilt > 0 ? `${tilt}° up` : 'level'
    return view.photo.altitudeMeters !== null
      ? `Aerial photo · ${Math.round(view.photo.altitudeMeters)} m · ${look}`
      : `Field photo · ${look}`
  }
  return SOURCE_LABELS[view.source.kind]
}

const CAPTURE_LABELS: Record<ViewCaptureState, string> = {
  captured: 'Captured',
  'no-figure': 'Saved, no analysis sheet',
  outdated: 'Changed since captured',
  'not-captured': 'Not captured',
}

/** The view's VLI arrows from the loaded inventory, nearest its block's direction first, as the finder lists them. */
function viewArrows(view: ViewOfInterest, inventory: ViewpointInventory | null, block: Block | null): CandidateArrow[] {
  if (view.source.kind !== 'vli' || !inventory) return []
  const key = view.source.key
  const centre = block ? blockCentre(block.geometry) : null
  const toBlock = centre ? bearingDegrees(view, centre) : null
  return inventory.arrows
    .filter((arrow) => `vli:${arrow.viewpointId}` === key)
    .map((arrow) => {
      const offset = toBlock === null ? 180 : Math.abs(((arrow.bearing - toBlock + 540) % 360) - 180)
      return {
        id: arrow.id,
        bearing: arrow.bearing,
        offsetDegrees: offset,
        lengthMeters: arrow.lengthMeters,
        aims: offset <= ARROW_AIM_DEGREES,
      }
    })
    .sort((a, b) => a.offsetDegrees - b.offsetDegrees)
}

function facingValue(facing: ViewOfInterestFacing): string {
  if (facing.kind === 'block') return 'block'
  return facing.arrowId ? `arrow:${facing.arrowId}` : 'bearing'
}

/** "faces the block", "looks NE (45°)", "arrow 2 · NE". */
function facingSummary(view: ViewOfInterest, arrows: readonly CandidateArrow[]): string {
  if (view.facing.kind === 'block') return 'faces the block'
  const degrees = Math.round(view.facing.degrees)
  const arrowId = view.facing.arrowId
  const index = arrowId ? arrows.findIndex((arrow) => arrow.id === arrowId) : -1
  return index >= 0 ? `arrow ${index + 1} · ${compassPoint(degrees)}` : `looks ${compassPoint(degrees)} (${degrees}°)`
}

/**
 * Which group's step 4 a view shares (`viewGroups.ts`): its own, or another group's, and the perspective suggestion
 * when it sees its block from the same side as an earlier view. Nothing is grouped without the reviewer's choice.
 */
function GroupFields({
  view,
  views,
  blocks,
  assessed,
  onChange,
  onLeadChanged,
}: {
  view: ViewOfInterest
  views: readonly ViewOfInterest[]
  blocks: readonly Block[]
  assessed: ReadonlySet<string>
  onChange: ViewsOfInterestPanelProps['onChange']
  onLeadChanged?: (from: string, to: string) => void
}) {
  const lead = groupLeadOf(view, views)
  const members = groupMembers(lead.id, views)
  const otherLeads = views.filter((entry) => entry.id !== lead.id && groupLeadOf(entry, views).id === entry.id)
  const centreOf = (blockId: string) => {
    const block = blocks.find((entry) => entry.id === blockId)
    return block ? blockCentre(block.geometry) : null
  }
  const suggestion = groupSuggestion(view, views, centreOf)
  const join = (leadId: string) => onChange((current) => joinGroup(current, view.id, leadId))
  const leave = () => {
    const left = leaveGroup(views, view.id)
    onChange(() => left.views)
    if (left.newLeadId) onLeadChanged?.(view.id, left.newLeadId)
  }
  const km = (meters: number) => (meters / 1000).toFixed(1)
  return (
    <div className="space-y-1.5" data-view-group={lead.id}>
      <SelectField
        label="Step 4 assessed with"
        aria-label={`Step 4 assessment of ${view.name}`}
        value={lead.id === view.id ? '' : lead.id}
        onValueChange={(value) => (value ? join(value) : leave())}
      >
        <option value="">
          {lead.id === view.id && members.length > 1 ? `Its own, for ${members.length} views` : 'Its own assessment'}
        </option>
        {lead.id !== view.id && <option value={lead.id}>{lead.name}</option>}
        {otherLeads.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.name}
          </option>
        ))}
      </SelectField>
      {suggestion && (
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-2xs text-muted-foreground">
          <span className="min-w-0">
            Sees {blocks.find((block) => block.id === view.blockId)?.name ?? 'its block'} from the same side as{' '}
            {suggestion.lead.name}: {Math.round(suggestion.apartDegrees)}° apart, {km(suggestion.distancesMeters[0])}{' '}
            and {km(suggestion.distancesMeters[1])} km away.
          </span>
          <Button type="button" variant="outline" size="2xs" onClick={() => join(suggestion.lead.id)}>
            Assess together
          </Button>
        </p>
      )}
      <p className="text-2xs text-muted-foreground" data-group-assessed={assessed.has(lead.id) || undefined}>
        {assessed.has(lead.id)
          ? 'Step 4 recorded for this group.'
          : 'Step 4 not recorded yet: Stand here, then assess in step 4.'}
      </p>
    </div>
  )
}

/** The eight compass points, short enough to sit in the bearing field beside its degree sign. */
const COMPASS_SHORT = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const

/**
 * An open row's tabs: what the view looks at, its Table 3 record, what the crew brought back, and how it is assessed
 * and exported. One choice for the whole list, so going through several views stays on the same tab.
 */
type RowTab = 'view' | 'record' | 'field' | 'report'

const ROW_TAB_LABELS: Record<RowTab, string> = { view: 'View', record: 'Record', field: 'Field', report: 'Report' }

/** One tab's fields, kept mounted while another tab shows so a reading in progress is not lost. */
function RowPanel({ tab, shown, children }: { tab: RowTab; shown: RowTab; children: ReactNode }) {
  return (
    <div className="space-y-2" data-view-tab={tab} hidden={tab !== shown}>
      {children}
    </div>
  )
}

/** A titled part of a tab, with its state beside the title. */
function RowPart({
  title,
  summary,
  children,
  ...props
}: { title: string; summary?: string; children: ReactNode } & Record<`data-${string}`, string>) {
  return (
    <section className="space-y-1.5" {...props}>
      <p className="text-2xs font-medium text-foreground">
        {title}
        {summary && <span className="ml-1 font-normal text-muted-foreground">· {summary}</span>}
      </p>
      {children}
    </section>
  )
}

/** The view's name, edited in place and written on Enter or leaving the field, not on every key. */
function NameField({ view, onCommit }: { view: ViewOfInterest; onCommit: (name: string) => void }) {
  const [draft, setDraft] = useState(view.name)
  const commit = () => {
    const name = draft.trim()
    if (name && name !== view.name) onCommit(name)
    else setDraft(view.name)
  }
  return (
    <FormField label="Name">
      <input
        type="text"
        className={FORM_INPUT_CLASS}
        value={draft}
        maxLength={120}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
          if (event.key === 'Escape') setDraft(view.name)
        }}
      />
    </FormField>
  )
}

/**
 * Step 2: the views of interest — where the assessment is looked at from, planned on the plan map before the road
 * view is ever opened. Views come from a click on the plan (the map's *Add a view of interest* tool, `ViewPlacementCard`) or from step 1's *Viewpoints and rec
 * sites* (*Add to views*); each is captured as a saved view without driving (`useViewCapture`), and Save & export
 * writes from those. How many are captured shows in the headline's *Views captured* tile.
 */
export function ViewsOfInterestPanel(props: ViewsOfInterestPanelProps) {
  const { views, savedViews, hasFigure } = props
  const included = views.filter(isIncluded)
  const captured = included.filter((view) => viewCaptureState(view, savedViews, hasFigure) === 'captured').length
  return (
    <ToolSection
      title="Views of interest"
      toggleProps={{ 'data-forestry-disclosure': 'views-of-interest' }}
      defaultOpen
      summary={views.length ? `${views.length} planned · ${captured} of ${included.length} captured` : 'None planned'}
      help={
        <>
          The places the block is looked at from, planned on the plan map before the road view is opened: place one with
          the map&apos;s <em>Add a view of interest</em> tool, or add BC&apos;s inventory viewpoints and rec sites from
          the list below (a viewpoint adds up to two of its arrows aimed at the block, else one view facing it). Each
          view faces its block or a bearing, through a lens. Open a row for everything about that view: its record and
          3.2.1 type, its field photos, whether it is a key viewpoint and, at the view you stand at, the surveyed eye
          and the field photo to line up with. A view saved from the road view&apos;s bar is listed here too.
          <br />
          <em>Capture</em> stands at each view, runs the assessment there and saves the view as <em>Save viewpoint</em>{' '}
          does, without your driving; Save &amp; export then writes from those saved views. A view changed since its
          capture is captured again. The list travels with the scene but is a plan, not an input: editing it never
          changes the run.
        </>
      }
    >
      <ViewsOfInterestList {...props} />
    </ToolSection>
  )
}

/**
 * The views of interest themselves: one row a view, opened for everything about it, and capturing them. Step 2's
 * section (`ViewsOfInterestPanel`) and Save & export's *Views* entry show this same list over the same page state.
 */
export function ViewsOfInterestList({
  views,
  onChange,
  blocks,
  targets,
  savedViews,
  hasFigure,
  capture,
  openViewId,
  onOpenView,
  placing = false,
  inventory,
  onOpenExport,
  onShowView,
  landformControl,
  recordControl,
  keyControl,
  photoControl,
  fieldCheckControl,
  standingViewId = null,
  standingControl,
  onReopenSaved,
  canReopenSaved,
  assessedGroups,
  onLeadChanged,
  onRenamed,
  message = null,
  renderer,
  onChangeRenderer,
  capturedHere,
  photoOf,
}: ViewsOfInterestPanelProps) {
  const engine = !!renderer && renderer.id !== 'pgmaps'
  const blockById = useMemo(() => new Map(blocks.map((block) => [block.id, block])), [blocks])
  const orphans = useMemo(() => orphanedViews(views, targets), [views, targets])
  const states = useMemo(
    () => new Map(views.map((view) => [view.id, viewCaptureState(view, savedViews, hasFigure)])),
    [views, savedViews, hasFigure],
  )
  const included = views.filter(isIncluded)
  // A view saved without its analysis sheet is taken again with the rest.
  const toCapture = included.filter((view) => needsCapture(states.get(view.id) ?? 'not-captured'))
  const [batchSize, setBatchSize] = useState<number>(MAX_VIEWS_OF_INTEREST)
  const batch = toCapture.slice(0, batchSize)
  const running = capture.state.status === 'running'
  const [rowTab, setRowTab] = useState<RowTab>('view')
  // The last batch's word on each view: why it was not captured, or what its save is missing (`warning`). Several
  // can name one view (no sheet and no before render); they are read together.
  const failures = useMemo(() => {
    const byView = new Map<string, { reason: string; warning: boolean }>()
    for (const failure of capture.state.failures) {
      const earlier = byView.get(failure.viewId)
      byView.set(failure.viewId, {
        reason: earlier ? `${earlier.reason} ${failure.reason}` : failure.reason,
        warning: (earlier?.warning ?? true) && !!failure.warning,
      })
    }
    return byView
  }, [capture.state.failures])

  const update = (id: string, patch: Partial<ViewOfInterest>) =>
    onChange((current) => current.map((view) => (view.id === id ? { ...view, ...patch } : view)))
  const remove = (id: string) => {
    // A lead's group passes to the next of its views first, with its step 4 record.
    const handed = handOver(views, id)
    if (handed.newLeadId) {
      onChange(() => handed.views)
      onLeadChanged?.(id, handed.newLeadId)
    }
    onChange((current) => current.filter((view) => view.id !== id))
    if (openViewId === id) onOpenView(null)
  }

  return (
    <div className="space-y-2">
      {!blocks.length && <p className="text-2xs text-muted-foreground">Import or draw a cutblock in step 1 first.</p>}

      {message && (
        <p className="text-2xs text-muted-foreground" role="status">
          {message}
        </p>
      )}

      {views.length === 0 && blocks.length > 0 && (
        <p className="text-2xs text-muted-foreground">
          No views yet. Place one with the map&apos;s <em>Add a view of interest</em> tool, or with <em>Add</em> on the
          viewpoints and rec sites below.
        </p>
      )}

      {views.length > 0 && (
        <ul
          className={cn(insetBox({ padding: 'none' }), 'divide-y divide-border overflow-hidden')}
          aria-label="Views of interest"
        >
          {views.map((view, index) => {
            const block = blockById.get(view.blockId) ?? null
            const arrows = viewArrows(view, inventory, block)
            const state = states.get(view.id) ?? 'not-captured'
            const open = view.id === openViewId
            const current = running && capture.state.currentViewId === view.id
            // A failure counts while the view is still not captured; a warning is read beside its state.
            const noted = failures.get(view.id)
            const failure = noted && !noted.warning && state !== 'captured' ? noted.reason : null
            const warning = noted?.warning && state !== 'not-captured' && state !== 'outdated' ? noted.reason : null
            const changedText = state === 'outdated' ? captureChangeText(captureKeyChanges(view, savedViews)) : null
            // An engine redraws a capture only where the reviewer stands now; elsewhere the figure stays PGMaps'.
            const engineElsewhere =
              engine && state !== 'not-captured' && state !== 'outdated' && capturedHere && !capturedHere(view.id)
            const missingBlock = orphans.missingBlock.includes(view.id)
            const missingLandform = orphans.missingLandform.includes(view.id)
            const standingHere = view.id === standingViewId
            const photo = view.photo ? (photoOf?.(view) ?? null) : null
            const photos = open ? (photoControl?.(view) ?? null) : null
            const fieldCheck = open ? (fieldCheckControl?.(view) ?? null) : null
            const tabs: RowTab[] = [
              'view',
              ...(recordControl ? (['record'] as const) : []),
              ...(photos || fieldCheck ? (['field'] as const) : []),
              'report',
            ]
            const tab = tabs.includes(rowTab) ? rowTab : 'view'
            // The bearing the view looks along now: typed when it faces a bearing, else read from its block or arrow.
            const typedBearing = view.facing.kind === 'bearing' && !view.facing.arrowId
            const bearingNow =
              view.facing.kind === 'bearing'
                ? view.facing.degrees
                : open
                  ? viewBearing(view, block ? blockCentre(block.geometry) : null)
                  : null
            return (
              <li key={view.id} data-view-of-interest={view.id}>
                <ResultRow
                  className="px-2 py-1.5"
                  selected={open}
                  onClick={() => {
                    onOpenView(open ? null : view.id)
                    if (!open) onShowView?.(view)
                  }}
                  leading={
                    <span
                      className={cn(
                        'fixed-palette mt-0.5 flex h-5 w-5 items-center justify-center rounded-full text-2xs font-semibold tabular-nums text-white',
                        !isIncluded(view) && 'opacity-50',
                      )}
                      style={{ backgroundColor: VIEW_OF_INTEREST_COLORS.view }}
                      aria-hidden="true"
                    >
                      {index + 1}
                    </span>
                  }
                  title={
                    photo?.thumbUrl ? (
                      <span className="flex min-w-0 items-center gap-1.5">
                        <img
                          src={photo.thumbUrl}
                          alt=""
                          className="h-6 w-9 shrink-0 rounded-sm object-cover"
                          data-view-photo-thumb=""
                        />
                        <span className="min-w-0 truncate text-xs">{view.name}</span>
                      </span>
                    ) : (
                      <span className="text-xs">{view.name}</span>
                    )
                  }
                  subtitle={
                    <span className="whitespace-normal text-3xs leading-4">
                      {viewSourceLabel(view)} · {block?.name ?? 'block missing'} · {facingSummary(view, arrows)} ·{' '}
                      {view.focalMm} mm
                      {isIncluded(view) ? '' : ' · left out of exports'}
                      {assessedGroups && groupLeadOf(view, views).id !== view.id
                        ? ` · assessed with ${groupLeadOf(view, views).name}`
                        : ''}
                      {standingHere && (
                        <>
                          {' · '}
                          <span className="font-medium text-foreground" data-assessing-from="">
                            assessing from here
                          </span>
                        </>
                      )}
                    </span>
                  }
                  trailing={
                    <span
                      title={changedText ?? undefined}
                      className={cn(
                        'text-2xs font-normal',
                        current
                          ? 'text-foreground'
                          : failure
                            ? 'text-danger'
                            : state === 'captured'
                              ? 'text-success'
                              : state === 'outdated' || state === 'no-figure'
                                ? 'text-warning'
                                : 'text-muted-foreground',
                      )}
                      data-capture-state={state}
                    >
                      {current ? 'Capturing…' : failure ? 'Not captured' : CAPTURE_LABELS[state]}
                    </span>
                  }
                />
                {open && (
                  <ResultRowDetail className="space-y-2 pl-2">
                    {missingBlock && (
                      <InlineAlert tone="warning">Its block is no longer in the scene: choose another.</InlineAlert>
                    )}
                    {missingLandform && (
                      <InlineAlert tone="warning">
                        Its landform is no longer in the scene: choose another or cover the block.
                      </InlineAlert>
                    )}
                    {failure && <InlineAlert tone="error">{failure}</InlineAlert>}
                    {state === 'no-figure' && (
                      <InlineAlert tone="warning">
                        {warning ??
                          'Saved, but its analysis sheet was not drawn (or its screenshot is gone with an earlier session).'}{' '}
                        <em>Capture again</em> draws it.
                      </InlineAlert>
                    )}
                    {state === 'captured' && warning && <InlineAlert tone="warning">{warning}</InlineAlert>}
                    {changedText && (
                      <p className="text-2xs text-warning">
                        {changedText} <em>Capture again</em> brings it up to date, as Save &amp; export would.
                      </p>
                    )}
                    {engineElsewhere && (
                      <p className="text-2xs text-muted-foreground">
                        {renderer!.label} redraws only views captured where you stand now: this one keeps PGMaps&apos;
                        picture, and the files say so. Stand here to have {renderer!.label} draw it.
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Button
                        type="button"
                        variant="outline"
                        size="2xs"
                        disabled={running || missingBlock}
                        title="Run the assessment from here and open the road view on this facing (optional)"
                        onClick={() => capture.standAt(view.id)}
                      >
                        <Footprints className="h-3.5 w-3.5" />
                        Stand here
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="2xs"
                        disabled={running || missingBlock}
                        onClick={() => void capture.capture([view.id])}
                      >
                        <Camera className="h-3.5 w-3.5" />
                        {state === 'not-captured' ? 'Capture' : 'Capture again'}
                      </Button>
                      {onReopenSaved && canReopenSaved?.(view.id) && (
                        <Button
                          type="button"
                          variant="outline"
                          size="2xs"
                          disabled={running}
                          title="Open the road view where this view was saved, as it was saved"
                          onClick={() => onReopenSaved(view.id)}
                        >
                          <History className="h-3.5 w-3.5" />
                          Reopen saved
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="2xs"
                        className="ml-auto"
                        disabled={current}
                        onClick={() => remove(view.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Remove
                      </Button>
                    </div>
                    <SegmentedControl
                      label={`What to show of ${view.name}`}
                      size="sm"
                      value={tab}
                      options={tabs.map(
                        (entry): SegmentedOption<RowTab> => ({ value: entry, label: ROW_TAB_LABELS[entry] }),
                      )}
                      onChange={setRowTab}
                    />
                    <RowPanel tab="view" shown={tab}>
                      <NameField
                        key={`${view.id}:${view.name}`}
                        view={view}
                        onCommit={(name) => {
                          update(view.id, { name })
                          onRenamed?.(view.name, name)
                        }}
                      />
                      <SelectField
                        label="Block"
                        value={view.blockId}
                        placeholder="Choose a block"
                        onValueChange={(blockId) => update(view.id, { blockId })}
                      >
                        {blocks.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.name}
                          </option>
                        ))}
                      </SelectField>
                      <div className="grid grid-cols-2 gap-1.5">
                        <SelectField
                          label="Facing"
                          value={facingValue(view.facing)}
                          onValueChange={(value) => {
                            if (value === 'block') update(view.id, { facing: { kind: 'block' } })
                            else if (value === 'bearing') {
                              const now = viewBearing(view, block ? blockCentre(block.geometry) : null) ?? 0
                              update(view.id, { facing: { kind: 'bearing', degrees: Math.round(now) % 360 } })
                            } else {
                              const arrowId = value.slice('arrow:'.length)
                              const arrow = arrows.find((entry) => entry.id === arrowId)
                              if (arrow)
                                update(view.id, {
                                  facing: { kind: 'bearing', degrees: normalizeBearing(arrow.bearing), arrowId },
                                })
                            }
                          }}
                        >
                          <option value="block">Face the block</option>
                          <option value="bearing">A bearing</option>
                          {arrows.map((arrow, arrowIndex) => (
                            <option key={arrow.id} value={`arrow:${arrow.id}`}>
                              {arrowLabel(arrow, arrowIndex)}
                            </option>
                          ))}
                          {view.facing.kind === 'bearing' &&
                            view.facing.arrowId &&
                            !arrows.some(
                              (arrow) => view.facing.kind === 'bearing' && arrow.id === view.facing.arrowId,
                            ) && (
                              <option value={`arrow:${view.facing.arrowId}`}>
                                Inventory arrow · {Math.round(view.facing.degrees)}° (load the viewpoints below to see
                                it)
                              </option>
                            )}
                        </SelectField>
                        {/* Always in its place beside Facing: typed for a bearing, else the bearing the block or
                            arrow gives, read only. */}
                        <NumberField
                          label="Bearing from north"
                          unit={
                            bearingNow === null
                              ? '°'
                              : `° ${COMPASS_SHORT[Math.round((((bearingNow % 360) + 360) % 360) / 45) % 8]}`
                          }
                          {...unitInside(FORM_INPUT_CLASS, { wide: true })}
                          min={0}
                          max={359.9}
                          updateOn="commit"
                          disabled={!typedBearing}
                          title={
                            typedBearing ? undefined : 'Set by the facing. Choose A bearing under Facing to type one.'
                          }
                          value={typedBearing ? (bearingNow ?? 0) : Math.round(bearingNow ?? 0) % 360}
                          onValueChange={(degrees) =>
                            update(view.id, { facing: { kind: 'bearing', degrees: normalizeBearing(degrees) } })
                          }
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        <SelectField
                          label="Lens"
                          value={String(view.focalMm)}
                          // A photo viewpoint keeps its photo's lens: the camera is changed by accepting it again.
                          disabled={!!view.photo}
                          title={view.photo ? 'The photo’s lens: accept its camera again to change it.' : undefined}
                          onValueChange={(value) => update(view.id, { focalMm: Number(value) })}
                        >
                          {[
                            ...LENS_FOCAL_LENGTHS,
                            ...((LENS_FOCAL_LENGTHS as readonly number[]).includes(view.focalMm) ? [] : [view.focalMm]),
                          ].map((focal) => (
                            <option key={focal} value={String(focal)}>
                              {lensLabel(focal)}
                            </option>
                          ))}
                        </SelectField>
                        <SelectField
                          label="Framing"
                          value={view.framing}
                          onValueChange={(value) =>
                            update(view.id, { framing: value === 'single' ? 'single' : 'landform' })
                          }
                        >
                          <option value="landform">Cover the landform</option>
                          <option value="single">One frame along the facing</option>
                        </SelectField>
                      </div>
                      {landformControl?.(view)}
                      {standingHere && standingControl && (
                        <section
                          aria-label={`Where you stand at ${view.name}`}
                          className="space-y-2 rounded-md border border-border/60 bg-background/60 px-2 py-1.5"
                        >
                          {standingControl(view)}
                        </section>
                      )}
                    </RowPanel>
                    {recordControl && (
                      <RowPanel tab="record" shown={tab}>
                        {recordControl(view)}
                      </RowPanel>
                    )}
                    {(photos || fieldCheck) && (
                      <RowPanel tab="field" shown={tab}>
                        {fieldCheck && (
                          <RowPart
                            title="Real and reachable"
                            summary={fieldCheck.summary}
                            data-view-field-check={view.id}
                          >
                            {fieldCheck.node}
                          </RowPart>
                        )}
                        {photos && (
                          <RowPart
                            title="Field photos"
                            summary={photos.count ? `${photos.count} linked` : 'none linked'}
                            data-view-photos={view.id}
                          >
                            {photos.node}
                          </RowPart>
                        )}
                      </RowPanel>
                    )}
                    <RowPanel tab="report" shown={tab}>
                      <CheckboxField
                        label="Include in exports"
                        checked={isIncluded(view)}
                        onCheckedChange={(include) => update(view.id, { include: include ? undefined : false })}
                      />
                      {keyControl?.(view)}
                      {assessedGroups && (
                        <GroupFields
                          view={view}
                          views={views}
                          blocks={blocks}
                          assessed={assessedGroups}
                          onChange={onChange}
                          onLeadChanged={onLeadChanged}
                        />
                      )}
                    </RowPanel>
                  </ResultRowDetail>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {running ? (
        <InlineAlert tone="info">
          <span className="flex items-center justify-between gap-2" role="status">
            <span className="flex min-w-0 items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
              <span className="min-w-0">
                {capture.state.message ?? `Capturing ${capture.state.done + 1} of ${capture.state.total}…`}
              </span>
            </span>
            <Button type="button" variant="outline" size="2xs" className="shrink-0" onClick={capture.cancel}>
              Cancel
            </Button>
          </span>
        </InlineAlert>
      ) : (
        capture.state.message &&
        capture.state.status !== 'idle' && (
          <p
            className={cn('text-2xs', capture.state.failures.length ? 'text-warning' : 'text-muted-foreground')}
            role="status"
          >
            {capture.state.message}
          </p>
        )
      )}

      {toCapture.length > 1 && (
        <SelectField
          label="Views per capture"
          labelClassName="text-2xs text-muted-foreground"
          className={cn(FORM_INPUT_CLASS, 'py-1 text-xs')}
          value={String(batchSize)}
          disabled={running}
          onValueChange={(value) => setBatchSize(Number(value))}
        >
          {CAPTURE_BATCH_SIZES.map((n) => (
            <option key={n} value={String(n)}>
              {n === MAX_VIEWS_OF_INTEREST ? `All (${n})` : n}
            </option>
          ))}
        </SelectField>
      )}
      {views.length > 0 && (
        <div className={cn('grid gap-1.5', onOpenExport ? 'grid-cols-2' : 'grid-cols-1')}>
          <Button
            type="button"
            size="xs"
            disabled={running || placing || toCapture.length === 0}
            title="Stand at each view, run and save it, without driving the road view"
            onClick={() => void capture.capture(batch.map((view) => view.id))}
          >
            <Camera className="h-3.5 w-3.5" />
            {toCapture.length
              ? `Capture ${batch.length} view${batch.length === 1 ? '' : 's'}${batch.length < toCapture.length ? ' of ' + toCapture.length + ' pending' : ''}`
              : included.length
                ? 'All captured'
                : 'None included'}
          </Button>
          {onOpenExport && (
            <Button type="button" variant="outline" size="xs" disabled={running} onClick={onOpenExport}>
              <Download className="h-3.5 w-3.5" />
              Export…
            </Button>
          )}
        </div>
      )}
      {views.length > 0 && renderer && (
        <p
          className="flex flex-wrap items-center gap-x-1 text-2xs text-muted-foreground"
          data-views-renderer={renderer.id}
        >
          Figures drawn by <span className="font-medium text-foreground">{renderer.label}</span>
          {onChangeRenderer && (
            <>
              ·
              <button
                type="button"
                className="rounded-sm font-medium text-link hover:text-link-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onClick={onChangeRenderer}
              >
                Change
              </button>
            </>
          )}
          <InfoTip label="About who draws the figures">
            Captures are always drawn by PGMaps. Save &amp; export&apos;s <em>Figures drawn by</em> can have another
            engine (threejs-worldgen, Nanite Forest) redraw each captured view from its saved camera in the background.
            It redraws only the views captured where you stand now; the others keep PGMaps&apos; picture, and the files
            say which.
          </InfoTip>
        </p>
      )}
      {views.length > 0 && toCapture.length > 0 && (
        <p className="flex items-center gap-1 text-3xs text-muted-foreground">
          Save &amp; export captures the {toCapture.length === 1 ? 'one' : toCapture.length} left before it writes a
          file.
          <InfoTip label="About exporting before every view is captured">
            Save &amp; export writes from saved views. Preview and Download first capture every included view that is
            not captured, changed since its capture, or saved without its analysis sheet, as <em>Capture</em> does here;
            capturing them now only saves that wait.
          </InfoTip>
        </p>
      )}
    </div>
  )
}
