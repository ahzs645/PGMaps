import { useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { AppSelect } from '@/components/ui/select'
import { YEAR_FILTER_DOMAIN, yearHistogramBins } from './data'
import type { YearRange } from './types'

export function YearFilterWidget({
  value,
  onChange,
}: {
  value: YearRange
  onChange: (value: YearRange) => void
}) {
  const [minYear, maxYear] = YEAR_FILTER_DOMAIN
  const svgRef = useRef<SVGSVGElement>(null)
  const dragAnchorYear = useRef<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [hoveredYear, setHoveredYear] = useState<number | null>(null)
  const maxCount = Math.max(...yearHistogramBins.map((bin) => bin.count))
  const hoveredBin = yearHistogramBins.find((bin) => bin.year === hoveredYear) ?? null
  const selectedCount = yearHistogramBins
    .filter((bin) => bin.year >= value[0] && bin.year <= value[1])
    .reduce((total, bin) => total + bin.count, 0)

  const setStart = (year: number) => onChange([Math.min(year, value[1]), value[1]])
  const setEnd = (year: number) => onChange([value[0], Math.max(year, value[0])])
  const yearOptions = years().map((year) => ({ value: String(year), label: year }))
  const updateRangeFromPointer = (clientX: number, anchorYear: number) => {
    const year = clientXToYear(clientX, svgRef.current, minYear, maxYear)
    if (year === null) return
    onChange([Math.min(anchorYear, year), Math.max(anchorYear, year)])
  }

  return (
    <div className="border-t border-border pt-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Year issued</h3>
        <button
          type="button"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() => onChange(YEAR_FILTER_DOMAIN)}
          aria-label="Reset year filter"
        >
          <RotateCcw className="size-4" />
        </button>
      </div>

      <svg
        ref={svgRef}
        width="100%"
        height="74"
        viewBox="0 0 248 74"
        role="slider"
        aria-label="Year issued filter"
        aria-valuemin={minYear}
        aria-valuemax={maxYear}
        aria-valuetext={`${value[0]} to ${value[1]}, estimated ${selectedCount.toLocaleString()} matching records`}
        tabIndex={0}
        className="block cursor-pointer overflow-visible rounded-sm touch-none select-none outline-none"
        onPointerDown={(event) => {
          const year = clientXToYear(event.clientX, svgRef.current, minYear, maxYear)
          if (year === null) return
          setHoveredYear(year)
          event.currentTarget.setPointerCapture(event.pointerId)
          dragAnchorYear.current = year
          setIsDragging(true)
          onChange([year, year])
        }}
        onPointerMove={(event) => {
          const year = clientXToYear(event.clientX, svgRef.current, minYear, maxYear)
          if (year !== null) setHoveredYear(year)
          if (!isDragging || dragAnchorYear.current === null) return
          updateRangeFromPointer(event.clientX, dragAnchorYear.current)
        }}
        onPointerUp={(event) => {
          if (dragAnchorYear.current !== null) updateRangeFromPointer(event.clientX, dragAnchorYear.current)
          dragAnchorYear.current = null
          setIsDragging(false)
        }}
        onPointerCancel={() => {
          dragAnchorYear.current = null
          setIsDragging(false)
        }}
        onPointerLeave={() => {
          if (!isDragging) setHoveredYear(null)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') {
            event.preventDefault()
            setEnd(Math.max(minYear, value[1] - 1))
          }
          if (event.key === 'ArrowRight') {
            event.preventDefault()
            setEnd(Math.min(maxYear, value[1] + 1))
          }
        }}
      >
        <g transform="translate(0 14)">
          <line x1="0" x2="248" y1="42" y2="42" className="stroke-border" />
          {yearHistogramBins.map((bin, index) => {
            const width = 248 / yearHistogramBins.length - 2
            const x = index * (248 / yearHistogramBins.length) + 1
            const height = Math.max(5, (bin.count / maxCount) * 41)
            const selected = bin.year >= value[0] && bin.year <= value[1]
            return (
              <rect
                key={bin.year}
                x={x}
                y={42 - height}
                width={width}
                height={height}
                rx="1"
                className={selected ? 'fill-primary/80 hover:fill-primary' : 'fill-muted-foreground/25 hover:fill-muted-foreground/45'}
                onPointerEnter={() => setHoveredYear(bin.year)}
              />
            )
          })}
          <rect
            x={yearToX(value[0], minYear, maxYear)}
            y="0"
            width={Math.max(4, yearToX(value[1], minYear, maxYear) - yearToX(value[0], minYear, maxYear))}
            height="42"
            className="pointer-events-none fill-primary/15 stroke-primary/45"
          />
          <RangeHandle x={yearToX(value[0], minYear, maxYear)} side="start" />
          <RangeHandle x={yearToX(value[1], minYear, maxYear)} side="end" />
          {hoveredBin ? (
            <text
              x={barCenterX(hoveredBin.year)}
              y={Math.max(-8, 42 - Math.max(5, (hoveredBin.count / maxCount) * 41) - 5)}
              textAnchor="middle"
              className="pointer-events-none fill-foreground text-[10px] font-semibold"
            >
              {hoveredBin.count.toLocaleString()}
            </text>
          ) : (
            <text x={(yearToX(value[0], minYear, maxYear) + yearToX(value[1], minYear, maxYear)) / 2} y="-6" textAnchor="middle" className="fill-foreground text-[10px] font-semibold">
              {selectedCount.toLocaleString()}
            </text>
          )}
        </g>
      </svg>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="grid gap-1 text-[11px] font-medium text-muted-foreground">
          From
          <AppSelect
            value={String(value[0])}
            onValueChange={(nextValue) => setStart(Number(nextValue))}
            options={yearOptions}
            triggerClassName="h-8 border-border bg-background/80 px-2 text-sm text-foreground"
            triggerAriaLabel="From year"
          />
        </label>
        <label className="grid gap-1 text-[11px] font-medium text-muted-foreground">
          To
          <AppSelect
            value={String(value[1])}
            onValueChange={(nextValue) => setEnd(Number(nextValue))}
            options={yearOptions}
            triggerClassName="h-8 border-border bg-background/80 px-2 text-sm text-foreground"
            triggerAriaLabel="To year"
          />
        </label>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {value[0]} to {value[1]} · filters map, search, and table
      </p>
    </div>
  )
}

