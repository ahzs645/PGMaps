import { useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, CircleDashed, OctagonAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ResultRow } from '@/components/ui/result-list'
import { insetBox } from '@/components/ui/inset-box'
import { cn } from '@/lib/utils'
import { formatRoadStation } from './Charts'
import {
  CROSSING_SOURCE_LABELS,
  crossingMatchText,
  type CrossingRegister,
  type CrossingRegisterRow,
} from './crossingRegister'
import {
  READINESS_GROUP_LABELS,
  readinessParts,
  readinessVerdict,
  type ReadinessGroup,
  type ReadinessRow,
} from './readiness'
import { RoadSection } from './SidebarParts'

const GROUPS = Object.keys(READINESS_GROUP_LABELS) as ReadinessGroup[]
const VERDICT_CLASS = {
  danger: 'text-danger',
  warning: 'text-warning',
  neutral: 'text-foreground',
  success: 'text-success',
}

function StateIcon({ row }: { row: ReadinessRow }) {
  if (row.state === 'met')
    return <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" role="img" aria-label="Met" />
  if (row.state === 'not-assessed')
    return (
      <CircleDashed className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" role="img" aria-label="Not assessed" />
    )
  return row.severity === 'limit' ? (
    <OctagonAlert
      className="mt-0.5 size-3.5 shrink-0 text-danger"
      role="img"
      aria-label="Needs attention: outside a limit"
    />
  ) : (
    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" role="img" aria-label="Needs attention: to do" />
  )
}

/**
 * The checks a designer signs against. What needs attention leads, a broken limit before an input
 * still to do, because that is what the designer acts on. The checks that were not made and the
 * ones that are met fold to one line each that states how many there are, so the list fits the
 * sidebar; every row is still there when its group is opened, and the report prints all of them.
 * The verdict line and those two summaries carry the four counts between them.
 *
 * A row shows what was found, the measured value and a way to the place it is fixed; opened, it
 * adds the check's own wording and the limit it was judged on. `children` follow the rows that
 * need attention, inside the leading section.
 */
export function ReadinessList({
  rows,
  onAction,
  help,
  children,
}: {
  rows: ReadinessRow[]
  onAction: (action: NonNullable<ReadinessRow['action']>) => void
  help?: ReactNode
  children?: ReactNode
}) {
  const [opened, setOpened] = useState<Record<string, boolean>>({})
  const parts = readinessParts(rows)
  const verdict = readinessVerdict(rows)
  const item = (row: ReadinessRow) => {
    const open = opened[row.id] ?? false
    return (
      <li key={row.id} className="text-xs" data-check={row.id} data-state={row.state} data-severity={row.severity}>
        <button
          type="button"
          aria-expanded={open}
          title={row.check}
          aria-label={`${row.check}: ${row.result}`}
          className="flex w-full items-start gap-2 px-2 pt-1.5 text-left hover:bg-muted/50"
          onClick={() => setOpened((previous) => ({ ...previous, [row.id]: !open }))}
        >
          <StateIcon row={row} />
          <span className="min-w-0 flex-1 font-medium leading-4">{row.result}</span>
          <ChevronDown
            aria-hidden
            className={`mt-0.5 size-3 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>
        <div className="space-y-0.5 pb-1.5 pl-[1.625rem] pr-2 pt-0.5 text-2xs leading-4">
          {/* The measured value and the way to fix it share a line, so a row is two or three lines tall. */}
          <div className="flex items-start gap-2">
            <p className={`min-w-0 flex-1 ${open ? '' : 'line-clamp-2'}`}>{row.measured}</p>
            {row.action && (
              <Button size="2xs" variant="outline" className="shrink-0 px-1.5" onClick={() => onAction(row.action!)}>
                {row.action.label}
              </Button>
            )}
          </div>
          {open && (
            <p className="text-muted-foreground">
              Check: {row.check}
              {row.judgedOn ? `. Judged on: ${row.judgedOn}` : ''}
            </p>
          )}
        </div>
      </li>
    )
  }
  const list = (label: string, members: ReadinessRow[]) =>
    members.length > 0 && (
      <section key={label} aria-label={`${label} checks`}>
        <h4 className="mb-1 text-3xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</h4>
        <ul className={cn(insetBox({ padding: 'none' }), 'divide-y')}>{members.map(item)}</ul>
      </section>
    )
  /** A folded group: its summary line gives the count, and its rows keep the list's own grouping. */
  const folded = (title: string, members: ReadinessRow[], testId: string, about: string) =>
    members.length > 0 && (
      <RoadSection
        title={title}
        summary={`${members.length} ${members.length === 1 ? 'check' : 'checks'}`}
        help={about}
        toggleTestId={`${testId}-toggle`}
        data-testid={testId}
      >
        {GROUPS.map((group) =>
          list(
            READINESS_GROUP_LABELS[group],
            members.filter((row) => row.group === group),
          ),
        )}
      </RoadSection>
    )
  return (
    <div data-testid="road-readiness-checks">
      <RoadSection title="Ready to review" help={help}>
        <p className={`text-xs font-semibold ${VERDICT_CLASS[verdict.tone]}`} data-testid="road-readiness-verdict">
          {verdict.text}
        </p>
        <div className="space-y-2" data-testid="road-readiness-attention">
          {list(
            'Outside a limit',
            parts.attention.filter((row) => row.severity === 'limit'),
          )}
          {list(
            'To do',
            parts.attention.filter((row) => row.severity !== 'limit'),
          )}
        </div>
        {children}
      </RoadSection>
      {folded(
        'Not assessed',
        parts.notAssessed,
        'road-readiness-not-assessed',
        'Checks the workspace could not make: no limit is entered, a result is missing or out of date, or the subject is outside what it models. Not assessed is not a pass. Open the group to see each one and what would let it be made.',
      )}
      {folded(
        'Met',
        parts.met,
        'road-readiness-met',
        'Checks that were made with nothing outstanding, each against this project’s own limits.',
      )}
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
    <ul className={cn(insetBox({ padding: 'none' }), 'divide-y')} data-testid="road-crossing-register">
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
