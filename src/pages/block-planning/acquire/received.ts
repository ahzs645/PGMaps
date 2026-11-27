/**
 * Using a value the reviewer transcribed from a received record. A value feeds nothing until the
 * reviewer uses it, one click each way:
 *
 * - as the **answer to its fact**, in the block's review or its crossing's, with the record named
 *   as the answer's evidence (a value the fact cannot take is refused, with the reason);
 * - as **evidence for an exception claimed** on a raised rule, beside the claim's own evidence;
 * - as **evidence on its crossing**, kind `received`, beside what was read about the crossing.
 *
 * Each use is recorded on the value (`uses`), so the record says where it went. Nothing here reads
 * or keeps the document itself.
 *
 * DOM- and network-free.
 */
import { accepts, releaseKey, type Fact, type Pack, type Scalar } from '../../../../packages/legal-rules/src/contract'
import type { CrossingEvidence } from '../crossings/record'
import type { Plan, ReviewCase } from '../plan'
import { setFact } from '../review/caseEdits'
import { setLinkedFact } from '../review/linkedFacts'
import { channelOf } from './channels'
import { blockReviewOf } from './gaps'
import type { ReceivedRecord, ReceivedValue, ValueUse } from './record'

export type UseResult = { plan: Plan } | { error: string }

/** The value as the fact's answer, or why it cannot be: yes/no, a number, one of the choices, or text. */
export function scalarFor(fact: Fact, text: string): Scalar | undefined {
  const t = text.trim()
  let value: Scalar | undefined
  if (fact.type === 'boolean') value = /^(yes|y|true)$/i.test(t) ? true : /^(no|n|false)$/i.test(t) ? false : undefined
  else if (fact.type === 'number') {
    const n = Number(t.replace(/,/g, '').replace(/\s*(%|m|mm|m³\/s|ha|years?)$/i, ''))
    value = t && Number.isFinite(n) ? n : undefined
  } else if (fact.type === 'choice') value = fact.choices?.find((c) => c.toLowerCase() === t.toLowerCase())
  else value = t || undefined
  return value !== undefined && accepts(fact, value) ? value : undefined
}

/** Where a record is cited from in an answer or a piece of evidence. */
export function citation(record: ReceivedRecord, value: ReceivedValue): string {
  const when = record.documentDate ? `dated ${record.documentDate}` : `received ${record.receivedOn}`
  return `Received record “${record.title}”${record.reference ? `, ${record.reference}` : ''}, ${when}${value.page ? `, p. ${value.page}` : ''} (the reviewer’s transcription)`
}

function find(plan: Plan, recordId: string, valueId: string) {
  const record = plan.acquisition?.received?.find((r) => r.id === recordId)
  const value = record?.values.find((v) => v.id === valueId)
  return record && value ? { record, value } : null
}

function withUse(plan: Plan, recordId: string, valueId: string, use: ValueUse): Plan {
  return {
    ...plan,
    acquisition: {
      ...plan.acquisition,
      received: (plan.acquisition?.received ?? []).map((r) =>
        r.id !== recordId
          ? r
          : { ...r, values: r.values.map((v) => (v.id === valueId ? { ...v, uses: [...(v.uses ?? []), use] } : v)) },
      ),
    },
  }
}

/** The case a value's answer goes into: its crossing's review, else the block's. */
function targetCase(plan: Plan, record: ReceivedRecord, value: ReceivedValue) {
  if (value.crossing) {
    const crossing = plan.crossings?.find((c) => c.key === value.crossing && c.block === record.block)
    return crossing ? { review: crossing.review, crossing, label: crossing.label } : null
  }
  const block = plan.blocks.find((b) => b.id === record.block)
  return block ? { review: blockReviewOf(plan, block.id), label: `${block.name} review` } : null
}

function putCase(plan: Plan, record: ReceivedRecord, value: ReceivedValue, review: ReviewCase): Plan {
  if (value.crossing)
    return {
      ...plan,
      crossings: plan.crossings?.map((c) => (c.key === value.crossing ? { ...c, review } : c)),
    }
  return { ...plan, reviews: { ...plan.reviews, [record.block]: review } }
}

/** Uses a value as the answer to its fact, in the case that asks it. */
export function applyValueAsFact(
  plan: Plan,
  library: Pack[],
  recordId: string,
  valueId: string,
  today: string,
): UseResult {
  const found = find(plan, recordId, valueId)
  if (!found) return { error: 'The record or value is no longer in the plan.' }
  const { record, value } = found
  if (!value.fact) return { error: 'Say which question the value answers first.' }
  const target = targetCase(plan, record, value)
  if (!target) return { error: 'The crossing it names is no longer listed for the block.' }
  const packs = library.filter((p) => target.review.selected.includes(releaseKey(p)))
  const pack = packs.find((p) => p.id === value.fact!.pack)
  if (!pack) return { error: `${target.label} does not use ${value.fact.pack}.` }
  const fact = pack.facts.find((f) => f.id === value.fact!.fact)
  if (!fact) return { error: `${pack.title} ${pack.version} does not ask ${value.fact.fact}.` }
  const scalar = scalarFor(fact, value.value)
  if (scalar === undefined)
    return {
      error:
        fact.type === 'boolean'
          ? 'This question takes Yes or No.'
          : fact.type === 'number'
            ? `This question takes a number${fact.unit ? ` in ${fact.unit}` : ''}${fact.min !== undefined || fact.max !== undefined ? ` from ${fact.min ?? '…'} to ${fact.max ?? '…'}` : ''}.`
            : fact.type === 'choice'
              ? `This question takes one of: ${fact.choices?.join('; ')}.`
              : 'This question takes text.',
    }
  let review = setLinkedFact(target.review, packs, pack, fact.id, scalar)
  review = setFact(review, pack, fact.id, scalar, citation(record, value))
  const next = putCase(plan, record, value, review)
  return {
    plan: withUse(next, recordId, valueId, {
      as: 'fact',
      target: `${target.label}: ${fact.label}`,
      on: today,
    }),
  }
}

