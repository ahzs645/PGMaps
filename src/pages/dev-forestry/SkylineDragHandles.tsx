/**
 * Drag-to-align over an own photo (PeakFinder and PeakVisor's hand fallback): a cross at the drawn skyline's middle
 * moves it, a handle at each side turns it about the cross. While dragging, what is drawn over the photo follows as a
 * picture (`onPreview`, a CSS transform), which costs nothing; on release the drag becomes heading, pitch and roll
 * (`skylineAlign.ts`), set as the reviewer's, and the skyline is drawn again for the new camera. The search can then
 * refine it from there (*Adjust* → *Search near this camera*).
 */
import { useRef, useState, type PointerEvent, type RefObject } from 'react'
import { Move, RotateCw } from 'lucide-react'

import { cn } from '@/lib/utils'

import type { PhotoPose } from './photoPose'
import { alignPixel, rollAbout, screenAngle, skylineHandles, wrapSigned } from './skylineAlign'

type Pixel = { x: number; y: number }
type Drag = { kind: 'move' | 'turn'; start: Pixel; centre: Pixel; pointer: number }

export function SkylineDragHandles({
  frame,
  pose,
  skyline,
  onPreview,
  onAlign,
}: {
  /** The photo's frame: client pixels are read against its box. */
  frame: RefObject<HTMLElement>
  /** The camera the skyline is drawn for, in the photo's pixels. */
  pose: PhotoPose
  skyline: ReadonlyArray<{ x: number; y: number } | null>
  /** A CSS transform for what is drawn over the photo while dragging; null when not. */
  onPreview: (preview: { transform: string; origin: string } | null) => void
  /** The camera the drag lands on. */
  onAlign: (angles: { bearing: number; pitch: number; roll: number }) => void
}) {
  const handles = skylineHandles(skyline, pose.width, pose.height)
  const drag = useRef<Drag | null>(null)
  const [refused, setRefused] = useState(false)
  const toPixel = (event: PointerEvent): Pixel | null => {
    const box = frame.current?.getBoundingClientRect()
    if (!box || !box.width || !box.height) return null
    return {
      x: ((event.clientX - box.left) / box.width) * pose.width,
      y: ((event.clientY - box.top) / box.height) * pose.height,
    }
  }
  const percent = (point: Pixel) => ({
    left: `${(point.x / pose.width) * 100}%`,
    top: `${(point.y / pose.height) * 100}%`,
  })
  const origin = `${(handles.centre.x / pose.width) * 100}% ${(handles.centre.y / pose.height) * 100}%`

  const start = (kind: Drag['kind'], at: Pixel) => (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const pixel = toPixel(event) ?? at
    drag.current = { kind, start: pixel, centre: handles.centre, pointer: event.pointerId }
    setRefused(false)
  }
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const current = drag.current
    if (!current || current.pointer !== event.pointerId) return
    const at = toPixel(event)
    if (!at) return
    if (current.kind === 'move')
      onPreview({
        transform: `translate(${((at.x - current.start.x) / pose.width) * 100}%, ${((at.y - current.start.y) / pose.height) * 100}%)`,
        origin,
      })
    else
      onPreview({
        transform: `rotate(${wrapSigned(screenAngle(current.centre, at) - screenAngle(current.centre, current.start))}deg)`,
        origin,
      })
  }
  const end = (event: PointerEvent<HTMLButtonElement>) => {
    const current = drag.current
    if (!current || current.pointer !== event.pointerId) return
    drag.current = null
    onPreview(null)
    const at = toPixel(event)
    if (!at || Math.hypot(at.x - current.start.x, at.y - current.start.y) < 1) return
    const angles =
      current.kind === 'move'
        ? alignPixel(pose, current.start, at)
        : rollAbout(
            pose,
            current.centre,
            wrapSigned(screenAngle(current.centre, at) - screenAngle(current.centre, current.start)),
          )
    if (angles) onAlign(angles)
    else setRefused(true)
  }
  const handle = (kind: Drag['kind'], at: Pixel, label: string) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'pointer-events-auto absolute flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 touch-none items-center justify-center rounded-full border border-white bg-foreground/70 text-background shadow focus-visible:ring-2 focus-visible:ring-ring touch:h-10 touch:w-10',
        kind === 'move' ? 'cursor-move' : 'cursor-grab',
      )}
      style={percent(at)}
      onPointerDown={start(kind, at)}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={() => {
        drag.current = null
        onPreview(null)
      }}
    >
      {kind === 'move' ? <Move className="h-4 w-4" /> : <RotateCw className="h-3.5 w-3.5" />}
    </button>
  )
  return (
    <div className="pointer-events-none absolute inset-0" data-testid="own-photo-align-handles">
      {handle('move', handles.centre, 'Drag the skyline to move it')}
      {handle('turn', handles.left, 'Drag to turn the skyline (left handle)')}
      {handle('turn', handles.right, 'Drag to turn the skyline (right handle)')}
      {refused && (
        <p className="absolute bottom-1 left-1 rounded-sm bg-background/90 px-1.5 py-0.5 text-2xs" role="status">
          No camera puts the skyline there: try a shorter drag.
        </p>
      )}
    </div>
  )
}
