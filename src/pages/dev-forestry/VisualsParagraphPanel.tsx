import { CheckboxField, FORM_INPUT_CLASS, StyledSelect } from '@/components/ui/form-field'
import { formatMeasure, formatPercentValue } from '@/lib/format'
import { Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { Button, buttonVariants } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { InfoTip } from '@/components/ui/info-tip'
import { insetBox } from '@/components/ui/inset-box'
import { InlineAlert, KeyValueRows } from '@/components/ui/map-panels'
import { cn } from '@/lib/utils'

import type { BcSensitivityUnit } from './bcVisualInventory'
import type { ForestryScene } from './scene'
import type { AnalysisResult, TargetPolygon } from './types'
import type { ViaAssessment, ViaReview } from './via'
import {
  draftVisualMeasures,
  MEASURE_LIMITS,
  measureItems,
  measuresInputFromScene,
  type VisualMeasure,
} from './visualMeasures'
import { PULLOUT_METERS, roadsNearBlock, type ViewpointInventory } from './viewpointInventory'
import { lineLengthMeters, polygonAreaMeters, polygonBounds } from './visibility'
import { queryVisualInventory } from './visualInventoryQuery'
import {
  EVQO_CODE_FOR_CLASS,
  EVQO_NAMES,
  NARRATIVE_LIMITS,
  narrativeInputFromScene,
  visualsNarrative,
  type EvqoUnit,
  type NarrativeSentence,
  type ViewpointFinding,
} from './visualsNarrative'

/** "0.5 km": how near a retention mask must be to the block to be listed with it. */
const MEASURE_NEAR_KM = `${MEASURE_LIMITS.patchNearMeters / 1000} km`

/** The paragraph box: the shared input style, tall enough for a planner's paragraph. */
const TEXTAREA_CLASS = `${FORM_INPUT_CLASS} min-h-32 leading-5`

/** What the panel hands the page for the block note: its own text, before screenshots are added. */
export type BlockNoteParts = {
  blockId: string
  header: Array<{ label: string; value: string }>
  visuals: { text: string; drafted: boolean }
  sentences: ReadonlyArray<NarrativeSentence>
  landform: Array<{ label: string; value: string }>
  /** The visual measures for the Site Plan and Logging Plan: the reviewer's, else the draft. */
  measures: { items: string[]; drafted: boolean; basis: ReadonlyArray<VisualMeasure> }
}

type UnitState = { key: string; status: 'loading' | 'ready' | 'error'; units: EvqoUnit[]; error?: string }

function unitsToEvqo(units: ReadonlyArray<BcSensitivityUnit>): EvqoUnit[] {
  return units.flatMap((unit) =>
    unit.objectiveId ? [{ code: EVQO_CODE_FOR_CLASS[unit.objectiveId], geometry: unit.geometry }] : [],
  )
}

/**
 * Step 5: the block's planning-note summary — block, licence, permit, the
 * EVQO classes under it — and the Visuals paragraph drafted from the run. The
 * reviewer's own text is kept once written; the draft stays beside it, with
 * the measurement behind each sentence.
 */
export function VisualsParagraphPanel({
  scene,
  result,
  stale,
  review,
  onReviewChange,
  selectedTargetId,
  inventory,
  otherViewpoints: allOtherViewpoints,
  otherViewpointsBlockId,
  captions,
  landform,
  assessment,
  onParts,
}: {
  scene: ForestryScene
  /** The current run; null when there is none or it is stale. */
  result: AnalysisResult | null
  stale: boolean
  review: ViaReview
  onReviewChange: (patch: Partial<ViaReview>) => void
  selectedTargetId: string | null
  inventory: ViewpointInventory | null
  /** Inventory viewpoints and rec sites the reverse check found the block in view from. */
  otherViewpoints: ReadonlyArray<ViewpointFinding>
  /** The block those were checked against; they are left out for any other. */
  otherViewpointsBlockId: string | null
  /** Captions of the saved views, in order. */
  captions: ReadonlyArray<string>
  /** The note's text as it stands, for the block note in Save & export; null without a block. */
  onParts?: (parts: BlockNoteParts | null) => void
  landform: TargetPolygon | null
  /** Step 4's assessment against the landform, for the visual measures; null without a landform. */
  assessment?: ViaAssessment | null
}) {
  const blocks = scene.targets.filter((target) => target.role === 'block')
  const [chosen, setChosen] = useState<string | null>(null)
  const block =
    blocks.find((entry) => entry.id === chosen) ??
    blocks.find((entry) => entry.id === selectedTargetId) ??
    blocks[0] ??
    null

  // The EVQO polygons under the block, live from DataBC (the snapshot only if that fails).
  const unitKey = block ? JSON.stringify(polygonBounds(block.geometry)) : ''
  const [unitState, setUnitState] = useState<UnitState | null>(null)
  useEffect(() => {
    if (!block || !unitKey) return
    const abort = new AbortController()
    queryVisualInventory(polygonBounds(block.geometry), abort.signal)
      .then(({ units }) => {
        if (!abort.signal.aborted) setUnitState({ key: unitKey, status: 'ready', units: unitsToEvqo(units) })
      })
      .catch((error: unknown) => {
        if (!abort.signal.aborted)
          setUnitState({
            key: unitKey,
            status: 'error',
            units: [],
            error: error instanceof Error ? error.message : String(error),
          })
      })
    return () => abort.abort()
    // The block's extent is what the lookup depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitKey])
  const units = unitState?.key === unitKey ? unitState : null

  const otherViewpoints = useMemo(
    () => (block && otherViewpointsBlockId === block.id ? allOtherViewpoints : []),
    [allOtherViewpoints, otherViewpointsBlockId, block],
  )
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set())
  const included = useMemo(
    () => otherViewpoints.filter((finding) => !excluded.has(finding.name)),
    [otherViewpoints, excluded],
  )

  const narrative = useMemo(() => {
    if (!block || !units || units.status !== 'ready') return null
    const input = narrativeInputFromScene({
      block,
      targets: scene.targets,
      result,
      // A stood-at viewpoint's 30 m pullout is a spot, not a road.
      viewpoint: {
        name: scene.viewpoint.name,
        mode:
          scene.viewpoint.mode === 'corridor' && lineLengthMeters(scene.viewpoint.coordinates) > 2 * PULLOUT_METERS
            ? 'corridor'
            : 'spot',
      },
      units: units.units,
      nearbyRoads: inventory ? roadsNearBlock(block.geometry, inventory.roads) : [],
      otherViewpoints: included,
      landform,
      screenshotCount: captions.length,
    })
    return { input, ...visualsNarrative(input) }
  }, [block, units, scene.targets, result, scene.viewpoint, inventory, included, landform, captions.length])

  const measuresDraft = useMemo(
    () =>
      block
        ? draftVisualMeasures(
            measuresInputFromScene({
              block,
              masks: scene.masks ?? [],
              landform,
              assessment: assessment ?? null,
              run: result && !stale ? 'current' : stale ? 'stale' : 'none',
              landformDesign: result?.landformDesign,
              viewpointName: scene.viewpoint.name,
            }),
          )
        : null,
    [block, scene.masks, landform, assessment, result, stale, scene.viewpoint.name],
  )

  if (!block)
    return (
      <>
        <ReportParts parts={null} onParts={onParts} />
        <p className="text-2xs text-muted-foreground">Add a cutblock to draft its note.</p>
      </>
    )

  const note = review.visualsNote ?? ''
  const draft = narrative?.paragraph ?? ''
  const measures = review.visualMeasures ?? ''
  const measuresText = measuresDraft?.text ?? ''
  const planning = block.planning
  const headerRows = [
    { label: 'Block', value: planning?.blockId ?? block.name },
    ...(planning?.licenceId ? [{ label: 'Licence', value: planning.licenceId }] : []),
    ...(planning?.permitId ? [{ label: 'Cutting permit', value: planning.permitId }] : []),
    ...(planning?.openingId ? [{ label: 'Opening', value: planning.openingId }] : []),
    {
      label: 'Area',
      value: formatMeasure(polygonAreaMeters(block.geometry) / 10_000, 'ha', {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }),
    },
    {
      label: 'EVQO under the block',
      value: !units
        ? 'Reading…'
        : units.status === 'error'
          ? 'Not read'
          : narrative?.input.overlaps.length
            ? narrative.input.overlaps
                .map((o) => `${EVQO_NAMES[o.code]} '${o.code}' ${Math.round(o.share * 100)}%`)
                .join(' · ')
            : 'None',
    },
  ]
  // The landform figures the note carries, worded.
  const alteration = narrative?.input.alteration
  const landformRows = landform
    ? [
        {
          label: 'Landform',
          value: `${landform.name} · ${formatMeasure(polygonAreaMeters(landform.geometry) / 10_000, 'ha', { maximumFractionDigits: 0 })} · objective ${EVQO_NAMES[EVQO_CODE_FOR_CLASS[landform.objectiveId]]}`,
        },
        {
          label: 'Landform alteration',
          value: alteration
            ? `${formatPercentValue(alteration.percent, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} in perspective view (initial X) · ${alteration.objective} range ${alteration.rangeLabel}`
            : 'Not measured: run the assessment with this landform',
        },
      ]
    : [{ label: 'Landform', value: 'None adopted' }]
  const viewpointRow = { label: 'Viewpoint', value: scene.viewpoint.name || 'Unnamed' }
  const parts: BlockNoteParts = {
    blockId: block.id,
    header: headerRows,
    visuals: { text: note || draft, drafted: !note },
    sentences: narrative?.sentences ?? [],
    landform: [viewpointRow, ...landformRows],
    measures: {
      items: measureItems(measures || measuresText),
      drafted: !measures,
      basis: measuresDraft?.measures ?? [],
    },
  }

  return (
    <div className="space-y-3 text-xs" aria-label="Visuals paragraph">
      <ReportParts parts={parts} onParts={onParts} />
      {blocks.length > 1 && (
        <StyledSelect
          aria-label="Block the paragraph is for"
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
      <KeyValueRows variant="divided" rows={headerRows} />
      {units?.status === 'error' && <InlineAlert tone="error">EVQO polygons unavailable: {units.error}</InlineAlert>}
      {stale && (
        <InlineAlert tone="warning">
          The scene changed since the run: the draft leaves visibility out until it is run again.
        </InlineAlert>
      )}
      {!result && !stale && (
        <p className="text-2xs text-muted-foreground">
          Run the visibility assessment (step 3) for the visibility sentences; the overlap is read already.
        </p>
      )}
      {!inventory && (
        <p className="text-2xs text-muted-foreground">
          Load viewpoints around the block in step 1 to name the road a windfirm screen is left along, and to add rec
          sites that see it.
        </p>
      )}
      {otherViewpoints.length > 0 && (
        <fieldset className="space-y-1">
          <legend className="text-2xs font-medium text-muted-foreground">Also seen from</legend>
          {otherViewpoints.map((finding) => (
            <CheckboxField
              key={finding.name}
              className="text-2xs"
              label={`${finding.name} · ${formatPercentValue(finding.shares.visible * 100, { maximumFractionDigits: 0 })} of the block, bare earth`}
              checked={!excluded.has(finding.name)}
              onCheckedChange={(checked) =>
                setExcluded((current) => {
                  const next = new Set(current)
                  if (checked) next.delete(finding.name)
                  else next.add(finding.name)
                  return next
                })
              }
            />
          ))}
        </fieldset>
      )}

      {narrative && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium text-foreground">
              Draft from the run
              {!narrative.applies && <span className="font-normal text-muted-foreground"> · no EVQO overlap</span>}
            </p>
            <InfoTip label="How the draft is worded">
              Written to the pattern of planners' notes: which EVQO classes the block overlaps and how much (over{' '}
              {NARRATIVE_LIMITS.wholeBlockShare * 100}% reads as the block; over {NARRATIVE_LIMITS.mostShare * 100}% as
              most of it; under {NARRATIVE_LIMITS.minorShare * 100}% as very minor), how visible it is from each
              viewpoint (in view over {NARRATIVE_LIMITS.willBeVisibleShare * 100}% of its ground reads "will be
              visible"; any less "may be"; hidden only by timber "may not be … due to screening"; within{' '}
              {NARRATIVE_LIMITS.flatTerrainDegrees}° of eye level adds "relatively flat terrain"), and recommendations:
              a WTRA where a stricter class is in view, a windfirm screen toward a road within{' '}
              {NARRATIVE_LIMITS.screenRoadMeters} m, and a post-layout VIA naming openings within{' '}
              {NARRATIVE_LIMITS.adjacentMeters / 1000} km. The thresholds are judgement calls; edit the text.
            </InfoTip>
          </div>
          <ol className="space-y-1.5" aria-label="Draft sentences">
            {narrative.sentences.map((sentence) => (
              <li key={sentence.id} className={cn(insetBox(), 'border-border/60')}>
                <p className="text-foreground">{sentence.text}</p>
                <p className="mt-0.5 text-3xs leading-4 text-muted-foreground">{sentence.basis}</p>
              </li>
            ))}
          </ol>
        </div>
      )}

      <label className="block">
        <span className="mb-1 block text-2xs font-medium text-muted-foreground">Visuals paragraph (yours)</span>
        <textarea
          className={TEXTAREA_CLASS}
          value={note}
          placeholder={draft || 'The draft appears here once the EVQO polygons are read.'}
          onChange={(event) => onReviewChange({ visualsNote: event.target.value })}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={note ? 'outline' : 'default'}
          disabled={!draft || note === draft}
          onClick={() => onReviewChange({ visualsNote: draft })}
        >
          {note ? 'Replace with the draft' : 'Use the draft'}
        </Button>
        <CopyButton
          text={note || draft}
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
          disabled={!(note || draft)}
        >
          Copy paragraph
        </CopyButton>
      </div>
      {note && draft && note !== draft && (
        <p className="text-3xs text-muted-foreground">Your text is kept; the draft above follows the latest run.</p>
      )}

      <div className="space-y-2 border-t border-border/60 pt-3" aria-label="Visual measures">
        <div className="flex items-center justify-between gap-2">
          <p className="font-medium text-foreground">Visual measures · Site Plan and Logging Plan</p>
          <InfoTip label="About the visual measures">
            What the logging crew does to achieve the objective, and when to stop. Drafted from what the assessment
            records: the objective and its measured and adjusted figure, VAC, the wildlife tree patches and retention
            drawn or imported in step 3 (in or within {MEASURE_NEAR_KM} of the block), the block's harvest system, the
            step-4 design ratings the design relies on (good or moderate edges, good force lines, character and
            position), the run's skyline check and road visibility. It always ends with a stop-work condition. Edit the
            list: change, remove or add a measure; your list is saved with the project, and Reset goes back to the
            draft. The block note numbers them.
          </InfoTip>
        </div>
        <MeasureList
          draft={measuresDraft?.measures ?? []}
          text={measures}
          onTextChange={(text) => onReviewChange({ visualMeasures: text })}
        />
      </div>

      {captions.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <p className="text-2xs font-medium text-muted-foreground">Screenshot captions</p>
            <CopyButton
              text={captions.join('\n')}
              className={buttonVariants({ variant: 'ghost', size: 'xs', className: 'text-2xs' })}
            >
              Copy
            </CopyButton>
          </div>
          <ul className="list-disc pl-4 text-2xs">
            {captions.map((caption, i) => (
              <li key={`${i}-${caption}`}>{caption}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/** One measure as stored: a single line, since the list is kept one measure per line. */
function oneLine(text: string): string {
  return text.replace(/\s*\r?\n\s*/g, ' ').trim()
}

/**
 * The visual measures as one list. Until the reviewer changes anything it shows
 * the draft, which follows the assessment; the first edit, removal or addition
 * copies the draft into `viaReview.visualMeasures` (saved with the scene and the
 * project file) and the list is the reviewer's from then on. *Reset to draft*
 * clears it. The last measure cannot be removed: an empty list would read as
 * "not written yet" and bring the draft back.
 */
function MeasureList({
  draft,
  text,
  onTextChange,
}: {
  draft: ReadonlyArray<VisualMeasure>
  /** The reviewer's list, one measure per line; '' while the draft stands. */
  text: string
  onTextChange: (text: string) => void
}) {
  const own = text.length > 0
  const items = own ? measureItems(text) : draft.map((measure) => measure.text)
  const basisFor = new Map(draft.map((measure) => [measure.text, measure.basis]))
  const draftText = draft.map((measure) => measure.text).join('\n')
  const [editing, setEditing] = useState<{ index: number; value: string } | null>(null)

  const commit = (next: string[]) => {
    const lines = next.map(oneLine).filter((line) => line.length > 0)
    if (lines.length > 0) onTextChange(lines.join('\n'))
  }
  const save = () => {
    if (!editing) return
    const value = oneLine(editing.value)
    const next = [...items]
    if (editing.index >= next.length) {
      if (value) next.push(value)
    } else if (value) next[editing.index] = value
    else next.splice(editing.index, 1)
    setEditing(null)
    if (next.join('\n') !== items.join('\n') || !own) commit(next)
  }
  const remove = (index: number) => {
    setEditing(null)
    commit(items.filter((_, i) => i !== index))
  }

  const rows = editing && editing.index >= items.length ? [...items, ''] : items
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-2xs font-medium text-muted-foreground">
          {own ? 'Your measures' : 'Draft measures · edit any to make the list yours'}
        </p>
        {own && (
          <Button
            type="button"
            size="2xs"
            variant="ghost"
            disabled={!draftText}
            onClick={() => {
              setEditing(null)
              onTextChange('')
            }}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset to draft
          </Button>
        )}
      </div>
      <ol className="space-y-1.5" aria-label={own ? 'Your measures' : 'Draft measures'}>
        {rows.map((item, index) => {
          const basis = basisFor.get(item)
          const isEditing = editing?.index === index
          return (
            <li key={`${index}-${item}`} className={cn(insetBox(), 'border-border/60')}>
              {isEditing ? (
                <div className="space-y-1.5">
                  <textarea
                    className={`${FORM_INPUT_CLASS} min-h-16 leading-5`}
                    aria-label={`Measure ${index + 1}`}
                    autoFocus
                    onFocus={(event) => {
                      const end = event.currentTarget.value.length
                      event.currentTarget.setSelectionRange(end, end)
                    }}
                    value={editing.value}
                    onChange={(event) => setEditing({ index, value: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault()
                        save()
                      } else if (event.key === 'Escape') {
                        event.preventDefault()
                        setEditing(null)
                      }
                    }}
                  />
                  <div className="flex gap-1.5">
                    <Button type="button" size="2xs" onClick={save}>
                      Save
                    </Button>
                    <Button type="button" size="2xs" variant="ghost" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-1.5">
                  <span className="w-4 shrink-0 text-muted-foreground">{index + 1}.</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground">{item}</p>
                    {basis ? (
                      <p className="mt-0.5 text-3xs leading-4 text-muted-foreground">{basis}</p>
                    ) : (
                      <p className="mt-0.5 text-3xs leading-4 text-muted-foreground">Yours</p>
                    )}
                  </div>
                  <Button
                    type="button"
                    size="icon-2xs"
                    variant="ghost"
                    aria-label={`Edit measure ${index + 1}`}
                    title="Edit"
                    onClick={() => setEditing({ index, value: item })}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="icon-2xs"
                    variant="ghost"
                    aria-label={`Remove measure ${index + 1}`}
                    title={items.length > 1 ? 'Remove' : 'The list keeps at least one measure'}
                    disabled={items.length <= 1}
                    onClick={() => remove(index)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </li>
          )
        })}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={editing !== null}
          onClick={() => setEditing({ index: items.length, value: '' })}
        >
          <Plus className="h-3.5 w-3.5" />
          Add a measure
        </Button>
        <CopyButton
          text={items.map((item, i) => `${i + 1}. ${item}`).join('\n')}
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
          disabled={items.length === 0}
        >
          Copy measures
        </CopyButton>
      </div>
      {own && draftText && text !== draftText && (
        <p className="text-3xs text-muted-foreground">
          Your list is kept as the assessment changes; Reset to draft takes the latest draft.
        </p>
      )}
    </div>
  )
}

/** Hands the note's text up whenever it changes, by value, so the page's copy never loops a render. */
function ReportParts({
  parts,
  onParts,
}: {
  parts: BlockNoteParts | null
  onParts?: (parts: BlockNoteParts | null) => void
}) {
  const key = JSON.stringify(parts)
  const latest = useRef({ parts, onParts })
  useEffect(() => {
    latest.current = { parts, onParts }
  })
  useEffect(() => {
    latest.current.onParts?.(latest.current.parts)
  }, [key])
  useEffect(() => () => latest.current.onParts?.(null), [])
  return null
}
