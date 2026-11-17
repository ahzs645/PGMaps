/**
 * The photo against the model view drawn for its camera (satellite imagery seen from that camera), at the same size:
 * blinked (hold B, or the button) or swiped (a vertical divider). Pixel alignment is judged better overlaid than across
 * panels. The agreement score sits beside it as evidence, never a verdict. Only when the skyline result is *not
 * settled* is a 2×2 shown: the photo, the model view for the camera, the one for the runner-up, and their difference.
 * See docs/forestry-visual-quality-own-photo-redesign-2026-11-17.md, §2.5.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Loader2, Mountain } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { cn } from '@/lib/utils'

import type { FieldPhotoState, ModelViewImage } from './useFieldPhoto'

type Mode = 'swipe' | 'blink'

/** Whether a key event comes from somewhere typing happens, where B is a letter, not a blink. */
const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))

export function PhotoCompare({ photo }: { photo: FieldPhotoState }) {
  const own = photo.own
  const [mode, setMode] = useState<Mode>('swipe')
  const [split, setSplit] = useState(50)
  const [blink, setBlink] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  useEffect(() => {
    const down = (event: globalThis.KeyboardEvent) => {
      if ((event.key === 'b' || event.key === 'B') && !typing(event.target) && !event.metaKey && !event.ctrlKey)
        setBlink(true)
    }
    const up = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'b' || event.key === 'B') setBlink(false)
    }
    const away = () => setBlink(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', away)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', away)
    }
  }, [])

  if (!own) return null
  const work = photo.workFor(own.id)
  const camera = work.modelViews.camera
  // The model view drawn for this exact camera (place, angles and lens), never one that only shares its heading.
  const view = camera && !!photo.activePoseKey && camera.poseKey === photo.activePoseKey ? camera : null
  const search = work.search.status === 'done' ? work.search.result : null
  const notSettled = !!search && !search.trustworthy
  const runnerUp = work.modelViews['runner-up'] ?? null

  const setFrom = (event: PointerEvent<HTMLDivElement>) => {
    const rect = box.current?.getBoundingClientRect()
    if (!rect?.width) return
    setSplit(Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)))
  }
  const nudgeSplit = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') setSplit((value) => Math.max(0, value - 5))
    if (event.key === 'ArrowRight') setSplit((value) => Math.min(100, value + 5))
  }

  return (
    <section className="space-y-2" aria-label="Photo against the model view" data-testid="own-photo-compare">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">Compare with the model view</h4>
        <SegmentedControl<Mode>
          label="How to compare"
          size="sm"
          fullWidth={false}
          value={mode}
          onChange={setMode}
          options={[
            { value: 'swipe', label: 'Swipe' },
            { value: 'blink', label: 'Blink (hold B)' },
          ]}
        />
      </div>
      {!view ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <p className="min-w-0 flex-1 leading-5">
            The model view draws satellite imagery as this camera would see it: roads, openings and lakes should fall
            where the photo has them. It needs no skyline.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="touch:h-10"
            disabled={!!photo.toolsBusy || own.pose.lng === null}
            onClick={() => void photo.renderModel('camera')}
          >
            {photo.toolsBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mountain className="h-4 w-4" />}
            Draw the model view for this camera
          </Button>
        </div>
      ) : (
        <>
          <div
            ref={box}
            className={cn('relative overflow-hidden rounded-sm', mode === 'swipe' && 'cursor-ew-resize touch-none')}
            onPointerDown={(event) => {
              if (mode !== 'swipe') return
              dragging.current = true
              event.currentTarget.setPointerCapture(event.pointerId)
              setFrom(event)
            }}
            onPointerMove={(event) => dragging.current && setFrom(event)}
            onPointerUp={() => (dragging.current = false)}
          >
            <img src={own.src} alt="Your photo" className="block w-full" draggable={false} />
            <img
              src={view.url}
              alt={`Model view at heading ${view.bearing.toFixed(0)}°`}
              className="absolute inset-0 h-full w-full"
              draggable={false}
              style={
                mode === 'swipe'
                  ? { clipPath: `inset(0 0 0 ${split}%)` }
                  : { opacity: blink ? 1 : 0, transition: 'none' }
              }
            />
            {mode === 'swipe' && (
              <div
                role="slider"
                tabIndex={0}
                aria-label="Divider between the photo and the model view"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(split)}
                onKeyDown={nudgeSplit}
                className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-background shadow focus-visible:ring-2 focus-visible:ring-ring"
                style={{ left: `${split}%` }}
              />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
            {mode === 'blink' && (
              <Button
                type="button"
                variant="outline"
                size="xs"
                className="touch:h-10"
                onPointerDown={() => setBlink(true)}
                onPointerUp={() => setBlink(false)}
                onPointerLeave={() => setBlink(false)}
              >
                Hold to show the model view
              </Button>
            )}
            <span className="tabular-nums">
              {mode === 'swipe' ? 'Photo left, model view right' : blink ? 'Model view' : 'Photo'} · heading{' '}
              {view.bearing.toFixed(1)}° · agreement {view.score.toFixed(2)}
            </span>
          </div>
          <p className="text-2xs leading-4 text-muted-foreground">
            Agreement correlates the photo with the model view over the ground, in brightness and in edges. Higher is
            better; it is evidence beside the skyline and the sun, not a verdict.
          </p>
        </>
      )}
      {notSettled && <NotSettledGrid photo={photo} camera={view} runnerUp={runnerUp} />}
    </section>
  )
}

