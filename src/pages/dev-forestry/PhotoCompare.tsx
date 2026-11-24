/**
 * The photo against the model view drawn for its camera (satellite imagery seen from that camera), at the same size:
 * blinked (hold B, or the button) or swiped (a vertical divider). Pixel alignment is judged better overlaid than across
 * panels. The agreement score sits beside it as evidence, never a verdict. Only when the skyline result is *not
 * settled* is a 2×2 shown: the photo, the model view for the camera, the one for the runner-up, and their difference.
 * See docs/forestry-visual-quality-own-photo-redesign-2026-11-17.md, §2.5.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { ChevronsLeftRight, Loader2, SlidersHorizontal } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { ZoomPan } from '@/components/ui/zoom-pan'
import { fitBox, FIT_VIEW, type ZoomPanView } from '@/components/ui/zoomPanView'
import { useElementSize } from '@/hooks/useElementSize'
import { cn } from '@/lib/utils'

import { PhotoFineTune, type FineTuneStart, type FineTuneStep } from './PhotoFineTune'
import { photoModelViews, type FieldPhotoState, type ModelViewImage } from './useFieldPhoto'

type Mode = 'swipe' | 'blink' | 'blend' | 'side'

/** For a mark that keeps its size on screen while the pictures are enlarged under it (`ZoomPan`). */
const KEEP_SIZE = 'calc(1 / var(--zoom-pan-scale, 1))'
/** Between the two pictures set side by side, pixels. */
const SIDE_GAP_PX = 8

/** Whether a key event comes from somewhere typing happens, where B is a letter, not a blink. */
const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))

