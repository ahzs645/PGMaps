import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { Badge, type BadgeTone } from '@/components/ui/badge'
import { DisclosureRow } from '@/components/ui/disclosure'
import { FORM_INPUT_CLASS, FormField, NullableNumberField, StyledSelect } from '@/components/ui/form-field'
import { InlineAlert } from '@/components/ui/map-panels'
import { TextButton } from '@/components/ui/text-button'
import { ToolDisclosure } from '@/components/ui/tool-section'
import { ACTION_KIND } from '@/lib/legal/decisionTree'
import { cn } from '@/lib/utils'
import { assess } from '../../../../packages/legal-rules/engine/evaluate'
import { spatialFacts, type Measurement } from '../../../../packages/legal-rules/engine/spatialFacts'
import {
  releaseKey,
  type Claim,
  type Fact,
  type FactSet,
  type Pack,
  type Scalar,
} from '../../../../packages/legal-rules/src/contract'
import type { ReviewCase } from '../plan'
import { chooseRelease, instrumentOf, setClaim } from './caseEdits'
import { ExceptionClaim, STANDING_TONE } from './ExceptionClaim'
import { recordLinkedAnswer, setLinkedFact, sharedQuestion, type SharedQuestion } from './linkedFacts'
import { dateGaps, dateGapText, findingCounts, questions, type Finding, type Question } from './questions'
import type { ExceptionSignal } from './tenureSignals'
import { topicSections } from './topics'
import { describeCheck, formatValue, STANDING_WORDS, STATUS_WORDS, type Status } from './wording'

const RuleFlow = lazy(() => import('../../legal-workbench/RuleFlow'))
const ProvisionLink = lazy(() =>
  import('../../legal-workbench/ProvisionPreview').then((m) => ({ default: m.ProvisionLink })),
)
const DecisionFlowchart = lazy(() =>
  import('../../legal-workbench/DecisionFlowchart').then((m) => ({ default: m.DecisionFlowchart })),
)

