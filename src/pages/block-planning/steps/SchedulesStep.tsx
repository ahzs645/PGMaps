import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmRemoveButton } from '@/components/ui/confirm-remove'
import { FORM_INPUT_CLASS, NumberField, SelectField, StyledSelect } from '@/components/ui/form-field'
import { TextButton } from '@/components/ui/text-button'
import { ToolSection } from '@/components/ui/tool-section'
import { cn } from '@/lib/utils'
import {
  addSchedule,
  followWouldLoop,
  removeSchedule,
  setEntry,
  setReviewSchedule,
  updateSchedule,
  type NewSchedule,
} from '../edits'
import { entryIsOwn, entryOf, YEAR_RANGE, type Plan, type Schedule } from '../plan'
import type { StepProps } from './types'

function ScheduleSettings({ plan, schedule, edit }: { plan: Plan; schedule: Schedule; edit: StepProps['edit'] }) {
  const others = plan.schedules.filter((s) => s.id !== schedule.id && !followWouldLoop(plan, schedule.id, s.id))
  return (
    <li className="space-y-2 rounded-md border p-2" data-testid={`schedule-${schedule.id}`}>
      <div className="flex items-center gap-2">
        <input
          aria-label={`Name of schedule ${schedule.name}`}
          className={FORM_INPUT_CLASS}
          defaultValue={schedule.name}
          key={schedule.name}
          onBlur={(e) => edit((p) => updateSchedule(p, schedule.id, { name: e.target.value }))}
        />
        <ConfirmRemoveButton
          label={`Remove ${schedule.name}`}
          question={`Remove the schedule ${schedule.name}?`}
          detail="Schedules that follow it keep the timing they read from it."
          disabled={plan.schedules.length <= 1}
          onConfirm={() => edit((p) => removeSchedule(p, schedule.id))}
        />
      </div>
      <label className="flex items-center gap-2 text-xs">
        <input
          type="radio"
          name="review-schedule"
          checked={plan.reviewSchedule === schedule.id}
          onChange={() => edit((p) => setReviewSchedule(p, schedule.id))}
        />
        The proposal under review
      </label>
      <div className="grid grid-cols-[1fr_auto] items-end gap-2">
        <SelectField
          label="Timing"
          value={schedule.follows?.schedule ?? ''}
          onValueChange={(from) =>
            edit((p) =>
              updateSchedule(p, schedule.id, {
                follows: from ? { schedule: from, years: schedule.follows?.years ?? 10 } : undefined,
              }),
            )
          }
        >
          <option value="">Its own years</option>
          {others.map((s) => (
            <option key={s.id} value={s.id}>
              Follows {s.name}
            </option>
          ))}
        </SelectField>
        {schedule.follows && (
          <NumberField
            label="Moved by"
            unit="years"
            fieldClassName="w-28"
            value={schedule.follows.years}
            min={-200}
            max={200}
            step={1}
            updateOn="commit"
            onValueChange={(years) =>
              edit((p) => updateSchedule(p, schedule.id, { follows: { schedule: schedule.follows!.schedule, years } }))
            }
          />
        )}
      </div>
    </li>
  )
}

