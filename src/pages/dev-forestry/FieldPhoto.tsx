import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Camera,
  ImageOff,
  Loader2,
  Minus,
  Plus,
  Search,
  X,
} from 'lucide-react'
import { useEffect, useRef } from 'react'

import { Button } from '@/components/ui/button'
import { CheckboxField, FORM_INPUT_CLASS, FormField } from '@/components/ui/form-field'
import { insetBox } from '@/components/ui/inset-box'
import { InlineAlert, KeyValueRows } from '@/components/ui/map-panels'
import { MAP_OVERLAY_Z } from '@/components/ui/map-overlay'
import { NumericRangeField } from '@/components/ui/numeric-range-field'
import { Slider } from '@/components/ui/slider'
import { ExternalLink } from '@/components/ui/text-button'
import { ToggleRow } from '@/components/ui/toggle-row'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'

import { photoNearDrive } from './mapillary'
import { formatKm } from './measureFormat'
import { OwnFieldPhoto, type OwnPhotoActions } from './OwnFieldPhoto'
import type { FieldPhotoState } from './useFieldPhoto'

function Credit({ photo }: { photo: { creator: string | null; pageUrl: string } }) {
  return (
    <ExternalLink href={photo.pageUrl} hideIcon className="text-3xs font-normal">
      {photo.creator ?? 'Mapillary contributor'} · Mapillary · CC BY-SA 4.0
    </ExternalLink>
  )
}

/**
 * Step 2's field photo: find or paste a street-level photo, read its pose, and
 * line the road view up with it (handbook 3.2 photographs, 3.3.4 accuracy check).
 * Below it, the reviewer's own photo lines up the same way (`OwnFieldPhoto`).
 */
export function FieldPhotoPanel({
  photo,
  canLineUp,
  onLineUp,
  own,
}: {
  photo: FieldPhotoState
  canLineUp: boolean
  onLineUp: () => void
  /** The reviewer's own photo; without it only Mapillary photos are offered. */
  own?: OwnPhotoActions
}) {
  const ownPhoto = own ? (
    <div className="border-t border-border pt-3 text-xs">
      <OwnFieldPhoto photo={photo} actions={own} />
    </div>
  ) : null
  if (!photo.token) {
    return (
      <div className="space-y-3 text-xs">
        <InlineAlert title="Street-level photos are off">
          Add a Mapillary client token as <code>VITE_MAPILLARY_TOKEN</code> in <code>.env.local</code> and restart the
          dev server to compare the road view with real photos.
        </InlineAlert>
        {ownPhoto}
      </div>
    )
  }
  const { image, fov, onRoad, search } = photo
  return (
    <div className="space-y-3">
      <div className="space-y-3 text-xs" aria-label="Field photo">
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void photo.load(photo.input)
          }}
        >
          <FormField label="Mapillary photo link or image key" hideLabel className="flex-1">
            <input
              className={cn(FORM_INPUT_CLASS, 'h-9 touch:h-10')}
              placeholder="Mapillary photo link or image key"
              value={photo.input}
              onChange={(event) => photo.setInput(event.target.value)}
            />
          </FormField>
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
            <p className="mb-1 text-2xs text-muted-foreground">
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
                    className="block w-full overflow-hidden rounded-md border border-border text-left hover:border-primary/60"
                    aria-label={`Load photo ${candidate.id}`}
                    onClick={() => void photo.load(candidate.id)}
                  >
                    {candidate.thumbUrl ? (
                      <img
                        src={candidate.thumbUrl}
                        alt=""
                        loading="lazy"
                        className="aspect-[4/3] w-full object-cover"
                      />
                    ) : (
                      <span className="flex aspect-[4/3] items-center justify-center bg-muted">
                        <ImageOff className="h-4 w-4" />
                      </span>
                    )}
                    <span className="block truncate px-1 py-0.5 text-3xs text-muted-foreground">
                      {candidate.capturedAt ? formatDate(candidate.capturedAt) : 'Undated'} ·{' '}
                      {formatKm(candidate.targetMeters, 1)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <CheckboxField
          label={<span className="font-medium">Show street photos while driving</span>}
          description={`The nearest photo taken from the road, looking the way the camera looks${
            search.status === 'ready' ? ` (${search.road.length} along this road)` : ''
          }.`}
          checked={photo.follow}
          onCheckedChange={(follow) => {
            photo.setFollow(follow)
            if (follow && search.status !== 'ready') void photo.findPhotos()
          }}
        />
        {image && (
          <div className={cn(insetBox(), 'space-y-2')}>
            {image.thumbUrl && (
              <img src={image.thumbUrl} alt="Street-level photo from Mapillary" className="w-full rounded-sm" />
            )}
            <p className="text-3xs text-muted-foreground">
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
                  value: `${onRoad.offsetMeters.toFixed(0)} m off, ${formatKm(onRoad.distanceAlongMeters)} along`,
                },
              ]}
            />
            {image.isPano && (
              <p className="text-3xs leading-4 text-muted-foreground">
                A 360° photo: lining up cuts a 60° view from it, turned toward the cutblock. The arrows turn it.
              </p>
            )}
            {onRoad && onRoad.offsetMeters > 60 && (
              <InlineAlert tone="warning">
                This photo was taken {onRoad.offsetMeters.toFixed(0)} m from the road line, so the road view cannot
                stand where it was taken.
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
            <p className="text-3xs leading-4 text-muted-foreground">
              The eye stands on the road line nearest the photo. Recorded positions are often a few metres out and
              headings a few degrees; nudge the view until the drawn skyline sits on the photographed one.
            </p>
          </div>
        )}
      </div>
      {ownPhoto}
    </div>
  )
}

