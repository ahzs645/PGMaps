import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { insetBox } from '@/components/ui/inset-box'
import { CollapsibleSection } from '@/components/ui/map-panels'
import { cn } from '@/lib/utils'
import { Field, OptionalNumberField, RoadSelect, roadFieldClass } from './Controls'
import {
  DEFAULT_LIFECYCLE,
  SCHEDULE_BASES,
  SCHEDULE_GROUPS,
  SCHEDULE_LIMITS,
  SCHEDULE_STATUSES,
  scheduleRowProblem,
  withEntry,
  withoutEntry,
  type CostScheduleState,
  type ScheduleBasis,
  type ScheduleEntry,
  type ScheduleGroup,
  type ScheduleRow,
  type ScheduleStatus,
} from './costSchedule'
import type { ProjectBudget } from './projectBudget'
import type { EvidenceCurrency } from './costEvidence/costEvidence'

const money = (value: number, currency: EvidenceCurrency) =>
  `${currency === 'CAD' ? '$' : `${currency} `}${value.toLocaleString('en-CA', { maximumFractionDigits: 0 })}`

const STATUS_OPTIONS = (Object.keys(SCHEDULE_STATUSES) as ScheduleStatus[]).map((status) => ({
  value: status,
  label: SCHEDULE_STATUSES[status].label,
}))
const BASIS_OPTIONS = (Object.keys(SCHEDULE_BASES) as ScheduleBasis[]).map((basis) => ({
  value: basis,
  label: SCHEDULE_BASES[basis].label,
}))

/** The entry a row's edit starts from: its stored decision, or the template default. */
const entryOf = (row: ScheduleRow): ScheduleEntry =>
  row.entry ?? {
    id: row.id,
    status: row.status,
    basis: row.basis,
    ...(row.derived ? { includedIn: row.derived } : {}),
  }

function BudgetRow({
  row,
  currency,
  onEntry,
  onReset,
}: {
  row: ScheduleRow
  currency: EvidenceCurrency
  onEntry: (entry: ScheduleEntry, label: string) => void
  onReset: (id: string, label: string) => void
}) {
  const entry = entryOf(row)
  const problem = scheduleRowProblem(row)
  const priced = row.status === 'priced' || row.status === 'allowance'
  const set = (patch: Partial<ScheduleEntry>, what: string) => onEntry({ ...entry, ...patch }, `${row.label}: ${what}`)
  return (
    <li className="space-y-1.5 px-3 py-2" data-budget-row={row.id} data-status={row.status}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 basis-40 text-xs text-foreground">
          {row.label}
          {row.hint && (
            <span className="ml-1 inline-flex align-middle">
              <InfoTip label={`About ${row.label}`}>{row.hint}</InfoTip>
            </span>
          )}
        </p>
        <span className="text-xs font-semibold tabular-nums" data-testid="road-budget-row-amount">
          {row.amount === null ? '—' : money(row.amount, currency)}
          {row.group === 'future' && row.amount !== null ? ' each time' : ''}
        </span>
        <RoadSelect
          value={row.status}
          options={STATUS_OPTIONS}
          ariaLabel={`${row.label} status`}
          className="h-7 w-40"
          onValueChange={(value) => {
            const status = value as ScheduleStatus
            set(
              {
                status,
                ...(row.group === 'future' && (status === 'priced' || status === 'allowance') && !entry.recurrence
                  ? { recurrence: { firstYear: 1, everyYears: row.id === 'deactivation' ? 0 : 1 } }
                  : {}),
              },
              SCHEDULE_STATUSES[status].label.toLowerCase(),
            )
          }}
        />
        {(row.entry || row.custom) && (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={() => onReset(row.id, row.custom ? `Removed ${row.label}` : `${row.label}: reset`)}
          >
            {row.custom ? 'Remove' : 'Reset'}
          </Button>
        )}
      </div>
      {priced && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Field label="Basis">
            <RoadSelect
              value={row.basis}
              options={BASIS_OPTIONS}
              ariaLabel={`${row.label} basis`}
              onValueChange={(value) => set({ basis: value as ScheduleBasis }, 'basis')}
            />
          </Field>
          {row.basis === 'percent' ? (
            <OptionalNumberField
              label="% of construction"
              value={entry.percent ?? null}
              min={0}
              max={SCHEDULE_LIMITS.maxPercent}
              step={0.1}
              placeholder="Enter %"
              onChange={(percent) => set(percent === null ? { percent: undefined } : { percent }, 'percent')}
            />
          ) : (
            <OptionalNumberField
              label={row.basis === 'per-km' ? `${currency} per km` : `${currency} lump sum`}
              value={entry.amount ?? null}
              min={0}
              max={SCHEDULE_LIMITS.maxAmount}
              step={1}
              placeholder="Enter amount"
              onChange={(amount) => set(amount === null ? { amount: undefined } : { amount }, 'amount')}
            />
          )}
          {row.group === 'future' && (
            <>
              <OptionalNumberField
                label="First due (year)"
                value={entry.recurrence?.firstYear ?? null}
                min={0}
                max={SCHEDULE_LIMITS.maxHorizonYears}
                step={1}
                placeholder="Year"
                onChange={(firstYear) =>
                  set(
                    { recurrence: { everyYears: entry.recurrence?.everyYears ?? 0, firstYear: firstYear ?? 1 } },
                    'timing',
                  )
                }
              />
              <OptionalNumberField
                label="Every (years, 0 once)"
                value={entry.recurrence?.everyYears ?? null}
                min={0}
                max={SCHEDULE_LIMITS.maxHorizonYears}
                step={1}
                placeholder="Years"
                onChange={(everyYears) =>
                  set(
                    { recurrence: { firstYear: entry.recurrence?.firstYear ?? 1, everyYears: everyYears ?? 0 } },
                    'timing',
                  )
                }
              />
            </>
          )}
          <Field label="Source">
            <input
              className={roadFieldClass}
              aria-label={`${row.label} source`}
              defaultValue={entry.source ?? ''}
              maxLength={SCHEDULE_LIMITS.maxText}
              placeholder="Quote, estimate, record"
              onBlur={(event) => {
                const source = event.target.value.trim()
                if (source !== (entry.source ?? '')) set(source ? { source } : { source: undefined }, 'source')
              }}
            />
          </Field>
        </div>
      )}
      {(row.status === 'included' || row.status === 'excluded') && !row.derived && (
        <Field label={row.status === 'included' ? 'Carried by' : 'Why it is left out'}>
          <input
            className={roadFieldClass}
            aria-label={row.status === 'included' ? `${row.label} carried by` : `${row.label} reason`}
            defaultValue={(row.status === 'included' ? entry.includedIn : entry.reason) ?? ''}
            maxLength={SCHEDULE_LIMITS.maxText}
            placeholder={row.status === 'included' ? 'The cut rate includes it' : 'Owner pays directly'}
            onBlur={(event) => {
              const text = event.target.value.trim()
              const key = row.status === 'included' ? 'includedIn' : 'reason'
              if (text !== ((entry[key] as string | undefined) ?? '')) set({ [key]: text || undefined }, 'note')
            }}
          />
        </Field>
      )}
      {row.derived && <p className="text-2xs text-muted-foreground">Carried by {row.derived}.</p>}
      {problem && (
        <p className="text-2xs text-warning" data-testid="road-budget-row-problem">
          {problem}
        </p>
      )}
    </li>
  )
}

