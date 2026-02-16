import { useState, useMemo, useCallback } from 'react'
import { SpinnerWheelCanvas, SpinnerWheelLabel, useAudio } from '@firstform/spinnerwheel'
import '@firstform/spinnerwheel/styles'
import type { WheelEntry, WheelSegment } from '@firstform/spinnerwheel'
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
  const [isSpinning, setIsSpinning] = useState(false)
  const [currentSegment, setCurrentSegment] = useState<WheelSegment | null>(null)

  const { playTick, playCelebration } = useAudio({
    enabled: true,
    tickPath: `${import.meta.env.BASE_URL}media/spinner-wheel-tick.mp3`,
    celebrationPath: `${import.meta.env.BASE_URL}media/spinner-wheel-celebration.mp3`,
  })

  const entries: WheelEntry[] = useMemo(() => {
    return restaurants.map((r, i) => ({
      id: r.details_url || `restaurant-${i}`,
      name: r.name
    }))
  }, [restaurants])

  const handleSpin = useCallback(() => {
    if (isSpinning || restaurants.length === 0) return
    setIsSpinning(true)
    onSpinStart()
  }, [isSpinning, restaurants.length, onSpinStart])

  const handleSegmentChange = useCallback((segment: WheelSegment) => {
    setCurrentSegment(segment)
  }, [])

  const handleSpinComplete = useCallback((segment: WheelSegment) => {
    setIsSpinning(false)
    setCurrentSegment(segment)
    playCelebration()
    const winnerName = segment.fullText || segment.text
    const winner = restaurants.find(r => r.name === winnerName)
    if (winner) {
      onSpinComplete(winner)
    }
  }, [restaurants, onSpinComplete, playCelebration])

  if (restaurants.length === 0) {
    return (
      <div className="relative w-72 h-72">
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
    <div className="flex flex-col items-center w-full max-w-[280px]">
      {currentSegment ? (
        <SpinnerWheelLabel
          text={currentSegment.fullText || currentSegment.text}
          backgroundColor={currentSegment.fillStyle}
          variant="white"
          className="mb-4"
        />
      ) : (
        <div className="spinner-wheel-label --white mb-4" style={{ width: '256px' }}>
          <span className="spinner-wheel-label__prompt" style={{ color: 'hsl(var(--foreground))' }}>Press &#9658; to spin the wheel</span>
        </div>
      )}
      <div style={{ transform: 'scale(0.7)', transformOrigin: 'center center', marginTop: '-70px', marginBottom: '-70px' }}>
        <SpinnerWheelCanvas
          entries={entries}
          isSpinning={isSpinning}
          canvasSize={465}
          spinDuration={6}
          spinRevolutions={6}
          onSpin={handleSpin}
          onSpinComplete={handleSpinComplete}
          onSegmentChange={handleSegmentChange}
          onTickSound={playTick}
        />
      </div>
    </div>
  )
}
