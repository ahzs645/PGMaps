import { CircleCheck, CircleDashed, CircleMinus, CircleSlash } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { DisclosureCard } from '@/components/ui/disclosure'
import { FORM_INPUT_CLASS, FormField } from '@/components/ui/form-field'
import { cn } from '@/lib/utils'
import type { Plan, RationaleRecord, RecruitmentRecord } from '../plan'
import type { Pathway, StepState } from './pathways'

const ICON: Record<StepState, typeof CircleCheck> = {
  done: CircleCheck,
  open: CircleDashed,
  blocked: CircleSlash,
  'not-needed': CircleMinus,
}
const STATE_WORD: Record<StepState, string> = {
  done: 'Done',
  open: 'To do',
  blocked: 'Does not apply',
  'not-needed': 'Not needed',
}

function TextRecord({
  label,
  value,
  onChange,
  rows = 1,
  type = 'text',
}: {
  label: string
  value?: string
  onChange: (v: string | undefined) => void
  rows?: number
  type?: string
}) {
  return (
    <FormField label={label}>
      {rows > 1 ? (
        <textarea
          className={FORM_INPUT_CLASS}
          rows={rows}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
      ) : (
        <input
          type={type}
          className={FORM_INPUT_CLASS}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
      )}
    </FormField>
  )
}

/**
 * One D.5 pathway as a checklist with the records it asks for. The determinations are answered in
 * the order's review below the card; this card never makes one.
 */
export function PathwayCard({
  pathway,
  plan,
  edit,
}: {
  pathway: Pathway
  plan: Plan
  edit: (change: (plan: Plan) => Plan) => void
}) {
  const records = plan.landscape.pathways ?? {}
  const setA = (change: Partial<RecruitmentRecord>) =>
    edit((p) => ({
      ...p,
      landscape: {
        ...p.landscape,
        pathways: { ...p.landscape.pathways, a: { ...p.landscape.pathways?.a, ...change } },
      },
    }))
  const setB = (change: Partial<RationaleRecord>) =>
    edit((p) => ({
      ...p,
      landscape: {
        ...p.landscape,
        pathways: { ...p.landscape.pathways, b: { ...p.landscape.pathways?.b, ...change } },
      },
    }))
  const settled = pathway.status === 'Does not apply' || pathway.status === 'Not needed'
  return (
    <DisclosureCard
      title={`${pathway.id} · ${pathway.title}`}
      summary={
        <Badge tone={settled ? 'neutral' : 'info'} size="sm">
          {pathway.status}
        </Badge>
      }
      defaultOpen={pathway.id === 'D.5(b)'}
      contentClassName="space-y-3"
    >
      <ol className="space-y-1.5" aria-label={`${pathway.id} steps`}>
        {pathway.steps.map((step) => {
          const Icon = ICON[step.state]
          return (
            <li key={step.id} className="flex gap-2 text-xs" data-step={step.id} data-state={step.state}>
              <Icon
                className={cn(
                  'mt-0.5 size-3.5 shrink-0',
                  step.state === 'done' ? 'text-success' : 'text-muted-foreground',
                )}
                aria-label={STATE_WORD[step.state]}
              />
              <span>
                <span
                  className={cn(
                    'font-medium',
                    step.state !== 'open' && step.state !== 'done' && 'text-muted-foreground',
                  )}
                >
                  {step.label}
                </span>
                <span className="block text-muted-foreground">{step.detail}</span>
              </span>
            </li>
          )
        })}
      </ol>
      {!settled &&
        (pathway.id === 'D.5(b)' ? (
          <div className="space-y-2">
            <TextRecord
              label="Rationale draft"
              rows={6}
              value={plan.landscape.rationale}
              onChange={(rationale) => edit((p) => ({ ...p, landscape: { ...p.landscape, rationale } }))}
            />
            <div className="grid grid-cols-2 gap-2">
              <TextRecord
                label="Submitted on"
                type="date"
                value={records.b?.submitted}
                onChange={(submitted) => setB({ submitted })}
              />
              <TextRecord
                label="Reference"
                value={records.b?.reference}
                onChange={(reference) => setB({ reference })}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <TextRecord
              label="Recruitment analysis relied on"
              rows={2}
              value={records.a?.analysis}
              onChange={(analysis) => setA({ analysis })}
            />
            <TextRecord
              label="Strategy draft"
              rows={4}
              value={records.a?.strategy}
              onChange={(strategy) => setA({ strategy })}
            />
            <div className="grid grid-cols-2 gap-2">
              <TextRecord
                label="Submitted on"
                type="date"
                value={records.a?.submitted}
                onChange={(submitted) => setA({ submitted })}
              />
              <TextRecord
                label="Approved on"
                type="date"
                value={records.a?.approved}
                onChange={(approved) => setA({ approved })}
              />
              <TextRecord label="Approved by" value={records.a?.approver} onChange={(approver) => setA({ approver })} />
              <TextRecord
                label="Reference"
                value={records.a?.reference}
                onChange={(reference) => setA({ reference })}
              />
            </div>
          </div>
        ))}
    </DisclosureCard>
  )
}
