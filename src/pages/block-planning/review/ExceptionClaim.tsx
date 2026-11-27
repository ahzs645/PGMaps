import { lazy, Suspense } from 'react'
import { Badge, type BadgeTone } from '@/components/ui/badge'
import { FORM_INPUT_CLASS, FormField, StyledSelect } from '@/components/ui/form-field'
import { exceptionKey } from '@/lib/legal/ruleQuotes'
import type { ExceptionStanding } from '../../../../packages/legal-rules/engine/evaluate'
import type { Claim, Pack, Rule } from '../../../../packages/legal-rules/src/contract'
import type { Finding } from './questions'
import { describeCheck, STANDING_WORDS } from './wording'

const ProvisionLink = lazy(() =>
  import('../../legal-workbench/ProvisionPreview').then((m) => ({ default: m.ProvisionLink })),
)

export const STANDING_TONE: Record<ExceptionStanding, BadgeTone> = {
  relied_on: 'info',
  decided: 'info',
  unanswered: 'warning',
  pending: 'warning',
  not_supported: 'danger',
}

/** The evidence row a reviewer can always add, beside the ones the exception asks for. */
const OTHER = 'Other evidence'

/**
 * On a raised finding: the exceptions the law makes to its rule, the one the reviewer relies on,
 * and their rationale, evidence and (for an exception that needs a decision) the decision. The
 * finding stays raised; the evaluator says where the claim stands.
 */
