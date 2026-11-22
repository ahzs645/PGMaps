import { Crosshair } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'

import type { StartPlanPick } from './PhotoCameraTools'
import type { OwnPhoto, FieldPhotoState } from './useFieldPhoto'

export function PhotoLocationPanel({
  own,
  photo,
  startPick,
}: {
  own: OwnPhoto
  photo: FieldPhotoState
  startPick: StartPlanPick
}) {
  const search = photo.locationSearch
  return (
    <section className="space-y-2 rounded-md border border-border p-3" aria-label="Find the photo location">
      <h4 className="text-sm font-semibold">Find the photo location</h4>
      <p className="text-xs leading-5 text-muted-foreground">
        Pick an approximate area on the map. PGMaps compares the skyline at nine locations in a 1 km square, using the
        current {own.pose.hfov.toFixed(0)}° field of view. An aerial photo needs its approximate altitude set first.
      </p>
      {search?.status === 'searching' ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p role="status" className="text-xs">
            Checking terrain at {search.checked} of {search.total} locations
          </p>
          <Button type="button" variant="outline" size="sm" onClick={photo.cancelLocationSearch}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="touch:h-10"
            onClick={() =>
              startPick(
                ([lng, lat]) => void photo.findLocation(own.id, { lng, lat }),
                'Pick the approximate centre of the area to search for the photo',
              )
            }
          >
            <Crosshair className="h-4 w-4" />
            Pick a search area
          </Button>
          {own.pose.lng !== null && own.pose.lat !== null && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="touch:h-10"
              onClick={() => {
                const { lng, lat } = own.pose
                if (lng !== null && lat !== null) void photo.findLocation(own.id, { lng, lat })
              }}
            >
              Search around current position
            </Button>
          )}
        </div>
      )}
      {search?.status === 'error' && <InlineAlert tone="warning">{search.message}</InlineAlert>}
      {search?.status === 'done' &&
        (search.candidates.length ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Searched at {search.basis.hfov.toFixed(0)}° across.{' '}
              {search.ambiguous
                ? 'Several locations or headings fit closely. Compare landmarks before choosing.'
                : 'Use a candidate as a starting camera and check the model view against recognizable landmarks.'}
            </p>
            <ol className="space-y-1">
              {search.candidates.map((candidate, index) => (
                <li
                  key={`${candidate.lng},${candidate.lat}`}
                  className="flex flex-wrap items-center justify-between gap-2 text-xs tabular-nums"
                >
                  <span>
                    {candidate.lat.toFixed(5)}, {candidate.lng.toFixed(5)} · {candidate.fit.bearing.toFixed(1)}° ·{' '}
                    {candidate.fit.fit.agreeing} skyline samples aligned
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    className="touch:h-10"
                    aria-label={`Use candidate ${index + 1} as a starting camera`}
                    onClick={() => photo.useLocation(own.id, candidate)}
                  >
                    Use as a start
                  </Button>
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <InlineAlert tone="warning">
            {search.sampled
              ? 'No clear skyline match in this area. Try a different area or set a rough camera location and pair landmarks.'
              : 'Terrain could not be read at the trial locations. Try another area or retry.'}
          </InlineAlert>
        ))}
    </section>
  )
}