/** Claims open in the block's review and its crossings', for a value to support. */
export function claimTargets(plan: Plan, library: Pack[], block: string) {
  const out: { crossing?: string; caseLabel: string; release: string; rule: string; ruleTitle: string }[] = []
  const add = (review: ReviewCase, caseLabel: string, crossing?: string) => {
    for (const [release, set] of Object.entries(review.sets))
      for (const claim of set.claims ?? []) {
        const pack = library.find((p) => releaseKey(p) === release)
        out.push({
          crossing,
          caseLabel,
          release,
          rule: claim.rule,
          ruleTitle: pack?.rules.find((r) => r.id === claim.rule)?.title ?? claim.rule,
        })
      }
  }
  const name = plan.blocks.find((b) => b.id === block)?.name ?? block
  add(blockReviewOf(plan, block), name)
  for (const c of plan.crossings ?? []) if (c.block === block) add(c.review, `${name} · ${c.label}`, c.key)
  return out
}

/** Adds a value to the evidence of an exception claimed on a rule. */
export function applyValueAsClaimEvidence(
  plan: Plan,
  recordId: string,
  valueId: string,
  target: { crossing?: string; release: string; rule: string },
  today: string,
): UseResult {
  const found = find(plan, recordId, valueId)
  if (!found) return { error: 'The record or value is no longer in the plan.' }
  const { record, value } = found
  const crossing = target.crossing
    ? plan.crossings?.find((c) => c.key === target.crossing && c.block === record.block)
    : undefined
  if (target.crossing && !crossing) return { error: 'The crossing is no longer listed for the block.' }
  const review = crossing ? crossing.review : blockReviewOf(plan, record.block)
  const set = review.sets[target.release]
  const claim = set?.claims?.find((c) => c.rule === target.rule)
  if (!set || !claim) return { error: 'No exception is claimed on that rule any more.' }
  const evidence = {
    label: `${value.label}: ${value.value} (${citation(record, value)})`,
    ...(record.reference ? { reference: record.reference } : {}),
    date: record.documentDate ?? record.receivedOn,
  }
  const nextSet = {
    ...set,
    claims: set.claims!.map((c) =>
      c.rule === target.rule ? { ...c, evidence: [...(c.evidence ?? []), evidence] } : c,
    ),
  }
  const nextReview = { ...review, sets: { ...review.sets, [target.release]: nextSet } }
  const next = crossing
    ? { ...plan, crossings: plan.crossings!.map((c) => (c.key === crossing.key ? { ...c, review: nextReview } : c)) }
    : { ...plan, reviews: { ...plan.reviews, [record.block]: nextReview } }
  const name = plan.blocks.find((b) => b.id === record.block)?.name ?? record.block
  return {
    plan: withUse(next, recordId, valueId, {
      as: 'claim',
      target: `${crossing ? `${name} · ${crossing.label}` : name}: exception claimed on ${target.rule}`,
      on: today,
    }),
  }
}

/** Adds a value to its crossing's evidence, kind `received`. */
export function applyValueAsCrossingEvidence(plan: Plan, recordId: string, valueId: string, today: string): UseResult {
  const found = find(plan, recordId, valueId)
  if (!found) return { error: 'The record or value is no longer in the plan.' }
  const { record, value } = found
  const crossing = value.crossing
    ? plan.crossings?.find((c) => c.key === value.crossing && c.block === record.block)
    : undefined
  if (!crossing) return { error: 'Say which crossing the value is about first.' }
  const evidence: CrossingEvidence = {
    kind: 'received',
    source: `Received through ${channelOf(record.from)?.label ?? record.from}: “${record.title}”`,
    readOn: record.receivedOn,
    summary: `${value.label}: ${value.value}${value.page ? ` (p. ${value.page})` : ''}. The reviewer’s transcription.`,
    ...(record.reference ? { reference: record.reference } : {}),
    received: `${record.id}/${value.id}`,
  }
  const next = {
    ...plan,
    crossings: plan.crossings!.map((c) => (c.key === crossing.key ? { ...c, evidence: [...c.evidence, evidence] } : c)),
  }
  return {
    plan: withUse(next, recordId, valueId, { as: 'crossing', target: `${crossing.label}: evidence`, on: today }),
  }
}
