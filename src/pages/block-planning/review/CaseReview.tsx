import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { Badge, type BadgeTone } from '@/components/ui/badge'
import { DisclosureRow } from '@/components/ui/disclosure'
import { FORM_INPUT_CLASS, FormField, NullableNumberField, StyledSelect } from '@/components/ui/form-field'
import { InlineAlert } from '@/components/ui/map-panels'
import { cn } from '@/lib/utils'
import { assess } from '../../../../packages/legal-rules/engine/evaluate'
import { spatialFacts, type Measurement } from '../../../../packages/legal-rules/engine/spatialFacts'
import {
  releaseKey,
  type Fact,
  type FactSet,
  type Pack,
  type Scalar,
} from '../../../../packages/legal-rules/src/contract'
import type { ReviewCase } from '../plan'
import { chooseRelease, instrumentOf, setFact } from './caseEdits'
import { findingCounts, questions, type Finding, type Question } from './questions'
import { describeCheck, formatValue, STATUS_WORDS, type Status } from './wording'

const RuleFlow = lazy(() => import('../../legal-workbench/RuleFlow'))

const STATUS_TONE: Record<Status, BadgeTone> = {
  review_required: 'warning',
  missing_evidence: 'info',
  condition_not_triggered: 'neutral',
  outside_scope: 'neutral',
  outside_source_window: 'neutral',
}

function Answer({
  question,
  value,
  hint,
  onChange,
}: {
  question: Question
  value: Scalar | null
  hint?: ReactNode
  onChange: (value: Scalar | undefined) => void
}) {
  const { fact } = question
  const label = fact.label + (fact.unit && fact.type === 'number' ? ` (${fact.unit})` : '')
  if (fact.type === 'boolean' || fact.type === 'choice') {
    const options = [
      { value: '', label: 'Not answered' },
      ...(fact.type === 'boolean'
        ? [
            { value: 'true', label: 'Yes' },
            { value: 'false', label: 'No' },
          ]
        : fact.choices!.map((c) => ({ value: c, label: c }))),
    ]
    return (
      <FormField label={label} description={hint} group>
        <StyledSelect
          aria-label={label}
          value={value === null ? '' : String(value)}
          options={options}
          onValueChange={(v) => onChange(v === '' ? undefined : fact.type === 'boolean' ? v === 'true' : v)}
        />
      </FormField>
    )
  }
  if (fact.type === 'number')
    return (
      <NullableNumberField
        label={label}
        description={hint}
        value={typeof value === 'number' ? value : null}
        min={fact.min}
        max={fact.max}
        updateOn="commit"
        onValueChange={(v) => onChange(v ?? undefined)}
      />
    )
  return (
    <FormField label={label} description={hint}>
      <input
        className={FORM_INPUT_CLASS}
        defaultValue={value === null ? '' : String(value)}
        onBlur={(e) => onChange(e.target.value.trim() || undefined)}
      />
    </FormField>
  )
}

function FindingRow({ pack, finding, facts, date }: { pack: Pack; finding: Finding; facts: FactSet; date: string }) {
  const rule = pack.rules.find((r) => r.id === finding.rule)!
  const stages = (
    [
      ['Applies when', 'scope' in finding ? finding.scope : undefined],
      ['Triggers when', 'condition' in finding ? finding.condition : undefined],
    ] as const
  ).filter(([, stage]) => stage && stage.trace.length)
  return (
    <DisclosureRow
      title={finding.title}
      summary={
        <Badge tone={STATUS_TONE[finding.status]} size="sm">
          {STATUS_WORDS[finding.status]}
        </Badge>
      }
      contentClassName="space-y-2 text-xs"
    >
      <p>
        <a className="underline" href={finding.source.url} target="_blank" rel="noreferrer">
          {finding.source.title}, {finding.provision}
        </a>
      </p>
      {'finding' in finding && <p className="font-medium">{finding.finding}</p>}
      {'actions' in finding &&
        finding.actions.map((a, i) => (
          <p key={i}>
            <span className="font-medium capitalize">{a.kind}:</span> {a.description}
          </p>
        ))}
      {stages.map(([heading, stage]) => (
        <div key={heading} className="space-y-1">
          <p className="font-medium">{heading}</p>
          {stage!.trace.map((group, g) => (
            <ul key={g} className="space-y-0.5 rounded bg-muted p-1.5">
              {stage!.trace.length > 1 && <li className="text-muted-foreground">Either, case {g + 1}:</li>}
              {group.map((check, c) => {
                const line = describeCheck(pack, check)
                return (
                  <li key={c} className="flex justify-between gap-2">
                    <span>
                      {line.asks}
                      <span className="text-muted-foreground"> · answer {line.answer}</span>
                    </span>
                    <span
                      className={cn(
                        'shrink-0',
                        line.result === false && 'text-muted-foreground',
                        line.result === null && 'italic',
                      )}
                    >
                      {line.held}
                    </span>
                  </li>
                )
              })}
            </ul>
          ))}
        </div>
      ))}
      <Suspense fallback={null}>
        <RuleFlow pack={pack} rule={rule} finding={finding} facts={facts} date={date} />
      </Suspense>
    </DisclosureRow>
  )
}

export interface CaseReviewProps {
  /** Every release this browser has: built in and installed on the legal rules page. */
  library: Pack[]
  /** The instruments this case may use (`bc.fppr`, `bc.pgtsa.biodiversity`). */
  instruments: string[]
  review: ReviewCase
  onChange: (next: ReviewCase) => void
  /** Facts the planner's model fills; they are shown, never asked. */
  measurements: Measurement[]
  /** A line under a question, by fact id. */
  hints?: Partial<Record<string, ReactNode>>
  testId?: string
}

