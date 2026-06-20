import { useEffect, useCallback } from 'react'
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

  // Hide the floating mobile top toolbar (PGMaps menu, search, info, theme)
  // while the sheet is open so its controls don't peek out above the modal.
  // The Navbar listens for this event; desktop is unaffected.
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('pgmaps:mobile-toolbar-visibility', { detail: { hidden: true } })
    )
    return () => {
      window.dispatchEvent(
        new CustomEvent('pgmaps:mobile-toolbar-visibility', { detail: { hidden: false } })
      )
    }
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={(e) => e.target === e.currentTarget && handleClose()}
    >
      <div className="flex max-h-[96dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-background/95 shadow-2xl backdrop-blur sm:h-auto sm:max-h-[calc(100dvh-1rem)] sm:max-w-lg sm:rounded-2xl">
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
        <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain [scrollbar-gutter:stable] p-3 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:p-4">
          {/* Filters & Wheel Options */}
          <div className="space-y-3 rounded-xl border border-border bg-muted/50 p-3">
            {/* Use Filters + Options on one line */}
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              {/* Filter Toggle */}
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">Use Filters</span>
                <button
                  onClick={() => setUseFilters(!useFilters)}
                  aria-label="Use filters"
                  aria-pressed={useFilters}
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

              {/* Options + eligible count + shuffle.
                  min-h-8 reserves the Shuffle button's height so the row
                  doesn't shrink when the button hides on spin (which would
                  toggle the modal scrollbar). */}
              <div className="flex min-h-8 items-center gap-2">
                <span className="text-sm text-muted-foreground">Options:</span>
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

            {/* Wheel size options */}
            <div className="grid grid-cols-6 gap-1">
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
          </div>

          {/* Spinner or Result.
              Reserve the wheel's height (mirrors RouletteWheel's reserved box
              per breakpoint) so swapping the wheel for the shorter result card
              — or hiding controls mid-spin — never shrinks the sheet. */}
          <div className="flex min-h-[358px] min-w-0 flex-col items-center justify-center max-[360px]:min-h-[342px] min-[390px]:min-h-[388px] sm:min-h-[368px]">
            {/* Show result popup */}
            {hasSpun && !isSpinning && winner && (
              <RouletteResult
                winner={winner}
                onSpinAgain={handleSpinAgain}
                onViewOnMap={handleViewOnMap}
              />
            )}

            {/* Show wheel */}
            {!(hasSpun && !isSpinning && winner) && (
              <RouletteWheel
                restaurants={wheelRestaurants}
                onSpinStart={startSpinning}
                onSpinComplete={completeSpinningWithWinner}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
