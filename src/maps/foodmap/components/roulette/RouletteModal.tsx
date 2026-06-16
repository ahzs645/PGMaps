import { useEffect, useCallback } from 'react'
import { RouletteFilters } from './RouletteFilters'
import { RouletteWheel } from './RouletteWheel'
import { RouletteSlot } from './RouletteSlot'
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

export function RouletteModal({
  restaurants,
  onClose,
  onSelectOnMap
}: RouletteModalProps) {
  const {
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
    winnerIndex,
    hasSpun,
    spinnerMode,
    setSpinnerMode,
    wheelSize,
    setWheelSize,
    wheelRestaurants,
    eligibleRestaurants,
    setSourceFromGeolocation,
    setSourceFromMap,
    clearSourceLocation,
    toggleHazardExclusion,
    shuffleWheel,
    spin,
    startSpinning,
    completeSpinning,
    completeSpinningWithWinner,
    resetSpin,
    resetFilters
  } = useRouletteState(restaurants)

  const {
    error: geoError,
    loading: geoLoading,
    getCurrentPosition,
    clearPosition: clearGeoPosition
  } = useGeolocation()

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

  const handleMapClick = useCallback((lngLat: SourceLocation) => {
    setSourceFromMap(lngLat)
  }, [setSourceFromMap])

  const handleClearLocation = useCallback(() => {
    clearSourceLocation()
    clearGeoPosition()
  }, [clearSourceLocation, clearGeoPosition])

  const handleSpin = useCallback(() => {
    if (spinnerMode === 'slot') {
      if (eligibleRestaurants.length === 0) return
    } else {
      if (wheelRestaurants.length === 0) return
    }
    spin()
  }, [spinnerMode, eligibleRestaurants.length, wheelRestaurants.length, spin])

  const handleSpinComplete = useCallback(() => {
    completeSpinning()
  }, [completeSpinning])

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

  useEffect(() => {
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose()
      }
    }
    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [handleClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={(e) => e.target === e.currentTarget && handleClose()}
    >
      <div className="flex h-[min(92dvh,760px)] w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-background/95 shadow-2xl backdrop-blur sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:max-w-lg sm:rounded-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border p-4">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-lg font-bold leading-tight text-foreground sm:text-xl">
              <span className="text-xl sm:text-2xl" aria-hidden="true">🎰</span>
              Restaurant Roulette
            </h2>
            <p className="text-sm text-muted-foreground">Spin to pick a random restaurant</p>
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

        {/* Content */}
        <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain p-3 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:p-4">
          {/* Filter Toggle */}
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/50 p-3">
            <div className="min-w-0">
              <span className="text-sm font-medium text-foreground">Use Filters</span>
              <p className="text-xs text-muted-foreground">
                {useFilters ? 'Narrow down by location, violations & hazard' : 'All restaurants included'}
              </p>
            </div>
            <button
              onClick={() => setUseFilters(!useFilters)}
              className={`relative h-6 w-12 shrink-0 rounded-full transition-colors ${
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

          {/* Filters (collapsible) */}
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

          {/* Mode Toggle */}
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-muted/50 p-2">
            <button
              onClick={() => setSpinnerMode('wheel')}
              className={`flex min-w-0 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                spinnerMode === 'wheel'
                  ? 'bg-sky-500 text-white shadow'
                  : 'border border-input bg-background text-foreground hover:bg-accent'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" strokeWidth="2"/>
                <path strokeWidth="2" d="M12 2v10l7 7"/>
              </svg>
              Wheel
            </button>
            <button
              onClick={() => setSpinnerMode('slot')}
              className={`flex min-w-0 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                spinnerMode === 'slot'
                  ? 'bg-sky-500 text-white shadow'
                  : 'border border-input bg-background text-foreground hover:bg-accent'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <rect x="3" y="4" width="18" height="16" rx="2" strokeWidth="2"/>
                <line x1="3" y1="12" x2="21" y2="12" strokeWidth="2"/>
              </svg>
              Slot
            </button>
          </div>

          {/* Wheel Size & Eligible Count (for wheel mode) */}
          {spinnerMode === 'wheel' && (
            <div className="rounded-xl border border-border bg-muted/50 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">Options:</span>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-right text-sm leading-tight ${
                      eligibleRestaurants.length > 0
                        ? 'text-green-600 dark:text-green-400'
                        : 'text-red-600 dark:text-red-400'
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
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Shuffle
                    </button>
                  )}
                </div>
              </div>
              <div className="mt-2 grid grid-cols-6 gap-1">
                  {wheelSizeOptions.map((size) => (
                    <button
                      key={size}
                      onClick={() => setWheelSize(size)}
                      className={`h-9 min-w-0 rounded-lg px-1 text-sm font-medium transition-colors sm:h-8 ${
                        wheelSize === size
                          ? 'bg-sky-500 text-white shadow'
                          : 'border border-input bg-background text-foreground hover:bg-accent'
                      }`}
                    >
                      {size === 0 ? 'All' : size}
                    </button>
                  ))}
              </div>
            </div>
          )}

          {/* Eligible count for slot mode */}
          {spinnerMode === 'slot' && (
            <div className="text-center py-2">
              <span
                className={`text-sm ${
                  eligibleRestaurants.length > 0
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-red-600 dark:text-red-400'
                }`}
              >
                {eligibleRestaurants.length} restaurants available
              </span>
            </div>
          )}

          {/* Spinner or Result */}
          <div className="flex min-w-0 flex-col items-center">
            {/* Wheel Mode: Show result popup */}
            {spinnerMode === 'wheel' && hasSpun && !isSpinning && winner && (
              <RouletteResult
                winner={winner}
                onSpinAgain={handleSpinAgain}
                onViewOnMap={handleViewOnMap}
              />
            )}

            {/* Wheel Mode: Show wheel */}
            {spinnerMode === 'wheel' && !(hasSpun && !isSpinning && winner) && (
              <RouletteWheel
                restaurants={wheelRestaurants}
                onSpinStart={startSpinning}
                onSpinComplete={completeSpinningWithWinner}
              />
            )}

            {/* Slot Mode */}
            {spinnerMode === 'slot' && (
              <RouletteSlot
                restaurants={wheelRestaurants}
                eligibleRestaurants={eligibleRestaurants}
                winnerIndex={winnerIndex}
                isSpinning={isSpinning}
                onSpinComplete={handleSpinComplete}
              />
            )}

            {/* Slot Mode: Action buttons after spin */}
            {spinnerMode === 'slot' && hasSpun && !isSpinning && winner && (
              <div className="mt-4 grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  onClick={handleViewOnMap}
                  className="flex items-center justify-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-600"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                  </svg>
                  View on Map
                </button>
                <button
                  onClick={handleSpinAgain}
                  className="flex items-center justify-center gap-2 rounded-lg border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Spin Again
                </button>
              </div>
            )}

            {/* Spin button for slot mode */}
            {spinnerMode === 'slot' && (!hasSpun || isSpinning) && (
              <button
                onClick={handleSpin}
                disabled={eligibleRestaurants.length === 0 || isSpinning}
                className="mt-6 px-8 py-4 text-xl font-bold rounded-full bg-sky-500 hover:bg-sky-600 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed text-white shadow-lg transform transition-all hover:scale-105 active:scale-95 disabled:hover:scale-100"
              >
                {isSpinning ? (
                  <span className="animate-pulse">Spinning...</span>
                ) : (
                  <span>SPIN!</span>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
