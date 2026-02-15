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

  useEffect(() => {
    shuffleWheel()
  }, [])

  useEffect(() => {
    if (!isSpinning && !hasSpun) {
      shuffleWheel()
    }
  }, [eligibleRestaurants, wheelSize])

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
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && handleClose()}
    >
      <div className="w-full max-w-lg max-h-[90vh] bg-white dark:bg-gray-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <span className="text-2xl">🎰</span>
              Restaurant Roulette
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">Spin to pick a random restaurant</p>
          </div>
          <button
            onClick={handleClose}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <svg className="w-5 h-5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Filter Toggle */}
          <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900 rounded-xl">
            <div>
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Use Filters</span>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {useFilters ? 'Narrow down by location, violations & hazard' : 'All restaurants included'}
              </p>
            </div>
            <button
              onClick={() => setUseFilters(!useFilters)}
              className={`relative w-12 h-6 rounded-full transition-colors ${
                useFilters ? 'bg-purple-500' : 'bg-gray-300 dark:bg-gray-600'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
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
          <div className="flex items-center justify-center gap-2 p-2 bg-gray-50 dark:bg-gray-900 rounded-xl">
            <button
              onClick={() => setSpinnerMode('wheel')}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                spinnerMode === 'wheel'
                  ? 'bg-purple-500 text-white'
                  : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600'
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
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                spinnerMode === 'slot'
                  ? 'bg-purple-500 text-white'
                  : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600'
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
            <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900 rounded-xl">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600 dark:text-gray-400">Options:</span>
                <div className="flex gap-1">
                  {wheelSizeOptions.map((size) => (
                    <button
                      key={size}
                      onClick={() => setWheelSize(size)}
                      className={`${size === 0 ? 'px-2' : 'w-8'} h-8 text-sm font-medium rounded-lg transition-colors ${
                        wheelSize === size
                          ? 'bg-purple-500 text-white'
                          : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600'
                      }`}
                    >
                      {size === 0 ? 'All' : size}
                    </button>
                  ))}
                </div>
              </div>

              <span
                className={`text-sm ${
                  eligibleRestaurants.length > 0
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-red-600 dark:text-red-400'
                }`}
              >
                {eligibleRestaurants.length} available
              </span>
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
          <div className="flex flex-col items-center">
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
              <div className="flex gap-3 mt-4">
                <button
                  onClick={handleViewOnMap}
                  className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                  </svg>
                  View on Map
                </button>
                <button
                  onClick={handleSpinAgain}
                  className="px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white text-sm font-medium rounded-lg transition-all flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Spin Again
                </button>
              </div>
            )}

            {/* Reshuffle button */}
            {spinnerMode === 'wheel' && !hasSpun && !isSpinning && wheelSize !== 0 && eligibleRestaurants.length > wheelSize && (
              <button
                onClick={shuffleWheel}
                className="mt-2 px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white flex items-center gap-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Shuffle ({eligibleRestaurants.length - wheelSize} more available)
              </button>
            )}

            {/* Spin button for slot mode */}
            {spinnerMode === 'slot' && (!hasSpun || isSpinning) && (
              <button
                onClick={handleSpin}
                disabled={eligibleRestaurants.length === 0 || isSpinning}
                className="mt-6 px-8 py-4 text-xl font-bold rounded-full bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed text-white shadow-lg transform transition-all hover:scale-105 active:scale-95 disabled:hover:scale-100"
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
