import { Camera, Crosshair, ImagePlus, Loader2, Save, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { FileButton } from '@/components/ui/file-button'
import { NullableNumberField, NumberField } from '@/components/ui/form-field'
import { InlineAlert, KeyValueRows } from '@/components/ui/map-panels'

import type { FieldRecord } from './assessmentTools'
import type { PoseSource, RoadViewPose } from './exifPose'
import { formatKm } from './measureFormat'
import type { FieldPhotoState } from './useFieldPhoto'

/** What the page does with an own photo: stand the road view there, pick its spot, save its pose. */
export type OwnPhotoActions = {
  /** Field records of kind 'photo', to line up without picking the file again. */
  records: FieldRecord[]
  /** The road view's pose as it stands, the starting point for anything EXIF does not give. */
  roadView: RoadViewPose | null
  /** False while the scene cannot open a road view at all. */
  canLineUp: boolean
  /** Stands the road view at `at` and holds it on the photo's pose. */
  onLineUp: (at: { lng: number; lat: number }) => void
  /** Asks the plan map for one click; null cancels. */
  onPickPoint?: (onPoint: ((point: [number, number]) => void) | null) => void
  pickActive?: boolean
  /** Writes the confirmed camera back to the field record it came from. */
  onSaveToRecord?: (recordId: string, patch: Partial<FieldRecord>) => void
}

const SOURCE_TEXT: Record<PoseSource, string> = {
  exif: 'from the photo’s EXIF',
  record: 'from the field record',
  'road-view': 'the road view’s, as it stood',
  level: 'level; EXIF records no tilt',
  default: 'a default',
  reviewer: 'set by you',
  skyline: 'fitted to the skyline',
}

const ACCEPT = 'image/jpeg,image/png,image/webp'

/**
 * Lining up a photo of the reviewer's own (handbook 3.3.4): a picked file or a
 * field record's photograph, its EXIF read as a starting pose, every value
 * editable while the photo sits over the road view.
 */
export function OwnFieldPhoto({ photo, actions }: { photo: FieldPhotoState; actions: OwnPhotoActions }) {
  const { own, ownStand, ownFov, ownStatus } = photo
  const comparing = !!own && !!photo.match
  const moveTo = (point: { lng: number; lat: number }) => {
    photo.setOwnPose(point)
    // While compared, the road view follows the photo to its new spot.
    if (comparing) actions.onLineUp(point)
  }
  return (
    <div className="space-y-2" aria-label="Your own photo">
      <p className="text-2xs font-semibold tracking-wide text-muted-foreground uppercase">Your own photo</p>
      <FileButton
        label="Line up a photo of my own"
        accept={ACCEPT}
        className="w-full touch:h-10"
        disabled={ownStatus.loading}
        onFiles={([file]) => {
          if (file) void photo.openOwnFile(file, actions.roadView)
        }}
      >
        {ownStatus.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
        Line up a photo of my own
      </FileButton>
      {actions.records.length > 0 && (
        <div>
          <p className="mb-1 text-2xs text-muted-foreground">Or a photograph from Field records:</p>
          <ul className="space-y-1">
            {actions.records.map((record) => (
              <li key={record.id} className="flex items-center gap-2">
                <img src={record.image} alt="" className="h-8 w-12 shrink-0 rounded-sm object-cover" />
                <span className="min-w-0 flex-1 truncate">{record.name}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0 px-2 text-2xs touch:h-10"
                  aria-label={`Open ${record.name}`}
                  onClick={() => photo.openOwnRecord(record, actions.roadView)}
                >
                  Open
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {ownStatus.error && <InlineAlert tone="error">{ownStatus.error}</InlineAlert>}
      {own && ownFov && (
        <div className="space-y-2 rounded-md border border-border p-2" aria-label="Own photo pose">
          <img src={own.src} alt={`Your photo ${own.name}`} className="w-full rounded-sm" />
          <p className="truncate text-3xs text-muted-foreground">
            {own.name} · read in this browser, not uploaded
            {own.recordId ? ' · field record' : ''}
          </p>
          <KeyValueRows
            variant="divided"
            rows={[
              own.exif?.takenAt ? { label: 'Taken', value: `${own.exif.takenAt} (camera clock)` } : null,
              own.exif?.camera ? { label: 'Camera', value: own.exif.camera } : null,
              own.exif && own.exif.altitudeMeters !== null
                ? {
                    label: 'GPS altitude',
                    value: `${Math.round(own.exif.altitudeMeters)} m, for reference only`,
                  }
                : null,
              photo.ownOnRoad
                ? {
                    label: 'From the road line',
                    value: `${photo.ownOnRoad.offsetMeters.toFixed(0)} m off, ${formatKm(photo.ownOnRoad.distanceAlongMeters)} along`,
                  }
                : null,
            ]}
          />
          {!own.recordId && !own.exif?.position && !own.exif?.heading && !own.exif?.fov && (
            <p className="text-3xs leading-4 text-muted-foreground">
              No camera EXIF in this file: the pose starts from the road view. Set the spot, then turn and widen the
              view until the photo sits on the road view.
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <NullableNumberField
              label="Latitude"
              step={0.0001}
              updateOn="commit"
              value={own.pose.lat}
              onValueChange={(lat) => {
                if (lat !== null && Math.abs(lat) <= 90 && own.pose.lng !== null) moveTo({ lng: own.pose.lng, lat })
                else photo.setOwnPose({ lat })
              }}
            />
            <NullableNumberField
              label="Longitude"
              step={0.0001}
              updateOn="commit"
              value={own.pose.lng}
              onValueChange={(lng) => {
                if (lng !== null && Math.abs(lng) <= 180 && own.pose.lat !== null) moveTo({ lng, lat: own.pose.lat })
                else photo.setOwnPose({ lng })
              }}
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-3xs text-muted-foreground">
              Position: {own.sources.position ? SOURCE_TEXT[own.sources.position] : 'not known yet'}
            </p>
            {actions.onPickPoint && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 shrink-0 px-2 text-2xs touch:h-10"
                aria-pressed={actions.pickActive}
                onClick={() => actions.onPickPoint?.(actions.pickActive ? null : ([lng, lat]) => moveTo({ lng, lat }))}
              >
                <Crosshair className="h-3.5 w-3.5" />
                {actions.pickActive ? 'Click the plan…' : 'Pick on the plan'}
              </Button>
            )}
          </div>
          <NumberField
            label="Heading, degrees from true north"
            step={0.5}
            min={0}
            max={360}
            value={Math.round(own.pose.bearing * 10) / 10}
            description={headingNote(own)}
            onValueChange={(bearing) => photo.setOwnPose({ bearing })}
          />
          {own.sources.heading === 'exif' && own.headingReference !== 'true' && (
            <NullableNumberField
              label="Magnetic declination, degrees east"
              step={0.5}
              min={-60}
              max={60}
              value={own.declinationEast}
              description="Added to the recorded heading. Look it up for the photo's place and date (NRCan's calculator gives it)."
              onValueChange={photo.setDeclination}
            />
          )}
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Pitch, ° above horizon"
              step={0.25}
              min={-45}
              max={30}
              value={Math.round(own.pose.pitch * 100) / 100}
              description={SOURCE_TEXT[own.sources.pitch]}
              onValueChange={(pitch) => photo.setOwnPose({ pitch })}
            />
            <NumberField
              label="Roll, °"
              step={0.25}
              min={-30}
              max={30}
              value={Math.round(own.pose.roll * 100) / 100}
              description={SOURCE_TEXT[own.sources.roll]}
              onValueChange={(roll) => photo.setOwnPose({ roll })}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Field of view across, °"
              step={0.5}
              min={3}
              max={150}
              value={Math.round(own.pose.hfov * 10) / 10}
              description={`${ownFov.vertical.toFixed(1)}° down · ${fovNote(own)}`}
              onValueChange={(hfov) => photo.setOwnPose({ hfov })}
            />
            <NumberField
              label="Eye height above ground, m"
              step={0.1}
              min={0.3}
              max={100}
              value={own.pose.eyeHeightMeters}
              description={SOURCE_TEXT[own.sources.eyeHeight]}
              onValueChange={(eyeHeightMeters) => photo.setOwnPose({ eyeHeightMeters })}
            />
          </div>
          {ownStand?.status === 'no-position' && (
            <InlineAlert>Pick the spot the photo was taken from on the plan, or type it.</InlineAlert>
          )}
          {ownStand?.status === 'too-far' && (
            <InlineAlert tone="warning">
              This spot is {formatKm(ownStand.offRoadMeters)} from the road line; the road view walks at most 2 km off
              it.
            </InlineAlert>
          )}
          {ownStand?.status === 'no-terrain' && (
            <InlineAlert tone="warning">
              The road view’s terrain does not reach this spot ({formatKm(ownStand.offRoadMeters)} off the road line).
            </InlineAlert>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              className="flex-1 touch:h-10"
              disabled={!actions.canLineUp || ownStand?.status === 'no-position' || ownStand?.status === 'too-far'}
              onClick={() => {
                if (own.pose.lng !== null && own.pose.lat !== null)
                  actions.onLineUp({ lng: own.pose.lng, lat: own.pose.lat })
              }}
            >
              <Camera className="h-4 w-4" />
              {comparing ? 'Stand at my photo again' : 'Line up my photo'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="touch:h-10"
              aria-label="Close my photo"
              onClick={photo.clear}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          {own.recordId && actions.onSaveToRecord && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full touch:h-10"
              disabled={own.pose.lng === null || own.pose.lat === null}
              onClick={() => {
                const ground =
                  photo.drawing && photo.own ? photo.drawing.pose.altitudeMeters - own.pose.eyeHeightMeters : null
                actions.onSaveToRecord?.(own.recordId!, {
                  lng: own.pose.lng,
                  lat: own.pose.lat,
                  bearing: Math.round(own.pose.bearing * 10) / 10,
                  pitch: Math.round(own.pose.pitch * 100) / 100,
                  roll: Math.round(own.pose.roll * 100) / 100,
                  hfov: Math.round(own.pose.hfov * 10) / 10,
                  ...(ground !== null
                    ? {
                        altitude: Math.round((ground + own.pose.eyeHeightMeters) * 10) / 10,
                        verticalReference: `Road-view terrain + ${own.pose.eyeHeightMeters} m eye height (lined up)`,
                      }
                    : {}),
                })
              }}
            >
              <Save className="h-4 w-4" />
              Save this pose to the field record
            </Button>
          )}
          <p className="text-3xs leading-4 text-muted-foreground">
            The eye stands where the photo was taken, off the road if need be. Every value is a suggestion: phone GPS is
            often 5–20 m out and a cropped photo no longer has its lens’s field of view. Turn, tilt and widen the view
            until the drawn skyline sits on the photographed one.
          </p>
        </div>
      )}
    </div>
  )
}

function headingNote(own: NonNullable<FieldPhotoState['own']>): string {
  const source = SOURCE_TEXT[own.sources.heading]
  if (own.sources.heading !== 'exif' || own.headingReference === 'true') return source
  const recorded = own.exif?.heading?.degrees
  const what = own.headingReference === 'magnetic' ? 'magnetic' : 'of unrecorded reference'
  return own.declinationEast !== null
    ? `EXIF heading ${recorded?.toFixed(1)}° ${what}, plus ${own.declinationEast}° declination`
    : `EXIF heading is ${what}, not true north: add the local declination below`
}

function fovNote(own: NonNullable<FieldPhotoState['own']>): string {
  if (own.sources.fov !== 'exif') return SOURCE_TEXT[own.sources.fov]
  return own.exif?.fov?.from === '35mm' ? 'EXIF 35 mm equivalent' : 'EXIF focal length and sensor'
}