/**
 * The project budget beside the covered estimate: every item of survey, design, construction support,
 * environmental work, contractor indirects, owner costs and future work, each priced, carried by
 * another line, excluded with a reason, or still not assessed. Edits write `project.costSchedule`;
 * reading it writes nothing.
 */
export function ProjectBudgetPanel({
  budget,
  state,
  currency,
  onSchedule,
}: {
  budget: ProjectBudget
  state: CostScheduleState | undefined
  currency: EvidenceCurrency
  onSchedule?: (next: CostScheduleState | undefined, label: string) => void
}) {
  const { rows, summary } = budget
  const [adding, setAdding] = useState<{ group: ScheduleGroup; label: string } | null>(null)
  const lifecycle = state?.lifecycle ?? DEFAULT_LIFECYCLE
  const groups = Object.keys(SCHEDULE_GROUPS) as ScheduleGroup[]
  const onEntry = (entry: ScheduleEntry, label: string) => onSchedule?.(withEntry(state, entry), label)
  const onReset = (id: string, label: string) => onSchedule?.(withoutEntry(state, id), label)
  return (
    <section className="space-y-2" aria-label="Project budget" data-testid="road-project-budget">
      <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4" data-testid="road-project-budget-summary">
        {[
          ['Construction estimate', money(summary.construction, currency)],
          ['Project items', money(summary.projectItems, currency)],
          ['Project budget', money(summary.projectBudget, currency)],
          ['Not assessed', String(summary.counts['not-assessed'])],
        ].map(([label, value]) => (
          <div key={label} className={cn(insetBox(), 'space-y-0.5')}>
            <dt className="text-2xs text-muted-foreground">{label}</dt>
            <dd
              className={cn(
                'font-semibold tabular-nums',
                label === 'Not assessed' && summary.counts['not-assessed'] > 0 && 'text-warning',
              )}
              data-testid={`road-project-budget-${label.toLowerCase().replace(/\s+/g, '-')}`}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-2xs leading-4 text-muted-foreground">
        Beside the covered estimate, never inside it: route searches still compare roads on construction alone. A
        not-assessed item is left out of the budget, which is not the same as costing nothing.
        {summary.allowances > 0 && ` Allowances are ${money(summary.allowances, currency)} of the project items.`}
      </p>
      <div className={cn(insetBox({ padding: 'none' }), 'overflow-hidden')}>
        {groups.map((group) => {
          const inGroup = rows.filter((row) => row.group === group)
          const open = inGroup.filter((row) => row.status === 'not-assessed').length
          const priced = inGroup.reduce((sum, row) => sum + (row.group === 'future' ? 0 : (row.amount ?? 0)), 0)
          return (
            <CollapsibleSection
              key={group}
              label={SCHEDULE_GROUPS[group].label}
              summary={`${group === 'future' ? 'Over the horizon' : money(priced, currency)} · ${open ? `${open} not assessed` : 'all decided'}`}
              defaultOpen={false}
              className="bg-transparent last:border-b-0"
            >
              <p className="px-3 pt-1 text-2xs text-muted-foreground">{SCHEDULE_GROUPS[group].note}</p>
              <ul className="divide-y" data-testid={`road-budget-group-${group}`}>
                {inGroup.map((row) => (
                  <BudgetRow key={row.id} row={row} currency={currency} onEntry={onEntry} onReset={onReset} />
                ))}
              </ul>
              {group === 'future' && (
                <div className="grid grid-cols-2 gap-2 border-t px-3 py-2">
                  <OptionalNumberField
                    label="Horizon (years)"
                    value={lifecycle.horizonYears}
                    min={1}
                    max={SCHEDULE_LIMITS.maxHorizonYears}
                    step={1}
                    onChange={(horizonYears) =>
                      onSchedule?.(
                        {
                          entries: state?.entries ?? [],
                          lifecycle: { ...lifecycle, horizonYears: horizonYears ?? 20 },
                        },
                        'Lifecycle horizon',
                      )
                    }
                  />
                  <OptionalNumberField
                    label="Discount rate (% a year)"
                    value={lifecycle.discountRatePercent}
                    min={0}
                    max={SCHEDULE_LIMITS.maxDiscountPercent}
                    step={0.1}
                    onChange={(discountRatePercent) =>
                      onSchedule?.(
                        {
                          entries: state?.entries ?? [],
                          lifecycle: { ...lifecycle, discountRatePercent: discountRatePercent ?? 0 },
                        },
                        'Discount rate',
                      )
                    }
                  />
                  <p className="col-span-2 text-2xs text-muted-foreground" data-testid="road-budget-lifecycle">
                    {summary.lifecycle.lines.length
                      ? `${money(summary.lifecycle.undiscounted, currency)} over ${lifecycle.horizonYears} years undiscounted${lifecycle.discountRatePercent ? `; ${money(summary.lifecycle.presentValue, currency)} present value at ${lifecycle.discountRatePercent}%` : ''}. Not added to the project budget.`
                      : 'No future work priced yet.'}
                  </p>
                </div>
              )}
            </CollapsibleSection>
          )
        })}
      </div>
      {onSchedule &&
        (adding ? (
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Group">
              <RoadSelect
                value={adding.group}
                options={groups.map((group) => ({ value: group, label: SCHEDULE_GROUPS[group].label }))}
                ariaLabel="New item group"
                onValueChange={(group) => setAdding({ ...adding, group: group as ScheduleGroup })}
              />
            </Field>
            <Field label="Item">
              <input
                className={roadFieldClass}
                aria-label="New item name"
                value={adding.label}
                maxLength={120}
                onChange={(event) => setAdding({ ...adding, label: event.target.value })}
              />
            </Field>
            <Button
              type="button"
              size="xs"
              disabled={!adding.label.trim()}
              onClick={() => {
                const label = adding.label.trim()
                onSchedule(
                  withEntry(state, {
                    id: `custom-${Date.now().toString(36)}`,
                    group: adding.group,
                    label,
                    status: 'not-assessed',
                  }),
                  `Added ${label} to the budget`,
                )
                setAdding(null)
              }}
            >
              Add item
            </Button>
            <Button type="button" size="xs" variant="ghost" onClick={() => setAdding(null)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            size="xs"
            variant="outline"
            data-testid="road-budget-add"
            onClick={() => setAdding({ group: 'support', label: '' })}
          >
            Add a budget item
          </Button>
        ))}
      {summary.problems.length > 0 && (
        <p className="flex flex-wrap items-center gap-1 text-2xs text-warning">
          <Badge tone="warning" variant="outline">
            {summary.problems.length} to finish
          </Badge>
          {summary.problems.map(({ row }) => row.label).join(', ')}
        </p>
      )}
    </section>
  )
}
