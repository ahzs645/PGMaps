/**
 * The photo against the model view drawn for its camera (satellite imagery seen from that camera), at the same size:
 * blinked (hold B, or the button) or swiped (a vertical divider). Pixel alignment is judged better overlaid than across
 * panels. The agreement score sits beside it as evidence, never a verdict. Only when the skyline result is *not
 * settled* is a 2×2 shown: the photo, the model view for the camera, the one for the runner-up, and their difference.
 * See docs/forestry-visual-quality-own-photo-redesign-2026-11-17.md, §2.5.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Loader2, Mountain, SlidersHorizontal } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { cn } from '@/lib/utils'

import { PhotoFineTune, type FineTuneStart, type FineTuneStep } from './PhotoFineTune'
import { modelViewFor } from './PhotoOptionsCard'
import type { FieldPhotoState, ModelViewImage } from './useFieldPhoto'

type Mode = 'swipe' | 'blink' | 'blend'

/** Whether a key event comes from somewhere typing happens, where B is a letter, not a blink. */
const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))

export function PhotoCompare({ photo, active }: { photo: FieldPhotoState; active: boolean }) {
  const own = photo.own
  const [mode, setMode] = useState<Mode>('swipe')
  const [split, setSplit] = useState(50)
  const [opacity, setOpacity] = useState(50)
  const [blink, setBlink] = useState(false)
  const [showCandidates, setShowCandidates] = useState(false)
  const [fineTune, setFineTune] = useState<FineTuneStart | null>(null)
  const [step, setStep] = useState<FineTuneStep>('fine')
  const [previewFailure, setPreviewFailure] = useState<string | null>(null)
  const [retryPreview, setRetryPreview] = useState(0)
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

  // Reuse an existing model only when it was drawn for this exact pose.
  const { activePoseKey, previewCamera } = photo
  const photoId = own?.id
  const work = photoId ? photo.workFor(photoId) : null
  const fullView = Object.values(work?.modelViews ?? {}).find((model) => model.poseKey === activePoseKey)
  const currentView = fullView ?? (work?.previewModel?.poseKey === activePoseKey ? work?.previewModel : undefined)
  const needsPreview = active && !!fineTune && !!activePoseKey && !currentView
  useEffect(() => {
    if (!needsPreview || !photoId) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void previewCamera(photoId, controller.signal).catch(() => {
        if (!controller.signal.aborted) setPreviewFailure(activePoseKey)
      })
    }, 350)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [needsPreview, photoId, activePoseKey, previewCamera, retryPreview])

  if (!own || !work) return null
  const failed = !currentView && !!activePoseKey && previewFailure === activePoseKey
  const view = currentView ?? (fineTune ? (work.previewModel ?? work.modelViews.camera) : null)
  const search = work.search.status === 'done' ? work.search.result : null
  const options = photo.optionsFor(own.id)
  const best = options.find((option) => option.kind === 'winner')
  const alternative = options.find((option) => option.kind === 'runner-up')
  const compareCandidates = !!search?.ambiguous && !!best && !!alternative
  const winner = modelViewFor(work.modelViews, best?.pose ?? null)
  const runnerUp = modelViewFor(work.modelViews, alternative?.pose ?? null)

  const setFrom = (event: PointerEvent<HTMLDivElement>) => {
    const rect = box.current?.getBoundingClientRect()
    if (!rect?.width) return
    setSplit(Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)))
  }
  const nudgeSplit = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') setSplit((value) => Math.max(0, value - 5))
    if (event.key === 'ArrowRight') setSplit((value) => Math.min(100, value + 5))
  }

  const fineTuneButton = (
    <Button
      type="button"
      variant={fineTune ? 'secondary' : 'outline'}
      size="sm"
      className="ml-auto touch:h-10"
      aria-expanded={!!fineTune}
      disabled={own.pose.lng == null || own.pose.lat == null}
      onClick={() => {
        setPreviewFailure(null)
        setFineTune(fineTune ? null : { pose: own.pose, sources: own.sources, chosen: own.chosen })
      }}
    >
      <SlidersHorizontal className="size-3.5" />
      {fineTune ? 'Finish fine-tuning' : 'Fine-tune camera'}
    </Button>
  )

  return (
    <section className="space-y-2" aria-label="Photo against the model view" data-testid="own-photo-compare">
      {/* The picture first, where the photo with its layers stands, so switching between the two moves nothing; how
          to compare, and the camera's fine-tuning, are under it. */}
      {!view ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <p className="min-w-0 flex-1 leading-5">
            Check whether roads, openings and lakes appear in the same places in the photo and the model.
          </p>
          {!fineTune && (
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
          )}
          {fineTuneButton}
        </div>
      ) : (
        <>
          <div
            ref={box}
            className={cn(
              'relative mx-auto w-full overflow-hidden rounded-sm',
              mode === 'swipe' && 'cursor-ew-resize touch-none',
            )}
            // No taller than the photo's own viewer, so the controls under it stay on screen.
            style={{ maxWidth: `calc(${fineTune ? 42 : 52}dvh * ${own.width / own.height})` }}
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
              className="absolute inset-0 h-full w-full bg-muted"
              draggable={false}
              style={
                mode === 'swipe'
                  ? { clipPath: `inset(0 0 0 ${split}%)` }
                  : { opacity: mode === 'blend' ? opacity / 100 : blink ? 1 : 0, transition: 'none' }
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
            <SegmentedControl<Mode>
              label="How to compare"
              size="sm"
              fullWidth={false}
              value={mode}
              onChange={setMode}
              options={[
                { value: 'swipe', label: 'Swipe' },
                { value: 'blend', label: 'Blend' },
                { value: 'blink', label: 'Blink (hold B)' },
              ]}
            />
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
            {mode === 'blend' && (
              <label className="flex items-center gap-2">
                Model opacity
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={opacity}
                  onChange={(event) => setOpacity(event.currentTarget.valueAsNumber)}
                />
              </label>
            )}
            {fineTuneButton}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
            <span className="tabular-nums">
              {!currentView
                ? 'Preview for the previous camera'
                : `${mode === 'swipe' ? 'Photo left, model view right' : mode === 'blend' ? 'Photo and model' : blink ? 'Model view' : 'Photo'} · heading ${view.bearing.toFixed(2)}° · ${fullView ? agreementLabel(view) : 'Preview'}`}
            </span>
            {!fineTune && !fullView && (
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={!!photo.toolsBusy}
                onClick={() => void photo.renderModel('camera')}
              >
                Draw full model view
              </Button>
            )}
          </div>
        </>
      )}
      {fineTune && <PhotoFineTune own={own} photo={photo} start={fineTune} step={step} onStep={setStep} />}
      {fineTune && !currentView && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
          {failed ? (
            <>
              The preview could not be drawn.
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => {
                  setPreviewFailure(null)
                  setRetryPreview((count) => count + 1)
                }}
              >
                Retry preview
              </Button>
            </>
          ) : (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              {activePoseKey ? 'Updating the model preview…' : 'Waiting for terrain…'}
            </>
          )}
        </div>
      )}
      {compareCandidates && (
        <div className="space-y-2 border-t border-border pt-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="touch:h-10"
            aria-expanded={showCandidates}
            onClick={() => setShowCandidates((shown) => !shown)}
          >
            {showCandidates ? 'Hide comparison' : 'Compare skyline candidates'}
          </Button>
          {showCandidates && <NotSettledGrid photo={photo} camera={winner} runnerUp={runnerUp} />}
        </div>
      )}
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
        context.clearRect(0, 0, width, height)
        context.drawImage(b, 0, 0, width, height)
        const second = context.getImageData(0, 0, width, height)
        const out = context.createImageData(width, height)
        for (let i = 0; i < out.data.length; i += 4) {
          if (!first.data[i + 3] || !second.data[i + 3]) continue
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
      {(!camera || !runnerUp) && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="touch:h-10"
          disabled={!!photo.toolsBusy}
          onClick={() => void photo.renderModel('both candidates')}
        >
          Draw both candidates
        </Button>
      )}
      <div className="grid grid-cols-2 gap-2 text-3xs text-muted-foreground">
        <figure>
          <img src={own.src} alt="Your photo" className="w-full rounded-sm" />
          <figcaption>Photo</figcaption>
        </figure>
        <ModelCell
          view={camera}
          label="Best skyline fit"
          onDraw={() => void photo.renderModel('winner')}
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
          className="w-full rounded-sm bg-muted"
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
        {view ? ` · ${view.bearing.toFixed(0)}° · ${agreementLabel(view)}` : ''}
      </figcaption>
    </figure>
  )
}

function agreementLabel(view: ModelViewImage): string {
  const coverage = `${Math.round(view.coverage * 100)}% ground imagery`
  return Number.isFinite(view.score)
    ? `agreement ${view.score.toFixed(2)} · ${coverage}`
    : `insufficient imagery · ${coverage}`
}
