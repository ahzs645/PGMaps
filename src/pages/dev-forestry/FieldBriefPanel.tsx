import { FORM_INPUT_CLASS, FormField, StyledSelect } from '@/components/ui/form-field'
import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { TextButton } from '@/components/ui/text-button'
import { ToolSection } from '@/components/ui/tool-section'
import { downloadBlob } from '@/lib/download'

import type { NoteImage } from './blockNote'
import {
  briefOpenings,
  briefViewpoints,
  buildFieldBrief,
  fieldBriefFileName,
  fieldBriefPdf,
  formatLatLng,
} from './fieldBrief'
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
import type { AnalysisResult, TargetPolygon } from './types'
import type { ViaAssessment, ViaReview } from './via'

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
  const labels = FIELD_CHECK_LABELS[group]
  const stamp = stampText(entry)
  return (
    <li className="space-y-1 border-b border-border py-2 last:border-b-0" data-field-check={group}>
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-foreground" title={title}>
          {title}
        </p>
        <p className="text-3xs leading-4 text-muted-foreground">{detail}</p>
      </div>
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
    </li>
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
  stale,
  assessment,
  review,
  onReviewChange,
  selectedTargetId,
  landform,
  savedViews,
  otherViews,
  images,
}: {
  scene: ForestryScene
  /** The current run; null when there is none or it is stale. */
  result: AnalysisResult | null
  stale: boolean
  assessment: ViaAssessment | null
  review: ViaReview
  onReviewChange: (patch: Partial<ViaReview>) => void
  selectedTargetId: string | null
  landform: TargetPolygon | null
  /** Views saved on the road the scene has now, in order. */
  savedViews: ReadonlyArray<SavedDriveView>
  /** Views saved while standing at other viewpoints. */
  otherViews: ReadonlyArray<SavedDriveView>
  /** Screenshots taken at *Save viewpoint*, by view id. */
  images: Readonly<Record<string, NoteImage>>
}) {
  const blocks = scene.targets.filter((target) => target.role === 'block')
  const [chosen, setChosen] = useState<string | null>(null)
  const block =
    blocks.find((entry) => entry.id === chosen) ??
    blocks.find((entry) => entry.id === selectedTargetId) ??
    blocks[0] ??
    null
  const [message, setMessage] = useState<{ tone: 'info' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const briefViews = useMemo(
    () => [
      ...savedViews.map((view) => ({ ...view, onThisRoad: true })),
      ...otherViews.map((view) => ({ ...view, onThisRoad: false })),
    ],
    [savedViews, otherViews],
  )
  const viewpoints = useMemo(
    () =>
      briefViewpoints({ viewpoint: scene.viewpoint, block, targets: scene.targets, result, savedViews: briefViews }),
    [scene.viewpoint, block, scene.targets, result, briefViews],
  )
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

  const download = async () => {
    if (!block) return
    setBusy(true)
    setMessage(null)
    try {
      const brief = buildFieldBrief({
        block,
        targets: scene.targets,
        viewpoint: scene.viewpoint,
        landform,
        result,
        stale,
        assessment,
        review,
        savedViews: briefViews,
        images,
        notes: [
          'A desk screening from terrain (AWS Open Data CDEM/SRTM) and drawn timber; confirm every viewpoint and figure in the field.',
        ],
        generatedAt: new Date(),
      })
      const jspdf = await import('jspdf')
      downloadBlob(new Blob([fieldBriefPdf(brief, jspdf)], { type: 'application/pdf' }), fieldBriefFileName(brief))
      setMessage({
        tone: 'info',
        text: `Downloaded with ${brief.viewpoints.length} viewpoint${brief.viewpoints.length === 1 ? '' : 's'} and ${brief.images.length} screenshot${brief.images.length === 1 ? '' : 's'}.`,
      })
    } catch (error) {
      setMessage({ tone: 'error', text: `Brief failed: ${error instanceof Error ? error.message : String(error)}` })
    } finally {
      setBusy(false)
    }
  }

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
          crew&apos;s answers here; each is stamped with the name below and the date, and printed in the brief&apos;s
          boxes. They are part of the review, so they never stale the run.
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
                onChange={(event) => setChosen(event.target.value)}
              >
                {blocks.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </StyledSelect>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => void download()} disabled={busy}>
                {busy ? 'Writing…' : 'Download field brief (PDF)'}
              </Button>
              <span className="text-3xs text-muted-foreground">
                {result ? '' : stale ? 'Run is out of date: the brief says so.' : 'Not run yet: the brief says so.'}
              </span>
            </div>
            {message && <InlineAlert tone={message.tone === 'error' ? 'error' : 'info'}>{message.text}</InlineAlert>}

            <FormField label="Checked by" hint="Stamped on each answer you record, with today’s date.">
              <input
                className={FORM_INPUT_CLASS}
                value={checklist.checkedBy}
                placeholder="Crew lead"
                onChange={(event) =>
                  onReviewChange({ fieldChecklist: { ...checklist, checkedBy: event.target.value.slice(0, 120) } })
                }
              />
            </FormField>

            <div>
              <p className="text-2xs font-semibold text-foreground">Each viewpoint is real and reachable</p>
              {viewpoints.length ? (
                <ul aria-label="Viewpoints to ground-truth">
                  {viewpoints.map((point) => (
                    <CheckRow
                      key={point.key}
                      group="viewpoints"
                      title={point.name}
                      detail={[point.where, point.location ? formatLatLng(point.location) : null]
                        .filter(Boolean)
                        .join(' · ')}
                      entry={checklist.viewpoints[point.key] ?? null}
                      onAnswer={(value) => answer('viewpoints', point.key, { answer: value })}
                      onNote={(note) => answer('viewpoints', point.key, { note })}
                    />
                  ))}
                </ul>
              ) : (
                <p className="text-2xs text-muted-foreground">No viewpoint yet: draw or import the road in step 1.</p>
              )}
            </div>

            <div>
              <p className="text-2xs font-semibold text-foreground">Adjacent openings have visually greened up</p>
              {openings.length ? (
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
              ) : (
                <p className="text-2xs text-muted-foreground">
                  No existing openings in the scene. Look up the BC inventory in step 1 to list them.
                </p>
              )}
            </div>

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
