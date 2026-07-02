import { cn } from '@/lib/utils'
import { getHazardRating, HAZARD_TAILWIND } from '../../hazard'
import type { RouletteRestaurant, HazardRating } from '../../types'

interface RouletteResultProps {
  winner: RouletteRestaurant
  onSpinAgain: () => void
  onViewOnMap: () => void
}

function getHazardColor(rating?: HazardRating): string {
  return (HAZARD_TAILWIND[rating || 'Unknown'] || HAZARD_TAILWIND.Unknown).bg
}

export function RouletteResult({ winner, onSpinAgain, onViewOnMap }: RouletteResultProps) {
  const rating = getHazardRating(winner)
  const violationCount = winner.rouletteViolationCount ??
    (winner.inspections || []).reduce((sum, i) => sum + (i.violations?.length || 0), 0)
  const inspectionCount = (winner.inspections || []).length

  return (
    <div className="w-full max-w-sm animate-bounce-in">
      {/* Winner announcement */}
      <div className="text-center mb-4">
        <div className="inline-flex items-center gap-2 rounded-full bg-sky-500 px-4 py-2 text-sm font-bold text-white shadow-lg">
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
          </svg>
          WINNER!
        </div>
      </div>

      {/* Restaurant card */}
      <div className="rounded-2xl border border-border bg-background shadow-xl overflow-hidden">
        <div className="bg-sky-500 p-4 text-white">
          <h3 className="text-xl font-bold">{winner.name}</h3>
          <p className="text-sky-100 text-sm">{winner.address}</p>
        </div>

        <div className="p-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            <span
              className={cn(
                'px-3 py-1 text-xs font-medium rounded-full text-white',
                getHazardColor(rating)
              )}
            >
              {rating} Hazard
            </span>
            <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
              {winner.establishment_type || winner.facility_type || 'Restaurant'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-muted p-2">
              <div className="text-lg font-bold text-foreground">
                {violationCount}
              </div>
              <div className="text-xs text-muted-foreground">Violations</div>
            </div>
            <div className="rounded-lg bg-muted p-2">
              <div className="text-lg font-bold text-foreground">
                {inspectionCount}
              </div>
              <div className="text-xs text-muted-foreground">Inspections</div>
            </div>
          </div>

          {winner.distanceKm && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span>{winner.distanceKm.toFixed(1)} km away</span>
            </div>
          )}

          {winner.full_address && (
            <div className="text-xs text-muted-foreground">
              {winner.full_address}
            </div>
          )}
        </div>

        <div className="border-t border-border bg-muted p-4 flex gap-3">
          <button
            onClick={onViewOnMap}
            className="flex-1 py-2 px-4 rounded-lg bg-sky-500 text-sm font-medium text-white transition-colors hover:bg-sky-600 flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
            View on Map
          </button>
          <button
            onClick={onSpinAgain}
            className="flex-1 py-2 px-4 rounded-lg border border-input bg-background text-sm font-medium text-foreground transition-colors hover:bg-accent flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Spin Again
          </button>
        </div>
      </div>
    </div>
  )
}