function AddSchedule({ plan, edit }: Pick<StepProps, 'plan' | 'edit'>) {
  const [kind, setKind] = useState<NewSchedule['kind']>('follow')
  const [from, setFrom] = useState(plan.reviewSchedule)
  const [years, setYears] = useState(10)
  const source = plan.schedules.find((s) => s.id === from) ?? plan.schedules[0]
  const name =
    kind === 'empty'
      ? 'No further harvest'
      : kind === 'copy'
        ? `${source.name} (copy)`
        : `${source.name} ${years >= 0 ? '+' : ''}${years} years`
  return (
    <div className="space-y-2 rounded-md border border-dashed p-2">
      <SelectField label="New schedule" value={kind} onValueChange={(v) => setKind(v as NewSchedule['kind'])}>
        <option value="follow">Follow another, moved by some years</option>
        <option value="copy">Copy another, to edit</option>
        <option value="empty">Cut nothing</option>
      </SelectField>
      {kind !== 'empty' && (
        <SelectField label="From" value={source.id} onValueChange={setFrom}>
          {plan.schedules.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </SelectField>
      )}
      {kind === 'follow' && (
        <NumberField
          label="Moved by"
          unit="years"
          value={years}
          min={-200}
          max={200}
          step={1}
          onValueChange={setYears}
        />
      )}
      <Button
        size="sm"
        onClick={() =>
          edit(
            (p) =>
              addSchedule(
                p,
                kind === 'empty'
                  ? { kind, name }
                  : kind === 'copy'
                    ? { kind, name, from: source.id }
                    : { kind, name, from: source.id, years },
              ).plan,
          )
        }
      >
        <Plus className="size-3.5" />
        Add schedule
      </Button>
    </div>
  )
}

/** One block in one schedule: its year (blank: read through, or not cut) and its shape. */
function TimingCell({
  plan,
  schedule,
  blockId,
  edit,
}: {
  plan: Plan
  schedule: Schedule
  blockId: string
  edit: StepProps['edit']
}) {
  const block = plan.blocks.find((b) => b.id === blockId)!
  const own = entryIsOwn(plan, schedule.id, blockId)
  const entry = entryOf(plan, schedule.id, blockId)
  const inherited = schedule.follows && !own ? entry : null
  const [text, setText] = useState<string | null>(null)
  const shown = text ?? (own && entry.year !== null ? String(entry.year) : '')
  const commit = () => {
    if (text === null) return
    setText(null)
    const value = text.trim()
    if (!value) return edit((p) => setEntry(p, schedule.id, blockId, undefined))
    const year = Number(value)
    if (!Number.isInteger(year) || year < YEAR_RANGE[0] || year > YEAR_RANGE[1]) return
    edit((p) => setEntry(p, schedule.id, blockId, { year, shape: entry.shape }))
  }
  return (
    <td className="px-1 py-1 align-top">
      <input
        aria-label={`Year ${schedule.name} cuts ${block.name}`}
        inputMode="numeric"
        className={cn(FORM_INPUT_CLASS, 'h-7 w-20 px-1.5 text-xs', inherited && 'placeholder:italic')}
        value={shown}
        placeholder={inherited ? (inherited.year === null ? 'not cut' : String(inherited.year)) : 'not cut'}
        title={
          inherited
            ? `Read through ${plan.schedules.find((s) => s.id === schedule.follows!.schedule)?.name}`
            : undefined
        }
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') setText(null)
        }}
      />
      {schedule.follows && (own || entry.year !== null) && (
        <TextButton
          className="block text-2xs"
          onClick={() => edit((p) => setEntry(p, schedule.id, blockId, own ? undefined : { year: null }))}
        >
          {own ? 'Follow again' : 'Not cut here'}
        </TextButton>
      )}
      {block.shapes.length > 1 && entry.year !== null && (
        <StyledSelect
          aria-label={`Shape ${schedule.name} cuts of ${block.name}`}
          className="mt-1 h-7 w-20 px-1 text-2xs"
          value={entry.shape ?? block.shapes[0].id}
          onValueChange={(shape) => edit((p) => setEntry(p, schedule.id, blockId, { year: entry.year, shape }))}
          options={block.shapes.map((s) => ({ value: s.id, label: s.name }))}
        />
      )}
    </td>
  )
}

/** Step 3: the schedules, and the year each one cuts each block. */
export function SchedulesStep({ plan, edit, shown, setShown }: StepProps) {
  return (
    <>
      <ToolSection
        title="Schedules"
        help="Each schedule is one way of cutting the blocks. Compare at least the proposal, no further harvest and a practicable alternative: the D.5 pathways ask why the chosen one reaches the objective soonest."
        summary={`${plan.schedules.length} schedules`}
        defaultOpen
      >
        <ul className="space-y-2">
          {plan.schedules.map((s) => (
            <ScheduleSettings key={s.id} plan={plan} schedule={s} edit={edit} />
          ))}
        </ul>
        <AddSchedule plan={plan} edit={edit} />
      </ToolSection>
      <ToolSection
        title="When each block is cut"
        help="Type a year, or leave it blank. In a schedule that follows another, a blank reads the other schedule’s year moved by its offset (shown in italics)."
        summary={`${plan.blocks.length} blocks × ${plan.schedules.length} schedules`}
        defaultOpen
      >
        {plan.blocks.length === 0 ? (
          <p className="text-xs text-muted-foreground">Draw or import blocks in step 2 first.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-xs" data-testid="block-planning-timing">
              <thead>
                <tr>
                  <th className="px-1 text-left font-medium">Block</th>
                  {plan.schedules.map((s) => (
                    <th key={s.id} className="px-1 text-left font-medium">
                      <TextButton
                        className={cn('text-xs', shown.schedule === s.id && 'font-semibold underline')}
                        aria-pressed={shown.schedule === s.id}
                        title="Show this schedule on the map"
                        onClick={() => setShown({ schedule: s.id })}
                      >
                        {s.name}
                      </TextButton>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {plan.blocks.map((b) => (
                  <tr key={b.id} className="border-t">
                    <th scope="row" className="max-w-24 truncate px-1 py-1 text-left align-top font-normal">
                      {b.name}
                    </th>
                    {plan.schedules.map((s) => (
                      <TimingCell key={s.id} plan={plan} schedule={s} blockId={b.id} edit={edit} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ToolSection>
    </>
  )
}