/** The 2×2 for a result that is not settled: the photo, both model views, and where they differ. */
function NotSettledGrid({
  photo,
  camera,
  runnerUp,
}: {
  photo: FieldPhotoState
  camera: ModelViewImage | null
  runnerUp: ModelViewImage | null
}) {
  const own = photo.own!
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const target = canvas.current
    if (!target || !camera || !runnerUp) return
    let stopped = false
    const load = (src: string) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve(image)
        image.onerror = reject
        image.src = src
      })
    void Promise.all([load(camera.url), load(runnerUp.url)])
      .then(([a, b]) => {
        if (stopped) return
        const width = a.naturalWidth,
          height = a.naturalHeight
        target.width = width
        target.height = height
        const context = target.getContext('2d')
        if (!context) return
        context.drawImage(a, 0, 0)
        const first = context.getImageData(0, 0, width, height)
        context.drawImage(b, 0, 0, width, height)
        const second = context.getImageData(0, 0, width, height)
        const out = context.createImageData(width, height)
        for (let i = 0; i < out.data.length; i += 4) {
          const d =
            (Math.abs(first.data[i] - second.data[i]) +
              Math.abs(first.data[i + 1] - second.data[i + 1]) +
              Math.abs(first.data[i + 2] - second.data[i + 2])) /
            3
          out.data[i] = out.data[i + 1] = out.data[i + 2] = Math.min(255, d * 2)
          out.data[i + 3] = 255
        }
        context.putImageData(out, 0, 0)
      })
      .catch(() => {
        /* A view that failed to load leaves the difference blank. */
      })
    return () => {
      stopped = true
    }
  }, [camera, runnerUp])
  return (
    <div className="space-y-1.5" aria-label="Not settled: both candidates">
      <p className="text-xs font-medium text-warning-foreground">
        Not settled: another heading fits about as well. Hold the photo against both model views.
      </p>
      <div className="grid grid-cols-2 gap-2 text-3xs text-muted-foreground">
        <figure>
          <img src={own.src} alt="Your photo" className="w-full rounded-sm" />
          <figcaption>Photo</figcaption>
        </figure>
        <ModelCell
          view={camera}
          label="This camera"
          onDraw={() => void photo.renderModel('camera')}
          busy={!!photo.toolsBusy}
        />
        <ModelCell
          view={runnerUp}
          label="Runner-up"
          onDraw={() => void photo.renderModel('runner-up')}
          busy={!!photo.toolsBusy}
        />
        <figure>
          {camera && runnerUp ? (
            <canvas ref={canvas} className="w-full rounded-sm bg-muted" aria-label="Where the two model views differ" />
          ) : (
            <div className="flex aspect-[4/3] items-center justify-center rounded-sm bg-muted p-2 text-center">
              Draw both model views to see where they differ
            </div>
          )}
          <figcaption>Difference: bright where the two differ</figcaption>
        </figure>
      </div>
    </div>
  )
}

function ModelCell({
  view,
  label,
  onDraw,
  busy,
}: {
  view: ModelViewImage | null
  label: string
  onDraw: () => void
  busy: boolean
}) {
  return (
    <figure>
      {view ? (
        <img
          src={view.url}
          alt={`${label}: model view at heading ${view.bearing.toFixed(0)}°`}
          className="w-full rounded-sm"
        />
      ) : (
        <div className="flex aspect-[4/3] items-center justify-center rounded-sm bg-muted">
          <Button type="button" variant="outline" size="xs" className="touch:h-10" disabled={busy} onClick={onDraw}>
            Draw it
          </Button>
        </div>
      )}
      <figcaption className="tabular-nums">
        {label}
        {view ? ` · ${view.bearing.toFixed(0)}° · agreement ${view.score.toFixed(2)}` : ''}
      </figcaption>
    </figure>
  )
}
