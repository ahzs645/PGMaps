import { useEffect, useState } from 'react'
import { MapPin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { insetBox } from '@/components/ui/inset-box'
import { fetchJson } from '@/lib/fetchJson'
import { withBase } from '@/lib/dataUrl'
import { cn } from '@/lib/utils'
import { Field, roadFieldClass } from './Controls'
import { ReferenceSelect } from './CostReferenceControls'
import {
  COST_PACKS,
  COUNTRIES,
  countryInfo,
  packFor,
  placeCurrency,
  placeLabel,
  subdivisionsOf,
  type CostPack,
} from './costPlaces/packs'
import { prepareBoundaries, suggestPlace, type PlaceSuggestion, type PreparedBoundary } from './costPlaces/locate'
import { placeProblem, samePlace, type CostPlace } from './costPlaces/places'
import type { ProjectCostLocation } from './costPlaces/projectLocation'
import type { Coordinate } from './types'

const boundaryCache = new Map<string, Promise<PreparedBoundary[]>>()

function packBoundaries(pack: CostPack): Promise<PreparedBoundary[]> {
  const boundary = pack.regionScheme?.boundary
  if (!boundary) return Promise.resolve([])
  let pending = boundaryCache.get(pack.id)
  if (!pending) {
    pending = fetchJson<{ features: [] }>(withBase(boundary.path)).then((collection) =>
      prepareBoundaries(pack, collection.features ?? []),
    )
    pending.catch(() => boundaryCache.delete(pack.id))
    boundaryCache.set(pack.id, pending)
  }
  return pending
}

export type SuggestionState =
  | { status: 'idle' | 'loading' | 'outside' }
  | { status: 'error' }
  | { status: 'ready'; suggestion: PlaceSuggestion }

/**
 * Reads where the road is against each pack's region boundaries, once the dialog is open and only
 * while the project has no location. The boundary file loads on demand; a failed load leaves the
 * suggestion out and says so, and the location can still be chosen by hand.
 */
export function useLocationSuggestion(points: readonly Coordinate[], enabled: boolean): SuggestionState {
  const [state, setState] = useState<{ key: string; value: SuggestionState }>({ key: '', value: { status: 'idle' } })
  const key = enabled ? points.map((p) => p.join(',')).join(';') : ''
  useEffect(() => {
    if (!enabled || !points.length) return
    let cancelled = false
    const packs = COST_PACKS.filter((pack) => pack.regionScheme?.boundary)
    Promise.all(packs.map(async (pack) => suggestPlace(pack, points, await packBoundaries(pack)))).then(
      (found) => {
        if (cancelled) return
        const best = found.filter((item): item is PlaceSuggestion => !!item).sort((a, b) => b.share - a.share)[0]
        setState({ key, value: best ? { status: 'ready', suggestion: best } : { status: 'outside' } })
      },
      () => {
        if (!cancelled) setState({ key, value: { status: 'error' } })
      },
    )
    return () => {
      cancelled = true
    }
    // `key` stands for the points.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled])
  if (!enabled || !points.length) return { status: 'idle' }
  return state.key === key ? state.value : { status: 'loading' }
}

/** Country, then province or state, then the pack's region, then a free-text locality. */
export function PlacePicker({
  value,
  onChange,
  idPrefix,
}: {
  value: CostPlace
  onChange: (place: CostPlace) => void
  idPrefix: string
}) {
  const subdivisions = subdivisionsOf(value.country)
  const pack = packFor(value)
  const regions = pack?.subdivision === value.subdivision ? (pack?.regionScheme?.regions ?? []) : []
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-testid={`${idPrefix}-place-picker`}>
      <ReferenceSelect
        label="Country"
        value={value.country}
        options={COUNTRIES.map((country) => ({ value: country.code, label: `${country.name} · ${country.currency}` }))}
        onChange={(country) => onChange({ country })}
      />
      <ReferenceSelect
        label={countryInfo(value.country)?.subdivisionTerm ?? 'Province or state'}
        value={value.subdivision ?? ''}
        options={[
          { value: '', label: 'Whole country' },
          ...subdivisions.map((item) => ({
            value: item.code,
            label: `${item.name}${COST_PACKS.some((p) => p.subdivision === item.code) ? ' · cost pack' : ''}`,
          })),
        ]}
        onChange={(subdivision) => onChange({ country: value.country, ...(subdivision ? { subdivision } : {}) })}
      />
      {regions.length > 0 && (
        <ReferenceSelect
          label={pack?.regionScheme?.name ?? 'Region'}
          value={value.region ?? ''}
          options={[{ value: '', label: 'Whole province' }, ...regions.map((r) => ({ value: r.id, label: r.name }))]}
          onChange={(region) => {
            const { region: _drop, ...rest } = value
            void _drop
            onChange(region ? { ...rest, region } : rest)
          }}
        />
      )}
      <Field label="Town or site (optional)">
        <input
          className={roadFieldClass}
          aria-label="Town or site"
          value={value.locality ?? ''}
          maxLength={120}
          placeholder="Prince George"
          onChange={(event) => {
            const { locality: _drop, ...rest } = value
            void _drop
            onChange(event.target.value ? { ...rest, locality: event.target.value } : rest)
          }}
        />
      </Field>
    </div>
  )
}

/**
 * The cost dialog's location line. Shows where the project's prices come from, offers the place read
 * from the road (or the person's home place) without writing it, and stores a place only on Use or
 * Save. The currency follows the place.
 */
export function CostLocationControl({
  location,
  suggestion,
  homePlace,
  onSet,
}: {
  location: ProjectCostLocation | undefined
  suggestion: SuggestionState
  homePlace?: CostPlace
  onSet: (location: ProjectCostLocation | undefined, label: string) => void
}) {
  const [editing, setEditing] = useState<CostPlace | null>(null)
  const ready = suggestion.status === 'ready' ? suggestion.suggestion : null
  const offer = !location ? (ready?.place ?? homePlace) : undefined
  const offerBasis = ready ? ready.basis : homePlace ? 'Your home place, from your cost preferences.' : null
  const set = (place: CostPlace, basis: ProjectCostLocation['basis']) =>
    onSet({ place, basis, setOn: todayIso() }, location ? 'Changed cost location' : 'Set cost location')
  if (editing) {
    const problem = placeProblem(editing)
    return (
      <div className={cn(insetBox({ padding: 'lg' }), 'space-y-2')} data-testid="road-cost-location-editor">
        <PlacePicker value={editing} onChange={setEditing} idPrefix="road-cost-location" />
        <p className="text-2xs text-muted-foreground">
          Amounts are entered in {placeCurrency(editing)}. Nothing is converted from another currency.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="xs"
            disabled={!!problem || samePlace(editing, location?.place)}
            data-testid="road-cost-location-save"
            onClick={() => {
              set(editing, 'chosen')
              setEditing(null)
            }}
          >
            Save location
          </Button>
          {location && (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              onClick={() => {
                onSet(undefined, 'Cleared cost location')
                setEditing(null)
              }}
            >
              Clear
            </Button>
          )}
          <Button type="button" size="xs" variant="ghost" onClick={() => setEditing(null)}>
            Cancel
          </Button>
          {problem && <span className="text-2xs text-warning">{problem}</span>}
        </div>
      </div>
    )
  }
  return (
    <div className="flex min-h-8 flex-wrap items-center gap-x-2 gap-y-1 text-xs" data-testid="road-cost-location">
      <MapPin className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      {location ? (
        <span>
          <span className="font-medium text-foreground" data-testid="road-cost-location-label">
            {placeLabel(location.place)}
          </span>
          <span className="text-muted-foreground"> · {placeCurrency(location.place)}</span>
        </span>
      ) : (
        <span className="text-muted-foreground">
          No cost location
          {suggestion.status === 'loading' && ' · reading the road’s position…'}
          {suggestion.status === 'error' && ' · the region boundaries did not load'}
          {offer && (
            <>
              {' · '}
              <span className="text-foreground" data-testid="road-cost-location-suggestion">
                {placeLabel(offer)}
              </span>
            </>
          )}
        </span>
      )}
      {offer && (
        <Button
          type="button"
          size="xs"
          variant="outline"
          data-testid="road-cost-location-use"
          title={offerBasis ?? undefined}
          onClick={() => set(offer, ready ? 'road-location' : 'chosen')}
        >
          Use
        </Button>
      )}
      <Button
        type="button"
        size="xs"
        variant="ghost"
        data-testid="road-cost-location-change"
        onClick={() => setEditing(location?.place ?? offer ?? { country: 'CA', subdivision: 'CA-BC' })}
      >
        {location ? 'Change' : 'Choose'}
      </Button>
      <InfoTip label="About the cost location">
        <p>
          The location orders evidence nearest first (same region, then province or state, then country), picks the
          region pack&apos;s guidance, budget items and reference tools, and sets the currency rates are entered in. It
          never adjusts, weights or averages a price.
        </p>
        {offerBasis && <p className="mt-1.5">Suggested: {offerBasis}</p>}
        {location && (
          <p className="mt-1.5">
            {location.basis === 'road-location' ? 'Accepted from the road’s position' : 'Chosen'} on {location.setOn}.
          </p>
        )}
      </InfoTip>
    </div>
  )
}

function todayIso() {
  const now = new Date()
  const two = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`
}
