import { Camera, Crosshair, Download, Footprints, Loader2, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { CheckboxField, FORM_INPUT_CLASS, NumberField, SelectField, StyledSelect } from '@/components/ui/form-field'
import { InfoTip } from '@/components/ui/info-tip'
import { insetBox } from '@/components/ui/inset-box'
import { InlineAlert } from '@/components/ui/map-panels'
import { ResultRow, ResultRowDetail } from '@/components/ui/result-list'
import { StepMarker, type StepStatus } from '@/components/ui/step-section'
import { ToolSection } from '@/components/ui/tool-section'
import { cn } from '@/lib/utils'

import { VIEW_OF_INTEREST_COLORS } from './planMapStyle'
import type { ViewCaptureApi } from './useViewCapture'
import { arrowLabel } from './ViewpointFinderPanel'
import { ARROW_AIM_DEGREES, type CandidateArrow, type ViewpointInventory } from './viewpointInventory'
import { bearingDegrees, type PolygonGeometry } from './visibility'
import { compassPoint } from './visualsNarrative'
import {
  blockCentre,
  isIncluded,
  LENS_FOCAL_LENGTHS,
  needsCapture,
  lensLabel,
  MAX_VIEWS_OF_INTEREST,
  normalizeBearing,
  orphanedViews,
  viewBearing,
  viewCaptureState,
  type SavedViewCapture,
  type ViewCaptureState,
  type ViewOfInterest,
  type ViewOfInterestFacing,
} from './viewsOfInterest'

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
  /** The plan's click mode for placing a view (the page's `drawMode === 'view'`). */
  adding: boolean
  onStartAdding: (blockId: string) => void
  onCancelAdding: () => void
  /** The block a new view is for unless the reviewer picks another: the selected block. */
  defaultBlockId: string | null
  /** BC's viewpoint inventory as loaded in step 1, for a VLI view's arrows. */
  inventory: ViewpointInventory | null
  /** Opens Save & export. */
  onOpenExport: () => void
  /** Brings a view into sight on the plan. */
  onShowView?: (view: ViewOfInterest) => void
  /** Extra control in the open row, such as the landform seen from the view. */
  landformControl?: (view: ViewOfInterest) => ReactNode
  /** The last add's outcome, from the map or the finder ("Added 2 views", "Already listed"). */
  message?: string | null
}