export function PhotoCompare({ photo, active }: { photo: FieldPhotoState; active: boolean }) {
  const own = photo.own
  const [mode, setMode] = useState<Mode>('swipe')
  const [split, setSplit] = useState(50)
  const [opacity, setOpacity] = useState(50)
  const [blink, setBlink] = useState(false)
  const [fineTune, setFineTune] = useState<FineTuneStart | null>(null)
  const [step, setStep] = useState<FineTuneStep>('fine')
  const [previewFailure, setPreviewFailure] = useState<string | null>(null)
  const [retryPreview, setRetryPreview] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  // The space the picture may take: what the column has left over its controls, as the photo's own viewer does.
  const stage = useRef<HTMLDivElement>(null)
  const stageSize = useElementSize(stage)
  const dragging = useRef(false)
  // One view for whatever is shown: the overlaid pair, or both pictures side by side, which zoom and move together.
  const [zoomView, setZoomView] = useState<ZoomPanView>(FIT_VIEW)
  // Where the pointer is over either picture set side by side, as a share of the picture: marked on both.
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)

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
  const fullView = work ? photoModelViews(work).find((model) => model.poseKey === activePoseKey) : undefined
  const currentView = fullView ?? (work?.previewModel?.poseKey === activePoseKey ? work?.previewModel : undefined)
  // The view for the camera as it stands is drawn as soon as it is looked at, with no button: the full one, or the
  // smaller preview while fine-tuning, where the camera moves under the reviewer's hand.
  const tuning = !!fineTune
  const needsView = active && !!activePoseKey && (tuning ? !currentView : !fullView)
  useEffect(() => {
    if (!needsView || !photoId) return
    const controller = new AbortController()
    const timer = window.setTimeout(
      () => {
        void previewCamera(photoId, controller.signal, { full: !tuning }).catch(() => {
          if (!controller.signal.aborted) setPreviewFailure(activePoseKey)
        })
      },
      tuning ? 350 : 60,
    )
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [needsView, tuning, photoId, activePoseKey, previewCamera, retryPreview])
  // The view last shown stays up while the next camera's is drawn (said under it), so the picture never gives way to
  // an empty box between two cameras. It is this photo's: the panel is made again for another photo.
  const [held, setHeld] = useState<ModelViewImage | null>(null)
  if (currentView && held !== currentView) setHeld(currentView)

  if (!own || !work) return null
  const failed = !currentView && !!activePoseKey && previewFailure === activePoseKey
  const view = currentView ?? held ?? work.previewModel ?? photoModelViews(work)[0] ?? null

  const setFrom = (event: PointerEvent<HTMLDivElement>) => {
    const rect = box.current?.getBoundingClientRect()
    if (!rect?.width) return
    setSplit(Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)))
  }
  const nudgeSplit = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') setSplit((value) => Math.max(0, value - 5))
    if (event.key === 'ArrowRight') setSplit((value) => Math.min(100, value + 5))
  }

  const zoomed = zoomView.scale > 1.001
  const shape = own.width / own.height
  const changeMode = (next: Mode) => {
    // The pictures' boxes are another size side by side: a view kept from one arrangement is nowhere in the other.
    if ((next === 'side') !== (mode === 'side')) setZoomView(FIT_VIEW)
    setCursor(null)
    setMode(next)
  }
  const followCursor = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    setCursor({ x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height })
  }
  const sideBox = fitBox({ width: (stageSize.width - SIDE_GAP_PX) / 2, height: stageSize.height }, shape)

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
    <section
      className="flex min-h-0 flex-1 flex-col gap-2"
      aria-label="Photo against the model view"
      data-testid="own-photo-compare"
    >
      {/* The picture first, where the photo with its layers stands, so switching between the two moves nothing; how
          to compare, and the camera's fine-tuning, are under it. */}
      <>
        <div ref={stage} className="relative min-h-[40dvh] flex-1 md:min-h-60">
          {mode === 'side' ? (
            // Two pictures of one size sharing one view: zooming or moving either moves both, and the pointer over
            // one is marked on the other, so a bend of road or a lake's corner is found in both at once.
            <div className="absolute inset-0 grid grid-cols-2" style={{ gap: SIDE_GAP_PX }}>
              {(['photo', 'model'] as const).map((which) => (
                <ZoomPan
                  key={which}
                  className="rounded-sm bg-muted/50"
                  label="photo and model view"
                  view={zoomView}
                  onViewChange={setZoomView}
                  controls={which === 'model'}
                  overlay={
                    <span className="pointer-events-none absolute left-1.5 top-1.5 rounded-sm bg-background/85 px-1.5 py-0.5 text-2xs text-foreground">
                      {which === 'photo' ? 'Photo' : 'Model view'}
                    </span>
                  }
                >
                  <div
                    className="relative shrink-0 overflow-hidden rounded-sm bg-muted"
                    style={sideBox}
                    onPointerMove={followCursor}
                    onPointerLeave={() => setCursor(null)}
                    data-testid={`own-photo-compare-${which}`}
                  >
                    {which === 'photo' ? (
                      <img
                        src={own.src}
                        alt="Your photo"
                        className="absolute inset-0 h-full w-full"
                        draggable={false}
                      />
                    ) : (
                      view && (
                        <img
                          src={view.url}
                          alt={`Model view at heading ${view.bearing.toFixed(0)}°`}
                          className="absolute inset-0 h-full w-full"
                          draggable={false}
                        />
                      )
                    )}
                    {cursor && (
                      <span
                        className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.6)]"
                        style={{ left: `${cursor.x * 100}%`, top: `${cursor.y * 100}%`, scale: KEEP_SIZE }}
                        aria-hidden
                      />
                    )}
                  </div>
                </ZoomPan>
              ))}
            </div>
          ) : (
            <ZoomPan
              className="absolute inset-0"
              label="photo and model view"
              view={zoomView}
              onViewChange={setZoomView}
            >
              <div
                ref={box}
                className={cn(
                  'relative shrink-0 overflow-hidden rounded-sm bg-muted',
                  mode === 'swipe' && view && !zoomed && 'cursor-ew-resize touch-none',
                )}
                // The photo's own shape and the size its viewer shows it at, from the first frame and whether or not
                // a view has been drawn, so nothing moves when one arrives or the camera changes.
                style={fitBox(stageSize, shape)}
                onPointerDown={(event) => {
                  if (mode !== 'swipe' || !view) return
                  // Enlarged, a drag moves the pictures: the divider is then moved by its own handle.
                  if (zoomed && !(event.target as Element).closest('[data-swipe-handle]')) return
                  dragging.current = true
                  event.currentTarget.setPointerCapture(event.pointerId)
                  setFrom(event)
                }}
                onPointerMove={(event) => dragging.current && setFrom(event)}
                onPointerUp={() => (dragging.current = false)}
                onPointerCancel={() => (dragging.current = false)}
              >
                <img src={own.src} alt="Your photo" className="absolute inset-0 h-full w-full" draggable={false} />
                {view && (
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
                )}
                {mode === 'swipe' && view && (
                  <div
                    role="slider"
                    tabIndex={0}
                    aria-label="Divider between the photo and the model view"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(split)}
                    onKeyDown={nudgeSplit}
                    data-swipe-handle
                    data-zoom-pan-ignore
                    className="absolute inset-y-0 w-6 -translate-x-1/2 cursor-ew-resize touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    style={{ left: `${split}%` }}
                  >
                    <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-background shadow" />
                    <span
                      className="absolute left-1/2 top-1/2 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background text-foreground shadow"
                      style={{ scale: KEEP_SIZE }}
                    >
                      <ChevronsLeftRight className="h-3.5 w-3.5" aria-hidden />
                    </span>
                  </div>
                )}
              </div>
            </ZoomPan>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
          <SegmentedControl<Mode>
            label="How to compare"
            size="sm"
            fullWidth={false}
            value={mode}
            onChange={changeMode}
            options={[
              { value: 'swipe', label: 'Swipe' },
              { value: 'side', label: 'Side by side' },
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
            {!view
              ? failed
                ? 'The model view could not be drawn'
                : activePoseKey
                  ? 'Drawing the model view for this camera…'
                  : 'Waiting for terrain…'
              : !currentView
                ? failed
                  ? `The view at heading ${view.bearing.toFixed(2)}°: this camera’s could not be drawn`
                  : `The view at heading ${view.bearing.toFixed(2)}° while this camera’s is drawn…`
                : `${mode === 'swipe' || mode === 'side' ? 'Photo left, model view right' : mode === 'blend' ? 'Photo and model' : blink ? 'Model view' : 'Photo'} · heading ${view.bearing.toFixed(2)}° · ${fullView ? agreementLabel(view) : 'Preview'}`}
          </span>
          {failed && !fineTune && (
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => {
                setPreviewFailure(null)
                setRetryPreview((count) => count + 1)
              }}
            >
              Draw it again
            </Button>
          )}
        </div>
      </>
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
    </section>
  )
}

function agreementLabel(view: ModelViewImage): string {
  const coverage = `${Math.round(view.coverage * 100)}% ground imagery`
  return Number.isFinite(view.score)
    ? `agreement ${view.score.toFixed(2)} · ${coverage}`
    : `insufficient imagery · ${coverage}`
}
