import { Landmark, Loader2, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { CheckboxField } from '@/components/ui/form-field'
import { InlineAlert } from '@/components/ui/map-panels'
import { ToolSection } from '@/components/ui/tool-section'
import { formatMeasure } from '@/lib/format'

import { MASK_LABELS, MAX_ASSESSMENT_MASKS } from './assessmentMasks'
import { MASK_COLORS } from './planMapStyle'
import { parcelMaskFields, type PrivateParcel } from './parcelMapPrivateLand'
import type { AssessmentMask } from './types'
import type { PrivateParcels } from './usePrivateParcels'
import { polygonAreaMeters } from './visibility'

/**
 * Step 3: private land round the landform from ParcelMap BC, as candidates. The parcels found are drawn on the
 * plan; the reviewer ticks the ones to add, here or by clicking them on the plan, and Add makes each a "Private
 * land" assessment mask, the class the run already keeps out of the alteration and the VIA figures draw as
 * private land. A failed lookup is an error with a retry, never an empty answer.
 */
export function PrivateLandPanel({
  hasLandform,
  parcels,
  masks,
  onAdd,
  onRemove,
  stale,
}: {
  hasLandform: boolean
  /** The lookup and the ticked parcels, shared with the plan (`usePrivateParcels`). */
  parcels: PrivateParcels
  masks: ReadonlyArray<AssessmentMask>
  onAdd: (parcels: PrivateParcel[]) => void
  onRemove: (id: string) => void
  stale: boolean
}) {
  const { lookup, find, clear, candidates, selected, toggle, select } = parcels
  const added = masks.filter((mask) => mask.kind === 'private')
  const room = MAX_ASSESSMENT_MASKS - masks.length
  const chosen = candidates.filter((parcel) => selected.has(parcel.id))
  const allTicked = candidates.length > 0 && chosen.length === candidates.length
  return (
    <ToolSection
      title="Private land"
      aria-label="Private land"
      summary={added.length ? `${added.length} parcel${added.length === 1 ? '' : 's'} added` : 'ParcelMap BC'}
      toggleProps={{ 'data-forestry-disclosure': 'private-land' }}
      help={`Private parcels round the landform, read live from ParcelMap BC's parcel fabric and drawn on the plan. They are candidates: tick the ones to add, here or by clicking them on the plan, then add them. Each becomes a "${MASK_LABELS.private}" mask, kept out of the percent alteration, and drawn as private land by the VIA figure styles. Run the simulation again after adding parcels.`}
    >
      <div className="space-y-1.5 text-xs">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          disabled={!hasLandform || lookup.status === 'loading'}
          onClick={() => void find()}
        >
          {lookup.status === 'loading' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Landmark className="h-3.5 w-3.5" />
          )}
          {lookup.status === 'loading' ? 'Reading ParcelMap BC…' : 'Find private land round the landform'}
        </Button>
        {!hasLandform && <p className="text-2xs text-muted-foreground">Set the landform in step 1 first.</p>}
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
              {candidates.length > 0 && ' Tick the ones to add, or click them on the plan.'}
            </p>
            {candidates.length > 0 && (
              <>
                <div className="flex items-center justify-between gap-2 text-2xs">
                  <span className="text-muted-foreground">
                    {chosen.length} of {candidates.length} ticked
                  </span>
                  <span className="flex gap-2">
                    <button
                      type="button"
                      className="underline disabled:no-underline disabled:opacity-50"
                      disabled={allTicked}
                      onClick={() => select(candidates.map((parcel) => parcel.id))}
                    >
                      Tick all
                    </button>
                    <button
                      type="button"
                      className="underline disabled:no-underline disabled:opacity-50"
                      disabled={!chosen.length}
                      onClick={() => select([])}
                    >
                      Clear ticks
                    </button>
                    <button type="button" className="underline" onClick={clear}>
                      Hide list
                    </button>
                  </span>
                </div>
                <ul
                  className="max-h-40 divide-y divide-border overflow-y-auto rounded-md border border-border text-2xs"
                  aria-label="Private parcels to add"
                >
                  {candidates.map((parcel) => (
                    <li
                      key={parcel.id}
                      className="flex items-center gap-2 py-0.5 pl-2 pr-2"
                      data-selected={selected.has(parcel.id) || undefined}
                    >
                      <CheckboxField
                        className="min-w-0 flex-1 text-2xs"
                        labelClassName="items-center"
                        label={<span className="block truncate">{parcelMaskFields(parcel).name}</span>}
                        checked={selected.has(parcel.id)}
                        onCheckedChange={() => toggle(parcel.id)}
                      />
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {formatMeasure(parcel.areaMeters / 10_000, 'ha', { maximumFractionDigits: 1 })}
                      </span>
                    </li>
                  ))}
                </ul>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  disabled={!chosen.length || room < chosen.length}
                  onClick={() => onAdd(chosen)}
                >
                  {chosen.length
                    ? `Add ${chosen.length} ticked as private land`
                    : 'Tick parcels to add them as private land'}
                </Button>
                {room < chosen.length && (
                  <p className="text-2xs text-muted-foreground">
                    The scene keeps {MAX_ASSESSMENT_MASKS} masks: room for {Math.max(room, 0)} more. Untick some
                    parcels, or remove some masks.
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
