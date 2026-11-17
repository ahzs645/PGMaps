import { useEffect, useId, useRef } from 'react'
import { Image as ImageIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { MapToolPanel } from '@/components/ui/map-tool-panel'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Slider } from '@/components/ui/slider'

import { drawnForLine } from './photoDrapeCardText'
import type { PhotoDrapeLook } from './photoDrapeImage'

const LOOKS: ReadonlyArray<{ value: PhotoDrapeLook; label: string; title: string }> = [
  { value: 'filled', label: 'Filled', title: "The photo's pixels on the ground" },
  {
    value: 'edges',
    label: 'Edges',
    title: "Only the photo's edges, in one colour: the imagery stays readable under them",
  },
  { value: 'footprint', label: 'Footprint', title: "The frame's outline alone" },
]

/** A key typed into a field, or with a modifier, is not a blink. */
function isTyping(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null
  if (!target) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

/**
 * Hold B to hide the photo and see the imagery under it; let go to bring it back. Window keys, captured, so the
 * plan need not have focus; never while typing, and released when the window loses focus mid-hold.
 */
function useHoldToBlink(enabled: boolean, onBlinkChange: (blink: boolean) => void) {
  const latest = useRef(onBlinkChange)
  useEffect(() => {
    latest.current = onBlinkChange
  })
  useEffect(() => {
    if (!enabled) return
    let held = false
    const down = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'b' || event.repeat || held) return
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event)) return
      held = true
      latest.current(true)
    }
    const up = (event: KeyboardEvent) => {
      if (!held || event.key.toLowerCase() !== 'b') return
      held = false
      latest.current(false)
    }
    const release = () => {
      if (!held) return
      held = false
      latest.current(false)
    }
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    window.addEventListener('blur', release)
    return () => {
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
      window.removeEventListener('blur', release)
      release()
    }
  }, [enabled])
}

/**
 * The plan's card for an own photo laid on the ground: how it looks (filled, edges, footprint), how strongly,
 * which candidate camera (the one found or the runner-up; blinking between them settles a *not settled* search),
 * and hold B to see the imagery through it. The plan never flies to the drape by itself: *Show the photo's ground*
 * and *Back to the scene* do. While the camera has moved since the drape was laid, the card says for which
 * heading it was drawn. Every change is reported; the page owns the state and `PhotoDrapeLayer` draws it.
 */
export function PhotoDrapeCard({
  candidates,
  activeId,
  onActiveChange,
  look,
  onLookChange,
  opacity,
  onOpacityChange,
  blink,
  onBlinkChange,
  drawnForBearing,
  currentBearing,
  busy = null,
  onShowGround,
  onBackToScene,
  onRemove,
  className,
}: {
  /** The drapes to choose between: the camera found and, when there is one, the runner-up. */
  candidates: ReadonlyArray<{ id: string; label: string }>
  activeId: string | null
  onActiveChange: (id: string) => void
  look: PhotoDrapeLook
  onLookChange: (look: PhotoDrapeLook) => void
  /** 0–1. */
  opacity: number
  onOpacityChange: (opacity: number) => void
  blink: boolean
  onBlinkChange: (blink: boolean) => void
  /** The heading the active drape was laid for, and the camera's heading now; degrees. */
  drawnForBearing: number | null
  currentBearing: number | null
  /** What is being drawn, while it is ("Laying the photo on the map…"). */
  busy?: string | null
  onShowGround: () => void
  onBackToScene: () => void
  onRemove: () => void
  className?: string
}) {
  const opacityId = useId()
  useHoldToBlink(look !== 'footprint', onBlinkChange)
  const drawnFor = drawnForLine(drawnForBearing, currentBearing)
  return (
    <MapToolPanel
      title="Photo on the plan"
      icon={ImageIcon}
      aria-label="Photo on the plan"
      data-testid="photo-drape-card"
      className={className}
      help={
        <>
          The photo laid on the ground for the camera found. Ground the frame covers but nearer terrain hides is
          hatched: that is terrain only, not the run&apos;s visibility. Hold B to see the imagery under the photo.
        </>
      }
      status={busy ?? drawnFor?.text}
      statusTone={!busy && drawnFor?.moved ? 'warning' : 'default'}
      actions={
        <>
          <Button size="xs" variant="ghost" onClick={onRemove}>
            Take it off
          </Button>
          <Button size="xs" variant="outline" onClick={onBackToScene}>
            Back to the scene
          </Button>
          <Button size="xs" variant="outline" onClick={onShowGround}>
            Show the photo&apos;s ground
          </Button>
        </>
      }
    >
      {candidates.length > 1 && (
        <SegmentedControl
          label="Camera drawn"
          size="sm"
          value={activeId ?? candidates[0].id}
          options={candidates.map((candidate) => ({ value: candidate.id, label: candidate.label }))}
          onChange={onActiveChange}
        />
      )}
      <SegmentedControl
        label="Look"
        size="sm"
        value={look}
        options={LOOKS.map((option) => ({ ...option }))}
        onChange={onLookChange}
      />
      <div className="flex items-center gap-2">
        <label htmlFor={opacityId} className="shrink-0 text-muted-foreground">
          Opacity
        </label>
        <Slider
          id={opacityId}
          aria-label="Photo opacity"
          value={[Math.round(opacity * 100)]}
          min={10}
          max={100}
          step={5}
          disabled={look === 'footprint'}
          onValueChange={([value]) => onOpacityChange(value / 100)}
        />
        <span className="w-9 shrink-0 text-right tabular-nums">{Math.round(opacity * 100)}%</span>
      </div>
      <Button
        size="xs"
        variant={blink ? 'secondary' : 'outline'}
        className="w-full"
        disabled={look === 'footprint'}
        aria-pressed={blink}
        title="Hold to see the imagery under the photo · or hold B"
        onPointerDown={() => onBlinkChange(true)}
        onPointerUp={() => onBlinkChange(false)}
        onPointerLeave={() => blink && onBlinkChange(false)}
        onPointerCancel={() => onBlinkChange(false)}
      >
        Hold to see the imagery (B)
      </Button>
    </MapToolPanel>
  )
}
