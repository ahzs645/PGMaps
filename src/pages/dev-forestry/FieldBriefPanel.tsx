import { FORM_INPUT_CLASS, FormField, StyledSelect } from '@/components/ui/form-field'
import { useMemo, type ReactNode } from 'react'
import { PersonInput } from '@/branding/PersonInput'

import { InfoTip } from '@/components/ui/info-tip'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { TextButton } from '@/components/ui/text-button'
import { ToolSection } from '@/components/ui/tool-section'

import { briefOpenings, briefViewpoints, formatLatLng, viewOfInterestCheck, viewOfInterestCheckKey } from './fieldBrief'
import {
  FIELD_CHECK_LABELS,
  fieldChecklistProgress,
  layoutStageLabel,
  layoutStageOf,
  localIsoDate,
  stampText,
  updateBoundaryNote,
  updateFieldCheck,
  EMPTY_FIELD_CHECKLIST,
  type FieldCheckAnswer,
  type FieldCheckEntry,
  type FieldCheckGroup,
} from './fieldChecklist'
import { formatKm } from './measureFormat'
import type { SavedDriveView } from './previewState'
import type { ForestryScene } from './scene'
import type { AnalysisResult } from './types'
import type { ViaReview } from './via'
import type { ViewOfInterest } from './viewsOfInterest'

/** Openings listed for the green-up check in the sidebar; the brief prints fewer. */
const PANEL_OPENINGS = 12

type Answer = FieldCheckAnswer | 'unchecked'

/** One item to answer: a viewpoint or an opening, with its yes/no and a note. */
function CheckRow({
  group,
  title,
  detail,
  entry,
  onAnswer,
  onNote,
}: {
  group: FieldCheckGroup
  title: string
  detail: string
  entry: FieldCheckEntry | null
  onAnswer: (answer: FieldCheckAnswer | null) => void
  onNote: (note: string) => void
}) {
  return (
    <li className="space-y-1 border-b border-border py-2 last:border-b-0" data-field-check={group}>
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-foreground" title={title}>
          {title}
        </p>
        <p className="text-3xs leading-4 text-muted-foreground">{detail}</p>
      </div>
      <CheckFields group={group} title={title} entry={entry} onAnswer={onAnswer} onNote={onNote} />
    </li>
  )
}

/** The answer buttons and note of one check, as a crew row and a view's own row both draw them. */
function CheckFields({
  group,
  title,
  entry,
  onAnswer,
  onNote,
}: {
  group: FieldCheckGroup
  title: string
  entry: FieldCheckEntry | null
  onAnswer: (answer: FieldCheckAnswer | null) => void
  onNote: (note: string) => void
}) {
  const labels = FIELD_CHECK_LABELS[group]
  const stamp = stampText(entry)
  return (
    <>
      <SegmentedControl<Answer>
        size="sm"
        label={`${labels.question}: ${title}`}
        value={entry?.answer ?? 'unchecked'}
        onChange={(value) => onAnswer(value === 'unchecked' ? null : value)}
        options={[
          { value: 'unchecked', label: 'Not checked' },
          { value: 'yes', label: labels.yes },
          { value: 'no', label: labels.no },
        ]}
      />
      <input
        className={FORM_INPUT_CLASS}
        aria-label={`Note on ${title}`}
        placeholder="Note (access, what was seen)"
        value={entry?.note ?? ''}
        onChange={(event) => onNote(event.target.value)}
      />
      {stamp && <p className="text-3xs text-muted-foreground">Recorded {stamp}</p>}
    </>
  )
}

/**
 * A view of interest's crew check, in the view's own row: is it real and reachable. Kept under the view's id
 * (`viewOfInterestCheckKey`), so a recapture keeps it; the crew checklist and the field brief read the same answer.
 */