const SOURCE_LABELS: Record<ViewOfInterest['source']['kind'], string> = {
  map: 'Picked on the map',
  vli: 'VLI viewpoint',
  'rec-site': 'Rec site',
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

/** The view's name, edited in place and written on Enter or leaving the field, not on every key. */
function NameField({ view, onCommit }: { view: ViewOfInterest; onCommit: (name: string) => void }) {
  const [draft, setDraft] = useState(view.name)
  const commit = () => {
    const name = draft.trim()
    if (name && name !== view.name) onCommit(name)
    else setDraft(view.name)
  }
  return (
    <label className="block space-y-1">
      <span className="text-2xs text-muted-foreground">Name</span>
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
    </label>
  )
}

/**
 * Step 2: the views of interest — where the assessment is looked at from, planned on the plan map before the road
 * view is ever opened. Views come from a click on the plan (*Add on the map*) or from step 1's *Viewpoints and rec
 * sites* (*Add to views*); each is captured as a saved view without driving (`useViewCapture`), and Save & export
 * writes from those. The strip at the top is the workflow: blocks, views, captured, export.
 */
export function ViewsOfInterestPanel({
  views,
  onChange,
  blocks,
  targets,
  savedViews,
  hasFigure,
  capture,
  openViewId,
  onOpenView,
  adding,
  onStartAdding,
  onCancelAdding,
  defaultBlockId,
  inventory,
  onOpenExport,
  onShowView,
  landformControl,
  message = null,
}: ViewsOfInterestPanelProps) {
  const blockById = useMemo(() => new Map(blocks.map((block) => [block.id, block])), [blocks])
  const [addBlockChoice, setAddBlockChoice] = useState<string | null>(null)
  const addBlockId =
    (addBlockChoice && blockById.has(addBlockChoice) ? addBlockChoice : null) ??
    (defaultBlockId && blockById.has(defaultBlockId) ? defaultBlockId : null) ??
    blocks[0]?.id ??
    null
  const orphans = useMemo(() => orphanedViews(views, targets), [views, targets])
  const states = useMemo(
    () => new Map(views.map((view) => [view.id, viewCaptureState(view, savedViews, hasFigure)])),
    [views, savedViews, hasFigure],
  )
  const included = views.filter(isIncluded)
  const captured = included.filter((view) => states.get(view.id) === 'captured').length
  // A view saved without its analysis sheet is taken again with the rest.
  const toCapture = included.filter((view) => needsCapture(states.get(view.id) ?? 'not-captured'))
  const running = capture.state.status === 'running'
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

  // Escape puts the plan's click mode down, as it does a drawing.
  useEffect(() => {
    if (!adding) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancelAdding()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [adding, onCancelAdding])

  const update = (id: string, patch: Partial<ViewOfInterest>) =>
    onChange((current) => current.map((view) => (view.id === id ? { ...view, ...patch } : view)))
  const remove = (id: string) => {
    onChange((current) => current.filter((view) => view.id !== id))
    if (openViewId === id) onOpenView(null)
  }

  const full = views.length >= MAX_VIEWS_OF_INTEREST
  const steps: Array<{ label: string; value: string; status: StepStatus }> = [
    { label: 'Blocks', value: String(blocks.length), status: blocks.length ? 'done' : 'current' },
    {
      label: 'Views',
      value: String(views.length),
      status: views.length ? 'done' : blocks.length ? 'current' : 'todo',
    },
    {
      label: 'Captured',
      value: `${captured} of ${included.length}`,
      status: included.length && captured === included.length ? 'done' : included.length ? 'current' : 'todo',
    },
    {
      label: 'Export',
      value: 'Save & export',
      status: included.length && captured === included.length ? 'current' : 'todo',
    },
  ]

  return (
    <ToolSection
      title="Views of interest"
      toggleProps={{ 'data-forestry-disclosure': 'views-of-interest' }}
      defaultOpen
      summary={views.length ? `${views.length} planned · ${captured} of ${included.length} captured` : 'None planned'}
      help={
        <>
          The places the block is looked at from, planned on the plan map before the road view is opened: click the
          plan, or add BC&apos;s inventory viewpoints and rec sites from step 1 (a viewpoint adds up to two of its
          arrows aimed at the block, else one view facing it). Each view faces its block or a bearing, through a lens.
          <br />
          <em>Capture</em> stands at each view, runs the assessment there and saves the view as <em>Save viewpoint</em>{' '}
          does, without your driving; Save &amp; export then writes from those saved views. A view changed since its
          capture is captured again. The list travels with the scene but is a plan, not an input: editing it never
          changes the run.
        </>
      }
    >
      <ol className="grid grid-cols-4 gap-1" aria-label="Views of interest: where you are">
        {steps.map((step, index) => (
          <li
            key={step.label}
            className="flex min-w-0 flex-col items-center gap-0.5 text-center"
            data-workflow-step={step.label.toLowerCase()}
          >
            <StepMarker step={index + 1} status={step.status} className="h-5 w-5 text-3xs" />
            <span className="text-2xs font-medium text-foreground">{step.label}</span>
            <span className="truncate text-3xs tabular-nums text-muted-foreground">{step.value}</span>
          </li>
        ))}
      </ol>

      {!blocks.length && <p className="text-2xs text-muted-foreground">Import or draw a cutblock in step 1 first.</p>}

      {blocks.length > 0 && (
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant={adding ? 'default' : 'outline'}
            size="xs"
            className="shrink-0"
            aria-pressed={adding}
            disabled={(!adding && full) || running || !addBlockId}
            title={full ? `${MAX_VIEWS_OF_INTEREST} views is the most` : 'Click the plan where the view stands'}
            onClick={() => (adding ? onCancelAdding() : addBlockId && onStartAdding(addBlockId))}
          >
            <Crosshair className="h-3.5 w-3.5" />
            {adding ? 'Placing…' : 'Add on the map'}
          </Button>
          {blocks.length > 1 && (
            <StyledSelect
              aria-label="Block a new view is for"
              className={cn(FORM_INPUT_CLASS, 'min-w-0 flex-1 py-1 text-xs')}
              value={addBlockId ?? ''}
              onValueChange={setAddBlockChoice}
              disabled={adding}
            >
              {blocks.map((block) => (
                <option key={block.id} value={block.id}>
                  For {block.name}
                </option>
              ))}
            </StyledSelect>
          )}
        </div>
      )}
      {adding && (
        <InlineAlert tone="info">
          <span className="flex items-center justify-between gap-2" role="status">
            <span className="min-w-0">
              Click the plan where the view stands, facing{' '}
              {addBlockId ? (blockById.get(addBlockId)?.name ?? 'the block') : 'the block'}. Esc cancels.
            </span>
            <Button type="button" variant="outline" size="2xs" className="shrink-0" onClick={onCancelAdding}>
              Cancel
            </Button>
          </span>
        </InlineAlert>
      )}
      {message && (
        <p className="text-2xs text-muted-foreground" role="status">
          {message}
        </p>
      )}

      {views.length === 0 && blocks.length > 0 && (
        <p className="text-2xs text-muted-foreground">
          No views yet. Add one on the map, or use <em>Add to views</em> on step 1&apos;s viewpoints and rec sites.
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
            const missingBlock = orphans.missingBlock.includes(view.id)
            const missingLandform = orphans.missingLandform.includes(view.id)
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
                  title={<span className="text-xs">{view.name}</span>}
                  subtitle={
                    <span className="whitespace-normal text-3xs leading-4">
                      {SOURCE_LABELS[view.source.kind]} · {block?.name ?? 'block missing'} ·{' '}
                      {facingSummary(view, arrows)} · {view.focalMm} mm
                      {isIncluded(view) ? '' : ' · left out of exports'}
                    </span>
                  }
                  trailing={
                    <span
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
                    <NameField
                      key={`${view.id}:${view.name}`}
                      view={view}
                      onCommit={(name) => update(view.id, { name })}
                    />
                    <div className="grid grid-cols-2 gap-1.5">
                      <SelectField
                        label="Block"
                        labelClassName="text-2xs text-muted-foreground"
                        className={cn(FORM_INPUT_CLASS, 'py-1 text-xs')}
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
                      <SelectField
                        label="Facing"
                        labelClassName="text-2xs text-muted-foreground"
                        className={cn(FORM_INPUT_CLASS, 'py-1 text-xs')}
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
                              Inventory arrow · {Math.round(view.facing.degrees)}° (load viewpoints in step 1 to see it)
                            </option>
                          )}
                      </SelectField>
                    </div>
                    {view.facing.kind === 'bearing' && !view.facing.arrowId && (
                      // Under Facing, in its column, labelled above like the fields round it.
                      <div className="grid grid-cols-2 gap-1.5">
                        <span aria-hidden="true" />
                        <NumberField
                          label="Bearing from north"
                          labelClassName="text-2xs text-muted-foreground"
                          inputClassName={cn(FORM_INPUT_CLASS, 'min-w-0 flex-1 py-1 text-xs')}
                          unit="°"
                          min={0}
                          max={359.9}
                          updateOn="commit"
                          value={view.facing.degrees}
                          onValueChange={(degrees) =>
                            update(view.id, { facing: { kind: 'bearing', degrees: normalizeBearing(degrees) } })
                          }
                        />
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-1.5">
                      <SelectField
                        label="Lens"
                        labelClassName="text-2xs text-muted-foreground"
                        className={cn(FORM_INPUT_CLASS, 'py-1 text-xs')}
                        value={String(view.focalMm)}
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
                        labelClassName="text-2xs text-muted-foreground"
                        className={cn(FORM_INPUT_CLASS, 'py-1 text-xs')}
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
                    <CheckboxField
                      label="Include in exports"
                      checked={isIncluded(view)}
                      onCheckedChange={(include) => update(view.id, { include: include ? undefined : false })}
                    />
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

      {views.length > 0 && (
        <div className="grid grid-cols-2 gap-1.5">
          <Button
            type="button"
            size="xs"
            disabled={running || adding || toCapture.length === 0}
            title="Stand at each view, run and save it, without driving the road view"
            onClick={() => void capture.capture(toCapture.map((view) => view.id))}
          >
            <Camera className="h-3.5 w-3.5" />
            {toCapture.length
              ? `Capture ${toCapture.length} view${toCapture.length === 1 ? '' : 's'}`
              : included.length
                ? 'All captured'
                : 'None included'}
          </Button>
          <Button type="button" variant="outline" size="xs" disabled={running} onClick={onOpenExport}>
            <Download className="h-3.5 w-3.5" />
            Export…
          </Button>
        </div>
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
    </ToolSection>
  )
}
