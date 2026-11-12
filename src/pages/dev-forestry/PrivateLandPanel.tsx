import { useState } from 'react'
import { Landmark, Loader2, Plus, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import { ToolSection } from '@/components/ui/tool-section'
import { formatMeasure } from '@/lib/format'

import { MASK_LABELS, MAX_ASSESSMENT_MASKS } from './assessmentMasks'
import { MASK_COLORS } from './planMapStyle'
import { fetchPrivateParcels, parcelMaskFields, type PrivateParcel } from './parcelMapPrivateLand'
import type { AssessmentMask } from './types'
import { polygonAreaMeters, polygonBounds, type PolygonGeometry } from './visibility'

/** Margin round the landform the parcels are looked up in, degrees (about 1 km). */
const SEARCH_MARGIN_DEGREES = 0.01

type Lookup =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; parcels: PrivateParcel[]; truncated: boolean }

/**
 * Step 3: private land round the landform from ParcelMap BC, as candidates. The reviewer adds a
 * parcel and it becomes a "Private land" assessment mask, the class the run already keeps out of
 * the alteration and the VIA figures draw as private land. A failed lookup is an error with a
 * retry, never an empty answer.
 */
export function PrivateLandPanel({
  landform,
  masks,
  onAdd,
  onRemove,
  stale,
}: {
  landform: PolygonGeometry | null
  masks: ReadonlyArray<AssessmentMask>
  onAdd: (parcels: PrivateParcel[]) => void
  onRemove: (id: string) => void
  stale: boolean
}) {
  const [lookup, setLookup] = useState<Lookup>({ status: 'idle' })
  const added = masks.filter((mask) => mask.kind === 'private')
  const addedSources = new Set(added.map((mask) => mask.source))
  const room = MAX_ASSESSMENT_MASKS - masks.length
  const find = async () => {
    if (!landform) return
    const [w, s, e, n] = polygonBounds(landform)
    setLookup({ status: 'loading' })
    try {
      const answer = await fetchPrivateParcels(
        [w - SEARCH_MARGIN_DEGREES, s - SEARCH_MARGIN_DEGREES, e + SEARCH_MARGIN_DEGREES, n + SEARCH_MARGIN_DEGREES],
        fetch,
      )
      setLookup({ status: 'ready', ...answer })
    } catch (error) {
      setLookup({ status: 'error', message: error instanceof Error ? error.message : 'ParcelMap BC did not answer.' })
    }
  }
  const candidates =
    lookup.status === 'ready'
      ? lookup.parcels.filter((parcel) => !addedSources.has(parcelMaskFields(parcel).source))
      : []
  return (
    <ToolSection
      title="Private land"
      aria-label="Private land"
      summary={added.length ? `${added.length} parcel${added.length === 1 ? '' : 's'} added` : 'ParcelMap BC'}
      toggleProps={{ 'data-forestry-disclosure': 'private-land' }}
      help={`Private parcels round the landform, read live from ParcelMap BC's parcel fabric. They are candidates: each one you add becomes a "${MASK_LABELS.private}" mask, kept out of the percent alteration, and drawn as private land by the VIA figure styles. Run the simulation again after adding parcels.`}
    >
      <div className="space-y-1.5 text-xs">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          disabled={!landform || lookup.status === 'loading'}
          onClick={() => void find()}
        >
          {lookup.status === 'loading' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Landmark className="h-3.5 w-3.5" />
          )}
          {lookup.status === 'loading' ? 'Reading ParcelMap BC…' : 'Find private land round the landform'}
        </Button>
        {!landform && <p className="text-2xs text-muted-foreground">Set the landform in step 1 first.</p>}
        {lookup.status === 'error' && (
          <InlineAlert tone="error">
            {lookup.message}{' '}
            <button type="button" className="underline" onClick={() => void find()}>
              Retry
            </button>
          </InlineAlert>
        )}
        {lookup.status === 'ready' && (
          <div className="space-y-1">
            <p className="text-2xs text-muted-foreground">
              {lookup.parcels.length
                ? `${lookup.parcels.length} private parcel${lookup.parcels.length === 1 ? '' : 's'} round the landform${lookup.truncated ? ' (more exist than were returned)' : ''}.`
                : 'ParcelMap BC records no private parcels round the landform.'}
            </p>
            {candidates.length > 0 && (
              <>
                <ul
                  className="max-h-40 divide-y divide-border overflow-y-auto rounded-md border border-border text-2xs"
                  aria-label="Private parcels to add"
                >
                  {candidates.map((parcel) => (
                    <li key={parcel.id} className="flex items-center gap-2 py-0.5 pl-2 pr-0.5">
                      <span className="min-w-0 flex-1 truncate">{parcelMaskFields(parcel).name}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {formatMeasure(parcel.areaMeters / 10_000, 'ha', { maximumFractionDigits: 1 })}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={room < 1}
                        onClick={() => onAdd([parcel])}
                        aria-label={`Add ${parcelMaskFields(parcel).name} as private land`}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  disabled={room < candidates.length}
                  onClick={() => onAdd(candidates)}
                >
                  Add all {candidates.length} as private land
                </Button>
                {room < candidates.length && (
                  <p className="text-2xs text-muted-foreground">
                    The scene keeps {MAX_ASSESSMENT_MASKS} masks: add parcels one at a time, or remove some masks.
                  </p>
                )}
              </>
            )}
          </div>
        )}
        {added.length > 0 && (
          <ul
            className="divide-y divide-border overflow-hidden rounded-md border border-border text-2xs"
            aria-label="Private land in the scene"
          >
            {added.map((mask) => (
              <li key={mask.id} className="flex items-center gap-2 py-0.5 pl-2 pr-0.5">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-sm border"
                  style={{ backgroundColor: MASK_COLORS.private, borderColor: '#475569' }}
                />
                <span className="min-w-0 flex-1 truncate" title={mask.source || undefined}>
                  {mask.name}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatMeasure(polygonAreaMeters(mask.geometry) / 10_000, 'ha', { maximumFractionDigits: 1 })}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => onRemove(mask.id)}
                  aria-label={`Remove ${mask.name}`}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        {added.length > 0 && stale && (
          <p className="text-2xs text-muted-foreground">
            Run the simulation again to see the private land in the figures.
          </p>
        )}
      </div>
    </ToolSection>
  )
}
