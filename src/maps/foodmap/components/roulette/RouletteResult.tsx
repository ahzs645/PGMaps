import { cn } from '@/lib/utils'
import type { RouletteRestaurant, HazardRating } from '../../types'

interface RouletteResultProps {
  winner: RouletteRestaurant
  onSpinAgain: () => void
  onViewOnMap: () => void
}

const hazardColors: Record<HazardRating, string> = {
  Low: 'bg-green-500',
  Moderate: 'bg-amber-500',
  Unknown: 'bg-gray-500'
}

function getHazardColor(rating?: HazardRating): string {
  return hazardColors[rating || 'Unknown'] || hazardColors.Unknown
}

export function RouletteResult({ winner, onSpinAgain, onViewOnMap }: RouletteResultProps) {
  const rating = (winner.current_hazard_rating || winner.hazard_rating || 'Unknown') as HazardRating
  const violationCount = winner.rouletteViolationCount ??
    (winner.inspections || []).reduce((sum, i) => sum + (i.violations?.length || 0), 0)
  const inspectionCount = (winner.inspections || []).length

  return (
    <div className="w-full max-w-sm animate-bounce-in">
      {/* Winner announcement */}
      <div className="text-center mb-4">
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-yellow-400 to-orange-500 text-white rounded-full text-sm font-bold shadow-lg">
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
          </svg>
          WINNER!
        </div>
      </div>

      {/* Restaurant card */}
      <div className="bg-white dark:bg-gray-700 rounded-2xl shadow-xl overflow-hidden border border-gray-200 dark:border-gray-600">
        <div className="bg-gradient-to-r from-purple-500 to-pink-500 p-4 text-white">
          <h3 className="text-xl font-bold">{winner.name}</h3>
          <p className="text-purple-100 text-sm">{winner.address}</p>
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
            <span className="px-3 py-1 text-xs font-medium rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
              {winner.facility_type || 'Restaurant'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-2">
              <div className="text-lg font-bold text-gray-900 dark:text-white">
                {violationCount}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Violations</div>
            </div>
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-2">
              <div className="text-lg font-bold text-gray-900 dark:text-white">
                {inspectionCount}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Inspections</div>
            </div>
          </div>

          {winner.distanceKm && (
            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span>{winner.distanceKm.toFixed(1)} km away</span>
            </div>
          )}

          {winner.full_address && (
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {winner.full_address}
            </div>
          )}
        </div>

        <div className="p-4 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-600 flex gap-3">
          <button
            onClick={onViewOnMap}
            className="flex-1 py-2 px-4 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
            View on Map
          </button>
          <button
            onClick={onSpinAgain}
            className="flex-1 py-2 px-4 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white text-sm font-medium rounded-lg transition-all flex items-center justify-center gap-2"
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
