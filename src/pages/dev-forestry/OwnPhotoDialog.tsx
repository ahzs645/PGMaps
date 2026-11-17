/**
 * Lining up a photo of the reviewer's own, as one window (handbook 3.3.4): the photo on the left with the terrain's
 * skyline drawn over it, and three steps on the right — where it was taken, which way it looked, and a check of the
 * camera — ending in *Line up in the road view*. The sidebar keeps only a summary (`OwnFieldPhoto`).
 *
 * A step that needs the plan (a spot picked, a point paired, the photo laid on it) hides this window until the plan
 * has answered; the state it works on lives in `useFieldPhoto`, so nothing is lost while it is away.
 * `docs/forestry-visual-quality.md`, "A photo of your own".
 */
import { useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowRight,
  Camera,
  Check,
  CircleAlert,
  Crosshair,
  FileInput,
  ImagePlus,
  Loader2,
  Mountain,
  Save,
  Trash2,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { DialogShell } from '@/components/ui/dialog-shell'
import { FileButton } from '@/components/ui/file-button'
import { FileDropField } from '@/components/ui/file-drop-field'
import { CheckboxField, NullableNumberField, NumberField } from '@/components/ui/form-field'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert, KeyValueRows } from '@/components/ui/map-panels'
import { TabBar } from '@/components/ui/tab-bar'
import { PHOTO_FILE_ACCEPT } from '@/lib/heic/heicFile'
import { cn } from '@/lib/utils'

import type { FieldRecord } from './assessmentTools'
import type { PoseSource } from './exifPose'
import { matchedCameraChecks, parseMatchedCamera } from './matchedCamera'
import { formatKm } from './measureFormat'
import type { OwnPhotoActions } from './OwnFieldPhoto'
import { OWN_PHOTO_STEPS, ownPhotoSteps, type OwnPhotoStep, type OwnPhotoStepState } from './ownPhotoSteps'
import {
  CameraChecks,
  HeldAngles,
  PairedPoints,
  SkylineSearch,
  heldAngleCount,
  solveLooksWrong,
  type StartPlanPick,
} from './PhotoCameraTools'
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

type Method = 'skyline' | 'points' | 'matched'
const METHODS: ReadonlyArray<{ value: Method; label: string }> = [
  { value: 'skyline', label: 'Skyline search' },
  { value: 'points', label: 'Paired points' },
  { value: 'matched', label: 'Matched camera' },
]

/** Reads the steps' states from the hook: one answer for the tabs, the Next button and the sidebar summary. */
export function readOwnPhotoSteps(photo: FieldPhotoState) {
  const own = photo.own
  if (!own) return null
  const search = photo.cameraSearch.status === 'done' ? photo.cameraSearch.result : null
  const solve = photo.controlSolve
  return ownPhotoSteps({
    position: own.pose.lng === null || own.pose.lat === null ? null : own.sources.position,
    heading: own.sources.heading,
    airborne: own.pose.altitudeMeters !== null && own.pose.altitudeMeters !== undefined,
    search: search ? { trustworthy: search.trustworthy, ambiguous: search.ambiguous } : null,
    pairs: photo.pairs.length,
    solved: solve ? { points: solve.pairs.length, suspect: solveLooksWrong(solve) } : null,
    matched: own.matched ? { checks: own.matched.checks.length } : null,
    bearing: own.pose.bearing,
    checkedBearings: [
      ...(photo.photoDrape?.which === 'camera' ? [photo.photoDrape.bearing] : []),
      ...(photo.modelViews.camera ? [photo.modelViews.camera.bearing] : []),
    ],
  })
}

/** The camera in one line, for the dialog's footer and the sidebar's summary. */
export function ownCameraLine(own: Own): string {
  const { bearing, pitch, roll, hfov } = own.pose
  return `Heading ${bearing.toFixed(1)}° · pitch ${pitch >= 0 ? '+' : '−'}${Math.abs(pitch).toFixed(1)}° · roll ${roll >= 0 ? '+' : '−'}${Math.abs(roll).toFixed(1)}° · ${hfov.toFixed(1)}° across`
}

/** Why the road view cannot stand at the photo, or null when it can. */
export function lineUpBlocked(photo: FieldPhotoState, canLineUp: boolean): string | null {
  const stand = photo.ownStand
  if (stand?.status === 'no-position') return 'Set where the photo was taken first.'
  if (stand?.status === 'too-far')
    return `This spot is ${formatKm(stand.offRoadMeters)} from the road line; the road view walks at most 2 km off it. The camera tools here work at any distance.`
  if (!canLineUp) return 'The scene needs a road or a viewpoint, and a cutblock, before a road view can open.'
  return null
}