export function viewFieldCheck({
  view,
  review,
  onReviewChange,
  savedViews,
}: {
  view: Pick<ViewOfInterest, 'id' | 'name'>
  review: ViaReview
  onReviewChange: (patch: Partial<ViaReview>) => void
  savedViews: ReadonlyArray<Pick<SavedDriveView, 'id' | 'plannedViewId'>>
}): { summary: string; node: ReactNode } {
  const checklist = review.fieldChecklist ?? EMPTY_FIELD_CHECKLIST
  const entry = viewOfInterestCheck(checklist.viewpoints, view.id, savedViews)
  const labels = FIELD_CHECK_LABELS.viewpoints
  const key = viewOfInterestCheckKey(view.id)
  // An answer read from the view's earlier capture is written under the view's own key from the first edit.
  const write = (patch: { answer?: FieldCheckAnswer | null; note?: string }) =>
    onReviewChange({
      fieldChecklist: updateFieldCheck(
        checklist,
        'viewpoints',
        key,
        { answer: entry?.answer ?? null, note: entry?.note ?? '', ...patch },
        localIsoDate(new Date()),
      ),
    })
  return {
    summary: entry?.answer === 'yes' ? labels.yes : entry?.answer === 'no' ? labels.no : 'not checked',
    node: (
      <div className="space-y-1" data-field-check="view" data-view-check={view.id}>
        <CheckFields
          group="viewpoints"
          title={view.name}
          entry={entry}
          onAnswer={(answer) => write({ answer })}
          onNote={(note) => write({ note })}
        />
        {!checklist.checkedBy.trim() && (
          <p className="text-3xs text-muted-foreground">
            Stamped with the date and <em>Checked by</em> from Save &amp; export&apos;s Field brief.
          </p>
        )}
      </div>
    ),
  }
}

/**
 * The road's crew check, in step 2's *Road viewpoint* section: is the road's assessment station real and reachable.
 * Kept under `station:<viewpoint id>`, the key the field brief prints it from. Null when the brief does not list the
 * road (no road yet, or standing at a view of interest, whose own row holds the check).
 */
export function RoadFieldCheck({
  scene,
  result,
  review,
  onReviewChange,
  standingViewId,
}: {
  scene: ForestryScene
  result: AnalysisResult | null
  review: ViaReview
  onReviewChange: (patch: Partial<ViaReview>) => void
  standingViewId?: string | null
}) {
  const road = useMemo(
    () =>
      briefViewpoints({
        viewpoint: scene.viewpoint,
        block: null,
        targets: scene.targets,
        result,
        savedViews: [],
        viewsOfInterest: scene.viewsOfInterest,
        standingViewId,
      }).find((point) => point.key.startsWith('station:')) ?? null,
    [scene.viewpoint, scene.targets, scene.viewsOfInterest, result, standingViewId],
  )
  if (!road) return null
  const checklist = review.fieldChecklist ?? EMPTY_FIELD_CHECKLIST
  const write = (patch: { answer?: FieldCheckAnswer | null; note?: string }) =>
    onReviewChange({
      fieldChecklist: updateFieldCheck(checklist, 'viewpoints', road.key, patch, localIsoDate(new Date())),
    })
  return (
    <div className="space-y-1" data-field-check="road">
      <p className="text-2xs font-semibold text-foreground">Real and reachable</p>
      <p className="text-3xs leading-4 text-muted-foreground">
        {[road.where, road.location ? formatLatLng(road.location) : null].filter(Boolean).join(' · ')}
      </p>
      <CheckFields
        group="viewpoints"
        title={road.name}
        entry={checklist.viewpoints[road.key] ?? null}
        onAnswer={(answer) => write({ answer })}
        onNote={(note) => write({ note })}
      />
    </div>
  )
}

/**
 * *Checked by*, in Save & export's Field brief options: the name stamped on each crew answer as it is recorded and
 * printed in the brief's *Checked by* box.
 */
