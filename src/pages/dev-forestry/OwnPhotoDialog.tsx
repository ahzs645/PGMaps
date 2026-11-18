/**
 * The reviewer's own photos, as one window in three tabs (handbook 3.3.4; docs/forestry-visual-quality-own-photo-
 * redesign-2026-11-17.md, §2.8): *Photos* takes many at once and shows where the automatic queue has each; *Camera*
 * shows the active photo with everything drawn over it, the candidate cameras (the options card), the comparison with
 * the model view and, behind *Adjust*, the hand tools; *Use* accepts the camera and links the photo to its jobs. The
 * footer's primary action follows the photo's state: add photos, the queue's place, check this camera, accept it, make
 * a viewpoint, stand there, the next photo. The sidebar keeps only a summary (`OwnFieldPhoto`).
 *
 * Nothing is accepted automatically: everything before *Accept* is done for the reviewer, and a step says what a
 * camera rests on, never that it is right (`ownPhotoSteps.ts`).
 *
 * A tool that needs the plan (a spot picked, a point paired) hides this window until the plan has answered; the state
 * it works on lives in `useFieldPhoto`, so nothing is lost while it is away. `docs/forestry-visual-quality.md`,
 * "A photo of your own".
 */
import { useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowRight,
  Camera,
  Check,
  Crosshair,
  Loader2,
  Map as MapIcon,
  MapPin,
  Search,
  SlidersHorizontal,
  Square,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { DialogShell } from '@/components/ui/dialog-shell'
import { InlineAlert } from '@/components/ui/map-panels'
import { TabBar } from '@/components/ui/tab-bar'
import { cn } from '@/lib/utils'

import type { OwnPhotoActions } from './OwnFieldPhoto'
import { ownPhotoSteps } from './ownPhotoSteps'
import { OWN_PHOTO_TABS, adjustsAt, ownPhotoPrimary, tabOf, type OwnPhotoTab } from './ownPhotoTabs'
import { PhotoAcceptPanel, PhotoUsePanel } from './PhotoAcceptPanel'
import { acceptPreview } from './photoAcceptPreview'
import { sameCamera } from './photoAcceptance'
import { PhotoAdjustPanel } from './PhotoAdjustPanel'
import type { StartPlanPick } from './PhotoCameraTools'
import { PhotoCompare } from './PhotoCompare'
import { PhotoCombinedPanel } from './PhotoCombinedPanel'
import { PhotoFlightMatchPanel } from './PhotoFlightMatchPanel'
import { PhotoOptionsCard, ownAcceptancePose } from './PhotoOptionsCard'
import { controlSolveSuspect } from './photoQueue'
import { PhotoStrip, queueLine } from './PhotoStrip'
import { PhotoWithOverlays } from './PhotoWithOverlays'
import type { FieldPhotoState } from './useFieldPhoto'

type Own = NonNullable<FieldPhotoState['own']>

/** Reads the steps' states from the hook: one answer for the sidebar summary. */
export function readOwnPhotoSteps(photo: FieldPhotoState) {
  const own = photo.own
  if (!own) return null
  const search = photo.cameraSearch.status === 'done' ? photo.cameraSearch.result : null
  const solve = photo.controlSolve
  const checked = photo.checksDrawnFor(own.id)
  return ownPhotoSteps({
    position: own.pose.lng === null || own.pose.lat === null ? null : own.sources.position,
    heading: own.sources.heading,
    airborne: own.pose.altitudeMeters !== null && own.pose.altitudeMeters !== undefined,
    search: search ? { trustworthy: search.trustworthy, ambiguous: search.ambiguous } : null,
    pairs: photo.pairs.length,
    solved: solve ? { points: solve.pairs.length, suspect: controlSolveSuspect(solve) } : null,
    matched: own.matched ? { checks: own.matched.checks.length } : null,
    bearing: own.pose.bearing,
    checkedBearings: checked ? [checked.bearing] : [],
  })
}

/** The camera in one line, for the window's footer and the sidebar's summary. */
export function ownCameraLine(own: Own): string {
  const { bearing, pitch, roll, hfov } = own.pose
  return `Heading ${bearing.toFixed(1)}° · pitch ${pitch >= 0 ? '+' : '−'}${Math.abs(pitch).toFixed(1)}° · roll ${roll >= 0 ? '+' : '−'}${Math.abs(roll).toFixed(1)}° · ${hfov.toFixed(1)}° across`
}

/**
 * Why the road view cannot stand at the photo, or null when it can. A photo is stood at through its view of interest
 * (a photo viewpoint, `viewFromAcceptedPhoto`), at its own place and altitude, so no distance from the road applies.
 */
export function lineUpBlocked(photo: FieldPhotoState, canLineUp: boolean): string | null {
  if (photo.ownStand?.status === 'no-position') return 'Set where the photo was taken first.'
  if (!canLineUp) return 'The scene needs a road or a viewpoint, and a cutblock, before a road view can open.'
  // Only an accepted camera becomes a viewpoint (`viewFromAcceptedPhoto`), and the road view stands at viewpoints.
  const accepted = photo.own ? photo.acceptanceState(photo.own.id) : 'none'
  if (accepted === 'none') return 'Accept the camera first.'
  if (accepted === 'lapsed') return 'The camera has moved since it was accepted: check it and accept it again.'
  return null
}

export function OwnPhotoDialog({ photo, actions }: { photo: FieldPhotoState; actions: OwnPhotoActions }) {
  const { own, ownPhotos } = photo
  const tab: OwnPhotoTab = own ? tabOf(photo.ownDialog.step) : 'photos'
  const setTab = (next: OwnPhotoTab) => photo.openOwnDialog(next)
  const [adjust, setAdjust] = useState(() => adjustsAt(photo.ownDialog.step))
  const [align, setAlign] = useState(false)
  const [placing, setPlacing] = useState(false)
  const [initials, setInitials] = useState('')
  const [note, setNote] = useState('')
  const [acceptError, setAcceptError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // A pick this window asked the plan for: it stays out of the way until the plan has answered or cancelled.
  const [pickRequested, setPickRequested] = useState(false)
  const steppedAside = pickRequested && !!actions.pickActive
  const comparing = !!own && !!photo.match

  // An older step name (the sidebar's Position or Direction) opens the hand tools; another photo starts clean.
  const [seen, setSeen] = useState({ step: photo.ownDialog.step, id: own?.id ?? null })
  if (seen.step !== photo.ownDialog.step || seen.id !== (own?.id ?? null)) {
    if (seen.step !== photo.ownDialog.step && adjustsAt(photo.ownDialog.step)) setAdjust(true)
    if (seen.id !== (own?.id ?? null)) {
      setNote('')
      setAcceptError(null)
      setNotice(null)
      setPlacing(false)
      setAlign(false)
    }
    setSeen({ step: photo.ownDialog.step, id: own?.id ?? null })
  }

  const current = ownAcceptancePose(own)
  const options = own ? photo.optionsFor(own.id) : []
  const checkedPose = own ? photo.checksDrawnFor(own.id) : null
  const checked = !!current && !!checkedPose && sameCamera(checkedPose, current)
  const preview = acceptPreview({
    pose: current,
    chosen: own?.chosen ?? null,
    headingSource: own?.sources.heading ?? 'default',
    rows: options,
    checkedPose,
    initials,
    note,
    photoWidth: own?.width ?? 0,
  })
  const entry = own ? photo.queue.entries.find((row) => row.recordId === own.id) : undefined
  const viewpointId = own?.uses.find((use) => use.job === 'viewpoint')?.targetId ?? null
  const blocked = own ? lineUpBlocked(photo, actions.canLineUp) : null
  const activeIndex = own ? ownPhotos.findIndex((entry) => entry.id === own.id) : -1
  const nextId =
    [...ownPhotos.slice(activeIndex + 1), ...ownPhotos.slice(0, Math.max(0, activeIndex))].find(
      (entry) => photo.acceptanceState(entry.id) !== 'accepted',
    )?.id ?? null
  const primary = ownPhotoPrimary({
    count: ownPhotos.length,
    activeId: own?.id ?? null,
    queue: {
      running: !!photo.queue.running && photo.queue.running === own?.id,
      position: photo.queue.position,
      total: photo.queue.total,
    },
    status: entry?.status ?? null,
    acceptance: own ? photo.acceptanceState(own.id) : 'none',
    checked,
    acceptReason: preview.gate.ok ? null : preview.gate.reason,
    viewpointId,
    standReason: blocked,
    nextId,
  })

  const startPick: StartPlanPick | undefined = actions.onPickPoint
    ? (onPoint, hint) => {
        setPickRequested(true)
        actions.onPickPoint?.(onPoint, hint)
      }
    : undefined
  const moveTo = (point: { lng: number; lat: number }) => photo.setOwnPose(point)
  const needsLandmarks =
    own?.pose.lng != null &&
    own?.pose.lat != null &&
    !!startPick &&
    (options.some((option) => option.kind === 'winner' && option.evidence.settled === false) ||
      photo.workFor(own.id).found?.skyline === false)
  const placePoint = (x: number, y: number) => {
    if (!startPick) return
    const pixel: [number, number] = [x, y]
    photo.setPendingPixel(pixel)
    setPlacing(false)
    startPick(
      ([lng, lat]) => void photo.addPair(pixel, lng, lat),
      `Click the same spot on the plan (point ${photo.pairs.length + 1})`,
    )
  }

  /** Draws the checks for the camera as it stands: what is drawn over the photo, and the model view. */
  const checkCamera = () => {
    if (!own) return
    setTab('camera')
    // Counted once what is drawn over the photo has its hit buffer for this exact camera (`requestCheck`), never on
    // the click alone.
    photo.requestCheck(own.id)
    const hasModel =
      !!photo.activePoseKey &&
      Object.values(photo.workFor(own.id).modelViews).some((model) => model.poseKey === photo.activePoseKey)
    if (!hasModel) void photo.renderModel('camera')
  }
  const accept = () => {
    if (!own) return
    const made = photo.acceptCamera(own.id, { initials, note })
    if (!made.ok) {
      setAcceptError(made.reason)
      return
    }
    setAcceptError(null)
    setNote('')
    setTab('use')
  }
  const makeViewpoint = () => {
    if (!own) return
    const made = photo.makeViewpoint(own.id)
    setNotice(
      made.ok
        ? made.added
          ? 'Added to the views of interest at this camera.'
          : 'Its view of interest now follows this camera.'
        : made.reason,
    )
  }
  const stand = () => {
    if (!own || own.pose.lng === null || own.pose.lat === null) return
    const refused = actions.onLineUp({ lng: own.pose.lng, lat: own.pose.lat })
    if (refused) setNotice(refused)
    else photo.closeOwnDialog()
  }
  const primaryClick = () => {
    switch (primary.kind) {
      case 'add':
        return setTab('photos')
      case 'check':
        return checkCamera()
      case 'accept':
        return tab === 'use' ? accept() : setTab('use')
      case 'viewpoint':
        return makeViewpoint()
      case 'stand':
        return stand()
      case 'next':
        return photo.selectOwnPhoto(primary.nextId)
      case 'search':
        return own && photo.rerun(own.id)
    }
  }
  const primaryDisabled =
    primary.kind === 'searching' ||
    primary.kind === 'none' ||
    (primary.kind === 'accept' && tab === 'use' && !!primary.reason) ||
    (primary.kind === 'stand' && !!primary.reason)
  const primaryReason =
    (primary.kind === 'accept' || primary.kind === 'stand' || primary.kind === 'viewpoint') && primary.reason
      ? primary.reason
      : null

  return (
    <>
      <DialogShell
        open={!steppedAside}
        onClose={photo.closeOwnDialog}
        size="xl"
        className="workspace-sm:max-w-6xl"
        title={ownPhotos.length > 1 ? 'Line up photos of my own' : 'Line up a photo of my own'}
        subtitle={
          own
            ? `${own.name}${ownPhotos.length > 1 ? ` · ${activeIndex + 1} of ${ownPhotos.length}` : ''} · read in this browser, not uploaded`
            : 'Read in this browser, never uploaded'
        }
        toolbar={
          ownPhotos.length ? (
            <TabBar<OwnPhotoTab>
              label="Own photo"
              idPrefix="own-photo"
              value={tab}
              onChange={setTab}
              stretch
              options={OWN_PHOTO_TABS.map((entry) => ({
                value: entry.tab,
                label: entry.label,
                disabled: entry.tab !== 'photos' && !own,
                badge:
                  entry.tab === 'photos' && photo.queue.running ? (
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                  ) : undefined,
              }))}
            />
          ) : undefined
        }
        footer={
          <div className="space-y-2">
            {primaryReason && <p className="text-xs leading-5 text-muted-foreground">{primaryReason}</p>}
            {notice && <p className="text-xs leading-5 text-muted-foreground">{notice}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <p
                className="mr-auto min-w-0 text-xs text-muted-foreground tabular-nums"
                aria-label="Camera as it stands"
              >
                {own ? ownCameraLine(own) : (queueLine(photo.queue) ?? '')}
              </p>
              {primary.kind === 'searching' && photo.queue.running && (
                <Button type="button" variant="ghost" size="sm" className="touch:h-10" onClick={photo.cancelQueue}>
                  <Square className="h-4 w-4" />
                  Cancel
                </Button>
              )}
              {own && primary.kind !== 'next' && nextId && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="touch:h-10"
                  onClick={() => photo.selectOwnPhoto(nextId)}
                >
                  Next photo
                  <ArrowRight className="h-4 w-4" />
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                className="touch:h-10"
                disabled={primaryDisabled}
                onClick={primaryClick}
                data-testid="own-photo-primary"
              >
                <PrimaryIcon kind={primary.kind} />
                {primary.kind === 'stand' && comparing ? 'Stand at my photo again' : primary.label}
              </Button>
            </div>
          </div>
        }
        contentProps={{ 'data-testid': 'own-photo-dialog' }}
      >
        <TabPanel tab="photos" current={tab}>
          <PhotoStrip
            photo={photo}
            records={actions.records}
            roadView={actions.roadView}
            onAdded={(added) => {
              // A first set opens on its earliest photo's camera; adding to a set stays here.
              if (added.length && !ownPhotos.length) setTab('camera')
            }}
          />
        </TabPanel>
        {own && (
          <TabPanel tab="camera" current={tab}>
            <div className="grid gap-5 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]" aria-label="Own photo camera">
              <div className="min-w-0 space-y-4 self-start md:sticky md:top-0">
                {placing && (
                  <p className="text-xs font-medium text-foreground">
                    Click a spot in the photo; this window then steps aside for you to click the same spot on the plan.
                  </p>
                )}
                <PhotoWithOverlays
                  photo={photo}
                  pageFeatures={actions.pageFeatures}
                  layersMenu="inline"
                  align={align}
                  showPairs
                  readOnClick={!placing}
                  imageClassName="max-h-[52dvh]"
                  onPickPixel={placing ? placePoint : undefined}
                  onPairPixel={startPick ? placePoint : undefined}
                  toolbar={
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      className="ml-auto touch:h-10"
                      disabled={own.pose.lng === null}
                      onClick={() => {
                        photo.showDrape('camera')
                        photo.closeOwnDialog()
                      }}
                    >
                      <MapIcon className="h-3.5 w-3.5" />
                      Show on the plan, beside the photo
                    </Button>
                  }
                />
                <PhotoCompare
                  key={own.id}
                  photo={photo}
                  active={tab === 'camera' && photo.ownDialog.open && !steppedAside}
                />
              </div>
              <div className="min-w-0 space-y-4 text-sm">
                {photo.ownStatus.error && <InlineAlert tone="error">{photo.ownStatus.error}</InlineAlert>}
                {needsLandmarks && !options.some((option) => option.kind === 'points' && !option.warnings.length) && (
                  <div className="space-y-2 rounded-md border border-border p-3">
                    <p className="text-xs leading-5 text-muted-foreground">
                      Use landmarks to check the heading. Pick a distinct shoreline bend, road junction or peak in the
                      photo and on the plan. Spread the pairs across the frame and use different distances.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="touch:h-10"
                      aria-pressed={placing}
                      onClick={() => {
                        setAdjust(true)
                        setAlign(false)
                        setPlacing(!placing)
                      }}
                    >
                      <Crosshair className="h-4 w-4" />
                      {placing ? 'Cancel landmark pick' : 'Pair a landmark'}
                    </Button>
                  </div>
                )}
                {tab === 'camera' && <PhotoFlightMatchPanel photo={photo} />}
                <PhotoOptionsCard photo={photo} onAdjust={() => setAdjust(true)} />
                {tab === 'camera' && <PhotoCombinedPanel key={own.id} photo={photo} />}
                <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
                  <p className="text-xs text-muted-foreground">
                    {checked
                      ? 'Checks drawn for this camera: compare them with the photo.'
                      : photo.checkPending
                        ? 'Drawing the checks for this camera…'
                        : 'Not checked for this camera yet.'}
                  </p>
                  <Button
                    type="button"
                    variant={adjust ? 'secondary' : 'outline'}
                    size="sm"
                    className="touch:h-10"
                    aria-expanded={adjust}
                    onClick={() => setAdjust((value) => !value)}
                  >
                    <SlidersHorizontal className="h-4 w-4" />
                    {adjust ? 'Hide the hand tools' : 'Adjust'}
                  </Button>
                </div>
                {adjust && (
                  <PhotoAdjustPanel
                    photo={photo}
                    startPick={startPick}
                    moveTo={moveTo}
                    align={align}
                    onAlign={setAlign}
                    placing={placing}
                    onPlacing={setPlacing}
                  />
                )}
                {photo.toolsBusy && (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {photo.toolsBusy}
                  </p>
                )}
                {photo.toolsError && <InlineAlert tone="warning">{photo.toolsError}</InlineAlert>}
              </div>
            </div>
          </TabPanel>
        )}
        {own && (
          <TabPanel tab="use" current={tab}>
            <div className="grid gap-5 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)]">
              {/* Mounted only while shown: laying the layers on the photo costs a second or more a camera, and the
                  Camera tab's copy already does it while this tab is hidden. */}
              {tab === 'use' ? (
                <PhotoWithOverlays
                  photo={photo}
                  pageFeatures={actions.pageFeatures}
                  compact
                  layersMenu="inline"
                  imageClassName="max-h-[40dvh]"
                />
              ) : (
                <div />
              )}
              <div className="min-w-0 space-y-5">
                <PhotoAcceptPanel
                  photo={photo}
                  preview={preview}
                  initials={initials}
                  note={note}
                  onInitials={setInitials}
                  onNote={setNote}
                  onAccept={accept}
                  acceptError={acceptError}
                />
                <PhotoUsePanel photo={photo} onRemoved={() => setTab('photos')} />
              </div>
            </div>
          </TabPanel>
        )}
      </DialogShell>
      {steppedAside && own && <PickReference own={own} photo={photo} />}
    </>
  )
}

function PrimaryIcon({ kind }: { kind: ReturnType<typeof ownPhotoPrimary>['kind'] }) {
  const Icon =
    kind === 'searching'
      ? Loader2
      : kind === 'search'
        ? Search
        : kind === 'check'
          ? SlidersHorizontal
          : kind === 'accept'
            ? Check
            : kind === 'viewpoint'
              ? MapPin
              : kind === 'stand'
                ? Camera
                : kind === 'next'
                  ? ArrowRight
                  : null
  return Icon ? <Icon className={cn('h-4 w-4', kind === 'searching' && 'animate-spin')} /> : null
}

/** A tab's panel: every one stays mounted, so a half-typed value survives a look at another tab. */
function TabPanel({ tab, current, children }: { tab: OwnPhotoTab; current: OwnPhotoTab; children: React.ReactNode }) {
  return (
    <div
      role="tabpanel"
      id={`own-photo-panel-${tab}`}
      aria-labelledby={`own-photo-tab-${tab}`}
      hidden={tab !== current}
      className="space-y-3"
    >
      {children}
    </div>
  )
}

/**
 * While the window is out of the way for a click on the plan: the photo, small, in the corner over the sidebar, with
 * the spot being paired, so the same place can be found on the plan.
 */
function PickReference({ own, photo }: { own: Own; photo: FieldPhotoState }) {
  const marks = [
    ...photo.pairs.map((pair, i) => ({ id: pair.id, pixel: pair.pixel, label: String(i + 1), pending: false })),
    ...(photo.pendingPixel ? [{ id: 'pending', pixel: photo.pendingPixel, label: '?', pending: true }] : []),
  ]
  return createPortal(
    <div
      className="pointer-events-none fixed bottom-3 left-3 z-50 w-72 max-w-[60vw] overflow-hidden rounded-lg border bg-popover p-1.5 text-xs shadow-lg"
      role="status"
      aria-label="The photo, while a spot is picked on the plan"
      data-testid="own-photo-pick-reference"
    >
      <div className="relative">
        <img src={own.src} alt="" className="block max-h-[45vh] w-full rounded-sm object-contain" />
        {marks.map((mark) => (
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
        ))}
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