/**
 * The photo laid over the road view at the photo's own field of view, with the
 * terrain skyline and the cutblock drawn in its pixels. The photo fills the map's
 * height, which is what the matched vertical field of view spans.
 */
export function PhotoOverlay({ photo }: { photo: FieldPhotoState }) {
  const { image, own, match, drawing, panoFrame, setViewAspect } = photo
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
  if ((!image && !own) || !match)
    return <div ref={frame} className="pointer-events-none absolute inset-0" aria-hidden="true" />
  const set = (patch: Partial<typeof match>) => photo.setMatch({ ...match, ...patch })
  const nudge = photo.nudge
  const roll = image ? (image.isPano ? 0 : (drawing?.pose.roll ?? image.roll)) : own!.pose.roll
  // Drawings are in the frame's own pixels: the photo's, or the cut view's.
  const frameWidth = drawing?.pose.width ?? image?.width ?? own!.width
  const frameHeight = drawing?.pose.height ?? image?.height ?? own!.height
  const src = image ? image.thumbUrl : own!.src
  return (
    <>
      <div ref={frame} className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div
          className="absolute top-0 left-1/2 h-full"
          style={{ aspectRatio: `${frameWidth} / ${frameHeight}`, transform: `translateX(-50%) rotate(${-roll}deg)` }}
        >
          {image?.isPano ? (
            <canvas ref={canvas} className="h-full w-full" style={{ opacity: match.opacity }} />
          ) : (
            src && <img src={src} alt="" className="h-full w-full" style={{ opacity: match.opacity }} />
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
            size="xs"
            className="touch:h-10"
            onClick={() => photo.setMatch(null)}
            aria-label="Stop comparing"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <NumericRangeField
          label="Photo"
          aria-label="Photo opacity"
          layout="inline"
          valueSeparator=" "
          display={`${Math.round(match.opacity * 100)}% · road view behind`}
          headerClassName="text-2xs text-muted-foreground"
          min={0}
          max={100}
          step={5}
          value={match.opacity * 100}
          onChange={(value) => set({ opacity: value / 100 })}
          renderControl={(control) => (
            <Slider
              id={control.id}
              aria-label={control['aria-label']}
              aria-labelledby={control['aria-labelledby']}
              value={[control.value]}
              min={control.min}
              max={control.max}
              step={control.step}
              disabled={control.disabled}
              onValueChange={([value]) => control.onChange(value)}
            />
          )}
        />
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Drawn over the photo">
          <ToggleRow
            layout="tile"
            label="Terrain skyline"
            active={match.showSkyline}
            onClick={() => set({ showSkyline: !match.showSkyline })}
          />
          <ToggleRow
            layout="tile"
            label="Cutblock"
            active={match.showBlock}
            onClick={() => set({ showBlock: !match.showBlock })}
          />
        </div>
        <div className="flex flex-wrap items-center gap-1" aria-label="Nudge the view">
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="touch:h-10"
            aria-label="Turn left"
            onClick={() => nudge(-0.5, 0)}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="touch:h-10"
            aria-label="Turn right"
            onClick={() => nudge(0.5, 0)}
          >
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="touch:h-10"
            aria-label="Tilt up"
            onClick={() => nudge(0, 0.25)}
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="touch:h-10"
            aria-label="Tilt down"
            onClick={() => nudge(0, -0.25)}
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </Button>
          {own && (
            <>
              <Button
                type="button"
                variant="outline"
                size="xs"
                className="touch:h-10"
                aria-label="Narrower field of view"
                onClick={() => photo.setOwnPose({ hfov: own.pose.hfov - 1 })}
              >
                <Minus className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="xs"
                className="touch:h-10"
                aria-label="Wider field of view"
                onClick={() => photo.setOwnPose({ hfov: own.pose.hfov + 1 })}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
          <Button type="button" variant="ghost" size="xs" className="text-2xs touch:h-10" onClick={photo.resetNudge}>
            Reset
          </Button>
        </div>
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="w-full text-2xs touch:h-10"
          disabled={!photo.skylineReady || photo.alignment.status === 'working'}
          onClick={() => void photo.autoAlign()}
        >
          {photo.alignment.status === 'working' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Auto-align to the skyline
        </Button>
        {photo.alignment.status === 'done' && photo.alignment.fit && (
          <p className="text-3xs leading-4 text-foreground" role="status">
            Aligned on {photo.alignment.fit.agreeing} sky columns across {Math.round(photo.alignment.fit.span * 100)}%
            of the frame; {Math.round(photo.alignment.fit.agreement * 100)}% of the columns that can be judged agree,
            median {photo.alignment.fit.medianErrorPx.toFixed(1)} px.
          </p>
        )}
        {photo.alignment.status === 'failed' && (
          <p className="text-3xs leading-4 text-foreground" role="status">
            {photo.alignment.message}
          </p>
        )}
        <p className="text-3xs leading-4 text-muted-foreground">
          {own
            ? `Heading ${own.pose.bearing.toFixed(1)}°, pitch ${own.pose.pitch >= 0 ? '+' : ''}${own.pose.pitch.toFixed(2)}°, ${own.pose.hfov.toFixed(1)}° across, eye ${own.pose.eyeHeightMeters} m up. `
            : ''}
          {match.nudge.bearing || match.nudge.pitch
            ? `Nudged ${match.nudge.bearing >= 0 ? '+' : ''}${match.nudge.bearing.toFixed(1)}° heading, ${match.nudge.pitch >= 0 ? '+' : ''}${match.nudge.pitch.toFixed(2)}° pitch. `
            : ''}
          Yellow: terrain skyline{photo.skylineReady ? ' to 25 km' : ' (loading terrain…)'}. Orange: cutblock outline,
          hidden parts included. Red: block ground this station sees.
        </p>
        <p className="text-3xs text-muted-foreground">
          {image ? (
            <>
              Photo: <Credit photo={image} />
            </>
          ) : (
            `Your photo, ${own!.name}: kept in this browser.`
          )}
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
      className={`absolute right-2 bottom-16 ${MAP_OVERLAY_Z.controls} hidden w-64 overflow-hidden rounded-lg border bg-background/95 text-2xs shadow md:block`}
      role="region"
      aria-label="Street photo here"
    >
      {src ? (
        <img
          src={src}
          alt="Street-level photo taken near this point on the road"
          className="aspect-[4/3] w-full object-cover"
        />
      ) : null}
      <div className="flex items-center justify-between gap-2 p-1.5">
        <span className="min-w-0 truncate text-muted-foreground">
          {near.capturedAt ? formatDate(near.capturedAt) : 'Undated'} ·{' '}
          {Math.round(Math.abs(near.alongMeters - positionMeters))} m{' '}
          {near.alongMeters >= positionMeters ? 'ahead' : 'back'}
          {near.isPano ? ' · 360°' : ''}
        </span>
        <Button type="button" variant="outline" size="2xs" className="shrink-0" onClick={() => onLineUp(near.id)}>
          Line up
        </Button>
      </div>
      <p className="px-1.5 pb-1.5 text-3xs text-muted-foreground">
        <ExternalLink
          href={`https://www.mapillary.com/app/?pKey=${near.id}&focus=photo`}
          hideIcon
          className="text-3xs font-normal"
        >
          Mapillary · CC BY-SA 4.0
        </ExternalLink>
      </p>
    </div>
  )
}
