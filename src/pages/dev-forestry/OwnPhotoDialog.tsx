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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { SegmentedControl } from '@/components/ui/segmented-control'
import { TabBar } from '@/components/ui/tab-bar'
import { useElementSize } from '@/hooks/useElementSize'
import { cn } from '@/lib/utils'

import type { OwnPhotoActions } from './OwnFieldPhoto'
import { ownPhotoSteps } from './ownPhotoSteps'
import { OWN_PHOTO_TABS, adjustsAt, ownPhotoPrimary, tabOf, type OwnPhotoTab } from './ownPhotoTabs'
import { PhotoAcceptPanel, PhotoUsePanel } from './PhotoAcceptPanel'
import { acceptPreview } from './photoAcceptPreview'
import { PhotoAdjustPanel } from './PhotoAdjustPanel'
import type { StartPlanPick } from './PhotoCameraTools'
import { PhotoCompare } from './PhotoCompare'
import { PhotoCombinedPanel } from './PhotoCombinedPanel'
import { PhotoFlightMatchPanel } from './PhotoFlightMatchPanel'
import { PhotoOptionsCard, ownAcceptancePose } from './PhotoOptionsCard'
import { photoStripState } from './photoOptions'
import { scenePhotoLayers } from './photoPageFeatures'
import { controlSolveSuspect } from './photoQueue'
import { PHOTO_TONE_DOT, PhotoFilmstrip, PhotoStrip, queueLine } from './PhotoStrip'
import { PhotoFeaturesCheck, PhotoWithOverlays } from './PhotoWithOverlays'
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
  // What the scene adds over the photo beside the layers the photo reads itself (`scenePhotoLayers`).
  const sceneLayers = useMemo(() => scenePhotoLayers(photo.ownScene), [photo.ownScene])
  // One picture at a time on the Camera tab: what is drawn over the photo, or the photo against the model view.
  const [viewer, setViewer] = useState<CameraViewer>('photo')
  const [initials, setInitials] = useState('')
  const [note, setNote] = useState('')
  const [acceptError, setAcceptError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // A pick this window asked the plan for: it stays out of the way until the plan has answered or cancelled.
  const [pickRequested, setPickRequested] = useState(false)
  const steppedAside = pickRequested && !!actions.pickActive
  const comparing = !!own && !!photo.match
  // A landmark is picked, and the skyline dragged, on the photo itself: both bring it back.
  const showModel = viewer === 'model' && !placing && !align

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

  // The check images count as drawn once what is laid over the photo has its hit buffer for this exact camera
  // (`requestCheck`). Asked for whenever a photo's camera is on screen, never by a button: an acceptance then records
  // truthfully whether they were in front of the reviewer.
  const { requestCheck, activePoseKey } = photo
  const shownId = tab === 'camera' && photo.ownDialog.open && !steppedAside ? (own?.id ?? null) : null
  useEffect(() => {
    if (shownId) requestCheck(shownId)
  }, [shownId, activePoseKey, requestCheck])

  // The picture's column is as tall as what the window shows of its content, so the photo is whole in view whatever
  // the screen: the window's scrolling body, found from the column itself and measured inside its padding.
  const [body, setBody] = useState<HTMLElement | null>(null)
  const findBody = useCallback((node: HTMLElement | null) => {
    let scroller = node?.parentElement ?? null
    while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement
    setBody(scroller)
  }, [])
  const bodyHeight = useElementSize(body, { box: 'content' }).height

  const current = ownAcceptancePose(own)
  const options = own ? photo.optionsFor(own.id) : []
  const checkedPose = own ? photo.checksDrawnFor(own.id) : null
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
  // What the queue's own comparison of cameras favours for a photo the skyline did not settle, when that is not the
  // camera as it stands: a start to take in one click, never taken for the reviewer.
  const compared = own ? photo.workFor(own.id).combined : null
  const [depthBusy, setDepthBusy] = useState<string | null>(null)
  const [depthError, setDepthError] = useState<string | null>(null)
  const depthRequest = useRef<AbortController | null>(null)
  useEffect(() => () => depthRequest.current?.abort(), [])
  const compareWithDepth = () => {
    if (!own || depthRequest.current) return
    const controller = new AbortController()
    depthRequest.current = controller
    setDepthBusy(own.id)
    setDepthError(null)
    void photo
      .compareWithDepth(own.id, controller.signal)
      .then((result) => {
        if (!result.depthModel) setDepthError(result.depthIssue ?? 'Depth could not be estimated for this photo.')
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setDepthError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (depthRequest.current === controller) depthRequest.current = null
        setDepthBusy(null)
      })
  }
  const favoured = compared?.result.candidates[0]
  const undecided = compared?.result.undecided ?? null
  // A camera the ground favours is a start to take; headings it leaves open are only said.
  const groundSuggestion =
    current &&
    favoured &&
    entry?.status !== 'accepted' &&
    (undecided || !sameHeading(favoured.pose.bearing, current.bearing))
      ? { pose: favoured.pose, depth: !!favoured.cues.depth, undecided }
      : null
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
  const landmarkCount = photo.pairs.filter((pair) => !photo.pairsOff.includes(pair.id)).length
  const guideWithLandmarks = !!current && !!startPick && (entry?.status !== 'accepted' || landmarkCount > 0)
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

  const accept = () => {
    if (!own) return
    const made = photo.acceptCamera(own.id, { initials, note })
    if (!made.ok) {
      setAcceptError(made.reason)
      return
    }
    setAcceptError(null)
    setNote('')
    setNotice('Camera accepted. Make it a viewpoint, or go on to the next photo.')
  }
  const makeViewpoint = () => {
    if (!own) return
    const made = photo.makeViewpoint(own.id, { initials, note })
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
      case 'accept':
        return accept()
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
    (primary.kind === 'accept' && !!primary.reason) ||
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
        // One height for every tab and photo: the window does not grow and shrink as cards come and go, and the
        // Camera tab's picture has a set space to fit.
        className="workspace-sm:h-[92dvh] workspace-sm:max-w-6xl"
        title={ownPhotos.length > 1 ? 'Line up photos of my own' : 'Line up a photo of my own'}
        subtitle={
          own
            ? `${own.name}${ownPhotos.length > 1 ? ` · ${activeIndex + 1} of ${ownPhotos.length}` : ''} · read in this browser, not uploaded`
            : 'Read in this browser, never uploaded'
        }
        toolbar={
          ownPhotos.length ? (
            <>
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
              {/* The Photos tab is the set at full size; on the others it stays in reach as one row. */}
              {tab !== 'photos' && <PhotoFilmstrip photo={photo} />}
            </>
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
              // A first photo opens on its camera. A first set stays here, where each photo's place in the queue and
              // what it needs can be read at a glance; adding to a set stays here too.
              if (added.length === 1 && !ownPhotos.length) setTab('camera')
            }}
          />
        </TabPanel>
        {own && (
          <TabPanel tab="camera" current={tab}>
            <div className="grid gap-5 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]" aria-label="Own photo camera">
              <div
                ref={findBody}
                className="flex min-w-0 flex-col gap-3 self-start md:sticky md:top-6 md:h-[var(--own-photo-column)]"
                style={{ '--own-photo-column': bodyHeight ? `${bodyHeight}px` : '60dvh' } as React.CSSProperties}
              >
                <SegmentedControl<CameraViewer>
                  label="What to look at"
                  size="sm"
                  value={showModel ? 'model' : 'photo'}
                  onChange={(next) => {
                    if (next === 'model') {
                      setPlacing(false)
                      setAlign(false)
                    }
                    setViewer(next)
                  }}
                  options={[
                    { value: 'photo', label: 'Layers on the photo' },
                    { value: 'model', label: 'Against the model view' },
                  ]}
                />
                {placing && (
                  <p className="text-xs font-medium text-foreground">
                    Click a spot in the photo; this window then steps aside for you to click the same spot on the plan.
                  </p>
                )}
                {/* Hidden, not unmounted, while the model view shows: laying the layers on the photo again costs a
                    second or more a camera. */}
                <div className={showModel ? 'hidden' : 'flex min-h-0 flex-1 flex-col'}>
                  <PhotoWithOverlays
                    photo={photo}
                    pageFeatures={actions.pageFeatures}
                    customLayers={sceneLayers}
                    layersMenu="corner"
                    fit
                    featuresCheck={false}
                    idle={showModel}
                    align={align}
                    showPairs
                    readOnClick={!placing}
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
                </div>
                <div className={showModel ? 'flex min-h-0 flex-1 flex-col overflow-y-auto' : 'hidden'}>
                  <PhotoCompare
                    key={own.id}
                    photo={photo}
                    active={showModel && tab === 'camera' && photo.ownDialog.open && !steppedAside}
                  />
                </div>
              </div>
              <div className="min-w-0 space-y-4 text-sm">
                {photo.ownStatus.error && <InlineAlert tone="error">{photo.ownStatus.error}</InlineAlert>}
                {entry && <PhotoNeeds part="line" entry={entry} />}
                <PhotoOptionsCard photo={photo} onAdjust={() => setAdjust(true)} />
                {/* What the comparison of cameras offers comes under the options, not over them: it is worked out
                    after a photo opens (a second or more), and above the options it pushed them down the window
                    under the reviewer's pointer. */}
                {entry && (
                  <PhotoNeeds
                    part="offers"
                    entry={entry}
                    suggestion={groundSuggestion}
                    onUseSuggestion={
                      groundSuggestion && !groundSuggestion.undecided
                        ? () => {
                            // The suggestion is a sector (the sweep is 30° apart), so the skyline is then searched
                            // inside it: the heading is held near the suggestion, shown under Adjust as a held angle.
                            photo.setOwnPose(groundSuggestion.pose)
                            void photo.findCamera({
                              heading: { value: groundSuggestion.pose.bearing, tolerance: SUGGESTION_SECTOR_DEGREES },
                            })
                          }
                        : undefined
                    }
                    depth={
                      compared && !compared.depth && entry.status !== 'accepted'
                        ? { busy: depthBusy === own.id, error: depthError, onCompare: compareWithDepth }
                        : undefined
                    }
                  />
                )}
                {/* Beside the picture, not under it: the picture's column is as tall as the window shows, and what
                    was read for the camera's ground is a list to read, not something to line up by eye. */}
                <PhotoFeaturesCheck photo={photo} />
                {guideWithLandmarks && (
                  <section className="space-y-2 rounded-md border border-border p-3" aria-label="Guide with landmarks">
                    <h4 className="text-sm font-semibold">Guide with landmarks</h4>
                    <p className="text-xs leading-5 text-muted-foreground">
                      {landmarkCount === 0
                        ? 'Click one distinct road bend, shoreline corner or peak in the photo and on the plan to get a starting camera.'
                        : landmarkCount === 1 && options.some((option) => option.kind === 'landmark')
                          ? 'Try the one-landmark starting camera below. Pair another landmark far from the first to refine roll.'
                          : landmarkCount < photo.pairsNeeded
                            ? 'Pair another landmark well away from the first, preferably at a different distance.'
                            : landmarkCount < photo.controlCheckCount
                              ? `You can solve now. Use ${photo.controlCheckCount} landmarks to measure error on a point left out of the fit.`
                              : 'Solve from the paired landmarks, then check the held-out error.'}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="touch:h-10"
                        aria-pressed={placing}
                        onClick={() => {
                          setAlign(false)
                          setPlacing(!placing)
                        }}
                      >
                        <Crosshair className="h-4 w-4" />
                        {placing ? 'Cancel landmark pick' : landmarkCount ? 'Pair another landmark' : 'Pair a landmark'}
                      </Button>
                      {landmarkCount >= photo.pairsNeeded && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="touch:h-10"
                          disabled={!!photo.toolsBusy}
                          onClick={() => void photo.solveFromPoints()}
                        >
                          Solve from {landmarkCount} landmarks
                        </Button>
                      )}
                    </div>
                  </section>
                )}
                {tab === 'camera' && <PhotoFlightMatchPanel photo={photo} />}
                {tab === 'camera' && <PhotoCombinedPanel key={own.id} photo={photo} />}
                <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
                  <p className="text-xs text-muted-foreground">
                    Numbers, held angles, a matched camera and dragging the skyline by hand.
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
                  customLayers={sceneLayers}
                  compact
                  layersMenu="corner"
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
                <PhotoUsePanel photo={photo} initials={initials} note={note} onRemoved={() => setTab('photos')} />
              </div>
            </div>
          </TabPanel>
        )}
      </DialogShell>
      {steppedAside && own && <PickReference own={own} photo={photo} />}
    </>
  )
}

