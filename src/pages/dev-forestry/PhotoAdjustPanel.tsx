/**
 * *Adjust*, behind the options card in the own-photo window (docs/forestry-visual-quality-own-photo-redesign-2026-11-17.md,
 * §2.2, §2.8): the hand tools for when no candidate is right. Where the photo was taken (latitude, longitude, altitude,
 * *Taken from the air*), the angle and lens numbers with the declination, drag-to-align on the photo, the skyline search
 * run again with angles held, a matched-camera file, and paired points. Each value says where it came from; none of
 * them is a verdict on the camera.
 */
import { useState } from 'react'
import { Crosshair, FileInput, Move } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { FileButton } from '@/components/ui/file-button'
import { CheckboxField, NullableNumberField, NumberField } from '@/components/ui/form-field'
import { InlineAlert, KeyValueRows } from '@/components/ui/map-panels'

import type { PoseSource } from './exifPose'
import { matchedCameraChecks, parseMatchedCamera } from './matchedCamera'
import { formatKm } from './measureFormat'
import { PairedPointsTable } from './PairedPointsTable'
import { HeldAngles, SkylineSearch, heldAngleCount, type StartPlanPick } from './PhotoCameraTools'
import type { FieldPhotoState } from './useFieldPhoto'

type Own = NonNullable<FieldPhotoState['own']>

export const SOURCE_TEXT: Record<PoseSource, string> = {
  exif: 'from the photo’s EXIF',
  record: 'from the field record',
  'road-view': 'the road view’s, as it stood',
  level: 'level; EXIF records no tilt',
  default: 'a default',
  reviewer: 'set by you',
  skyline: 'fitted to the skyline',
  matched: 'from the matched camera',
  landmark: 'toward the spot picked at the photo’s centre',
  controls: 'solved from the paired points',
}

/** A coordinate as shown: seven decimals is a centimetre, past anything a photo's position knows. */
const roundDegrees = (value: number | null) => (value === null ? null : Math.round(value * 1e7) / 1e7)

function headingNote(own: Own): string {
  const source = SOURCE_TEXT[own.sources.heading]
  if (own.sources.heading !== 'exif' || own.headingReference === 'true') return source
  const recorded = own.exif?.heading?.degrees
  const what = own.headingReference === 'magnetic' ? 'magnetic' : 'of unrecorded reference'
  return own.declinationEast !== null
    ? `EXIF heading ${recorded?.toFixed(1)}° ${what}, plus ${own.declinationEast}° declination`
    : `EXIF heading is ${what}, not true north: add the local declination below`
}

function fovNote(own: Own): string {
  if (own.lens?.cropped) return 'cropped since it was taken: lens unknown'
  if (own.sources.fov !== 'exif') return SOURCE_TEXT[own.sources.fov]
  return own.exif?.fov?.from === '35mm' ? 'EXIF 35 mm equivalent' : 'EXIF focal length and sensor'
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="space-y-3 border-t border-border pt-3 first:border-t-0 first:pt-0">
    <h4 className="text-sm font-semibold">{title}</h4>
    {children}
  </section>
)

