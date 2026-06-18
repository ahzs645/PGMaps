import { cn } from '@/lib/utils'
import { sourceMeta } from '../data'
import type { DroppedLocation, GeocodeResult, GeocodeStatus, SourceKey, SourceLookupState } from '../types'
import { AcknowledgementDropMap, LocalMapBoundary } from './AcknowledgementMap'

type LocationPanelProps = {
  geocodeResult: GeocodeResult | null
  geocodeStatus: GeocodeStatus
  address: string
  sourceLookups: Record<SourceKey, SourceLookupState>
  onDrop: (location: DroppedLocation) => void
}

export function LocationPanel({ geocodeResult, geocodeStatus, address, sourceLookups, onDrop }: LocationPanelProps) {
  return (
    <div className="grid overflow-hidden rounded-lg border bg-white shadow-sm xl:grid-cols-[minmax(0,1fr)_260px]">
      <div className="relative min-h-[20rem]">
        <LocalMapBoundary result={geocodeResult}>
          <AcknowledgementDropMap
            result={geocodeResult}
            loading={geocodeStatus === 'loading'}
            onDrop={onDrop}
          />
        </LocalMapBoundary>
      </div>
      <div className="border-t p-4 xl:border-l xl:border-t-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Location</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Search an address, click the map, or drag the pin.
            </p>
          </div>
          <span className={cn(
            'rounded px-2 py-1 text-[10px] font-semibold uppercase',
            geocodeStatus === 'success' && 'bg-emerald-100 text-emerald-800',
            geocodeStatus === 'loading' && 'bg-sky-100 text-sky-800',
            geocodeStatus === 'error' && 'bg-red-100 text-red-800',
            geocodeStatus === 'idle' && 'bg-slate-100 text-slate-600',
          )}>
            {geocodeStatus}
          </span>
        </div>
        <dl className="mt-4 space-y-3 text-sm">
          <div>
            <dt className="text-xs uppercase text-slate-500">Selected point</dt>
            <dd className="mt-1 break-words font-medium">{geocodeResult?.fullAddress ?? address}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-slate-500">Coordinates</dt>
            <dd className="mt-1 font-mono text-xs">
              {geocodeResult ? `${geocodeResult.latitude.toFixed(6)}, ${geocodeResult.longitude.toFixed(6)}` : 'Waiting for match'}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-slate-500">Geocoder</dt>
            <dd className="mt-1">{geocodeResult?.matchPrecision === 'Map point' ? 'Map drop' : 'BC Address Geocoder'}</dd>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <dt className="text-xs uppercase text-slate-500">Score</dt>
              <dd className="mt-1">{geocodeResult ? `${geocodeResult.score}/100` : '-'}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-slate-500">Precision</dt>
              <dd className="mt-1 break-words">{geocodeResult?.matchPrecision ?? '-'}</dd>
            </div>
          </div>
        </dl>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
          {(['verified', 'nativeLand', 'treaty'] as SourceKey[]).map((source) => (
            <div key={source} className="rounded-md border bg-slate-50 px-2 py-2">
              <div className="text-base font-semibold text-slate-950">{sourceLookups[source].matches.length}</div>
              <div className="mt-0.5 truncate text-slate-500">{sourceMeta[source].label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
