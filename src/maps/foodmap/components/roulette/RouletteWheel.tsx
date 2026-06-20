import { useMemo, useCallback, useEffect } from 'react'
import { SpinnerWheel, useSpinnerWheelState } from '@firstform/spinnerwheel'
import '@firstform/spinnerwheel/styles'
import './RouletteWheel.css'
import type { WheelEntry } from '@firstform/spinnerwheel'
import type { RouletteRestaurant } from '../../types'

interface RouletteWheelProps {
  restaurants: RouletteRestaurant[]
  onSpinStart: () => void
  onSpinComplete: (winner: RouletteRestaurant) => void
}

export function RouletteWheel({
  restaurants,
  onSpinStart,
  onSpinComplete
}: RouletteWheelProps) {
  const initialEntries: WheelEntry[] = useMemo(
    () => restaurants.map((r, i) => ({
      id: r.details_url || `restaurant-${i}`,
      name: r.name,
    })),
    [restaurants]
  )

  const wheel = useSpinnerWheelState({
    initialEntries,
    onWinnerSelected: (winnerEntry) => {
      const winner = restaurants.find(r => r.name === winnerEntry.name)
      if (winner) onSpinComplete(winner)
    },
  })

  // useSpinnerWheelState only reads initialEntries on mount. Push prop-driven
  // changes (e.g. filter updates, async restaurant load) into the hook so the
  // wheel doesn't fall back to the library's DEFAULT_ENTRIES placeholder.
  const { setEntries } = wheel
  useEffect(() => {
    setEntries(initialEntries)
  }, [initialEntries, setEntries])

  const handleSpin = useCallback(() => {
    if (wheel.isSpinning || restaurants.length === 0) return
    onSpinStart()
    wheel.spin()
  }, [wheel, restaurants.length, onSpinStart])

  if (restaurants.length === 0) {
    return (
      <div className="relative aspect-square w-full max-w-[min(72vw,18rem)]">
        <div className="absolute inset-0 flex items-center justify-center rounded-full border border-border bg-muted">
          <div className="text-center p-4">
            <svg className="w-12 h-12 mx-auto text-muted-foreground mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm text-muted-foreground">No restaurants match your filters</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="-mt-2 flex w-full min-w-0 justify-center overflow-visible">
      <div className="relative h-[358px] w-[307px] overflow-visible max-[360px]:h-[342px] max-[360px]:w-[292px] min-[390px]:h-[388px] min-[390px]:w-[333px] sm:h-[368px] sm:w-[318px]">
        <div className="absolute left-1/2 top-0 w-[465px] origin-top -translate-x-1/2 scale-[0.6] max-[360px]:scale-[0.57] min-[390px]:scale-[0.65] sm:scale-[0.62]">
        <SpinnerWheel
          entries={wheel.entries}
          isSpinning={wheel.isSpinning}
          winner={wheel.winner}
          currentSegment={wheel.currentSegment}
          showWinnerPopup={false}
          onEntriesChange={wheel.setEntries}
          onSpin={handleSpin}
          onSpinComplete={wheel.handleSpinComplete}
          onSegmentChange={wheel.handleSegmentChange}
          onWinnerPopupClose={wheel.closeWinnerPopup}
          showEntryInput={false}
          audioEnabled={true}
          confettiEnabled={false}
          tickPath={`${import.meta.env.BASE_URL}media/spinner-wheel-tick.mp3`}
          celebrationPath={`${import.meta.env.BASE_URL}media/spinner-wheel-celebration.mp3`}
          canvasSize={465}
          spinDuration={6}
          spinRevolutions={6}
        />
        </div>
      </div>
    </div>
  )
}