/**
 * One review case: the releases used, the questions still open, and every rule's finding in
 * words with its flowchart. Only questions a rule is waiting on are asked; the rest appear as the
 * answers unlock them (`questions.ts`).
 */
export function CaseReview({
  library,
  instruments,
  review,
  onChange,
  measurements,
  hints = {},
  testId,
}: CaseReviewProps) {
  const packs = library.filter((p) => instruments.includes(p.id) && review.selected.includes(releaseKey(p)))
  const inputs = packs.map((p) => {
    const set: FactSet = review.sets[releaseKey(p)] ?? {
      format: 'pgmaps-legal-facts/v1',
      pack: p.id,
      version: p.version,
      source: 'Entered in the block planner',
      facts: [],
    }
    const derived = spatialFacts(p, measurements)
    const locked = new Set(derived.map((f) => f.id))
    return { ...set, facts: [...set.facts.filter((f) => !locked.has(f.id)), ...derived] }
  })
  let report: ReturnType<typeof assess> | undefined
  let problem = ''
  try {
    report = assess(review.date, packs, inputs)
  } catch (e) {
    problem = e instanceof Error ? e.message : 'The review could not be evaluated.'
  }
  const [showSettled, setShowSettled] = useState(false)
  return (
    <div className="space-y-3" data-testid={testId}>
      <div className="grid grid-cols-2 gap-2">
        {instruments.map((instrument) => {
          const releases = library.filter((p) => p.id === instrument)
          const chosen = review.selected.find((k) => instrumentOf(k) === instrument) ?? ''
          return (
            <FormField key={instrument} label={releases[0]?.title ?? instrument} group>
              <StyledSelect
                aria-label={`Release of ${releases[0]?.title ?? instrument}`}
                value={chosen}
                options={[
                  { value: '', label: 'Not used' },
                  ...releases.map((p) => ({ value: releaseKey(p), label: `Release ${p.version}` })),
                ]}
                onValueChange={(key) =>
                  onChange(chooseRelease(review, instrument, releases.find((p) => releaseKey(p) === key) ?? null))
                }
              />
            </FormField>
          )
        })}
        <FormField label="Legal assessment date" description="Separate from the year on the map.">
          <input
            type="date"
            className={FORM_INPUT_CLASS}
            value={review.date}
            onChange={(e) => e.target.value && onChange({ ...review, date: e.target.value })}
          />
        </FormField>
      </div>
      <p className="text-2xs text-muted-foreground">
        Other releases are installed on the{' '}
        <a className="underline" href="/dev/legal-rules">
          legal rules page
        </a>
        .
      </p>
      {problem && <InlineAlert tone="error">{problem}</InlineAlert>}
      {report?.releases.map((release) => {
        const measured = new Set((release.pack.spatialBindings ?? []).map((b) => b.fact))
        const asked = questions(release.pack, release.facts, release.findings, measured)
        const counts = findingCounts(release.findings)
        const value = (fact: Fact) => release.facts.facts.find((f) => f.id === fact.id)?.value ?? null
        const active = release.findings.filter((f) => f.status === 'review_required' || f.status === 'missing_evidence')
        const settled = release.findings.filter((f) => !active.includes(f))
        return (
          <section key={releaseKey(release.pack)} className="space-y-2" aria-label={release.pack.title}>
            <p className="text-xs font-medium">
              {release.pack.title} {release.pack.version}
              <span className="font-normal text-muted-foreground">
                {' '}
                · {counts.review} need review · {counts.open} need an answer · {counts.clear} not triggered ·{' '}
                {counts.notApplicable} do not apply
              </span>
            </p>
            <div className="space-y-2">
              {asked.map((q) =>
                q.state === 'measured' ? (
                  <p key={q.fact.id} className="rounded border border-dashed p-2 text-xs">
                    <span className="font-medium">{q.fact.label}:</span> {formatValue(q.fact, value(q.fact))}
                    <span className="block text-muted-foreground">
                      Measured by the planner · {release.facts.facts.find((f) => f.id === q.fact.id)?.evidence}
                    </span>
                  </p>
                ) : (
                  <div
                    key={q.fact.id}
                    className={cn(q.state === 'open' && 'rounded-md border-l-2 border-primary pl-2')}
                  >
                    <Answer
                      question={q}
                      value={value(q.fact)}
                      hint={hints[q.fact.id]}
                      onChange={(v) => onChange(setFact(review, release.pack, q.fact.id, v))}
                    />
                  </div>
                ),
              )}
              {!asked.some((q) => q.state === 'open') && (
                <p className="text-xs text-muted-foreground">No rule is waiting on an answer.</p>
              )}
            </div>
            <div className="space-y-1">
              {active.map((f) => (
                <FindingRow key={f.rule} pack={release.pack} finding={f} facts={release.facts} date={review.date} />
              ))}
              {settled.length > 0 && (
                <DisclosureRow
                  title={`Settled rules (${settled.length})`}
                  summary="Not triggered, or not applying"
                  open={showSettled}
                  onOpenChange={setShowSettled}
                >
                  {settled.map((f) => (
                    <FindingRow key={f.rule} pack={release.pack} finding={f} facts={release.facts} date={review.date} />
                  ))}
                </DisclosureRow>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}

/** Loads the releases this browser has, built in first; the built-in list until storage answers. */
export function useLibrary(fallback: Pack[]) {
  const [library, setLibrary] = useState(fallback)
  useEffect(() => {
    let live = true
    import('../../legal-workbench/registry')
      .then(({ loadLibrary }) => loadLibrary())
      .then((all) => live && setLibrary(all))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])
  return library
}
