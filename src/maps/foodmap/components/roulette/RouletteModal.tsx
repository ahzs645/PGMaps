import { useCallback, useEffect, useId, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { FilterChipGroup } from '@/components/ui/map-panels'
import { FilterToggleButton } from '@/components/ui/sticky-list-toolbar'
import { SelectAllActions } from '@/components/ui/text-button'
import { ROULETTE_CATEGORIES } from '../../dining'
import { RouletteFilters } from './RouletteFilters'
import { RouletteWheel } from './RouletteWheel'
import { RouletteResult } from './RouletteResult'
import { useRouletteState } from '../../hooks/useRouletteState'
import { useGeolocation } from '../../hooks/useGeolocation'
import type { Restaurant, RestaurantWithStats, SourceLocation } from '../../types'

interface RouletteModalProps {
  restaurants: Restaurant[]
  onClose: () => void
  onSelectOnMap: (restaurant: RestaurantWithStats) => void
}

const wheelSizeOptions = [4, 6, 8, 10, 65, 0]

export function RouletteModal({ restaurants, onClose, onSelectOnMap }: RouletteModalProps) {
  const [filtersOpen, setFiltersOpen] = useState(false)
  const filtersPanelId = useId()
  const {
    activeFilterCount,
    selectedCategories,
    setSelectedCategories,
    toggleCategory,
    categoryCounts,
    useFilters,
    setUseFilters,
    sourceLocation,
    locationMode,
    maxDistance,
    setMaxDistance,
    violationTimePeriod,
    setViolationTimePeriod,
    maxViolations,
    setMaxViolations,
    excludedHazardRatings,
    isSpinning,
    winner,
    hasSpun,
    wheelSize,
    setWheelSize,
    wheelRestaurants,
    eligibleRestaurants,
    setSourceFromGeolocation,
    setSourceFromMap,
    clearSourceLocation,
    toggleHazardExclusion,
    shuffleWheel,
    startSpinning,
    completeSpinningWithWinner,
    resetSpin,
    resetFilters,
  } = useRouletteState(restaurants)

  const { error: geoError, loading: geoLoading, getCurrentPosition, clearPosition: clearGeoPosition } = useGeolocation()

  // shuffleWheel's identity tracks the eligible list and wheel size, so this
  // covers the initial shuffle and idle-time reshuffles in one effect.
  useEffect(() => {
    if (!isSpinning && !hasSpun) {
      shuffleWheel()
    }
  }, [shuffleWheel, isSpinning, hasSpun])

  const handleGetLocation = useCallback(async () => {
    const pos = await getCurrentPosition()
    if (pos) {
      setSourceFromGeolocation(pos)
    }
  }, [getCurrentPosition, setSourceFromGeolocation])

  const handleMapClick = useCallback(
    (lngLat: SourceLocation) => {
      setSourceFromMap(lngLat)
    },
    [setSourceFromMap],
  )

  const handleClearLocation = useCallback(() => {
    clearSourceLocation()
    clearGeoPosition()
  }, [clearSourceLocation, clearGeoPosition])

  // The panel can push the wheel off the sheet, so it gets out of the way.
  const handleSpinStart = useCallback(() => {
    setFiltersOpen(false)
    startSpinning()
  }, [startSpinning])

  const handleSpinAgain = useCallback(() => {
    resetSpin()
    shuffleWheel()
  }, [resetSpin, shuffleWheel])

  const handleViewOnMap = useCallback(() => {
    if (winner) {
      onSelectOnMap(winner as unknown as RestaurantWithStats)
    }
  }, [winner, onSelectOnMap])

  const handleClose = useCallback(() => {
    resetFilters()
    onClose()
  }, [resetFilters, onClose])

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) handleClose()
      }}
    >
      <DialogContent variant="sheet" elevated showClose={false} className="sm:max-h-[calc(100dvh-1rem)]">
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border p-4">
          <div className="min-w-0">
            <DialogTitle className="flex items-center gap-2 text-lg font-bold leading-tight text-foreground sm:text-xl">
              <span className="text-xl sm:text-2xl" aria-hidden="true">
                🎰
              </span>
              Restaurant Roulette
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Spin to pick a random restaurant
            </DialogDescription>
          </div>
          <button
            onClick={handleClose}
            className="shrink-0 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Close restaurant roulette"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* The wheel stays first; every option sits behind the Filters button.
            Outside the scroller so a long panel can always be closed to get back
            to the wheel. The matching gutter lines it up with the content below. */}
        <div className="flex shrink-0 items-center justify-between gap-2 overflow-hidden px-3 pb-2 pt-3 [scrollbar-gutter:stable] sm:px-4 sm:pt-4">
          <FilterToggleButton
            open={filtersOpen}
            onToggle={() => setFiltersOpen((open) => !open)}
            panelId={filtersPanelId}
            activeCount={activeFilterCount}
          />
          <div className="flex items-center gap-2">
            <span
              className={`text-right text-sm leading-tight ${
                eligibleRestaurants.length > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
              }`}
            >
              {eligibleRestaurants.length.toLocaleString()} available
            </span>
            {!hasSpun && !isSpinning && wheelSize !== 0 && eligibleRestaurants.length > wheelSize && (
              <button
                onClick={shuffleWheel}
                className="flex h-8 items-center gap-1.5 rounded-lg border border-input bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
              >
                <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                Shuffle
              </button>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain [scrollbar-gutter:stable] p-3 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-1 sm:p-4 sm:pt-1">
          {filtersOpen && (
            <div id={filtersPanelId} className="space-y-3 rounded-xl border border-border bg-muted/50 p-3">
              <section aria-label="Dining categories" className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">Dining categories</h3>
                  <SelectAllActions
                    onAll={() => {
                      resetSpin()
                      setSelectedCategories([...ROULETTE_CATEGORIES])
                    }}
                    onNone={() => {
                      resetSpin()
                      setSelectedCategories([])
                    }}
                    allSelected={isSpinning || selectedCategories.length === ROULETTE_CATEGORIES.length}
                    noneSelected={isSpinning || selectedCategories.length === 0}
                  />
                </div>
                <FilterChipGroup
                  variant="filled"
                  showDot={false}
                  items={ROULETTE_CATEGORIES.map((category) => ({
                    value: category,
                    label: category,
                    count: categoryCounts[category],
                    disabled: isSpinning,
                  }))}
                  selectedValues={selectedCategories}
                  onToggle={(category) => {
                    resetSpin()
                    toggleCategory(category)
                  }}
                />
                <p className="text-xs text-muted-foreground">Other spots: clubs, convenience stores, food courts.</p>
              </section>

              <section aria-label="Wheel size" className="space-y-2">
                <h3 className="text-sm font-semibold">Wheel size</h3>
                <div className="grid grid-cols-6 gap-1">
                  {wheelSizeOptions.map((size) => (
                    <button
                      key={size}
                      onClick={() => setWheelSize(size)}
                      disabled={isSpinning}
                      className={`h-9 min-w-0 rounded-lg px-1 text-sm font-medium transition-colors disabled:opacity-50 sm:h-8 ${
                        wheelSize === size
                          ? 'bg-sky-500 text-white shadow'
                          : 'border border-input bg-background text-foreground hover:bg-accent'
                      }`}
                    >
                      {size === 0 ? 'All' : size}
                    </button>
                  ))}
                </div>
              </section>

              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-foreground">Distance and safety filters</span>
                <button
                  onClick={() => setUseFilters(!useFilters)}
                  aria-label="Distance and safety filters"
                  aria-pressed={useFilters}
                  disabled={isSpinning}
                  className={`relative h-6 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
                    useFilters ? 'bg-sky-500' : 'bg-input'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-background shadow transition-transform ${
                      useFilters ? 'translate-x-6' : 'translate-x-0'
                    }`}
                  ></span>
                </button>
              </div>

              {useFilters && (
                <RouletteFilters
                  sourceLocation={sourceLocation}
                  locationMode={locationMode}
                  maxDistance={maxDistance}
                  violationTimePeriod={violationTimePeriod}
                  maxViolations={maxViolations}
                  excludedHazardRatings={excludedHazardRatings}
                  geoLoading={geoLoading}
                  geoError={geoError}
                  onGetLocation={handleGetLocation}
                  onClearLocation={handleClearLocation}
                  onMapClick={handleMapClick}
                  onMaxDistanceChange={setMaxDistance}
                  onViolationTimePeriodChange={setViolationTimePeriod}
                  onMaxViolationsChange={setMaxViolations}
                  onToggleHazard={toggleHazardExclusion}
                />
              )}
            </div>
          )}

          {/* Spinner or Result.
              Reserve the wheel's height (mirrors RouletteWheel's reserved box
              per breakpoint) so swapping the wheel for the shorter result card
              — or hiding controls mid-spin — never shrinks the sheet. */}
          <div className="flex min-h-[358px] min-w-0 flex-col items-center justify-center max-[360px]:min-h-[342px] min-[390px]:min-h-[388px] sm:min-h-[368px]">
            {/* Show result popup */}
            {hasSpun && !isSpinning && winner && (
              <RouletteResult winner={winner} onSpinAgain={handleSpinAgain} onViewOnMap={handleViewOnMap} />
            )}

            {/* Show wheel */}
            {!(hasSpun && !isSpinning && winner) && (
              <RouletteWheel
                restaurants={wheelRestaurants}
                onSpinStart={handleSpinStart}
                onSpinComplete={completeSpinningWithWinner}
              />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
