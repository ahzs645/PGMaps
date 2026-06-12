import { useState, useEffect, useCallback } from 'react'
import type { RouletteRestaurant, HazardRating } from '../../types'

interface RouletteSlotProps {
  restaurants: RouletteRestaurant[]
  eligibleRestaurants: RouletteRestaurant[]
  winnerIndex: number | null
  isSpinning: boolean
  onSpinComplete: () => void
}

interface SlotCard extends RouletteRestaurant {
  id: string
}

const hazardColors: Record<HazardRating, { bg: string; border: string; text: string }> = {
  'Low': { bg: 'bg-green-500', border: 'border-green-500', text: 'text-green-500' },
  'Moderate': { bg: 'bg-amber-500', border: 'border-amber-500', text: 'text-amber-500' },
  'Unknown': { bg: 'bg-gray-500', border: 'border-gray-500', text: 'text-gray-500' }
}

function getHazardRating(restaurant: RouletteRestaurant): HazardRating {
  return (restaurant.current_hazard_rating || restaurant.hazard_rating || 'Unknown') as HazardRating
}

function getHazardColors(restaurant: RouletteRestaurant) {
  const rating = getHazardRating(restaurant)
  return hazardColors[rating] || hazardColors['Unknown']
}

function getDifficultyIndicator(restaurant: RouletteRestaurant) {
  const rating = getHazardRating(restaurant)
  switch (rating) {
    case 'Low': return '!'
    case 'Moderate': return '!!'
    case 'Unknown': return '!?'
    default: return '?'
  }
}

export function RouletteSlot({
  eligibleRestaurants,
  winnerIndex,
  isSpinning,
  onSpinComplete
}: RouletteSlotProps) {
  const [visibleCards, setVisibleCards] = useState<SlotCard[]>([])
  const [showWinner, setShowWinner] = useState(false)

  const initializeCards = useCallback(() => {
    if (eligibleRestaurants.length === 0) {
      setVisibleCards([])
      return
    }

    const cards: SlotCard[] = []
    for (let i = 0; i < 5; i++) {
      const idx = Math.floor(Math.random() * eligibleRestaurants.length)
      cards.push({
        ...eligibleRestaurants[idx],
        id: `init-${i}-${Date.now()}`
      })
    }
    setVisibleCards(cards)
    setShowWinner(false)
  }, [eligibleRestaurants])

  useEffect(() => {
    if (!isSpinning || eligibleRestaurants.length === 0 || winnerIndex === null) return

    setShowWinner(false)

    const winner = eligibleRestaurants[winnerIndex]
    const totalCards = 35

    const cards: SlotCard[] = []
    for (let i = 0; i < totalCards; i++) {
      if (i === totalCards - 3) {
        cards.push({ ...winner, id: `winner-${Date.now()}` })
      } else {
        const idx = Math.floor(Math.random() * eligibleRestaurants.length)
        cards.push({ ...eligibleRestaurants[idx], id: `spin-${i}-${Date.now()}` })
      }
    }

    const timeoutIds: number[] = []

    let currentTime = 0
    for (let i = 0; i < totalCards; i++) {
      const progress = i / totalCards
      const interval = 40 + Math.pow(progress, 2) * 310

      timeoutIds.push(window.setTimeout(() => {
        setVisibleCards(prev => [cards[i], ...prev.slice(0, 4)])
      }, currentTime))

      currentTime += interval
    }

    timeoutIds.push(window.setTimeout(() => {
      setShowWinner(true)
      onSpinComplete()
    }, currentTime + 600))

    return () => {
      timeoutIds.forEach((id) => window.clearTimeout(id))
    }
  }, [isSpinning, eligibleRestaurants, winnerIndex, onSpinComplete])

  useEffect(() => {
    initializeCards()
  }, [initializeCards])

  if (eligibleRestaurants.length === 0) {
    return (
      <div className="relative w-full max-w-md">
        <div className="h-80 flex items-center justify-center rounded-xl border border-border bg-muted">
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
    <div className="relative w-full max-w-md">
      <div className="relative h-80 overflow-hidden rounded-xl">
        <div className="absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-background to-transparent z-20 pointer-events-none"></div>
        <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-background to-transparent z-20 pointer-events-none"></div>

        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 py-8">
          {visibleCards.map((card, index) => {
            const colors = getHazardColors(card)
            let cardClass = 'border-transparent'
            let scaleClass = 'scale-[0.85] opacity-40'

            if (index === 2) {
              cardClass = showWinner
                ? 'border-sky-500 shadow-lg shadow-sky-500/25'
                : 'border-border shadow-md'
              scaleClass = 'scale-100 opacity-100'
            } else if (index === 1 || index === 3) {
              cardClass = 'border-border'
              scaleClass = 'scale-[0.92] opacity-70'
            }

            return (
              <div
                key={card.id}
                className={`w-full max-w-sm rounded-xl border-2 bg-background px-4 py-3 transition-all duration-150 ${cardClass} ${scaleClass}`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-lg shrink-0 ${colors.bg}`}
                  >
                    {getDifficultyIndicator(card)}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-foreground text-sm truncate">
                      {card.name}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {card.address}
                    </div>
                  </div>

                  {card.rouletteViolationCount !== undefined && (
                    <div className="shrink-0 rounded-full bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground">
                      {card.rouletteViolationCount} violations
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {showWinner && (
          <>
            <div className="absolute left-2 top-1/2 -translate-y-1/2 z-30">
              <div className="w-2 h-12 bg-sky-500 rounded-r-full"></div>
            </div>
            <div className="absolute right-2 top-1/2 -translate-y-1/2 z-30">
              <div className="w-2 h-12 bg-sky-500 rounded-l-full"></div>
            </div>
          </>
        )}
      </div>

      {showWinner && winnerIndex !== null && eligibleRestaurants[winnerIndex] && (
        <div className="mt-4 rounded-xl bg-sky-500 p-4 text-white">
          <div className="flex items-center gap-2 mb-2">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
            <span className="font-bold">Winner!</span>
          </div>
          <div className="text-lg font-semibold">{eligibleRestaurants[winnerIndex].name}</div>
          <div className="text-sky-100 text-sm">
            {eligibleRestaurants[winnerIndex].full_address || eligibleRestaurants[winnerIndex].address}
          </div>
        </div>
      )}
    </div>
  )
}
