/**
 * The own photo's Search section (doc section **A photo of your own**, *The Camera tab*): what was searched for this
 * photo and what it found, in a few lines, and the searches a reviewer can still start by hand. Every camera a search
 * finds goes to the options card above it; this section only says where it looked.
 */
import { Crosshair, Layers, Loader2, MapPin, Target } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'

import type { StartPlanPick } from './PhotoCameraTools'
import { LocationResults } from './PhotoLocationResults'
import { ownAcceptancePose } from './PhotoOptionsCard'
import { searchPlaceName } from './photoPlaces'
import type { FieldPhotoState, OwnPhoto } from './useFieldPhoto'

const fitWords = (result: { trustworthy: boolean; ambiguous: boolean; bearing: number }) =>
  result.trustworthy
    ? `settled at ${result.bearing.toFixed(0)}°`
    : result.ambiguous
      ? `best at ${result.bearing.toFixed(0)}°, but another heading fits about as well`
      : `best at ${result.bearing.toFixed(0)}°, not trustworthy`

export function PhotoSearchPanel({
  photo,
  own,
  startPick,
  placing,
  onPlacing,
  depth,
}: {
  photo: FieldPhotoState
  own: OwnPhoto
  startPick?: StartPlanPick
  placing: boolean
  onPlacing: (placing: boolean) => void
  /** Offered while the photo's cameras were compared without depth: depth is what tells two headings apart. */
  depth?: { busy: boolean; error: string | null; onCompare: () => void } | null
}) {
  const work = photo.workFor(own.id)
  const current = ownAcceptancePose(own)
  const search = work.search
  const places = work.places
  const manual = photo.locationSearch
  const undecided = work.combined?.result.undecided ?? null
  const accepted = photo.acceptanceState(own.id) === 'accepted'
  const landmarks = photo.pairs.filter((pair) => !photo.pairsOff.includes(pair.id)).length
  const pairLandmark = startPick && current ? () => onPlacing(!placing) : undefined
  const unresolved = (result: typeof manual) =>
    result?.status === 'done' && (result.ambiguous || !result.candidates.length)
  const inlineManual = unresolved(manual)
  const inlineBackground = !manual && unresolved(places?.area ?? null)
  const searchArea = (centre: { lng: number; lat: number }) => void photo.findLocation(own.id, centre)

  const lines: Array<{ key: string; text: string; busy?: boolean }> = []
  if (search.status === 'working')
    lines.push({ key: 'here', text: 'Searching the skyline from where it stands…', busy: true })
  else if (search.status === 'done')
    lines.push({
      key: 'here',
      text: `From ${
        (search.at &&
          current &&
          searchPlaceName({
            searchedAt: search.at,
            standsAt: current,
            fix: own.exif?.position ?? null,
            highGround: work.found?.highGround ?? null,
          })) ||
        'where it stands'
      }: ${fitWords(search.result)}.`,
    })
  else if (search.status === 'failed') lines.push({ key: 'here', text: search.message })
  for (const placed of places?.searches ?? [])
    lines.push({ key: placed.id, text: `From ${placed.label}: ${fitWords(placed.result)}.` })
  if (places?.status === 'working') {
    const next = places.tried[places.searches.length + places.notes.length] ?? places.tried.at(-1)
    lines.push({ key: 'places', text: `Searching from ${next ?? 'other places'}…`, busy: true })
  }
  for (const note of places?.notes ?? []) lines.push({ key: note, text: note })
  if (undecided)
    lines.push({
      key: 'ground',
      text: `By the look of the ground, ${
        (undecided.to - undecided.from + 360) % 360 >= 300
          ? 'cameras in almost every direction'
          : `headings from ${undecided.from.toFixed(0)}° round to ${undecided.to.toFixed(0)}°`
      } fit about equally: it does not single one out.`,
    })

  return (
    <section className="space-y-2.5 rounded-md border border-border p-3" aria-label="Search for the camera">
      <div className="flex items-center gap-1.5">
        <h4 className="text-sm font-semibold">Search</h4>
        <InfoTip label="About the search">
          The queue searches the skyline from where the photo stands. When that does not settle it, it searches by
          itself from where the evidence points: the high ground at the photo’s GPS altitude, and nine places round it
          or round a fix the phone itself doubts. Every camera found is a row in the options above, never the camera
          until you use it.
        </InfoTip>
      </div>
      {lines.length > 0 && (
        <ul className="space-y-0.5 text-xs leading-5 text-muted-foreground" role="status">
          {lines.map((line) => (
            <li key={line.key} className="flex items-start gap-1.5">
              {line.busy && <Loader2 className="mt-1 h-3 w-3 shrink-0 animate-spin" aria-hidden />}
              <span className="min-w-0">{line.text}</span>
            </li>
          ))}
        </ul>
      )}
      {places?.area && (
        <div className="space-y-1">
          <p className="text-xs font-medium">
            Nine places round {places.areaCentre?.on === 'high-ground' ? 'the high ground' : 'the GPS fix'}
          </p>
          <LocationResults
            search={places.area}
            quiet
            onPair={inlineBackground ? pairLandmark : undefined}
            placing={placing}
          />
          {places.searches.some((placed) => placed.id === 'area') && (
            <p className="text-xs leading-5 text-muted-foreground">
              {places.area.status === 'done' && places.area.ambiguous
                ? 'The one facing the phone’s heading is a row in the options: the phone is the second sensor the tie needs.'
                : 'One place stands ahead: it is a row in the options.'}
            </p>
          )}
        </div>
      )}
      {manual && (
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium">Places you searched</p>
            {manual.status === 'searching' && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="touch:h-10"
                onClick={photo.cancelLocationSearch}
              >
                Cancel
              </Button>
            )}
          </div>
          <LocationResults
            search={manual}
            onUse={(candidate) => photo.useLocation(own.id, candidate)}
            onPair={inlineManual ? pairLandmark : undefined}
            placing={placing}
            onTryTexture={
              manual.status === 'done' && manual.centre && !manual.candidates.length && !manual.textureFallback
                ? () => void photo.findLocation(own.id, manual.centre!, true)
                : undefined
            }
          />
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {current && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="touch:h-10"
            disabled={search.status === 'working'}
            onClick={() => void photo.findCamera()}
          >
            <Target className="h-4 w-4" />
            Search from this camera position
          </Button>
        )}
        {current && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="touch:h-10"
            disabled={manual?.status === 'searching'}
            onClick={() => searchArea({ lng: current.lng, lat: current.lat })}
          >
            <MapPin className="h-4 w-4" />
            Search round here
          </Button>
        )}
        {startPick && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="touch:h-10"
            disabled={manual?.status === 'searching'}
            onClick={() =>
              startPick(([lng, lat]) => searchArea({ lng, lat }), 'Click the middle of the area the photo was taken in')
            }
          >
            <Crosshair className="h-4 w-4" />
            {current ? 'Search another area…' : 'Pick the area it was taken in…'}
          </Button>
        )}
        {startPick && current && !inlineManual && !inlineBackground && (
          <Button
            type="button"
            variant={placing ? 'secondary' : 'outline'}
            size="sm"
            className="touch:h-10"
            aria-pressed={placing}
            onClick={() => onPlacing(!placing)}
          >
            <Crosshair className="h-4 w-4" />
            {placing ? 'Cancel landmark pick' : landmarks ? 'Pair another landmark' : 'Pair a landmark'}
          </Button>
        )}
        {depth && !accepted && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="touch:h-10"
            disabled={depth.busy}
            onClick={depth.onCompare}
            title="A depth estimate of the photo can tell headings apart where the skyline cannot. The model is a 27 MB download, kept in this browser."
          >
            {depth.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Layers className="h-4 w-4" />}
            Compare with depth
          </Button>
        )}
      </div>
      {depth?.error && <p className="text-xs leading-5 text-warning-foreground">{depth.error}</p>}
      {landmarks > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs leading-5">
          <p className="min-w-0 flex-1 text-muted-foreground">
            {landmarks < photo.pairsNeeded
              ? 'One landmark gives a starting camera in the options. Pair another well away from it to solve the angles.'
              : landmarks < photo.controlCheckCount
                ? `You can solve now. With ${photo.controlCheckCount} landmarks one is held out to measure the error.`
                : 'Solve from the landmarks, then check the held-out error.'}
          </p>
          {landmarks >= photo.pairsNeeded && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="touch:h-10"
              disabled={!!photo.toolsBusy}
              onClick={() => void photo.solveFromPoints()}
            >
              Solve from {landmarks} landmarks
            </Button>
          )}
        </div>
      )}
    </section>
  )
}
