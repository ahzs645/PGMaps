import type { ReactNode } from 'react'

import { Badge } from '@/components/ui/badge'
import { ChevronRight } from 'lucide-react'
import { InlineAlert, KeyValueRows } from '@/components/ui/map-panels'
import { StatGroup, type StatItem } from '@/components/ui/stat-group'

import type { AnalysisResult } from './types'
import {
  DESIGN_ELEMENTS,
  RETENTION_LEVELS,
  ROADS_VISIBILITY,
  SCALE_TERMS,
  SHAPE_TERMS,
  VIA_STEPS,
  VIEWPOINT_TYPES,
  VISIBLENESS_TERMS,
  WELL_WITHIN_SHARE,
  table2Range,
  type DesignRating,
  type RoadsVisibility,
  type RetentionLevel,
  type ViaAssessment,
  type ViaReview,
  type ViaStepId,
  type ViaStepStatus,
  type ViewpointTypeId,
} from './via'
import { viewpointImportance } from './vqe'
import { VISUAL_QUALITY_CLASSES, visualQualityClass, type VisualQualityClassId } from './vqo'

const SELECT_CLASS =
  'h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring touch:h-10'

function percent(value: number | null | undefined, digits = 1): string {
  return value === null || value === undefined || !Number.isFinite(value) ? '—' : `${value.toFixed(digits)}%`
}

/** Whether an alteration of class `id` satisfies an objective — the same or less altered. */
function achieves(id: VisualQualityClassId, objectiveId: VisualQualityClassId): boolean {
  const order = VISUAL_QUALITY_CLASSES.map((entry) => entry.id)
  return order.indexOf(id) <= order.indexOf(objectiveId)
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value)
}

function classCode(id: VisualQualityClassId | null | undefined): string {
  return id ? visualQualityClass(id).code : 'over MM'
}

type OnReviewChange = (patch: Partial<ViaReview>) => void

function ChoiceField({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[10px] leading-4 text-muted-foreground">{hint}</span>}
    </label>
  )
}

// ---------------------------------------------------------------------------
// Headline

type HeadlineProps = {
  assessment: ViaAssessment | null
  /** The scene changed since the last run, so its figures are withdrawn. */
  stale: boolean
  landformName: string | null
  statuses: Record<ViaStepId, ViaStepStatus>
  onOpenStep: (step: ViaStepId) => void
  /** The step on screen; the "Next" prompt is not shown for the step already open. */
  activeStep?: ViaStepId
}

/**
 * The answer the page exists to give, above everything that produces it: the
 * Table 7 rating once there is one, and until then the numbers so far and the
 * next thing the handbook asks for.
 */