function barCenterX(year: number) {
  const index = yearHistogramBins.findIndex((bin) => bin.year === year)
  if (index < 0) return 0
  const step = 248 / yearHistogramBins.length
  return index * step + step / 2
}

function years() {
  const [minYear, maxYear] = YEAR_FILTER_DOMAIN
  return Array.from({ length: maxYear - minYear + 1 }, (_, index) => minYear + index)
}

function yearToX(year: number, minYear: number, maxYear: number) {
  return ((year - minYear) / (maxYear - minYear)) * 248
}

function clientXToYear(clientX: number, element: SVGSVGElement | null, minYear: number, maxYear: number) {
  if (!element) return null
  const rect = element.getBoundingClientRect()
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  return Math.round(minYear + ratio * (maxYear - minYear))
}

function RangeHandle({ x, side }: { x: number; side: 'start' | 'end' }) {
  const path = side === 'start'
    ? 'M1 0H7V12L0.310345 5.6289C0.112165 5.44016 0 5.17844 0 4.90476V1C0 0.447715 0.447715 0 1 0Z'
    : 'M6 0H0V12L6.68966 5.6289C6.88784 5.44016 7 5.17844 7 4.90476V1C7 0.447715 6.55228 0 6 0Z'

  return (
    <g transform={`translate(${x - (side === 'start' ? 6 : 0)} 0)`} className="fill-primary">
      <rect y="0" width="6" height="42" fill="transparent" x={side === 'start' ? 3.5 : -2.5} />
      <rect y="0" width="1" height="42" x={side === 'start' ? 6 : 0} />
      <path d={path} />
    </g>
  )
}