export function PhotoAdjustPanel({
  photo,
  startPick,
  moveTo,
  align,
  onAlign,
  placing,
  onPlacing,
}: {
  photo: FieldPhotoState
  /** Asks the plan for a click while the window steps aside; absent when the plan cannot be asked. */
  startPick?: StartPlanPick
  /** Moves the camera's place. */
  moveTo: (point: { lng: number; lat: number }) => void
  /** Whether drag-to-align handles are on the photo. */
  align: boolean
  onAlign: (on: boolean) => void
  /** Whether the next click on the photo places a paired point. */
  placing: boolean
  onPlacing: (placing: boolean) => void
}) {
  const own = photo.own
  const [matchedError, setMatchedError] = useState<string | null>(null)
  if (!own || !photo.ownFov) return null
  const ownFov = photo.ownFov
  const placed = own.pose.lng !== null && own.pose.lat !== null
  const hasAltitude = own.pose.altitudeMeters !== null && own.pose.altitudeMeters !== undefined
  const fromAir = hasAltitude && own.sources.eyeHeight === 'exif'
  const applyMatchedFile = async (file: File) => {
    try {
      const camera = parseMatchedCamera(await file.text())
      const checks = matchedCameraChecks(camera, { name: own.name, gpsPosition: own.exif?.position ?? null })
      setMatchedError(null)
      photo.applyMatchedCamera(camera, file.name, checks)
    } catch (error) {
      setMatchedError(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div className="space-y-4 text-sm" aria-label="Adjust the camera" data-testid="photo-camera-tools">
      <Section title="Where it was taken">
        <div className="grid grid-cols-2 gap-3">
          <NullableNumberField
            label="Latitude"
            step={0.0001}
            updateOn="commit"
            value={roundDegrees(own.pose.lat)}
            onValueChange={(lat) => {
              if (lat !== null && Math.abs(lat) <= 90 && own.pose.lng !== null) moveTo({ lng: own.pose.lng, lat })
              else photo.setOwnPose({ lat })
            }}
          />
          <NullableNumberField
            label="Longitude"
            step={0.0001}
            updateOn="commit"
            value={roundDegrees(own.pose.lng)}
            onValueChange={(lng) => {
              if (lng !== null && Math.abs(lng) <= 180 && own.pose.lat !== null) moveTo({ lng, lat: own.pose.lat })
              else photo.setOwnPose({ lng })
            }}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Position: {own.sources.position ? SOURCE_TEXT[own.sources.position] : 'not known yet'}
            {photo.ownOnRoad ? ` · ${formatKm(photo.ownOnRoad.offsetMeters)} off the road line` : ''}
          </p>
          {startPick && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="touch:h-10"
              onClick={() =>
                startPick(([lng, lat]) => moveTo({ lng, lat }), 'Click where the photo was taken on the plan')
              }
            >
              <Crosshair className="h-4 w-4" />
              Pick on the plan
            </Button>
          )}
        </div>
        {own.exif?.altitudeMeters !== null && own.exif?.altitudeMeters !== undefined && (
          <CheckboxField
            label={<span className="font-medium">Taken from the air</span>}
            description={`Stand the eye at the photo’s GPS altitude, ${Math.round(own.exif.altitudeMeters)} m above sea level, not at eye height over the ground. Phone GPS altitude is too rough for eye level and fine from an aircraft.`}
            checked={fromAir}
            onCheckedChange={photo.setFromAir}
          />
        )}
        {hasAltitude ? (
          <NumberField
            label="Camera altitude, m above sea level"
            step={1}
            min={-500}
            max={9000}
            value={Math.round(own.pose.altitudeMeters! * 10) / 10}
            description={`${SOURCE_TEXT[own.sources.eyeHeight]}${photo.ownEyeHeight !== null && Number.isFinite(photo.ownGroundMeters) ? ` · ${Math.round(photo.ownEyeHeight)} m above the road view’s ground` : ''}`}
            onValueChange={(altitudeMeters) => photo.setOwnPose({ altitudeMeters })}
          />
        ) : (
          <NumberField
            label="Eye height above ground, m"
            step={0.1}
            min={0.3}
            max={100}
            value={own.pose.eyeHeightMeters}
            description={SOURCE_TEXT[own.sources.eyeHeight]}
            onValueChange={(eyeHeightMeters) => photo.setOwnPose({ eyeHeightMeters })}
          />
        )}
        {hasAltitude && photo.ownEyeHeight !== null && photo.ownEyeHeight < 1 && (
          <InlineAlert tone="warning">
            This altitude is {Math.round(1 - photo.ownEyeHeight)} m below a metre over the road view’s ground there.
            Check the altitude, or the terrain under the spot.
          </InlineAlert>
        )}
      </Section>

      <Section title="Which way it looked">
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="Heading, ° from true north"
            step={0.5}
            min={0}
            max={360}
            value={Math.round(own.pose.bearing * 10) / 10}
            description={headingNote(own)}
            onValueChange={(bearing) => photo.setOwnPose({ bearing })}
          />
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
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant={align ? 'default' : 'outline'}
            size="sm"
            className="touch:h-10"
            aria-pressed={align}
            disabled={!photo.ownSkyline}
            onClick={() => onAlign(!align)}
          >
            <Move className="h-4 w-4" />
            {align ? 'Dragging the skyline: done' : 'Drag the skyline into place'}
          </Button>
          <p className="min-w-0 flex-1 text-xs leading-5 text-muted-foreground">
            {photo.ownSkyline
              ? 'Move it by the cross, turn it by the side handles; then search near this camera to refine it.'
              : 'The skyline draws once the terrain round the photo has loaded.'}
          </p>
        </div>
      </Section>

      {placed ? (
        <>
          <Section title="Skyline search">
            <SkylineSearch photo={photo} />
            <details className="group">
              <summary className="cursor-pointer text-xs font-medium text-foreground select-none">
                Hold an angle near a value
                {heldAngleCount(photo.priors) > 0 && (
                  <span className="ml-1 font-normal text-muted-foreground">· {heldAngleCount(photo.priors)} held</span>
                )}
              </summary>
              <div className="pt-2">
                <HeldAngles photo={photo} onPick={startPick} />
              </div>
            </details>
          </Section>

          <Section title="Paired points">
            <PairedPointsTable photo={photo} placing={placing} onPlacing={onPlacing} canPick={!!startPick} />
          </Section>

          <Section title="Matched camera">
            <p className="text-xs leading-5 text-muted-foreground">
              A case file from the photo-matching bench replaces every value: position, altitude, heading, pitch, roll
              and lens.
            </p>
            <FileButton
              label="Use a matched camera"
              accept=".json,application/json"
              size="sm"
              className="touch:h-10"
              onFiles={([file]) => {
                if (file) void applyMatchedFile(file)
              }}
            >
              <FileInput className="h-4 w-4" />
              Use a matched camera…
            </FileButton>
            {matchedError && <InlineAlert tone="error">{matchedError}</InlineAlert>}
            {own.matched && (
              <div className="space-y-1" aria-label="Matched camera">
                <KeyValueRows
                  variant="divided"
                  valueMaxWidth="max-w-[18rem]"
                  rows={[
                    { label: 'Matched camera', value: `${own.matched.fileName} · ${own.matched.method}` },
                    {
                      label: 'Held-out accuracy',
                      value: own.matched.heldOut.length
                        ? own.matched.heldOut.map((g) => `${g.name} ${Math.round(g.metres)} m`).join(', ')
                        : 'not measured: skyline and GPS only',
                    },
                  ]}
                />
                {own.matched.checks.map((check) => (
                  <InlineAlert key={check} tone="warning">
                    {check}
                  </InlineAlert>
                ))}
              </div>
            )}
          </Section>
        </>
      ) : (
        <InlineAlert>Set where the photo was taken first: the tools below search the terrain round it.</InlineAlert>
      )}
    </div>
  )
}
