import { useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, CircleDashed, OctagonAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ResultRow } from '@/components/ui/result-list'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { formatRoadStation } from './Charts'
import {
  CROSSING_SOURCE_LABELS,
  crossingMatchText,
  type CrossingRegister,
  type CrossingRegisterRow,
} from './crossingRegister'
import {
  READINESS_GROUP_LABELS,
  readinessCounts,
  type ReadinessGroup,
  type ReadinessRow,
  type ReadinessState,
} from './readiness'

const GROUPS = Object.keys(READINESS_GROUP_LABELS) as ReadinessGroup[]

function StateIcon({ row }: { row: ReadinessRow }) {
  if (row.state === 'met')
    return <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" role="img" aria-label="Met" />
  if (row.state === 'not-assessed')
    return (
      <CircleDashed className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" role="img" aria-label="Not assessed" />
    )
  return row.severity === 'limit' ? (
    <OctagonAlert
      className="mt-0.5 size-3.5 shrink-0 text-red-600 dark:text-red-400"
      role="img"
      aria-label="Needs attention: outside a limit"
    />
  ) : (
    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" role="img" aria-label="Needs attention: to do" />
  )
}

/**
 * The checks a designer signs against, grouped. A row always shows what was found, the measured
 * value and a way to the place it is fixed; opened, it adds the limit it was judged on. Rows that
 * need attention start open, because the sidebar is narrow and the list is long. The check's own
 * wording names the row for assistive technology and is printed in the report.
 */
export function ReadinessList({
  rows,
  onAction,
}: {
  rows: ReadinessRow[]
  onAction: (action: NonNullable<ReadinessRow['action']>) => void
}) {
  const [show, setShow] = useState<'all' | 'open'>('all')
  // A row's own toggle outranks the default for its state.
  const [toggled, setToggled] = useState<Record<string, boolean>>({})
  const counts = readinessCounts(rows)
  const visible = (row: ReadinessRow) => show === 'all' || row.state !== 'met'
  const todo = counts.attention - counts.limits
  const chips: {
    state: ReadinessState | 'limit'
    count: number
    label: string
    tone: 'danger' | 'warning' | 'neutral' | 'success'
  }[] = [
    { state: 'limit', count: counts.limits, label: 'outside a limit', tone: 'danger' },
    { state: 'attention', count: todo, label: 'to do', tone: 'warning' },
    { state: 'not-assessed', count: counts.notAssessed, label: 'not assessed', tone: 'neutral' },
    { state: 'met', count: counts.met, label: 'met', tone: 'success' },
  ]
  return (
    <div className="space-y-2" data-testid="road-readiness-checks">
      <div className="flex flex-wrap items-center gap-1" data-testid="road-readiness-counts">
        {chips.map((chip) => (
          <Badge key={chip.state} tone={chip.tone} variant={chip.count ? 'soft' : 'outline'} pill>
            {chip.count} {chip.label}
          </Badge>
        ))}
      </div>
      <SegmentedControl
        size="sm"
        label="Checks shown"
        value={show}
        onChange={setShow}
        options={[
          { value: 'all', label: `All ${rows.length}` },
          { value: 'open', label: `Outstanding ${counts.attention + counts.notAssessed}` },
        ]}
      />
      {GROUPS.map((group) => {
        const members = rows.filter((row) => row.group === group && visible(row))
        if (!members.length) return null
        return (
          <section key={group} aria-label={`${READINESS_GROUP_LABELS[group]} checks`}>
            <h4 className="mb-1 text-3xs font-semibold uppercase tracking-wide text-muted-foreground">
              {READINESS_GROUP_LABELS[group]}
            </h4>
            <ul className="divide-y rounded-md border">
              {members.map((row) => {
                const open = toggled[row.id] ?? row.state === 'attention'
                return (
                  <li
                    key={row.id}
                    className="text-xs"
                    data-check={row.id}
                    data-state={row.state}
                    data-severity={row.severity}
                  >
                    <button
                      type="button"
                      aria-expanded={open}
                      title={row.check}
                      aria-label={`${row.check}: ${row.result}`}
                      className="flex w-full items-start gap-2 px-2 pt-1.5 text-left hover:bg-muted/50"
                      onClick={() => setToggled((previous) => ({ ...previous, [row.id]: !open }))}
                    >
                      <StateIcon row={row} />
                      <span className="min-w-0 flex-1 font-medium leading-4">{row.result}</span>
                      <ChevronDown
                        aria-hidden
                        className={`mt-0.5 size-3 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
                      />
                    </button>
                    <div className="space-y-0.5 pb-1.5 pl-[1.625rem] pr-2 pt-0.5 text-2xs leading-4">
                      {row.measured && <p className={open ? undefined : 'line-clamp-2'}>{row.measured}</p>}
                      {open && row.judgedOn && <p className="text-muted-foreground">Judged on: {row.judgedOn}</p>}
                      {row.action && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-0.5 h-6 px-1.5 text-2xs"
                          onClick={() => onAction(row.action!)}
                        >
                          {row.action.label}
                        </Button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

const classText = (row: CrossingRegisterRow) =>
  row.classStatus === null
    ? 'No mapped reach to classify'
    : row.riparianClass
      ? `Class ${row.riparianClass}${row.classStatus === 'reviewed' ? ' · reviewed' : ' · not reviewed'}`
      : 'No riparian class'

/** Every place water crosses the road, once, with its source, structure and class. */
export function CrossingRegisterList({
  register,
  station,
  onStation,
}: {
  register: CrossingRegister
  station: number
  onStation: (chainage: number) => void
}) {
  if (!register.rows.length)
    return (
      <p className="text-xs text-muted-foreground" data-testid="road-crossing-register-empty">
        No crossing found. That is the supplied stream lines and the drainage check speaking, not proof the road crosses
        no water.
      </p>
    )
  return (
    <ul className="divide-y rounded-md border" data-testid="road-crossing-register">
      {register.rows.map((row) => (
        <li key={row.id} data-crossing-source={row.source}>
          <ResultRow
            accent="teal"
            className="px-2 py-1.5 [&_span]:whitespace-normal"
            selected={Math.abs(station - row.chainage) < 0.05}
            title={
              <span className="text-xs">
                {formatRoadStation(row.chainage)} · {row.name}
              </span>
            }
            subtitle={
              <span className="text-2xs">
                {row.structure.kind === 'none'
                  ? 'No structure'
                  : `${row.structure.label}${row.structure.outstanding.length ? `: ${row.structure.outstanding.join(', ')}` : ''}`}
              </span>
            }
            meta={
              <span className="text-2xs">
                {classText(row)} · {crossingMatchText(row, register)}
              </span>
            }
            trailing={
              <Badge
                tone={row.source === 'both' ? 'success' : row.source === 'mapped' ? 'info' : 'violet'}
                variant="outline"
              >
                {CROSSING_SOURCE_LABELS[row.source]}
              </Badge>
            }
            onClick={() => onStation(row.chainage)}
          />
        </li>
      ))}
    </ul>
  )
}
