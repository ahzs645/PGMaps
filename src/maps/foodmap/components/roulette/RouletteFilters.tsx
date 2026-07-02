import { RouletteLocationPicker } from './RouletteLocationPicker'
import { AppSelect } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { HAZARD_TAILWIND } from '../../hazard'
import type { SourceLocation, HazardRating } from '../../types'

interface RouletteFiltersProps {
  sourceLocation: SourceLocation | null
  locationMode: string
  maxDistance: number
  violationTimePeriod: number
  maxViolations: number | null
  excludedHazardRatings: HazardRating[]
  geoLoading: boolean
  geoError: string | null
  onGetLocation: () => void
  onClearLocation: () => void
  onMapClick: (location: SourceLocation) => void
  onMaxDistanceChange: (distance: number) => void
  onViolationTimePeriodChange: (period: number) => void
  onMaxViolationsChange: (violations: number | null) => void
  onToggleHazard: (hazard: HazardRating) => void
}

const hazardOptions: HazardRating[] = ['Low', 'Moderate', 'Unknown']
const hazardColors = Object.fromEntries(
  hazardOptions.map((rating) => {
    const { bg, border, text } = HAZARD_TAILWIND[rating]
    return [rating, { active: bg, inactive: `${border} ${text}` }]
  }),
) as Record<HazardRating, { active: string; inactive: string }>

const timeOptions = [
  { value: 3, label: '3 months' },
  { value: 6, label: '6 months' },
  { value: 12, label: '1 year' },
  { value: 24, label: '2 years' },
  { value: 0, label: 'All time' }
]

export function RouletteFilters({
  sourceLocation,
  locationMode,
  maxDistance,
  violationTimePeriod,
  maxViolations,
  excludedHazardRatings,
  geoLoading,
  geoError,
  onGetLocation,
  onClearLocation,
  onMapClick,
  onMaxDistanceChange,
  onViolationTimePeriodChange,
  onMaxViolationsChange,
  onToggleHazard
}: RouletteFiltersProps) {
  const handleMaxViolationsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    onMaxViolationsChange(val === '' ? null : parseInt(val))
  }

  return (
    <div className="space-y-4">
      {/* Location Section */}
      <div className="rounded-xl border border-border bg-muted/50 p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Location
        </h3>

        <div className="flex gap-2 mb-3">
          <button
            onClick={onGetLocation}
            disabled={geoLoading}
            className={`flex-1 py-2 px-3 text-sm font-medium rounded-lg transition-all flex items-center justify-center gap-2 ${
              locationMode === 'geolocation'
                ? 'bg-sky-500 text-white'
                : 'border border-input bg-background text-foreground hover:bg-accent'
            }`}
          >
            {geoLoading ? (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
            My Location
          </button>
          {sourceLocation && (
            <button
              onClick={onClearLocation}
              className="py-2 px-3 text-sm font-medium rounded-lg bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
            >
              Clear
            </button>
          )}
        </div>

        {geoError && <p className="text-xs text-red-500 mb-3">{geoError}</p>}

        <RouletteLocationPicker
          sourceLocation={sourceLocation}
          maxDistance={maxDistance}
          onLocationSelected={onMapClick}
        />

        {sourceLocation && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="text-muted-foreground">Distance</span>
              <span className="font-medium text-foreground">{maxDistance} km</span>
            </div>
            <Slider
              min={1}
              max={20}
              step={1}
              value={[maxDistance]}
              onValueChange={([value]) => onMaxDistanceChange(value)}
              className="py-2"
            />
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>1 km</span>
              <span>20 km</span>
            </div>
          </div>
        )}

        {!sourceLocation && (
          <p className="text-xs text-muted-foreground mt-2">
            Click the map or use "My Location" to filter by distance
          </p>
        )}
      </div>

      {/* Violations Section */}
      <div className="rounded-xl border border-border bg-muted/50 p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          Violations
        </h3>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Time Period</label>
            <AppSelect
              value={String(violationTimePeriod)}
              onValueChange={(value) => onViolationTimePeriodChange(parseInt(value))}
              options={timeOptions.map((opt) => ({ value: String(opt.value), label: opt.label }))}
              triggerClassName="h-10 rounded-lg text-sm focus:ring-2 focus:ring-sky-500"
            />
          </div>

          <div>
            <label className="block text-xs text-muted-foreground mb-1">Max Violations</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                max="50"
                value={maxViolations ?? ''}
                onChange={handleMaxViolationsChange}
                placeholder="No limit"
                className="flex-1 px-3 py-2 text-sm rounded-lg border border-input bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              {maxViolations !== null && (
                <button
                  onClick={() => onMaxViolationsChange(null)}
                  className="px-3 py-2 text-sm rounded-lg border border-input bg-background text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Hazard Exclusion Section */}
      <div className="rounded-xl border border-border bg-muted/50 p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
          Exclude Hazard Ratings
        </h3>

        <div className="flex flex-wrap gap-2">
          {hazardOptions.map((hazard) => (
            <button
              key={hazard}
              onClick={() => onToggleHazard(hazard)}
              className={`px-4 py-2 text-sm font-medium rounded-lg border-2 transition-all ${
                excludedHazardRatings.includes(hazard)
                  ? `${hazardColors[hazard].active} text-white border-transparent line-through opacity-75`
                  : `${hazardColors[hazard].inactive} bg-background border-current`
              }`}
            >
              {hazard}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Click to exclude ratings from the roulette
        </p>
      </div>
    </div>
  )
}