const STATE_MARK: Record<OwnPhotoStepState, { icon: typeof Check; className: string; label: string }> = {
  done: { icon: Check, className: 'text-success', label: 'done' },
  attention: { icon: CircleAlert, className: 'text-warning', label: 'needs attention' },
  todo: { icon: ArrowRight, className: 'text-muted-foreground', label: 'to do' },
}

export function OwnPhotoDialog({ photo, actions }: { photo: FieldPhotoState; actions: OwnPhotoActions }) {
  const { own, ownFov, ownStatus, ownStand } = photo
  const step = photo.ownDialog.step
  const [method, setMethod] = useState<Method>('skyline')
  const [showSkyline, setShowSkyline] = useState(true)
  const [matchedError, setMatchedError] = useState<string | null>(null)
  // A pick this window asked the plan for: it stays out of the way until the plan has answered or cancelled.
  const [pickRequested, setPickRequested] = useState(false)
  const steppedAside = pickRequested && !!actions.pickActive
  const reading = readOwnPhotoSteps(photo)
  const comparing = !!own && !!photo.match

  const openFile = (file: File | undefined) => {
    if (!file) return
    void photo.openOwnFile(file, actions.roadView).then((opened) => {
      if (!opened) return
      actions.onOriginalPhoto(file)
      photo.openOwnDialog('position')
    })
  }
  const startPick: StartPlanPick | undefined = actions.onPickPoint
    ? (onPoint, hint) => {
        setPickRequested(true)
        actions.onPickPoint?.(onPoint, hint)
      }
    : undefined
  const moveTo = (point: { lng: number; lat: number }) => {
    photo.setOwnPose(point)
    // While compared, the road view follows the photo to its new spot.
    if (comparing) actions.onLineUp(point)
  }
  const applyMatchedFile = async (file: File) => {
    if (!own) return
    try {
      const camera = parseMatchedCamera(await file.text())
      const checks = matchedCameraChecks(camera, { name: own.name, gpsPosition: own.exif?.position ?? null })
      setMatchedError(null)
      photo.applyMatchedCamera(camera, file.name, checks)
      if (comparing) actions.onLineUp({ lng: camera.lng, lat: camera.lat })
    } catch (error) {
      setMatchedError(error instanceof Error ? error.message : String(error))
    }
  }
  const placePoint = (pixel: [number, number]) => {
    if (!startPick) return
    photo.setPendingPixel(pixel)
    startPick(
      ([lng, lat]) => void photo.addPair(pixel, lng, lat),
      `Click the same spot on the plan (point ${photo.pairs.length + 1})`,
    )
  }

  const hasAltitude = own?.pose.altitudeMeters !== null && own?.pose.altitudeMeters !== undefined
  const fromAir = hasAltitude && own?.sources.eyeHeight === 'exif'
  const blocked = lineUpBlocked(photo, actions.canLineUp)
  const stepIndex = OWN_PHOTO_STEPS.findIndex((entry) => entry.step === step)
  const following = OWN_PHOTO_STEPS[stepIndex + 1] ?? null
  const pairing = step === 'direction' && method === 'points' && !!startPick

  return (
    <>
      <DialogShell
        open={!steppedAside}
        onClose={photo.closeOwnDialog}
        size="xl"
        className="workspace-sm:max-w-6xl"
        title="Line up a photo of my own"
        subtitle={
          own
            ? `${own.name} · read in this browser, not uploaded${own.recordId ? ' · field record' : ''}`
            : 'Read in this browser, never uploaded'
        }
        toolbar={
          own && reading ? (
            <TabBar<OwnPhotoStep>
              label="Steps to line the photo up"
              idPrefix="own-photo"
              value={step}
              onChange={(next) => photo.openOwnDialog(next)}
              stretch
              options={OWN_PHOTO_STEPS.map((entry, index) => {
                const mark = STATE_MARK[reading.steps[entry.step].state]
                return {
                  value: entry.step,
                  label: `${index + 1} · ${entry.label}`,
                  ariaLabel: `Step ${index + 1}, ${entry.title}: ${mark.label}`,
                  badge: <mark.icon className={cn('h-3.5 w-3.5', mark.className)} aria-hidden="true" />,
                }
              })}
            />
          ) : undefined
        }
        footer={
          own && ownFov ? (
            <div className="space-y-2">
              {blocked && <p className="text-xs leading-5 text-muted-foreground">{blocked}</p>}
              <div className="flex flex-wrap items-center gap-2">
                <p
                  className="mr-auto min-w-0 text-xs text-muted-foreground tabular-nums"
                  aria-label="Camera as it stands"
                >
                  {ownCameraLine(own)}
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="touch:h-10"
                  onClick={() => {
                    photo.clear()
                    photo.closeOwnDialog()
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                  Remove photo
                </Button>
                {own.recordId && actions.onSaveToRecord && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="touch:h-10"
                    disabled={own.pose.lng === null || own.pose.lat === null}
                    onClick={() => actions.onSaveToRecord?.(own.recordId!, recordPatch(photo, own))}
                  >
                    <Save className="h-4 w-4" />
                    Save this pose to the field record
                  </Button>
                )}
                {following && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="touch:h-10"
                    onClick={() => photo.openOwnDialog(following.step)}
                  >
                    Next: {following.label.toLowerCase()}
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  className="touch:h-10"
                  disabled={!!blocked}
                  onClick={() => {
                    if (own.pose.lng === null || own.pose.lat === null) return
                    actions.onLineUp({ lng: own.pose.lng, lat: own.pose.lat })
                    photo.closeOwnDialog()
                  }}
                >
                  <Camera className="h-4 w-4" />
                  {comparing ? 'Stand at my photo again' : 'Line up in the road view'}
                </Button>
              </div>
            </div>
          ) : undefined
        }
        contentProps={{ 'data-testid': 'own-photo-dialog' }}
      >
        {!own || !ownFov ? (
          <PhotoChooser photo={photo} records={actions.records} onFile={openFile} roadView={actions.roadView} />
        ) : (
          <div className="grid gap-5 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]" aria-label="Own photo pose">
            <PhotoStage
              photo={photo}
              own={own}
              pairing={pairing}
              onPlace={placePoint}
              showSkyline={showSkyline}
              onShowSkyline={setShowSkyline}
              onFile={openFile}
            />
            <div className="min-w-0 space-y-4 text-sm">
              {ownStatus.error && <InlineAlert tone="error">{ownStatus.error}</InlineAlert>}
              {reading && (
                <header>
                  <h3 className="text-base font-semibold">{OWN_PHOTO_STEPS[stepIndex].title}</h3>
                  <p className="text-xs text-muted-foreground">{capitalise(reading.steps[step].note)}.</p>
                </header>
              )}

              <StepPanel step="position" current={step}>
                <KeyValueRows
                  variant="divided"
                  valueMaxWidth="max-w-[18rem]"
                  rows={[
                    own.exif?.takenAt ? { label: 'Taken', value: `${own.exif.takenAt} (camera clock)` } : null,
                    own.exif?.camera ? { label: 'Camera', value: own.exif.camera } : null,
                    own.exif && own.exif.altitudeMeters !== null
                      ? { label: 'GPS altitude', value: `${Math.round(own.exif.altitudeMeters)} m above sea level` }
                      : null,
                    photo.ownOnRoad
                      ? {
                          label: 'From the road line',
                          value: `${formatKm(photo.ownOnRoad.offsetMeters)} off, ${formatKm(photo.ownOnRoad.distanceAlongMeters)} along`,
                        }
                      : null,
                    own.decodedFrom === 'heic'
                      ? {
                          label: 'File',
                          value: `HEIC, decoded in this browser${own.srgb === false ? '; colours as coded' : ''}`,
                        }
                      : null,
                  ]}
                />
                {!own.recordId && !own.exif?.position && !own.exif?.heading && !own.exif?.fov && (
                  <InlineAlert>
                    No camera EXIF in this file: the camera starts from the road view. Set the spot here, then find the
                    direction in the next step.
                  </InlineAlert>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <NullableNumberField
                    label="Latitude"
                    step={0.0001}
                    updateOn="commit"
                    value={roundDegrees(own.pose.lat)}
                    onValueChange={(lat) => {
                      if (lat !== null && Math.abs(lat) <= 90 && own.pose.lng !== null)
                        moveTo({ lng: own.pose.lng, lat })
                      else photo.setOwnPose({ lat })
                    }}
                  />
                  <NullableNumberField
                    label="Longitude"
                    step={0.0001}
                    updateOn="commit"
                    value={roundDegrees(own.pose.lng)}
                    onValueChange={(lng) => {
                      if (lng !== null && Math.abs(lng) <= 180 && own.pose.lat !== null)
                        moveTo({ lng, lat: own.pose.lat })
                      else photo.setOwnPose({ lng })
                    }}
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    Position: {own.sources.position ? SOURCE_TEXT[own.sources.position] : 'not known yet'}
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
                    This altitude is {Math.round(1 - photo.ownEyeHeight)} m below a metre over the road view’s ground
                    there; the road view stands the eye a metre up. Check the altitude, or the terrain under the spot.
                  </InlineAlert>
                )}
                {ownStand?.status === 'no-terrain' && (
                  <InlineAlert tone="warning">
                    The road view’s terrain does not reach this spot ({formatKm(ownStand.offRoadMeters)} off the road
                    line).
                  </InlineAlert>
                )}
              </StepPanel>

              <StepPanel step="direction" current={step}>
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
                {own.pose.lng === null || own.pose.lat === null ? (
                  <InlineAlert>
                    Set where the photo was taken first: the tools below search the terrain round it.
                  </InlineAlert>
                ) : (
                  <section className="space-y-3 rounded-md border border-border p-3" data-testid="photo-camera-tools">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-sm font-semibold">Find it for me</h4>
                      <InfoTip label="About these tools">
                        None of these needs the road view, so they work for a photo taken far from the scene’s road.
                        Every result is a suggestion: judge it against the photo, and in the Check step.
                      </InfoTip>
                    </div>
                    <TabBar<Method>
                      label="How to find the direction"
                      variant="underline"
                      value={method}
                      onChange={setMethod}
                      options={METHODS.map((entry) => ({
                        ...entry,
                        badge:
                          entry.value === 'points' && photo.pairs.length ? (
                            <span className="text-2xs text-muted-foreground">{photo.pairs.length}</span>
                          ) : undefined,
                      }))}
                    />
                    <div hidden={method !== 'skyline'}>
                      <SkylineSearch photo={photo} />
                    </div>
                    <div hidden={method !== 'points'}>
                      <PairedPoints photo={photo} />
                    </div>
                    <div hidden={method !== 'matched'} className="space-y-2">
                      <p className="text-xs leading-5 text-muted-foreground">
                        A case file from the photo-matching bench replaces every value: position, altitude, heading,
                        pitch, roll and lens.
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
                    </div>
                    {method !== 'matched' && (
                      <details className="group border-t border-border pt-2">
                        <summary className="cursor-pointer text-xs font-medium text-foreground select-none">
                          Hold an angle near a value
                          {heldAngleCount(photo.priors) > 0 && (
                            <span className="ml-1 font-normal text-muted-foreground">
                              · {heldAngleCount(photo.priors)} held
                            </span>
                          )}
                        </summary>
                        <div className="pt-2">
                          <HeldAngles photo={photo} onPick={startPick} />
                        </div>
                      </details>
                    )}
                  </section>
                )}
              </StepPanel>

              <StepPanel step="check" current={step}>
                {own.pose.lng === null || own.pose.lat === null ? (
                  <InlineAlert>Set where the photo was taken first.</InlineAlert>
                ) : (
                  <CameraChecks photo={photo} onShownOnPlan={photo.closeOwnDialog} />
                )}
              </StepPanel>

              {photo.toolsBusy && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {photo.toolsBusy}
                </p>
              )}
              {photo.toolsError && <InlineAlert tone="warning">{photo.toolsError}</InlineAlert>}
            </div>
          </div>
        )}
      </DialogShell>
      {steppedAside && own && <PickReference own={own} photo={photo} />}
    </>
  )
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/** A coordinate as shown: seven decimals is a centimetre, past anything a photo's position knows. */
const roundDegrees = (value: number | null) => (value === null ? null : Math.round(value * 1e7) / 1e7)

/** A step's panel: every one stays mounted, so a half-typed value survives a look at another step. */
function StepPanel({
  step,
  current,
  children,
}: {
  step: OwnPhotoStep
  current: OwnPhotoStep
  children: React.ReactNode
}) {
  return (
    <div
      role="tabpanel"
      id={`own-photo-panel-${step}`}
      aria-labelledby={`own-photo-tab-${step}`}
      hidden={step !== current}
      className="space-y-3"
    >
      {children}
    </div>
  )
}

/** Before a photo is open: pick or drop a file, or take a field record's photograph. */
function PhotoChooser({
  photo,
  records,
  onFile,
  roadView,
}: {
  photo: FieldPhotoState
  records: FieldRecord[]
  onFile: (file: File | undefined) => void
  roadView: OwnPhotoActions['roadView']
}) {
  const { ownStatus } = photo
  return (
    <div className="mx-auto max-w-xl space-y-4 py-4 text-sm">
      <FileDropField
        label="Photo"
        accept={PHOTO_FILE_ACCEPT}
        multiple={false}
        filesLabel="Choose a photo"
        dropHint="or drop one here"
        disabled={ownStatus.loading}
        className="justify-center p-6"
        onFiles={([picked]) => onFile(picked?.file)}
        inputProps={{ 'data-testid': 'own-photo-file' }}
      />
      {ownStatus.loading && (
        <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" />
          {ownStatus.stage ?? 'Reading the photo…'}
        </p>
      )}
      {ownStatus.error && <InlineAlert tone="error">{ownStatus.error}</InlineAlert>}
      <p className="text-xs leading-5 text-muted-foreground">
        JPEG, PNG, WebP or HEIC, an iPhone’s own format, which is decoded here where the browser cannot show it. The
        photo’s EXIF gives the starting camera: where it was taken, the phone’s heading, the lens and the time. Then
        three steps settle the camera: its position, its direction, and a check against the map.
      </p>
      {records.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium">Or a photograph from Field records</p>
          <ul className="divide-y divide-border/70 rounded-md border border-border">
            {records.map((record) => (
              <li key={record.id} className="flex items-center gap-3 px-2 py-1.5 text-xs">
                <img src={record.image} alt="" className="h-9 w-14 shrink-0 rounded-sm object-cover" />
                <span className="min-w-0 flex-1 truncate">{record.name}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="touch:h-10"
                  aria-label={`Open ${record.name}`}
                  onClick={() => {
                    photo.openOwnRecord(record, roadView)
                    photo.openOwnDialog('position')
                  }}
                >
                  Open
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/** The pair marks over a photo: numbered for a pair, "?" for a spot still waiting for its place on the plan. */
function PairMarks({ photo, own }: { photo: FieldPhotoState; own: Own }) {
  const marks = [
    ...photo.pairs.map((pair, i) => ({ id: pair.id, pixel: pair.pixel, label: String(i + 1), pending: false })),
    ...(photo.pendingPixel ? [{ id: 'pending', pixel: photo.pendingPixel, label: '?', pending: true }] : []),
  ]
  return marks.map((mark) => (
    <span
      key={mark.id}
      className={cn(
        'pointer-events-none absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white text-2xs font-bold text-white shadow',
        mark.pending ? 'bg-warning' : 'bg-primary',
      )}
      style={{ left: `${(mark.pixel[0] / own.width) * 100}%`, top: `${(mark.pixel[1] / own.height) * 100}%` }}
    >
      {mark.label}
    </span>
  ))
}

/**
 * The photo, as large as the window allows, with the terrain's skyline for the camera as it stands, the sun where
 * the search puts it, and the paired points. While points are being paired a click places one.
 */
function PhotoStage({
  photo,
  own,
  pairing,
  onPlace,
  showSkyline,
  onShowSkyline,
  onFile,
}: {
  photo: FieldPhotoState
  own: Own
  pairing: boolean
  onPlace: (pixel: [number, number]) => void
  showSkyline: boolean
  onShowSkyline: (show: boolean) => void
  onFile: (file: File | undefined) => void
}) {
  const skyline = photo.ownSkyline
  const sun = photo.cameraSearch.status === 'done' ? photo.cameraSearch.sun?.best : null
  const click = (event: MouseEvent<HTMLImageElement>) => {
    if (!pairing) return
    const box = event.currentTarget.getBoundingClientRect()
    onPlace([
      ((event.clientX - box.left) / box.width) * own.width,
      ((event.clientY - box.top) / box.height) * own.height,
    ])
  }
  const hasPosition = own.pose.lng !== null && own.pose.lat !== null
  return (
    <div className="min-w-0 space-y-2 self-start md:sticky md:top-0">
      <div className="flex justify-center rounded-md bg-muted/50">
        <div className="relative inline-block max-w-full">
          <img
            src={own.src}
            alt={pairing ? 'Your photo: click a spot to pair it with the plan' : `Your photo ${own.name}`}
            className={cn('block h-auto max-h-[52dvh] w-auto max-w-full rounded-sm', pairing && 'cursor-crosshair')}
            draggable={false}
            onClick={click}
          />
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox={`0 0 ${own.width} ${own.height}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {showSkyline && skyline && skyline.length > 1 && (
              <polyline
                data-testid="own-photo-skyline"
                points={skyline.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')}
                fill="none"
                stroke="#facc15"
                strokeWidth={2}
                strokeDasharray="7 4"
                vectorEffect="non-scaling-stroke"
              />
            )}
            {sun?.inFrame && sun.pixel && (
              <circle
                cx={sun.pixel.x}
                cy={sun.pixel.y}
                r={own.width / 45}
                fill="none"
                stroke="#fde047"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
          <PairMarks photo={photo} own={own} />
        </div>
      </div>
      {pairing && (
        <p className="text-xs font-medium text-foreground">
          Click a spot in the photo; this window then steps aside for you to click the same spot on the plan.
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {skyline ? (
          <CheckboxField
            label="Terrain skyline"
            description="Yellow: the terrain’s skyline for the camera as it stands, to 85 km. It follows every change."
            checked={showSkyline}
            onCheckedChange={onShowSkyline}
          />
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="touch:h-10"
            disabled={!hasPosition || photo.ownSkylineStatus.loading}
            title={hasPosition ? undefined : 'Set where the photo was taken first'}
            onClick={() => void photo.loadOwnSkyline()}
          >
            {photo.ownSkylineStatus.loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Mountain className="h-4 w-4" />
            )}
            Draw the terrain skyline on it
          </Button>
        )}
        <FileButton
          label="Choose another photo"
          accept={PHOTO_FILE_ACCEPT}
          variant="ghost"
          size="sm"
          className="touch:h-10"
          disabled={photo.ownStatus.loading}
          onFiles={([file]) => onFile(file)}
        >
          {photo.ownStatus.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
          {photo.ownStatus.loading ? (photo.ownStatus.stage ?? 'Reading the photo…') : 'Choose another photo…'}
        </FileButton>
      </div>
      {photo.ownSkylineStatus.error && <InlineAlert tone="warning">{photo.ownSkylineStatus.error}</InlineAlert>}
    </div>
  )
}

/**
 * While the window is out of the way for a click on the plan: the photo, small, in the corner over the sidebar, with
 * the spot being paired, so the same place can be found on the plan.
 */
function PickReference({ own, photo }: { own: Own; photo: FieldPhotoState }) {
  return createPortal(
    <div
      className="pointer-events-none fixed bottom-3 left-3 z-50 w-72 max-w-[60vw] overflow-hidden rounded-lg border bg-popover p-1.5 text-xs shadow-lg"
      role="status"
      aria-label="The photo, while a spot is picked on the plan"
      data-testid="own-photo-pick-reference"
    >
      <div className="relative">
        <img src={own.src} alt="" className="block max-h-[45vh] w-full rounded-sm object-contain" />
        <PairMarks photo={photo} own={own} />
      </div>
      <p className="px-1 pt-1.5 leading-4 text-muted-foreground">
        {photo.pendingPixel
          ? 'Click the spot marked “?” on the plan. This window comes back after the click.'
          : 'Click the plan. This window comes back after the click.'}
      </p>
    </div>,
    document.body,
  )
}

/** The camera as it stands, as the patch a field record takes. */
function recordPatch(photo: FieldPhotoState, own: Own): Partial<FieldRecord> {
  const hasAltitude = own.pose.altitudeMeters !== null && own.pose.altitudeMeters !== undefined
  const ground = Number.isFinite(photo.ownGroundMeters) ? photo.ownGroundMeters : null
  const altitude = hasAltitude ? own.pose.altitudeMeters! : ground !== null ? ground + own.pose.eyeHeightMeters : null
  return {
    lng: own.pose.lng,
    lat: own.pose.lat,
    bearing: Math.round(own.pose.bearing * 10) / 10,
    pitch: Math.round(own.pose.pitch * 100) / 100,
    roll: Math.round(own.pose.roll * 100) / 100,
    hfov: Math.round(own.pose.hfov * 10) / 10,
    ...(altitude !== null
      ? {
          altitude: Math.round(altitude * 10) / 10,
          verticalReference: hasAltitude
            ? own.sources.eyeHeight === 'matched'
              ? 'Matched camera altitude, above sea level (lined up)'
              : 'GPS altitude, above sea level (lined up)'
            : `Road-view terrain + ${own.pose.eyeHeightMeters} m eye height (lined up)`,
        }
      : {}),
  }
}

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
  if (own.sources.fov !== 'exif') return SOURCE_TEXT[own.sources.fov]
  return own.exif?.fov?.from === '35mm' ? 'EXIF 35 mm equivalent' : 'EXIF focal length and sensor'
}
