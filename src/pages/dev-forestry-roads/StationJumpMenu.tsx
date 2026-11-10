import { ChevronsLeft, ChevronsRight } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ActionMenu } from '@/components/ui/action-menu'
import { formatRoadStation } from './Charts'
import { keepsNativeUndo } from './historyShortcut'
import {
  adjacentJump,
  jumpShortcut,
  reviewJumpFindings,
  STATION_JUMP_KINDS,
  stationJumpTargets,
  type StationJumpKind,
  type StationJumpTarget,
} from './stationJumps'
import type { Alignment, RoadAnalysis, RoadProject } from './types'

const kindLabel = (kind: StationJumpKind) => STATION_JUMP_KINDS.find((k) => k.kind === kind)!

/**
 * Beside the station box: step the shared station to the next or previous place of one kind (PVI,
 * curve point, flagged station, incomplete section, culvert, template change). `]` and `[` do the
 * same from anywhere on the page except a text field or a dialog.
 */
export function StationJumpMenu({
  project,
  alignment,
  analysis,
  station,
  onJump,
  onNotice,
  disabled = false,
}: {
  project: RoadProject
  /** The road the views show, and its analysis. */
  alignment: Alignment
  analysis: RoadAnalysis
  /** The station asked for (`w.station`), not the nearest calculated one: a jump lands exactly there. */
  station: number
  onJump: (target: StationJumpTarget) => void
  onNotice: (text: string) => void
  disabled?: boolean
}) {
  const [kind, setKind] = useState<StationJumpKind>('pvi')
  const [menuOpen, setMenuOpen] = useState(false)
  // Review rows and sight distance are only worked out when they are needed: on a jump, or for the counts.
  const targetsOf = (withFindings: boolean) =>
    stationJumpTargets(alignment, analysis, withFindings ? reviewJumpFindings(project, alignment, analysis) : [])
  const counts = useMemo(
    () => (menuOpen ? stationJumpTargets(alignment, analysis, reviewJumpFindings(project, alignment, analysis)) : null),
    [menuOpen, project, alignment, analysis],
  )
  const jump = (direction: 1 | -1, chosen: StationJumpKind = kind) => {
    const targets = targetsOf(chosen === 'flag')[chosen]
    const target = adjacentJump(targets, station, direction)
    const words = kindLabel(chosen)
    if (!target) {
      onNotice(
        targets.length
          ? `No ${words.noun} ${direction > 0 ? 'after' : 'before'} ${formatRoadStation(station)}.`
          : `This road has no ${words.plural}.`,
      )
      return
    }
    onJump(target)
    onNotice(`${words.label} at ${formatRoadStation(target.chainage)}: ${target.label}.`)
  }
  const latest = useRef({ jump, disabled })
  useEffect(() => {
    latest.current = { jump, disabled }
  })
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || latest.current.disabled || keepsNativeUndo(event.target)) return
      const direction = jumpShortcut(event)
      if (!direction) return
      event.preventDefault()
      latest.current.jump(direction)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
  const words = kindLabel(kind)
  const button =
    'flex items-center justify-center rounded border px-1 py-1 text-xs disabled:opacity-50 touch:min-h-10 touch:min-w-10'
  return (
    <div role="group" aria-label="Jump along the road" className="flex items-center gap-0.5">
      <button
        type="button"
        className={`${button} max-sm:hidden`}
        aria-label={`Previous ${words.noun}`}
        aria-keyshortcuts="["
        title={`Previous ${words.noun} ( [ )`}
        disabled={disabled}
        onClick={() => jump(-1)}
      >
        <ChevronsLeft className="size-3.5" aria-hidden />
      </button>
      <ActionMenu
        label={`Jump to: ${words.label}`}
        align="start"
        width={248}
        onOpenChange={setMenuOpen}
        triggerClassName="rounded border px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground touch:min-h-10"
        trigger={
          <span className="block max-w-[7rem] truncate" data-testid="road-jump-kind">
            {words.label}
          </span>
        }
        items={[
          { type: 'label', id: 'kinds', label: 'Jump to' },
          ...STATION_JUMP_KINDS.map((k) => ({
            id: k.kind,
            label: counts ? `${k.label} (${counts[k.kind].length})` : k.label,
            checked: kind === k.kind,
            radio: true,
            keepOpen: true,
            onSelect: () => setKind(k.kind),
          })),
          { type: 'separator', id: 'sep' },
          {
            id: 'previous',
            label: `Previous ${words.noun}  [`,
            icon: <ChevronsLeft className="size-4" />,
            disabled,
            onSelect: () => jump(-1),
          },
          {
            id: 'next',
            label: `Next ${words.noun}  ]`,
            icon: <ChevronsRight className="size-4" />,
            disabled,
            onSelect: () => jump(1),
          },
        ]}
      />
      <button
        type="button"
        className={`${button} max-sm:hidden`}
        aria-label={`Next ${words.noun}`}
        aria-keyshortcuts="]"
        title={`Next ${words.noun} ( ] )`}
        disabled={disabled}
        onClick={() => jump(1)}
      >
        <ChevronsRight className="size-3.5" aria-hidden />
      </button>
    </div>
  )
}
