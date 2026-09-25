import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Camera, ImageOff, Loader2, Search, X } from 'lucide-react'
import { useEffect, useRef } from 'react'

import { Button } from '@/components/ui/button'
import { InlineAlert, KeyValueRows } from '@/components/ui/map-panels'
import { MAP_OVERLAY_Z } from '@/components/ui/map-overlay'
import { Slider } from '@/components/ui/slider'
import { formatDate } from '@/lib/format'

import { photoNearDrive } from './mapillary'
import type { FieldPhotoState } from './useFieldPhoto'

const INPUT_CLASS =
  'h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring touch:h-10'

function Credit({ photo }: { photo: { creator: string | null; pageUrl: string } }) {
  return (
    <a className="underline" href={photo.pageUrl} target="_blank" rel="noreferrer">
      {photo.creator ?? 'Mapillary contributor'} · Mapillary · CC BY-SA 4.0
    </a>
  )
}

/**
 * Step 2's field photo: find or paste a street-level photo, read its pose, and
 * line the road view up with it (handbook 3.2 photographs, 3.3.4 accuracy check).
 */
export function FieldPhotoPanel({
  photo,
  canLineUp,
  onLineUp,
}: {
  photo: FieldPhotoState
  canLineUp: boolean
  onLineUp: () => void
}) {
  if (!photo.token) {
    return (
      <InlineAlert title="Street-level photos are off">
        Add a Mapillary client token as <code>VITE_MAPILLARY_TOKEN</code> in <code>.env.local</code> and restart the dev
        server to compare the road view with real photos.
      </InlineAlert>
    )
  }
  const { image, fov, onRoad, search } = photo
  return (
    <div className="space-y-3 text-xs" aria-label="Field photo">
      <p className="text-[11px] leading-4 text-muted-foreground">
        Handbook 3.2 photographs each viewpoint and 3.3.4 checks the simulation against the photo. A street-level photo
        from Mapillary can stand in for a first visit: line the road view up with it and see whether the terrain and
        timber match.
      </p>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void photo.load(photo.input)
        }}
      >
        <input
          className={INPUT_CLASS}
          aria-label="Mapillary photo link or image key"
          placeholder="Mapillary photo link or image key"
          value={photo.input}
          onChange={(event) => photo.setInput(event.target.value)}
        />
        <Button type="submit" variant="outline" size="sm" className="touch:h-10" disabled={photo.status.loading}>
          {photo.status.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Load'}
        </Button>
      </form>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full touch:h-10"
        disabled={search.status === 'loading'}
        onClick={() => void photo.findPhotos()}
      >
        {search.status === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        Find photos facing the cutblock
      </Button>
      {photo.status.error && <InlineAlert tone="error">{photo.status.error}</InlineAlert>}
      {search.status === 'error' && <InlineAlert tone="error">{search.error}</InlineAlert>}
      {search.status === 'ready' && (
        <div>
          <p className="mb-1 text-[11px] text-muted-foreground">
            {search.photos.length
              ? `${search.photos.length} of ${search.searched} photos along the road look toward the cutblock. Nearest first.`
              : `None of the ${search.searched} photos along the road look toward the cutblock.`}
            {search.truncated ? ' The road is long: not every stretch was searched.' : ''}
          </p>
          <ul className="grid grid-cols-3 gap-1.5">
            {search.photos.map((candidate) => (
              <li key={candidate.id}>
                <button
                  type="button"
                  className="block w-full overflow-hidden rounded border border-border text-left hover:border-primary/60"
                  aria-label={`Load photo ${candidate.id}`}
                  onClick={() => void photo.load(candidate.id)}
                >
                  {candidate.thumbUrl ? (
                    <img src={candidate.thumbUrl} alt="" loading="lazy" className="aspect-[4/3] w-full object-cover" />
                  ) : (
                    <span className="flex aspect-[4/3] items-center justify-center bg-muted">
                      <ImageOff className="h-4 w-4" />
                    </span>
                  )}
                  <span className="block truncate px-1 py-0.5 text-[10px] text-muted-foreground">
                    {candidate.capturedAt ? formatDate(candidate.capturedAt) : 'Undated'} ·{' '}
                    {(candidate.targetMeters / 1000).toFixed(1)} km
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <label className="flex items-start gap-2 text-[11px] leading-4 text-muted-foreground">
        <input
          type="checkbox"
          className="mt-0.5 h-3.5 w-3.5"
          checked={photo.follow}
          onChange={(event) => {
            photo.setFollow(event.target.checked)
            if (event.target.checked && search.status !== 'ready') void photo.findPhotos()
          }}
        />
        <span>
          <span className="font-medium text-foreground">Show street photos while driving.</span> The nearest photo taken
          from the road, looking the way the camera looks{search.status === 'ready' ? ` (${search.road.length} along this road)` : ''}.
        </span>
      </label>
      {image && (
        <div className="space-y-2 rounded-md border border-border p-2">
          {image.thumbUrl && (
            <img src={image.thumbUrl} alt="Street-level photo from Mapillary" className="w-full rounded" />
          )}
          <p className="text-[10px] text-muted-foreground">
            Photo: <Credit photo={image} />
          </p>
          <KeyValueRows
            variant="divided"
            rows={[
              {
                label: 'Taken',
                value: image.capturedAt ? `${formatDate(image.capturedAt)} (camera clock)` : 'Undated',
              },
              image.camera ? { label: 'Camera', value: image.camera } : null,
              {
                label: 'Looking',
                value: `${Math.round(image.bearing)}° · ${image.pitch >= 0 ? '+' : ''}${image.pitch.toFixed(1)}° pitch${image.poseSource === 'compass' ? ' (compass only)' : ''}`,
              },
              fov && { label: 'Field of view', value: `${fov.horizontal.toFixed(0)}° × ${fov.vertical.toFixed(0)}°` },
              onRoad && {
                label: 'From the road line',
                value: `${onRoad.offsetMeters.toFixed(0)} m off, ${(onRoad.distanceAlongMeters / 1000).toFixed(2)} km along`,
              },
            ]}
          />
          {image.isPano && (
            <p className="text-[10px] leading-4 text-muted-foreground">
              A 360° photo: lining up cuts a 60° view from it, turned toward the cutblock. The arrows turn it.
            </p>
          )}
          {onRoad && onRoad.offsetMeters > 60 && (
            <InlineAlert tone="warning">
              This photo was taken {onRoad.offsetMeters.toFixed(0)} m from the road line, so the road view cannot stand
              where it was taken.
            </InlineAlert>
          )}
          <div className="flex gap-2">
            <Button type="button" size="sm" className="flex-1 touch:h-10" disabled={!canLineUp} onClick={onLineUp}>
              <Camera className="h-4 w-4" />
              Line up the road view
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="touch:h-10"
              aria-label="Clear photo"
              onClick={photo.clear}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-[10px] leading-4 text-muted-foreground">
            The eye stands on the road line nearest the photo. Recorded positions are often a few metres out and
            headings a few degrees; nudge the view until the drawn skyline sits on the photographed one.
          </p>
        </div>
      )}
    </div>
  )
}

/**
 * The photo laid over the road view at the photo's own field of view, with the
 * terrain skyline and the cutblock drawn in its pixels. The photo fills the map's
 * height, which is what the matched vertical field of view spans.
 */
export function PhotoOverlay({ photo }: { photo: FieldPhotoState }) {
  const { image, match, drawing, panoFrame, setViewAspect } = photo
  const frame = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  // A view cut from a panorama takes the map's shape, so it covers the map.
  useEffect(() => {
    const element = frame.current
    if (!element) return
    const observer = new ResizeObserver(() => {
      if (element.clientHeight > 0) setViewAspect(element.clientWidth / element.clientHeight)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [setViewAspect])
  useEffect(() => {
    const target = canvas.current
    if (!target || !panoFrame) return
    target.width = panoFrame.width
    target.height = panoFrame.height
    target
      .getContext('2d')
      ?.putImageData(new ImageData(new Uint8ClampedArray(panoFrame.data), panoFrame.width, panoFrame.height), 0, 0)
  }, [panoFrame])
  if (!image || !match) return <div ref={frame} className="pointer-events-none absolute inset-0" aria-hidden="true" />
  const set = (patch: Partial<typeof match>) => photo.setMatch({ ...match, ...patch })
  const nudge = (bearing: number, pitch: number) =>
    set({ nudge: { bearing: match.nudge.bearing + bearing, pitch: match.nudge.pitch + pitch } })
  const roll = image.isPano ? 0 : (drawing?.pose.roll ?? image.roll)
  // Drawings are in the frame's own pixels: the photo's, or the cut view's.
  const frameWidth = drawing?.pose.width ?? image.width
  const frameHeight = drawing?.pose.height ?? image.height
  return (
    <>
      <div ref={frame} className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div
          className="absolute top-0 left-1/2 h-full"
          style={{ aspectRatio: `${frameWidth} / ${frameHeight}`, transform: `translateX(-50%) rotate(${-roll}deg)` }}
        >
          {image.isPano ? (
            <canvas ref={canvas} className="h-full w-full" style={{ opacity: match.opacity }} />
          ) : (
            image.thumbUrl && (
              <img src={image.thumbUrl} alt="" className="h-full w-full" style={{ opacity: match.opacity }} />
            )
          )}
          {drawing && (
            <svg
              className="absolute inset-0 h-full w-full"
              viewBox={`0 0 ${frameWidth} ${frameHeight}`}
              preserveAspectRatio="none"
            >
              {drawing.skyline.length > 1 && (
                <polyline
                  points={drawing.skyline.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')}
                  fill="none"
                  stroke="#facc15"
                  strokeWidth={frameWidth / 400}
                  strokeDasharray={`${frameWidth / 120} ${frameWidth / 200}`}
                />
              )}
              {drawing.visibleDots.map((dot, index) => (
                <circle key={index} cx={dot.x} cy={dot.y} r={frameWidth / 700} fill="#ef4444" opacity={0.8} />
              ))}
              {drawing.outlines.map((path, index) => (
                <path key={index} d={path} fill="none" stroke="#f97316" strokeWidth={frameWidth / 350} />
              ))}
            </svg>
          )}
        </div>
      </div>
      <div
        className={`absolute top-3 right-14 ${MAP_OVERLAY_Z.activeOverlay} w-64 max-w-[calc(100%-4.5rem)] space-y-2 rounded-lg border bg-background/95 p-2 text-xs shadow`}
        role="region"
        aria-label="Photo comparison"
      >
        <div className="flex items-center justify-between gap-2">
          <p className="font-semibold">Field photo comparison</p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 touch:h-10"
            onClick={() => photo.setMatch(null)}
            aria-label="Stop comparing"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <label className="block">
          <span className="text-[11px] text-muted-foreground">
            Photo {Math.round(match.opacity * 100)}% · road view behind
          </span>
          <Slider
            aria-label="Photo opacity"
            value={[match.opacity * 100]}
            min={0}
            max={100}
            step={5}
            onValueChange={([value]) => set({ opacity: value / 100 })}
          />
        </label>
        <div className="flex flex-wrap gap-3">
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={match.showSkyline}
              onChange={(event) => set({ showSkyline: event.target.checked })}
            />
            Terrain skyline
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={match.showBlock}
              onChange={(event) => set({ showBlock: event.target.checked })}
            />
            Cutblock
          </label>
        </div>
        <div className="flex items-center gap-1" aria-label="Nudge the view">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 touch:h-10"
            aria-label="Turn left"
            onClick={() => nudge(-0.5, 0)}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 touch:h-10"
            aria-label="Turn right"
            onClick={() => nudge(0.5, 0)}
          >
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 touch:h-10"
            aria-label="Tilt up"
            onClick={() => nudge(0, 0.25)}
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 touch:h-10"
            aria-label="Tilt down"
            onClick={() => nudge(0, -0.25)}
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11px] touch:h-10"
            onClick={() => set({ nudge: { bearing: 0, pitch: 0 } })}
          >
            Reset
          </Button>
        </div>
        <Button type="button" variant="outline" size="sm" className="h-7 w-full text-[11px] touch:h-10" disabled={!photo.skylineReady || photo.alignment.status === 'working'} onClick={() => void photo.autoAlign()}>
          {photo.alignment.status === 'working' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Auto-align to the skyline
        </Button>
        {photo.alignment.status === 'done' && photo.alignment.fit && (
          <p className="text-[10px] leading-4 text-foreground" role="status">
            Aligned on {photo.alignment.fit.agreeing} sky columns across {Math.round(photo.alignment.fit.span * 100)}% of
            the frame; {Math.round(photo.alignment.fit.agreement * 100)}% of the columns that can be judged agree, median{' '}
            {photo.alignment.fit.medianErrorPx.toFixed(1)} px.
          </p>
        )}
        {photo.alignment.status === 'failed' && <p className="text-[10px] leading-4 text-foreground" role="status">{photo.alignment.message}</p>}
        <p className="text-[10px] leading-4 text-muted-foreground">
          {match.nudge.bearing || match.nudge.pitch
            ? `Nudged ${match.nudge.bearing >= 0 ? '+' : ''}${match.nudge.bearing.toFixed(1)}° heading, ${match.nudge.pitch >= 0 ? '+' : ''}${match.nudge.pitch.toFixed(2)}° pitch. `
            : ''}
          Yellow: terrain skyline{photo.skylineReady ? ' to 25 km' : ' (loading terrain…)'}. Orange: cutblock outline,
          hidden parts included. Red: block ground this station sees.
        </p>
        <p className="text-[10px] text-muted-foreground">
          Photo: <Credit photo={image} />
        </p>
      </div>
    </>
  )
}

/**
 * While driving, the street photo taken nearest the eye and looking the same
 * way, so the drive can be checked against the road as it was photographed.
 */
export function StreetPhotoInset({
  photo,
  positionMeters,
  lookBearing,
  onLineUp,
}: {
  photo: FieldPhotoState
  positionMeters: number
  lookBearing: number
  onLineUp: (id: string) => void
}) {
  if (!photo.follow || photo.match) return null
  const near = photoNearDrive(photo.search.road, positionMeters, lookBearing)
  if (!near) return null
  const src = near.largeUrl ?? near.thumbUrl
  return (
    <div
      className={`absolute right-2 bottom-16 ${MAP_OVERLAY_Z.controls} hidden w-64 overflow-hidden rounded-lg border bg-background/95 text-[11px] shadow md:block`}
      role="region"
      aria-label="Street photo here"
    >
      {src ? <img src={src} alt="Street-level photo taken near this point on the road" className="aspect-[4/3] w-full object-cover" /> : null}
      <div className="flex items-center justify-between gap-2 p-1.5">
        <span className="min-w-0 truncate text-muted-foreground">
          {near.capturedAt ? formatDate(near.capturedAt) : 'Undated'} · {Math.round(Math.abs(near.alongMeters - positionMeters))} m {near.alongMeters >= positionMeters ? 'ahead' : 'back'}
          {near.isPano ? ' · 360°' : ''}
        </span>
        <Button type="button" variant="outline" size="sm" className="h-6 shrink-0 px-2 text-[11px]" onClick={() => onLineUp(near.id)}>
          Line up
        </Button>
      </div>
      <p className="px-1.5 pb-1.5 text-[10px] text-muted-foreground">
        <a className="underline" href={`https://www.mapillary.com/app/?pKey=${near.id}&focus=photo`} target="_blank" rel="noreferrer">
          Mapillary · CC BY-SA 4.0
        </a>
      </p>
    </div>
  )
}