export function ViaHeadline({ assessment, stale, landformName, statuses, onOpenStep, activeStep }: HeadlineProps) {
  const next = VIA_STEPS.find((step) => statuses[step.id] === 'current') ?? null
  const rating = assessment?.rating ?? null

  const stats: StatItem[] = assessment
    ? [
        {
          label: 'Objective',
          value: assessment.objective.code,
          note: `≤ ${table2Range(assessment.objective.id).max}%`,
        },
        {
          label: 'Measured (X)',
          value: percent(assessment.initialPercent),
          note:
            assessment.initialPercent !== null
              ? `reads ${classCode(assessment.initialClass?.id)}`
              : assessment.numericalProvisional
                ? 'withheld'
                : 'needs a run',
          tone: assessment.initialPercent === null ? 'muted' : 'default',
        },
        {
          label: 'Adjusted',
          value: percent(assessment.adjusted?.percent),
          note: assessment.adjusted ? `reads ${classCode(assessment.adjusted.classId)}` : 'needs step 4',
          tone: assessment.adjusted ? 'default' : 'muted',
        },
      ]
    : []

  return (
    <section className="border-b border-border bg-background/95 p-4" aria-label="VIA headline result">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">VIA rating</p>
          <p className="mt-0.5 text-xl font-bold text-foreground" data-via-rating={rating?.id ?? 'none'}>
            {rating ? rating.label : assessment ? 'Not rated yet' : 'No landform yet'}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {assessment
              ? `${assessment.objective.label} objective${landformName ? ` · ${landformName}` : ''}`
              : 'Choose or draw the landform the proposal sits on to set its objective.'}
          </p>
        </div>
        {rating ? (
          <Badge tone={rating.tone} variant="solid" size="sm">
            {rating.definitionAchieved
              ? 'Definition achieved'
              : rating.id === 'inconclusive'
                ? 'On the boundary'
                : 'Definition not achieved'}
          </Badge>
        ) : assessment?.numericalProvisional ? (
          <Badge tone="warning" size="sm">
            Provisional
          </Badge>
        ) : null}
      </div>

      {stale && (
        <p role="alert" className="mt-3 rounded-md border border-amber-500 p-2 text-xs text-foreground">
          Scene changed — rerun the analysis. Previous results, road preview and assessed exports are unavailable until
          the run matches this scene.
        </p>
      )}

      {stats.length > 0 && <StatGroup className="mt-3" variant="tiles" size="sm" columns={3} items={stats} />}

      {!rating &&
        assessment?.reviewStarted &&
        assessment.initialPercent === null &&
        !assessment.numericalProvisional &&
        !stale && (
          <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
            Your step 4 review is saved. Runs are not kept between visits; run the simulation again to rate it.
          </p>
        )}

      {assessment?.foreground && (
        <InlineAlert className="mt-3" tone="warning">
          Foreground view: the proposal is under 1 km from the assessment station. The handbook&apos;s criteria are not
          calibrated for foreground views; read any rating with the district office&apos;s advice.
        </InlineAlert>
      )}

      {rating && (
        <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
          {rating.meaning}
          {rating.measuresDisagree &&
            ' The ocular and numerical measures disagree; the handbook makes the ocular class the deciding one, so explain why in the rationale.'}
        </p>
      )}

      {next && next.id !== activeStep && (
        // One line: the tab bar below already marks the current step, so this
        // only says what is left there and takes you to it.
        <button
          type="button"
          onClick={() => onOpenStep(next.id)}
          aria-label={`Go to step ${next.number}`}
          className="mt-3 flex w-full items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-2 py-1.5 text-left text-xs text-foreground hover:bg-primary/10 touch:min-h-10"
        >
          <span className="min-w-0 flex-1 truncate">
            <span className="font-semibold">Next: step {next.number}</span>
            <span className="text-muted-foreground">
              {' · '}
              {!!assessment?.missing.length && (next.id === 'assess' || next.id === 'rate')
                ? assessment.missing[0]
                : next.title}
            </span>
          </span>
          <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Step 2 — 3.2.1 viewpoint type

export function ViewpointTypeField({
  result,
  review,
  speedKmh,
  onChange,
}: {
  result: AnalysisResult | null
  review: ViaReview
  speedKmh: number
  onChange: OnReviewChange
}) {
  const computed = result && result.stations.length > 1 ? viewpointImportance(result, { speedKmh }) : null
  return (
    <ChoiceField
      label="Viewpoint type (handbook 3.2.1)"
      hint={
        computed
          ? computed.rating
            ? `From the run: type ${computed.rating}, about ${Math.round(computed.exposedSeconds)} s in view at ${speedKmh} km/h. Types 4 and 5 are land uses a terrain model cannot see; choose them if they apply.`
            : 'Nothing proposed is in view from the road in this run.'
          : 'Run the simulation to estimate how long the proposal is in view.'
      }
    >
      <select
        className={SELECT_CLASS}
        aria-label="Viewpoint type"
        value={review.viewpointType ?? ''}
        onChange={(event) =>
          onChange({ viewpointType: event.target.value ? (Number(event.target.value) as ViewpointTypeId) : null })
        }
      >
        <option value="">
          {computed?.rating ? `Use the run's estimate (type ${computed.rating})` : 'Not recorded'}
        </option>
        {VIEWPOINT_TYPES.map((type) => (
          <option key={type.id} value={type.id}>
            {type.id}. {type.label}
          </option>
        ))}
      </select>
    </ChoiceField>
  )
}

// ---------------------------------------------------------------------------
// Step 4 — 3.4.1 ocular, 3.4.2 numerical, 3.4.3 adjustments

export function OcularAssessmentFields({
  assessment,
  review,
  onChange,
}: {
  assessment: ViaAssessment
  review: ViaReview
  onChange: OnReviewChange
}) {
  const ocular = review.ocular ?? {}
  const setOcular = (patch: Partial<NonNullable<ViaReview['ocular']>>) => onChange({ ocular: { ...ocular, ...patch } })
  const result = assessment.ocular
  return (
    <div className="space-y-3" aria-label="Ocular assessment">
      <p className="text-[11px] leading-4 text-muted-foreground">
        The primary measure. Look at the after-harvest road view at the scale a traveller sees it and describe the
        alteration — every existing opening not yet greened up included. The model does not fill these in.
      </p>
      <ChoiceField label="Ease of seeing">
        <select
          className={SELECT_CLASS}
          aria-label="Ease of seeing"
          value={ocular.visibleness ?? ''}
          onChange={(event) => setOcular({ visibleness: (event.target.value || null) as never })}
        >
          <option value="">Not described</option>
          {VISIBLENESS_TERMS.map((term) => (
            <option key={term.id} value={term.id} title={term.meaning}>
              {term.label}
            </option>
          ))}
        </select>
      </ChoiceField>
      <ChoiceField label="Scale, relative to the landform">
        <select
          className={SELECT_CLASS}
          aria-label="Scale relative to the landform"
          value={ocular.scale ?? ''}
          onChange={(event) => setOcular({ scale: (event.target.value || null) as never })}
        >
          <option value="">Not described</option>
          {SCALE_TERMS.map((term) => (
            <option key={term.id} value={term.id}>
              {term.label}
            </option>
          ))}
        </select>
      </ChoiceField>
      <ChoiceField label="Shape">
        <select
          className={SELECT_CLASS}
          aria-label="Shape"
          value={ocular.shape ?? ''}
          onChange={(event) => setOcular({ shape: (event.target.value || null) as never })}
        >
          <option value="">Not described</option>
          {SHAPE_TERMS.map((term) => (
            <option key={term.id} value={term.id} title={term.meaning}>
              {term.label}
            </option>
          ))}
        </select>
      </ChoiceField>
      <label className="flex items-start gap-2 text-[11px] leading-4 text-muted-foreground">
        <input
          type="checkbox"
          className="mt-0.5 h-3.5 w-3.5"
          checked={ocular.onBoundary === true}
          onChange={(event) => setOcular({ onBoundary: event.target.checked })}
        />
        <span>
          <span className="font-medium text-foreground">On the class boundary.</span> The alteration sits between{' '}
          {assessment.objective.label.toLowerCase()} and the next more-altered class. Table 7 rates this Inconclusive.
        </span>
      </label>
      {result && (
        <InlineAlert
          tone={achieves(result.classId, assessment.objective.id) && !result.onBoundary ? 'success' : 'warning'}
        >
          Ocular class: <span className="font-semibold">{visualQualityClass(result.classId).label}</span>.
          {result.mixed && result.leansTowardId
            ? ` The criteria do not line up: the other terms fit ${visualQualityClass(result.leansTowardId).label.toLowerCase()}, so this sits nearer that boundary.`
            : ''}
        </InlineAlert>
      )}
    </div>
  )
}

export function NumericalAssessmentSummary({
  assessment,
  result,
}: {
  assessment: ViaAssessment
  result: AnalysisResult | null
}) {
  const breakdown = result?.quality?.numericalReady ? result.perspectiveAlteration : null
  if (!breakdown) {
    return (
      <InlineAlert tone={assessment.numericalProvisional ? 'warning' : 'info'}>
        {assessment.numericalProvisional
          ? 'The run is provisional, so percent alteration is withheld. Resolve the warnings under Final rating and package.'
          : 'Run the simulation in step 3 with an active landform to measure percent alteration.'}
      </InlineAlert>
    )
  }
  return (
    <div aria-label="Numerical assessment">
      <KeyValueRows
        variant="divided"
        rows={[
          { label: 'a. Proposed openings', value: percent(breakdown.proposedPercent) },
          { label: 'b. Visible roads and site disturbance', value: percent(breakdown.disturbancePercent) },
          { label: 'c. Existing openings not greened up', value: percent(breakdown.existingPercent) },
          ...assessment.partialCuts.map((cut) => ({
            label: `Partial cut · ${cut.name} (Table 6)`,
            value: !cut.visible
              ? 'not seen'
              : cut.equivalentPercent === null
                ? 'needs volume and height'
                : `+${percent(cut.equivalentPercent)}`,
          })),
          {
            label: <span className="font-medium text-foreground">X · initial</span>,
            value: (
              <span className="font-semibold">
                {percent(assessment.initialPercent)} · {classCode(assessment.initialClass?.id)}
              </span>
            ),
          },
        ]}
      />
      <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
        Share of the landform&apos;s visible green face, in perspective from the assessment station, read against
        handbook Table 2. Estimated from terrain sightlines, not measured on a photograph.
      </p>
    </div>
  )
}

export function AdjustmentFields({
  assessment,
  review,
  onChange,
}: {
  assessment: ViaAssessment
  review: ViaReview
  onChange: OnReviewChange
}) {
  const setDesign = (id: (typeof DESIGN_ELEMENTS)[number]['id'], value: DesignRating | null) =>
    onChange({ design: { ...review.design, [id]: value } })
  return (
    <div className="space-y-3" aria-label="Adjustments">
      <p className="text-[11px] leading-4 text-muted-foreground">
        Table 3: Good −1, Moderate 0, Poor +1. Distance, and one or two openings, are measured from the run; override
        them if the view says otherwise.
      </p>
      {DESIGN_ELEMENTS.map((element) => {
        const entry = assessment.design[element.id]
        const own = review.design?.[element.id]
        return (
          <ChoiceField
            key={element.id}
            label={element.label}
            hint={
              entry.measured && (own === undefined || own === null)
                ? `Measured: ${entry.measured.basis}.`
                : element.question
            }
          >
            <select
              className={SELECT_CLASS}
              aria-label={element.label}
              value={own ?? ''}
              onChange={(event) =>
                setDesign(element.id, event.target.value === '' ? null : (Number(event.target.value) as DesignRating))
              }
            >
              <option value="">
                {entry.measured
                  ? `Measured: ${entry.measured.rating === -1 ? 'Good' : entry.measured.rating === 0 ? 'Moderate' : 'Poor'} (${signed(entry.measured.rating)})`
                  : 'Not rated'}
              </option>
              <option value="-1">Good (−1) · {element.good}</option>
              <option value="0">Moderate (0) · {element.moderate}</option>
              <option value="1">Poor (+1) · {element.poor}</option>
            </select>
          </ChoiceField>
        )
      })}
      <ChoiceField label="Roads, landings and sidecast (Table 4)">
        <select
          className={SELECT_CLASS}
          aria-label="Roads, landings and sidecast"
          value={review.roads ?? ''}
          onChange={(event) =>
            onChange({ roads: event.target.value === '' ? null : (Number(event.target.value) as RoadsVisibility) })
          }
        >
          <option value="">Not rated</option>
          {ROADS_VISIBILITY.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label} ({signed(entry.value)})
            </option>
          ))}
        </select>
      </ChoiceField>
      <ChoiceField label="Tree retention (Table 5)">
        <select
          className={SELECT_CLASS}
          aria-label="Tree retention"
          value={review.retention ?? ''}
          disabled={review.retentionNetted === true}
          onChange={(event) => onChange({ retention: (event.target.value || null) as RetentionLevel | null })}
        >
          <option value="">
            {assessment.retentionMeasured
              ? `From the blocks: ${percent(assessment.retentionMeasured.percent)} retained (${signed(RETENTION_LEVELS.find((level) => level.id === assessment.retentionMeasured!.level)!.factor)})`
              : 'Not rated'}
          </option>
          {RETENTION_LEVELS.map((level) => (
            <option key={level.id} value={level.id}>
              {level.label} ({signed(level.factor)})
            </option>
          ))}
        </select>
      </ChoiceField>
      <label className="flex items-start gap-2 text-[11px] leading-4 text-muted-foreground">
        <input
          type="checkbox"
          className="mt-0.5 h-3.5 w-3.5"
          checked={review.retentionNetted === true}
          onChange={(event) => onChange({ retentionNetted: event.target.checked })}
        />
        <span>Retained patches are already cut out of the block outlines, so they are not counted a second time.</span>
      </label>
      <KeyValueRows
        variant="divided"
        rows={[
          { label: 'Design total', value: assessment.designTotal === null ? '—' : signed(assessment.designTotal) },
          { label: 'Y · all adjustments', value: assessment.y === null ? '—' : signed(assessment.y) },
          {
            label: <span className="font-medium text-foreground">Adjusted · X × (1 + 0.14 × Y)</span>,
            value: (
              <span className="font-semibold">
                {assessment.adjusted
                  ? `${percent(assessment.adjusted.percent)} · ${classCode(assessment.adjusted.classId)}`
                  : '—'}
              </span>
            ),
          },
        ]}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 5 — 3.5 final rating and rationale

export function FinalRatingFields({
  assessment,
  review,
  onChange,
}: {
  assessment: ViaAssessment
  review: ViaReview
  onChange: OnReviewChange
}) {
  const rating = assessment.rating
  const range = table2Range(assessment.objective.id)
  return (
    <div className="space-y-3" aria-label="Final rating">
      {rating ? (
        <div className="rounded-md border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-foreground">{rating.label}</p>
            <Badge tone={rating.tone}>{assessment.objective.code} objective</Badge>
          </div>
          <KeyValueRows
            className="mt-2"
            rows={[
              {
                label: 'Ocular class (primary)',
                value: assessment.ocular ? visualQualityClass(assessment.ocular.classId).label : '—',
              },
              {
                label: 'Adjusted alteration',
                value: `${percent(assessment.adjusted?.percent)} · ${classCode(assessment.adjusted?.classId)}`,
              },
              {
                label: `${assessment.objective.code} range (Table 2)`,
                value: range.label,
              },
              {
                label: 'Against that range',
                value:
                  rating.standing === 'over'
                    ? 'Over'
                    : rating.standing === 'near-boundary'
                      ? 'Near the boundary'
                      : 'Well within',
              },
            ]}
          />
          <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
            Table 7 gives no figure for &ldquo;well within&rdquo;; this tool treats the top{' '}
            {Math.round((1 - WELL_WITHIN_SHARE) * 100)}% of the objective&apos;s range as near the boundary.
          </p>
        </div>
      ) : (
        <InlineAlert>
          A final rating needs both measures. Still to do:{' '}
          {assessment.missing
            .filter((item) => item !== 'Write the rationale')
            .join('; ')
            .toLowerCase() || 'nothing'}
          .
        </InlineAlert>
      )}
      {assessment.foreground && (
        <InlineAlert tone="warning">
          Under 1 km: handbook 3.0 says its criteria have not been calibrated for foreground views, which need
          additional interpretation. Record that interpretation in the rationale.
        </InlineAlert>
      )}
      <ChoiceField
        label="Rationale (handbook 3.5.2)"
        hint="Landscape character, constraints and opportunities, the design strategies used, and anything else that shaped the rating."
      >
        <textarea
          className="min-h-20 w-full rounded-md border border-border bg-background p-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          aria-label="Rationale"
          maxLength={4000}
          value={review.rationale ?? ''}
          onChange={(event) => onChange({ rationale: event.target.value })}
        />
      </ChoiceField>
    </div>
  )
}
