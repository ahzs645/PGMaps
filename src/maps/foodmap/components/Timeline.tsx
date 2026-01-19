import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ChevronLeft, ChevronRight, Play, Pause } from 'lucide-react'

interface TimelineProps {
  startDate: Date
  endDate: Date
  currentDate: Date
  onDateChange: (date: Date) => void
}

const speedOptions = [
  { value: '2000', label: '0.5x' },
  { value: '1000', label: '1x' },
  { value: '500', label: '2x' },
  { value: '250', label: '4x' }
]

function snapToMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

export function Timeline({ startDate, endDate, currentDate, onDateChange }: TimelineProps) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [playSpeed, setPlaySpeed] = useState('1000')
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const progress = useMemo(() => {
    const total = endDate.getTime() - startDate.getTime()
    const current = currentDate.getTime() - startDate.getTime()
    return Math.max(0, Math.min(100, (current / total) * 100))
  }, [startDate, endDate, currentDate])

  const formattedDate = useMemo(() => {
    return currentDate.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long'
    })
  }, [currentDate])

  const formattedStartDate = useMemo(() => {
    return startDate.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short'
    })
  }, [startDate])

  const formattedEndDate = useMemo(() => {
    return endDate.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short'
    })
  }, [endDate])

  const yearMarkers = useMemo(() => {
    const markers: { year: number; position: number }[] = []
    const startYear = startDate.getFullYear()
    const endYear = endDate.getFullYear()
    const totalTime = endDate.getTime() - startDate.getTime()

    for (let year = startYear; year <= endYear; year++) {
      const yearStart = new Date(year, 0, 1)
      if (yearStart >= startDate && yearStart <= endDate) {
        const position = ((yearStart.getTime() - startDate.getTime()) / totalTime) * 100
        markers.push({ year, position })
      }
    }
    return markers
  }, [startDate, endDate])

  const stepForward = useCallback(() => {
    const newDate = new Date(currentDate)
    newDate.setMonth(newDate.getMonth() + 1)
    newDate.setDate(1)
    if (newDate <= endDate) {
      onDateChange(newDate)
    } else {
      setIsPlaying(false)
    }
  }, [currentDate, endDate, onDateChange])

  const stepBackward = useCallback(() => {
    const newDate = new Date(currentDate)
    newDate.setMonth(newDate.getMonth() - 1)
    newDate.setDate(1)
    if (newDate >= startDate) {
      onDateChange(newDate)
    }
  }, [currentDate, startDate, onDateChange])

  const handleSliderChange = useCallback((value: number[]) => {
    const progressValue = value[0]
    const total = endDate.getTime() - startDate.getTime()
    const newTime = startDate.getTime() + (total * progressValue / 100)
    onDateChange(snapToMonth(new Date(newTime)))
  }, [startDate, endDate, onDateChange])

  const togglePlay = useCallback(() => {
    setIsPlaying(prev => !prev)
  }, [])

  // Handle play/pause and speed changes
  useEffect(() => {
    if (isPlaying) {
      playIntervalRef.current = setInterval(stepForward, parseInt(playSpeed))
    } else {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current)
        playIntervalRef.current = null
      }
    }

    return () => {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current)
      }
    }
  }, [isPlaying, playSpeed, stepForward])

  return (
    <div className="bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm rounded-lg shadow-lg p-4 min-w-[320px]">
      {/* Current Date Display */}
      <div className="text-center mb-3">
        <span className="text-lg font-bold text-gray-900 dark:text-white">{formattedDate}</span>
      </div>

      {/* Controls Row */}
      <div className="flex items-center justify-center gap-2 mb-3">
        {/* Step Backward */}
        <Button
          variant="ghost"
          size="icon"
          onClick={stepBackward}
          title="Previous month"
          className="h-8 w-8"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        {/* Play/Pause */}
        <Button
          size="icon"
          onClick={togglePlay}
          title={isPlaying ? 'Pause' : 'Play'}
          className="h-8 w-8 bg-blue-500 hover:bg-blue-600"
        >
          {isPlaying ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </Button>

        {/* Step Forward */}
        <Button
          variant="ghost"
          size="icon"
          onClick={stepForward}
          title="Next month"
          className="h-8 w-8"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>

        {/* Speed Control */}
        <Select value={playSpeed} onValueChange={setPlaySpeed}>
          <SelectTrigger className="w-16 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {speedOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Slider */}
      <div className="relative mb-2">
        <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-2">
          <span>{formattedStartDate}</span>
          <span>{formattedEndDate}</span>
        </div>

        <Slider
          value={[progress]}
          onValueChange={handleSliderChange}
          max={100}
          step={0.1}
          className="mb-2"
        />

        {/* Year markers */}
        <div className="relative h-4">
          {yearMarkers.map((marker) => (
            <div
              key={marker.year}
              className="absolute transform -translate-x-1/2 flex flex-col items-center"
              style={{ left: `${marker.position}%` }}
            >
              <div className="w-0.5 h-2 bg-gray-400 dark:bg-gray-500" />
              <span className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
                {marker.year}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