const STATUS_TONE: Record<Status, BadgeTone> = {
  review_required: 'warning',
  missing_evidence: 'info',
  condition_not_triggered: 'neutral',
  outside_scope: 'neutral',
  outside_source_window: 'warning',
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
    const options = answerOptions(fact)
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

/** Choices for a question, as the dropdown lists them. */
const answerOptions = (fact: Fact) => [
  { value: '', label: 'Not answered' },
  ...(fact.type === 'boolean'
    ? [
        { value: 'true', label: 'Yes' },
        { value: 'false', label: 'No' },
      ]
    : (fact.choices ?? []).map((c) => ({ value: c, label: c }))),
]
const fromOption = (fact: Fact, v: string): Scalar | undefined =>
  v === '' ? undefined : fact.type === 'boolean' ? v === 'true' : v

/**
 * A question another instrument asks about the same fact, shown in place of asking it again: the
 * release it is answered under, the copy recorded here, or both answers when they differ.
 */
function LinkedQuestion({
  question,
  shared,
  hint,
  onChange,
  onRecord,
}: {
  question: Question
  shared: Exclude<SharedQuestion, { kind: 'ask' }>
  hint?: ReactNode
  onChange: (value: Scalar | undefined, resolve?: boolean) => void
  onRecord: () => void
}) {
  const { fact } = question
  const [changing, setChanging] = useState(false)
  if (shared.kind === 'conflict')
    return (
      <div className="space-y-1 rounded border border-warning/40 p-1.5 text-xs" data-testid="linked-question">
        <p className="font-medium">{fact.label}</p>
        <p>The instruments that ask this hold different answers:</p>
        <ul className="list-disc pl-4">
          {shared.answers.map((a) => (
            <li key={releaseKey(a.pack)}>
              {a.pack.title} {a.pack.version}: {formatValue(fact, a.value)}
            </li>
          ))}
        </ul>
        <FormField label="One answer for both" group>
          <StyledSelect
            aria-label={`One answer for both: ${fact.label}`}
            value=""
            options={answerOptions(fact)}
            onValueChange={(v) => onChange(fromOption(fact, v), true)}
          />
        </FormField>
      </div>
    )
  if (changing && shared.kind !== 'differs')
    return (
      <Answer
        question={question}
        value={shared.value}
        hint={
          <>
            {hint}
            {hint ? ' ' : ''}Changing it here changes the answer under {shared.under.title} too.
          </>
        }
        onChange={(v) => {
          setChanging(false)
          onChange(v)
        }}
      />
    )
  const under = shared.under.title
  return (
    <div className="text-xs" data-testid="linked-question" data-fact={fact.id}>
      <p className="font-medium">{fact.label}</p>
      <p className="text-muted-foreground">
        {shared.kind === 'differs' ? (
          <>Answered differently under {under}; choose one answer there.</>
        ) : shared.kind === 'unrecorded' ? (
          <>
            Answered under {under}: {formatValue(fact, shared.value)}. Not yet recorded for this release.{' '}
            <TextButton onClick={onRecord}>Record it here too</TextButton>
          </>
        ) : shared.value === null ? (
          <>
            Asked under {under}. <TextButton onClick={() => setChanging(true)}>Answer here</TextButton>
          </>
        ) : (
          <>
            Answered under {under}: {formatValue(fact, shared.value)}.{' '}
            <TextButton onClick={() => setChanging(true)}>Change</TextButton>
          </>
        )}
      </p>
    </div>
  )
}

function FindingRow({
  pack,
  finding,
  facts,
  date,
  signals,
  onClaim,
}: {
  pack: Pack
  finding: Finding
  facts: FactSet
  date: string
  signals?: ExceptionSignal[]
  onClaim: (claim: Claim | undefined) => void
}) {
  const exception = 'exception' in finding ? finding.exception : undefined
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
        // One badge fits the row: a claimed exception's standing says the rule was raised as well.
        exception ? (
          <Badge tone={STANDING_TONE[exception.standing]} size="sm">
            {STANDING_WORDS[exception.standing]}
          </Badge>
        ) : (
          <Badge tone={STATUS_TONE[finding.status]} size="sm">
            {STATUS_WORDS[finding.status]}
          </Badge>
        )
      }
      contentClassName="space-y-2 text-xs"
    >
      <p>
        <Suspense
          fallback={
            <a className="underline" href={finding.source.url} target="_blank" rel="noreferrer">
              {finding.source.title}, {finding.provision}
            </a>
          }
        >
          <ProvisionLink
            citation={{
              sourceUrl: finding.source.url,
              sourceTitle: finding.source.title,
              provision: finding.provision,
              rule: { pack: pack.id, id: rule.id },
            }}
          />
        </Suspense>
      </p>
      {'finding' in finding && <p className="font-medium">{finding.finding}</p>}
      {'actions' in finding &&
        finding.actions.map((a, i) => (
          <p key={i}>
            <span className="font-medium">{ACTION_KIND[a.kind]}:</span> {a.description}
          </p>
        ))}
      <ExceptionClaim pack={pack} rule={rule} finding={finding} signals={signals} onChange={onClaim} />
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
  /** What the questions shared by several provisions are grouped under: "Whole block", "Whole landscape". */
  caseLabel?: string
  /** Public records bearing on an exception, offered beside it (`tenureSignals.ts`); never an answer. */
  signals?: ExceptionSignal[]
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
  caseLabel,
  signals,
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
  // A release that does not cover the date assessed none of its rules: said plainly, never as "does not apply".
  const gaps = report ? dateGaps(review.date, report.releases) : []
  // Every release's questions first, so a question two instruments ask is asked under one of them.
  const askedBy = new Map(
    (report?.releases ?? []).map((release) => {
      const measured = new Set((release.pack.spatialBindings ?? []).map((b) => b.fact))
      return [releaseKey(release.pack), questions(release.pack, release.facts, release.findings, measured)] as const
    }),
  )
  const listed = (pack: Pack, id: string) =>
    !!askedBy.get(releaseKey(pack))?.some((q) => q.fact.id === id && q.state !== 'measured')
  const linked = (pack: Pack, q: Question) =>
    q.state === 'measured' ? null : sharedQuestion(review, packs, pack, q.fact.id, listed)
  // A question asked under another release is not waiting here.
  const waiting = (pack: Pack, q: Question) => {
    const kind = q.state === 'open' ? linked(pack, q)?.kind : undefined
    return q.state === 'open' && kind !== 'elsewhere' && kind !== 'differs'
  }
  const answer = (pack: Pack, q: Question, value: Scalar | null) => {
    const shared = linked(pack, q)
    const change = (v: Scalar | undefined, resolve?: boolean) =>
      onChange(setLinkedFact(review, packs, pack, q.fact.id, v, { resolve }))
    if (shared && shared.kind !== 'ask')
      return (
        <LinkedQuestion
          key={q.fact.id}
          question={q}
          shared={shared}
          hint={hints[q.fact.id]}
          onChange={change}
          onRecord={() =>
            'under' in shared && onChange(recordLinkedAnswer(review, packs, pack, q.fact.id, shared.under))
          }
        />
      )
    const also = shared?.also.map((p) => p.title).join(' and ')
    return (
      <Answer
        key={q.fact.id}
        question={q}
        value={value}
        hint={
          also ? (
            <>
              {hints[q.fact.id]}
              {hints[q.fact.id] ? ' ' : ''}Also answers {also}, which asks the same.
            </>
          ) : (
            hints[q.fact.id]
          )
        }
        onChange={(v) => change(v)}
      />
    )
  }
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
      {gaps.length > 0 && (
        <InlineAlert tone="warning" title="Not assessed on this date">
          <span data-testid="review-date-gaps">
            {gaps.length === 1 ? 'One release does not' : `${gaps.length} releases do not`} cover the legal assessment
            date {review.date}:{' '}
            {gaps
              .map((g) => `${g.pack.title} ${g.pack.version} (${g.pack.coverage.from} to ${g.pack.coverage.through})`)
              .join('; ')}
            . Their rules were not assessed, which is not the same as not applying.
          </span>
        </InlineAlert>
      )}
      {report?.releases.map((release) => {
        const asked = askedBy.get(releaseKey(release.pack))!
        const counts = findingCounts(release.findings)
        const gap = gaps.find((g) => g.pack === release.pack)
        const value = (fact: Fact) => release.facts.facts.find((f) => f.id === fact.id)?.value ?? null
        const sections = topicSections(release.pack, asked, release.findings, caseLabel)
        const answers = Object.fromEntries(release.facts.facts.map((f) => [f.id, f.value]))
        const chartTopics = sections
          .filter((x) => x.findings.length)
          .map((x) => ({ id: x.topic.id, label: x.topic.label, rules: x.findings.map((f) => f.rule) }))
        return (
          <section key={releaseKey(release.pack)} className="space-y-1" aria-label={release.pack.title}>
            <p className="text-xs font-medium">
              {release.pack.title} {release.pack.version}
              <span className="font-normal text-muted-foreground">
                {' '}
                · {counts.review} need review
                {counts.exception ? ` (${counts.exception} relying on an exception)` : ''} · {counts.open} need an
                answer · {counts.clear} not triggered · {counts.notApplicable} do not apply
                {counts.outsideDates ? ` · ${counts.outsideDates} not assessed on this date` : ''}
              </span>
            </p>
            {gap && (
              <InlineAlert tone="warning">
                <span data-testid="release-date-gap">{dateGapText(gap)}</span>
              </InlineAlert>
            )}
            {!asked.some((q) => waiting(release.pack, q)) && (
              <p className="text-xs text-muted-foreground">No rule is waiting on an answer.</p>
            )}
            {sections.map(({ topic, questions: asks, findings }) => {
              const open = asks.filter((q) => waiting(release.pack, q))
              const rest = asks.filter((q) => !open.includes(q))
              const active = findings.filter((f) => f.status === 'review_required' || f.status === 'missing_evidence')
              const reviewing = findings.filter((f) => f.status === 'review_required').length
              // Not assessed on this date: listed in the open, never folded among the settled rules.
              const unassessed = findings.filter((f) => f.status === 'outside_source_window')
              const settled = findings.filter((f) => !active.includes(f) && f.status !== 'outside_source_window')
              // A question asked under another instrument, and not yet answered there, is not answered here.
              const askedElsewhere = rest.filter((q) => {
                const shared = q.state === 'open' ? linked(release.pack, q) : null
                return shared?.kind === 'elsewhere' && shared.value === null
              }).length
              const summary =
                [
                  open.length ? `${open.length} to answer` : '',
                  reviewing ? `${reviewing} need${reviewing === 1 ? 's' : ''} review` : '',
                  unassessed.length ? `${unassessed.length} not assessed on this date` : '',
                ]
                  .filter(Boolean)
                  .join(' · ') ||
                (findings.length
                  ? 'Settled'
                  : [
                      rest.length > askedElsewhere ? `${rest.length - askedElsewhere} answered` : '',
                      askedElsewhere ? `${askedElsewhere} asked under another instrument` : '',
                    ]
                      .filter(Boolean)
                      .join(' · '))
              return (
                <ToolDisclosure
                  // A provision that comes to need an answer or a review opens again, so a question
                  // the last answer unlocked is never hidden in a folded section.
                  key={`${topic.id}:${open.length > 0 || reviewing > 0}`}
                  label={topic.label}
                  summary={summary}
                  defaultOpen={open.length > 0 || reviewing > 0}
                  toggleProps={{ 'data-topic': topic.id }}
                  contentClassName="space-y-2"
                >
                  {findings.length > 0 && (
                    <div className="flex justify-end">
                      <Suspense fallback={null}>
                        <DecisionFlowchart
                          pack={release.pack}
                          answers={answers}
                          topics={chartTopics}
                          initialTopic={topic.id}
                          triggerLabel="Decision flowchart"
                        />
                      </Suspense>
                    </div>
                  )}
                  {open.map((q) => answer(release.pack, q, value(q.fact)))}
                  {rest.length > 0 && open.length > 0 && (
                    <p className="text-2xs font-medium text-muted-foreground">Answered</p>
                  )}
                  {rest.map((q) =>
                    q.state === 'measured' ? (
                      <p key={q.fact.id} className="text-xs">
                        <span className="font-medium">{q.fact.label}:</span> {formatValue(q.fact, value(q.fact))}
                        <span className="block text-muted-foreground">
                          Measured by the planner · {release.facts.facts.find((f) => f.id === q.fact.id)?.evidence}
                        </span>
                      </p>
                    ) : (
                      answer(release.pack, q, value(q.fact))
                    ),
                  )}
                  {active.map((f) => (
                    <FindingRow
                      key={f.rule}
                      pack={release.pack}
                      finding={f}
                      facts={release.facts}
                      date={review.date}
                      signals={signals}
                      onClaim={(claim) => onChange(setClaim(review, release.pack, f.rule, claim))}
                    />
                  ))}
                  {unassessed.map((f) => (
                    <FindingRow
                      key={f.rule}
                      pack={release.pack}
                      finding={f}
                      facts={release.facts}
                      date={review.date}
                      onClaim={(claim) => onChange(setClaim(review, release.pack, f.rule, claim))}
                    />
                  ))}
                  {settled.length > 0 && (
                    <DisclosureRow title={`Settled rules (${settled.length})`} summary="Not triggered, or not applying">
                      {settled.map((f) => (
                        <FindingRow
                          key={f.rule}
                          pack={release.pack}
                          finding={f}
                          facts={release.facts}
                          date={review.date}
                          onClaim={(claim) => onChange(setClaim(review, release.pack, f.rule, claim))}
                        />
                      ))}
                    </DisclosureRow>
                  )}
                </ToolDisclosure>
              )
            })}
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