export function ExceptionClaim({
  pack,
  rule,
  finding,
  onChange,
}: {
  pack: Pack
  rule: Rule
  finding: Finding
  onChange: (claim: Claim | undefined) => void
}) {
  const options = rule.exceptions ?? []
  if (!options.length || finding.status !== 'review_required') return null
  const chosen = 'exception' in finding ? finding.exception : undefined
  const claim = chosen?.claim
  const rows = chosen ? [...(chosen.evidence ?? []), OTHER] : []
  const evidenceOf = (label: string) => claim?.evidence?.find((e) => e.label === label)
  const update = (patch: Partial<Claim>) => claim && onChange({ ...claim, ...patch })
  const setEvidence = (label: string, patch: { reference?: string; date?: string }) => {
    const row = { label, ...evidenceOf(label), ...patch }
    if (!row.reference?.trim()) delete row.reference
    if (!row.date) delete row.date
    const others = (claim?.evidence ?? []).filter((e) => e.label !== label)
    const evidence = row.reference || row.date ? [...others, row] : others
    update({ evidence: evidence.length ? evidence : undefined })
  }
  const choose = (id: string) => {
    if (!id) return onChange(undefined)
    const next = options.find((x) => x.id === id)!
    onChange({
      rule: rule.id,
      exception: id,
      ...(claim?.rationale ? { rationale: claim.rationale } : {}),
      ...(next.kind === 'decision' && claim?.decision ? { decision: claim.decision } : {}),
    })
  }
  // Inputs keep their own text until they lose focus, so each claim's fields start from it.
  const keyed = (part: string) => `${rule.id}:${claim?.exception ?? ''}:${part}`
  return (
    <div className="space-y-2" data-exception-claim={rule.id}>
      <FormField
        label="Rely on an exception"
        description="The exceptions the law makes to this rule. The finding stays, with the exception relied on and its evidence."
        group
      >
        <StyledSelect
          aria-label={`Exception relied on for ${rule.title}`}
          value={claim?.exception ?? ''}
          options={[{ value: '', label: 'None' }, ...options.map((x) => ({ value: x.id, label: x.label }))]}
          onValueChange={choose}
        />
      </FormField>
      {chosen && claim && (
        <div className="space-y-2 rounded border border-border bg-card p-2">
          <p className="flex flex-wrap items-center gap-2">
            <Badge tone={STANDING_TONE[chosen.standing]} size="sm">
              {STANDING_WORDS[chosen.standing]}
            </Badge>
            <span className="text-muted-foreground">
              {chosen.kind === 'decision'
                ? chosen.standing === 'decided'
                  ? `Decided by ${claim.decision?.by} on ${claim.decision?.date}.`
                  : `Needs a decision: ${chosen.decidedBy ?? 'by the person the law names'}.`
                : 'Holds by law once its facts do.'}
            </span>
          </p>
          <p>
            <Suspense fallback={<span>{chosen.provision}</span>}>
              <ProvisionLink
                citation={{
                  sourceUrl: chosen.source.url,
                  sourceTitle: chosen.source.title,
                  provision: chosen.provision,
                  rule: { pack: pack.id, id: exceptionKey(rule.id, chosen.id) },
                }}
              />
            </Suspense>
          </p>
          {chosen.condition && (
            <ul className="space-y-0.5 rounded bg-muted p-1.5">
              {chosen.condition.trace.flat().map((check, i) => {
                const line = describeCheck(pack, check)
                return (
                  <li key={i} className="flex justify-between gap-2">
                    <span>
                      {line.asks}
                      <span className="text-muted-foreground"> · answer {line.answer}</span>
                    </span>
                    <span className="shrink-0">{line.held}</span>
                  </li>
                )
              })}
            </ul>
          )}
          <FormField label="Rationale">
            <textarea
              key={keyed('rationale')}
              className={FORM_INPUT_CLASS + ' min-h-16'}
              defaultValue={claim.rationale ?? ''}
              placeholder="Why the exception applies to this block"
              onBlur={(e) => {
                const rationale = e.target.value.trim()
                if (rationale !== (claim.rationale ?? '')) update({ rationale: rationale || undefined })
              }}
            />
          </FormField>
          <div className="space-y-1">
            <p className="font-medium">Evidence</p>
            {rows.map((label) => (
              <div key={label} className="grid grid-cols-[1fr_8.5rem] gap-1.5">
                <FormField label={label}>
                  <input
                    key={keyed('ref:' + label)}
                    className={FORM_INPUT_CLASS}
                    defaultValue={evidenceOf(label)?.reference ?? ''}
                    placeholder="Document, file or reference"
                    onBlur={(e) => {
                      if (e.target.value.trim() !== (evidenceOf(label)?.reference ?? ''))
                        setEvidence(label, { reference: e.target.value.trim() })
                    }}
                  />
                </FormField>
                <FormField label="Dated">
                  <input
                    type="date"
                    aria-label={`${label} date`}
                    className={FORM_INPUT_CLASS}
                    value={evidenceOf(label)?.date ?? ''}
                    onChange={(e) => setEvidence(label, { date: e.target.value })}
                  />
                </FormField>
              </div>
            ))}
          </div>
          {chosen.kind === 'decision' && (
            <div className="space-y-1">
              <p className="font-medium">Decision</p>
              <div className="grid grid-cols-[1fr_8.5rem] gap-1.5">
                <FormField label="Decided by">
                  <input
                    key={keyed('by')}
                    className={FORM_INPUT_CLASS}
                    defaultValue={claim.decision?.by ?? ''}
                    placeholder={chosen.decidedBy}
                    onBlur={(e) => {
                      const by = e.target.value.trim()
                      if (by !== (claim.decision?.by ?? ''))
                        update({ decision: by || claim.decision?.date ? { ...claim.decision, by } : undefined })
                    }}
                  />
                </FormField>
                <FormField label="On">
                  <input
                    type="date"
                    aria-label="Decision date"
                    className={FORM_INPUT_CLASS}
                    value={claim.decision?.date ?? ''}
                    onChange={(e) =>
                      update({
                        decision: {
                          ...claim.decision,
                          by: claim.decision?.by ?? '',
                          date: e.target.value || undefined,
                        },
                      })
                    }
                  />
                </FormField>
              </div>
              <FormField label="Reference">
                <input
                  key={keyed('reference')}
                  className={FORM_INPUT_CLASS}
                  defaultValue={claim.decision?.reference ?? ''}
                  placeholder="The decision's file or letter"
                  onBlur={(e) => {
                    const reference = e.target.value.trim()
                    if (reference !== (claim.decision?.reference ?? ''))
                      update({
                        decision: {
                          ...claim.decision,
                          by: claim.decision?.by ?? '',
                          reference: reference || undefined,
                        },
                      })
                  }}
                />
              </FormField>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
