import { ChevronsLeft, ChevronsRight, Ellipsis, Pause, Play } from 'lucide-react'
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
  mobileTools,
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
  mobileTools?: {
    playing: boolean
    onPlayback: () => void
    readout: string
  }
}) {
  const mobile = !!mobileTools
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
  return (
    <div role="group" aria-label="Jump along the road" className="road-station-jumps flex items-center gap-0.5">
      <ActionMenu
        label={mobile ? 'Station options' : `Jump to: ${words.label}`}
        align={mobile ? 'end' : 'start'}
        width={248}
        onOpenChange={setMenuOpen}
        triggerClassName="road-station-options flex items-center justify-center rounded-md border border-input bg-background px-1.5 py-1 text-xs text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        trigger={
          mobile ? (
            <Ellipsis className="size-4" aria-hidden />
          ) : (
            <span className="block max-w-[7rem] truncate" data-testid="road-jump-kind">
              {words.label}
            </span>
          )
        }
        items={[
          mobileTools && { type: 'label', id: 'station', label: mobileTools.readout },
          mobileTools && {
            id: 'playback',
            label: mobileTools.playing ? 'Pause station playback' : 'Play station playback',
            icon: mobileTools.playing ? <Pause className="size-4" /> : <Play className="size-4" />,
            onSelect: mobileTools.onPlayback,
          },
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
            label: 'Previous [',
            ariaLabel: `Previous ${words.noun} [`,
            width: 'half',
            icon: <ChevronsLeft className="size-4" />,
            disabled,
            onSelect: () => jump(-1),
          },
          {
            id: 'next',
            label: 'Next ]',
            ariaLabel: `Next ${words.noun} ]`,
            width: 'half',
            icon: <ChevronsRight className="size-4" />,
            disabled,
            onSelect: () => jump(1),
          },
        ]}
      />
    </div>
  )
}