export function CheckedByField({
  review,
  onReviewChange,
}: {
  review: ViaReview
  onReviewChange: (patch: Partial<ViaReview>) => void
}) {
  const checklist = review.fieldChecklist ?? EMPTY_FIELD_CHECKLIST
  return (
    <FormField
      label="Checked by"
      hintAction={
        <InfoTip label="About checked by" className="absolute -top-1 right-0">
          Printed in the brief&apos;s <em>Checked by</em> box, and stamped with today&apos;s date on each crew answer
          recorded while it is set.
        </InfoTip>
      }
    >
      <PersonInput
        className={FORM_INPUT_CLASS}
        value={checklist.checkedBy}
        placeholder="Crew lead"
        maxLength={120}
        onValueChange={(checkedBy) =>
          onReviewChange({ fieldChecklist: { ...checklist, checkedBy: checkedBy.slice(0, 120) } })
        }
      />
    </FormField>
  )
}

/** Opens the Field records section above and scrolls to it, where a visit's photos are added. */
function showFieldRecords() {
  const toggle = document.querySelector<HTMLButtonElement>('[data-forestry-disclosure="field-records"]')
  if (!toggle) return
  if (toggle.getAttribute('aria-expanded') === 'false') toggle.click()
  toggle.scrollIntoView({ block: 'start', behavior: 'smooth' })
}

/**
 * Step 2: the pre-layout VIA as a one-page brief for the layout crew, and the
 * crew's checklist answered back — viewpoints real and reachable, the
 * neighbouring openings greened up, where the boundary can follow natural
 * features. Answers live on `viaReview.fieldChecklist`, so they never stale a run.
 */
