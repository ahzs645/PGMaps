import { useState, type ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { Badge, type BadgeTone } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmRemoveButton } from '@/components/ui/confirm-remove'
import { FORM_INPUT_CLASS, FormField, NullableNumberField, StyledSelect } from '@/components/ui/form-field'
import { InlineAlert } from '@/components/ui/map-panels'
import { cn } from '@/lib/utils'
import type { Pack } from '../../../../packages/legal-rules/src/contract'
import {
  addCrossing,
  confirmCrossing,
  removeCrossing,
  setCrossingReview,
  updateCrossing,
  type CrossingChange,
} from '../edits'
import type { Block, Plan } from '../plan'
import { CaseReview } from '../review/CaseReview'
import {
  CROSSING_INSTRUMENTS,
  CROSSING_ORIGIN_LABELS,
  CROSSING_ROLE_LABELS,
  CROSSING_ROLES,
  CROSSING_STRUCTURE_LABELS,
  CROSSING_STRUCTURES,
  nextCrossingKey,
  type CrossingPlace,
  type CrossingRecord,
  type CrossingRole,
  type CrossingStructureKind,
} from './record'
import { CROSSING_STANDING_WORDS, crossingRollup, type CrossingAssessment, type CrossingStanding } from './standing'

export const CROSSING_STANDING_TONE: Record<CrossingStanding, BadgeTone> = {
  error: 'danger',
  raised: 'warning',
  open: 'info',
  unreviewed: 'neutral',
  clear: 'neutral',
}

const metres = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })

export function structureText(record: CrossingRecord) {
  const s = record.structure
  if (!s) return 'Structure not stated'
  const size = s.spanOrDiameterM === undefined ? '' : ` ${metres.format(s.spanOrDiameterM)} m`
  return `${CROSSING_STRUCTURE_LABELS[s.kind]}${size}`
}