type CameraViewer = 'photo' | 'model'

/** How far either side of a suggested heading the skyline is then searched: the sweep's own spacing is 30°. */
const SUGGESTION_SECTOR_DEGREES = 20

/** Headings this close are the same suggestion as the camera in use: the comparison's sweep is 30° apart. */
const sameHeading = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180) < 15

/**
 * What the open photo needs, in one sentence, above everything that could be done to it; and, for a photo the skyline
 * did not settle, the camera the ground favours, to take as a start.
 */
function PhotoNeeds({
  part,
  entry,
  suggestion,
  onUseSuggestion,
  depth,
}: {
  /** The one sentence, above the options; or what the comparison offers, under them. */
  part: 'line' | 'offers'
  entry: Parameters<typeof photoStripState>[0]
  suggestion?: {
    pose: { bearing: number; pitch: number }
    depth: boolean
    undecided?: { from: number; to: number } | null
  } | null
  onUseSuggestion?: () => void
  /** Offered while the photo's cameras were compared without depth: depth is what tells two headings apart. */
  depth?: { busy: boolean; error: string | null; onCompare: () => void }
}) {
  const state = photoStripState(entry)
  if (part === 'line') return <NeedsLine state={state} />
  const offered = !!suggestion?.undecided || (!!suggestion && !!onUseSuggestion) || (!!depth && state.tone === 'help')
  if (!offered) return null
  return (
    <div className="space-y-2">
      {suggestion?.undecided && (
        <p
          className="rounded-md border border-border bg-card p-2.5 text-xs leading-5"
          data-testid="own-photo-ground-undecided"
        >
          Compared by {suggestion.depth ? 'depth and the look of the ground' : 'the look of the ground'}, cameras{' '}
          {(suggestion.undecided.to - suggestion.undecided.from + 360) % 360 >= 300
            ? 'in almost every direction'
            : `heading anywhere from ${suggestion.undecided.from.toFixed(0)}° round to ${suggestion.undecided.to.toFixed(0)}°`}{' '}
          fit about equally well: the ground in this photo does not single one out. Pair a landmark to place it.
        </p>
      )}
      {suggestion && !suggestion.undecided && onUseSuggestion && (
        <div
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card p-2.5 text-xs leading-5"
          data-testid="own-photo-ground-suggestion"
        >
          <p className="min-w-0 flex-1">
            Compared by {suggestion.depth ? 'depth and the look of the ground' : 'the look of the ground'}, a camera
            near heading {suggestion.pose.bearing.toFixed(0)}°, pitch {suggestion.pose.pitch.toFixed(0)}° fits best.
            Starting from it searches the skyline within {SUGGESTION_SECTOR_DEGREES}° of that heading. Check the result
            against the photo before accepting it.
          </p>
          <Button type="button" variant="outline" size="sm" className="touch:h-10" onClick={onUseSuggestion}>
            Start from it
          </Button>
        </div>
      )}
      {depth && state.tone === 'help' && (
        <div
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card p-2.5 text-xs leading-5"
          data-testid="own-photo-depth-offer"
        >
          <p className="min-w-0 flex-1">
            {depth.error ??
              'A depth estimate of the photo can tell headings apart where the skyline cannot. It runs in this browser; the model is a 27 MB download, kept here, and unsettled photos then use it by themselves.'}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="touch:h-10"
            disabled={depth.busy}
            onClick={depth.onCompare}
          >
            {depth.busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Compare with depth
          </Button>
        </div>
      )}
    </div>
  )
}

function NeedsLine({ state }: { state: ReturnType<typeof photoStripState> }) {
  return (
    <p
      // Room for two lines whatever the sentence, so one that changes when a search or comparison ends moves nothing.
      className="flex min-h-[3.875rem] items-start gap-2 rounded-md border border-border bg-card p-2.5 text-xs leading-5"
      role="status"
      aria-label="What this photo needs"
      data-testid="own-photo-needs"
    >
      <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', PHOTO_TONE_DOT[state.tone])} aria-hidden />
      <span className="min-w-0">{state.text}</span>
    </p>
  )
}

function PrimaryIcon({ kind }: { kind: ReturnType<typeof ownPhotoPrimary>['kind'] }) {
  const Icon =
    kind === 'searching'
      ? Loader2
      : kind === 'search'
        ? Search
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