export function FieldBriefPanel({
  scene,
  result,
  review,
  onReviewChange,
  selectedTargetId,
  savedViews,
  otherViews,
  blockId,
  onBlockId,
  viewsOfInterest,
  standingViewId,
}: {
  scene: ForestryScene
  /** The current run; null when there is none or it is stale. */
  result: AnalysisResult | null
  review: ViaReview
  onReviewChange: (patch: Partial<ViaReview>) => void
  selectedTargetId: string | null
  /** Views saved on the road the scene has now, in order. */
  savedViews: ReadonlyArray<SavedDriveView>
  /** Views saved while standing at other viewpoints. */
  otherViews: ReadonlyArray<SavedDriveView>
  /** The block the brief and checklist are for (shared with Save & export); the selected one when null. */
  blockId: string | null
  onBlockId: (id: string) => void
  /** The views of interest: each is answered in its own row, and only counted here. */
  viewsOfInterest?: ReadonlyArray<ViewOfInterest>
  /** The view of interest the run stands at: the road is that view, so its station is not listed again. */
  standingViewId?: string | null
}) {
  const blocks = useMemo(() => scene.targets.filter((target) => target.role === 'block'), [scene.targets])
  const block = useMemo(
    () =>
      blocks.find((entry) => entry.id === blockId) ??
      blocks.find((entry) => entry.id === selectedTargetId) ??
      blocks[0] ??
      null,
    [blocks, blockId, selectedTargetId],
  )

  const briefViews = useMemo(
    () => [
      ...savedViews.map((view) => ({ ...view, onThisRoad: true })),
      ...otherViews.map((view) => ({ ...view, onThisRoad: false })),
    ],
    [savedViews, otherViews],
  )
  const viewpoints = useMemo(
    () =>
      briefViewpoints({
        viewpoint: scene.viewpoint,
        block,
        targets: scene.targets,
        result,
        savedViews: briefViews,
        viewsOfInterest,
        standingViewId,
        // A saved view of no planned view has no row to answer in; the brief still prints it.
      }).filter((point) => !point.key.startsWith('view:')),
    [scene.viewpoint, block, scene.targets, result, briefViews, viewsOfInterest, standingViewId],
  )
  // Each viewpoint is answered where its record is (a view's row, the road's section), and only counted here.
  const openings = useMemo(() => briefOpenings(block, scene.targets), [block, scene.targets])
  const checklist = review.fieldChecklist ?? EMPTY_FIELD_CHECKLIST
  const progress = fieldChecklistProgress(checklist, {
    viewpoints: viewpoints.map((point) => point.key),
    openings: openings.map((opening) => opening.id),
  })
  const stage = layoutStageOf(review)
  const today = () => localIsoDate(new Date())
  const answer = (group: FieldCheckGroup, key: string, patch: { answer?: FieldCheckAnswer | null; note?: string }) =>
    onReviewChange({ fieldChecklist: updateFieldCheck(checklist, group, key, patch, today()) })

  return (
    <ToolSection
      title="Field brief and crew checklist"
      summary={`${layoutStageLabel(stage)} · ${
        progress.started
          ? `${progress.answered} of ${progress.total} checked${progress.flagged ? ` · ${progress.flagged} flagged` : ''}`
          : 'not checked yet'
      }`}
      toggleProps={{ 'data-forestry-disclosure': 'field-brief' }}
      data-field-brief=""
      help={
        <>
          A VIA done before layout goes to the layout crew with the block, so strategic wildlife tree patches, leave
          trees and the boundary are placed for the view, and nobody returns for a second trip. The brief is one page:
          the block, landform and objective, each viewpoint with where to stand and which way to face, up to three saved
          views&apos; screenshots, the measured figure, what to look for, and this checklist with tick boxes. Record the
          crew&apos;s answers with each viewpoint and here; each is stamped with <em>Checked by</em> (set in Save &amp;
          export&apos;s Field brief) and the date, and printed in the brief&apos;s boxes. They are part of the review,
          so they never stale the run. Download the brief from Save &amp; export.
        </>
      }
    >
      <div className="space-y-3 text-xs">
        {!block ? (
          <p className="text-2xs text-muted-foreground">Add a cutblock in step 1 to brief the crew on it.</p>
        ) : (
          <>
            {blocks.length > 1 && (
              <StyledSelect
                aria-label="Block the brief is for"
                className="w-full rounded-md border bg-background p-1"
                value={block.id}
                onChange={(event) => onBlockId(event.target.value)}
              >
                {blocks.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </StyledSelect>
            )}

            {openings.length > 0 && (
              <div>
                <p className="text-2xs font-semibold text-foreground">Adjacent openings have visually greened up</p>
                <ul aria-label="Existing openings to check">
                  {openings.slice(0, PANEL_OPENINGS).map((opening) => (
                    <CheckRow
                      key={opening.id}
                      group="greenUp"
                      title={opening.name}
                      detail={[
                        opening.harvestYear ? `Harvested ${opening.harvestYear}` : 'Harvest year not recorded',
                        opening.distanceMeters !== null
                          ? `${formatKm(opening.distanceMeters, 1)} from the block`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                      entry={checklist.greenUp[opening.id] ?? null}
                      onAnswer={(value) => answer('greenUp', opening.id, { answer: value })}
                      onNote={(note) => answer('greenUp', opening.id, { note })}
                    />
                  ))}
                  {openings.length > PANEL_OPENINGS && (
                    <li className="pt-1 text-3xs text-muted-foreground">
                      {openings.length - PANEL_OPENINGS} more, farther from the block.
                    </li>
                  )}
                </ul>
              </div>
            )}

            <FormField
              label="Where the boundary can follow natural features"
              hint={stampText(checklist.boundary) ? `Recorded ${stampText(checklist.boundary)}` : undefined}
            >
              <textarea
                className={`${FORM_INPUT_CLASS} min-h-16 leading-5`}
                value={checklist.boundary.note}
                placeholder="Draws, benches, rock, timber-type edges the boundary can run along"
                onChange={(event) =>
                  onReviewChange({ fieldChecklist: updateBoundaryNote(checklist, event.target.value, today()) })
                }
              />
            </FormField>

            <p className="text-2xs leading-4 text-muted-foreground">
              Photos from the visit belong with their viewpoint in{' '}
              <TextButton onClick={showFieldRecords}>Field records</TextButton>.
            </p>
          </>
        )}
      </div>
    </ToolSection>
  )
}