/** A text field that commits when it loses focus, so a crossing is not rewritten on every key. */
function TextEntry({
  label,
  value,
  onCommit,
  multiline,
  description,
}: {
  label: string
  value: string
  onCommit: (value: string) => void
  multiline?: boolean
  description?: ReactNode
}) {
  const commit = (next: string) => next.trim() !== value.trim() && onCommit(next)
  return (
    <FormField label={label} description={description}>
      {multiline ? (
        <textarea
          className={FORM_INPUT_CLASS}
          rows={2}
          maxLength={20000}
          defaultValue={value}
          onBlur={(e) => commit(e.currentTarget.value)}
        />
      ) : (
        <input
          className={FORM_INPUT_CLASS}
          defaultValue={value}
          maxLength={200}
          onBlur={(e) => commit(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      )}
    </FormField>
  )
}

/** What the reviewer records about one crossing, its own review, and the evidence read for it (none yet). */
function CrossingDetail({
  assessed,
  library,
  edit,
  keepPacks,
  onRemoved,
}: {
  assessed: CrossingAssessment
  library: Pack[]
  edit: (change: (plan: Plan) => Plan) => void
  keepPacks: (plan: Plan) => Plan
  onRemoved: () => void
}) {
  const { record } = assessed
  const change = (c: CrossingChange) => edit((p) => updateCrossing(p, record.key, c))
  const structure = record.structure
  return (
    <div
      className="space-y-3 rounded-md border p-2"
      data-testid={`crossing-${record.key}`}
      aria-label={`Crossing ${record.label}`}
      role="region"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium">{record.label}</p>
        <ConfirmRemoveButton
          label={`Remove ${record.label}`}
          question="Remove this crossing?"
          detail="Its answers and the exceptions claimed on it go with it."
          onConfirm={() => {
            edit((p) => keepPacks(removeCrossing(p, record.key)))
            onRemoved()
          }}
        />
      </div>
      {!assessed.current && (
        <InlineAlert tone="info">
          The block’s shape or schedule changed since this crossing was listed. Its answers are kept; check it is still
          made on this shape.{' '}
          <Button size="sm" variant="outline" onClick={() => edit((p) => confirmCrossing(p, record.key))}>
            Keep it for this shape
          </Button>
        </InlineAlert>
      )}
      <div className="grid grid-cols-2 gap-2">
        <TextEntry label="Name" value={record.label} onCommit={(label) => change({ label })} />
        <FormField
          label="Origin"
          group
          description="Entered by the reviewer. Crossings from the road designer and the map come later."
        >
          <p className="text-xs">{CROSSING_ORIGIN_LABELS[record.origin]}</p>
        </FormField>
        <FormField label="Road" group>
          <StyledSelect
            aria-label="Road"
            value={record.role}
            options={CROSSING_ROLES.map((r) => ({ value: r, label: CROSSING_ROLE_LABELS[r] }))}
            onValueChange={(role) => change({ role: role as CrossingRole })}
          />
        </FormField>
        <FormField label="Structure" group>
          <StyledSelect
            aria-label="Structure"
            value={structure?.kind ?? ''}
            options={[
              { value: '', label: 'Not stated' },
              ...CROSSING_STRUCTURES.map((k) => ({ value: k, label: CROSSING_STRUCTURE_LABELS[k] })),
            ]}
            onValueChange={(kind) =>
              change({
                structure: kind ? { ...structure, kind: kind as CrossingStructureKind } : undefined,
              })
            }
          />
        </FormField>
        {structure && (
          <NullableNumberField
            label={structure.kind === 'bridge' ? 'Span' : 'Span or equivalent diameter'}
            unit="m"
            value={structure.spanOrDiameterM ?? null}
            min={0}
            max={1000}
            updateOn="commit"
            onValueChange={(v) => {
              const next = { ...structure }
              if (v === null) delete next.spanOrDiameterM
              else next.spanOrDiameterM = v
              change({ structure: next })
            }}
          />
        )}
        <TextEntry
          label="Road name or section"
          value={record.at?.road?.name ?? ''}
          onCommit={(name) => {
            const road = { ...record.at?.road }
            if (name.trim()) road.name = name.trim()
            else delete road.name
            const at: CrossingPlace = { ...record.at, road }
            if (!Object.keys(road).length) delete at.road
            change({ at: Object.keys(at).length ? at : undefined })
          }}
        />
        <TextEntry
          label="Stream"
          value={record.at?.stream?.name ?? ''}
          onCommit={(name) => {
            const stream = { ...record.at?.stream }
            if (name.trim()) stream.name = name.trim()
            else delete stream.name
            const at: CrossingPlace = { ...record.at, stream }
            if (!Object.keys(stream).length) delete at.stream
            change({ at: Object.keys(at).length ? at : undefined })
          }}
        />
      </div>
      <TextEntry label="Note" multiline value={record.note ?? ''} onCommit={(note) => change({ note })} />
      <div className="space-y-1">
        <p className="text-xs font-medium">Evidence</p>
        <p className="text-2xs text-muted-foreground" data-testid="crossing-evidence">
          {record.evidence.length
            ? `${record.evidence.length} record${record.evidence.length === 1 ? '' : 's'} read`
            : 'None read for this crossing yet. Records read later (PSCIS assessments, fish observations, Water Act notices, the designer’s sizing) are candidates beside the answers, never the answers.'}
        </p>
        {record.evidence.length > 0 && (
          <ul className="space-y-0.5 text-2xs">
            {record.evidence.map((e, i) => (
              <li key={i}>
                {e.summary}{' '}
                <span className="text-muted-foreground">
                  ({e.source}, read {e.readOn})
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <CaseReview
        library={library}
        instruments={[...CROSSING_INSTRUMENTS]}
        review={record.review}
        measurements={[]}
        hints={{
          structure: record.structure ? `Recorded above: ${structureText(record)}.` : undefined,
          'stream-gradient':
            'Under 20% presumes a fish stream unless one of limb (b)’s three rebuttals is shown; 20% or more makes none by limb (b), though limb (a) still may.',
          'no-listed-species':
            'Showing the watercourse holds none of the listed fish takes a fish inventory; one visit with no fish seen is not that evidence.',
          'listed-species':
            'Only the species the definition lists count: sculpins, suckers, chub or shiners recorded do not make a fish stream by limb (a).',
          'crossing-passage-effect':
            'A PSCIS barrier rating is evidence about the structure, not this answer: §56 asks about a material adverse effect on fish passage.',
        }}
        onChange={(review) => edit((p) => keepPacks(setCrossingReview(p, record.key, review)))}
        caseLabel="This crossing"
        testId={`crossing-review-${record.key}`}
      />
    </div>
  )
}

/**
 * The block's stream crossings under the schedule under review: the roll-up (the worst standing
 * across them, each such crossing by name, never stored), a table with each crossing's origin, road,
 * structure, open questions, findings and standing, and the selected crossing's own review.
 */
export function CrossingsSection({
  plan,
  edit,
  block,
  schedule,
  library,
  keepPacks,
}: {
  plan: Plan
  edit: (change: (plan: Plan) => Plan) => void
  block: Block
  schedule: string
  library: Pack[]
  keepPacks: (plan: Plan) => Plan
}) {
  const rollup = crossingRollup(plan, block.id, schedule, library)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [name, setName] = useState('')
  const open = rollup.crossings.find((c) => c.record.key === openKey)
  const add = () => {
    // The key the edit gives it, read from the plan as shown: the edit runs on that plan.
    setOpenKey(nextCrossingKey(plan))
    edit((p) => keepPacks(addCrossing(p, block.id, schedule, name).plan))
    setName('')
  }
  return (
    <div className="space-y-3" data-testid="block-planning-crossings">
      <p className="text-xs" data-testid="crossings-rollup">
        {rollup.standing ? (
          <>
            <Badge tone={CROSSING_STANDING_TONE[rollup.standing]} size="sm">
              {CROSSING_STANDING_WORDS[rollup.standing]}
            </Badge>{' '}
            <span className="mt-1 block space-y-0.5">
              {rollup.worst.map((c) => (
                <span key={c.record.key} className="block">
                  <span className="font-medium">{c.record.label}</span>
                  {c.raised.length > 0 && <>: {c.raised.map((r) => r.finding.title).join('; ')}</>}
                </span>
              ))}
            </span>
            <span className="block text-2xs text-muted-foreground">
              The worst standing across the block’s {rollup.crossings.length} crossing
              {rollup.crossings.length === 1 ? '' : 's'}, each answered on its own. Worked out from their answers each
              time, never kept.
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">
            No crossings listed for this block. The block review asks whether its roads or harvesting change a stream at
            all; list each crossing here to answer it on its own.
          </span>
        )}
      </p>
      {rollup.crossings.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs" data-testid="crossings-table" aria-label="Stream crossings">
            <thead>
              <tr className="text-left text-2xs text-muted-foreground">
                <th className="px-1 font-medium">Crossing · origin, road, structure</th>
                <th className="px-1 text-right font-medium">To answer</th>
                <th className="px-1 text-right font-medium">Raised</th>
                <th className="px-1 font-medium">Standing</th>
              </tr>
            </thead>
            <tbody>
              {rollup.crossings.map((c) => (
                <tr
                  key={c.record.key}
                  className={cn('border-t align-top', c.record.key === openKey && 'bg-muted')}
                  data-crossing={c.record.key}
                >
                  <th scope="row" className="px-1 py-1 text-left font-normal">
                    <button
                      type="button"
                      className="text-left underline-offset-2 hover:underline"
                      aria-expanded={c.record.key === openKey}
                      onClick={() => setOpenKey(c.record.key === openKey ? null : c.record.key)}
                    >
                      {c.record.label}
                    </button>
                    <span className="block text-2xs text-muted-foreground">
                      {CROSSING_ORIGIN_LABELS[c.record.origin]} · {CROSSING_ROLE_LABELS[c.record.role]} ·{' '}
                      {structureText(c.record)}
                    </span>
                    {!c.current && <span className="block text-2xs text-muted-foreground">Shape changed</span>}
                  </th>
                  <td className="px-1 py-1 text-right tabular-nums">{c.openQuestions}</td>
                  <td className="px-1 py-1 text-right tabular-nums">
                    {c.raised.length}
                    {c.exceptions > 0 && (
                      <span className="block text-2xs text-muted-foreground">{c.exceptions} with exception</span>
                    )}
                  </td>
                  <td className="px-1 py-1 whitespace-nowrap">
                    <Badge tone={CROSSING_STANDING_TONE[c.standing]} size="sm">
                      {CROSSING_STANDING_WORDS[c.standing]}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <FormField label="New crossing" className="flex-1">
          <input
            className={FORM_INPUT_CLASS}
            value={name}
            maxLength={200}
            placeholder={`Crossing ${rollup.crossings.length + 1}`}
            aria-label="New crossing’s name"
            onChange={(e) => setName(e.target.value)}
          />
        </FormField>
        <Button size="sm" type="submit">
          <Plus className="size-3.5" />
          Add crossing
        </Button>
      </form>
      {open && (
        <CrossingDetail
          key={open.record.key}
          assessed={open}
          library={library}
          edit={edit}
          keepPacks={keepPacks}
          onRemoved={() => setOpenKey(null)}
        />
      )}
    </div>
  )
}
