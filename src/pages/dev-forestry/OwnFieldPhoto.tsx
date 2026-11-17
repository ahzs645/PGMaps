import { createPortal } from 'react-dom'
import { Camera, Check, CircleAlert, ImagePlus, Loader2, SlidersHorizontal, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'

import type { FieldRecord } from './assessmentTools'
import type { RoadViewPose } from './exifPose'
import { OwnPhotoDialog, lineUpBlocked, ownCameraLine, readOwnPhotoSteps } from './OwnPhotoDialog'
import { OWN_PHOTO_STEPS } from './ownPhotoSteps'
import type { FieldPhotoState } from './useFieldPhoto'

/** What the page does with an own photo: stand the road view there, pick its spot, save its pose. */
export type OwnPhotoActions = {
  onOriginalPhoto: (file: File) => void
  /** Field records of kind 'photo', to line up without picking the file again. */
  records: FieldRecord[]
  /** The road view's pose as it stands, the starting point for anything EXIF does not give. */
  roadView: RoadViewPose | null
  /** False while the scene cannot open a road view at all. */
  canLineUp: boolean
  /** Stands the road view at `at` and holds it on the photo's pose. */
  onLineUp: (at: { lng: number; lat: number }) => void
  /** Asks the plan map for one click, with what its banner should say; null cancels. */
  onPickPoint?: (onPoint: ((point: [number, number]) => void) | null, hint?: string) => void
  pickActive?: boolean
  /** Writes the confirmed camera back to the field record it came from. */
  onSaveToRecord?: (recordId: string, patch: Partial<FieldRecord>) => void
}

/**
 * The reviewer's own photo in the sidebar (handbook 3.3.4): a button that opens its window, and, once a photo is
 * open, a summary of where its line-up stands with the two things done from here: opening the window again and
 * standing the road view at the photo. Everything else is in the window (`OwnPhotoDialog`).
 */
export function OwnFieldPhoto({ photo, actions }: { photo: FieldPhotoState; actions: OwnPhotoActions }) {
  const { own, ownStatus } = photo
  const comparing = !!own && !!photo.match
  const reading = readOwnPhotoSteps(photo)
  const blocked = own ? lineUpBlocked(photo, actions.canLineUp) : null
  const drape = photo.photoDrape
  return (
    <div className="space-y-2" aria-label="Your own photo">
      <p className="text-2xs font-semibold tracking-wide text-muted-foreground uppercase">Your own photo</p>
      {!own && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full touch:h-10"
          onClick={() => photo.openOwnDialog('position')}
        >
          {ownStatus.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
          Line up a photo of my own…
        </Button>
      )}
      {!own && !photo.ownDialog.open && ownStatus.error && <InlineAlert tone="error">{ownStatus.error}</InlineAlert>}
      {own && reading && (
        <div className="space-y-2 rounded-md border border-border p-2" aria-label="Own photo summary">
          <div className="flex gap-2">
            <img src={own.src} alt={`Your photo ${own.name}`} className="h-16 w-16 shrink-0 rounded-sm object-cover" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{own.name}</p>
              <p className="text-3xs leading-4 text-muted-foreground tabular-nums">{ownCameraLine(own)}</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="shrink-0"
              aria-label="Close my photo"
              onClick={photo.clear}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <ul className="space-y-0.5 text-2xs" aria-label="Steps">
            {OWN_PHOTO_STEPS.map(({ step, label }) => {
              const { state, note } = reading.steps[step]
              return (
                <li key={step}>
                  <button
                    type="button"
                    className="flex w-full items-start gap-1.5 rounded-sm text-left hover:bg-accent"
                    onClick={() => photo.openOwnDialog(step)}
                  >
                    {state === 'done' ? (
                      <Check className="mt-0.5 h-3 w-3 shrink-0 text-success" aria-label="Done" />
                    ) : state === 'attention' ? (
                      <CircleAlert className="mt-0.5 h-3 w-3 shrink-0 text-warning" aria-label="Needs attention" />
                    ) : (
                      <span className="mt-0.5 h-3 w-3 shrink-0 rounded-full border border-border" aria-label="To do" />
                    )}
                    <span className="min-w-0">
                      <span className="font-medium">{label}:</span>{' '}
                      <span className="text-muted-foreground">{note}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="flex-1 touch:h-10"
              onClick={() => photo.openOwnDialog(reading.next === 'line-up' ? undefined : reading.next)}
            >
              <SlidersHorizontal className="h-4 w-4" />
              Open the camera
            </Button>
            <Button
              type="button"
              size="sm"
              className="flex-1 touch:h-10"
              disabled={!!blocked}
              onClick={() => {
                if (own.pose.lng !== null && own.pose.lat !== null)
                  actions.onLineUp({ lng: own.pose.lng, lat: own.pose.lat })
              }}
            >
              <Camera className="h-4 w-4" />
              {comparing ? 'Stand there again' : 'Line up'}
            </Button>
          </div>
          {blocked && <p className="text-3xs leading-4 text-muted-foreground">{blocked}</p>}
        </div>
      )}
      {photo.ownDialog.open && <OwnPhotoDialog photo={photo} actions={actions} />}
      {own &&
        drape &&
        !photo.ownDialog.open &&
        // The window stepped aside to show the photo on the plan: the way back, wherever the sidebar is scrolled.
        createPortal(
          <div
            className="fixed bottom-3 left-3 z-50 w-72 max-w-[80vw] space-y-2 rounded-lg border bg-popover p-2 text-xs shadow-lg"
            role="status"
            aria-label="Photo on the plan"
            data-testid="own-photo-on-plan"
          >
            <p className="leading-5">
              The photo is on the plan as the camera at heading {drape.bearing.toFixed(0)}° saw the ground. Roads,
              openings and lakes should sit on the map’s.
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                className="flex-1 touch:h-10"
                onClick={() => photo.openOwnDialog('check')}
              >
                Back to the camera
              </Button>
              <Button type="button" variant="outline" size="sm" className="touch:h-10" onClick={photo.hideDrape}>
                Take it off
              </Button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
