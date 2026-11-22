import { useMemo } from 'react'
import { Pentagon, X } from 'lucide-react'
import { LineBandChart, type XYDomain } from '@pgmaps/geo-toolkit/visualizations/react'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert } from '@/components/ui/map-panels'
import { ValueHistogram } from '@/components/ui/value-histogram'
import { rampColour, SENTINEL_INDICES } from './indices'
import {
  SENTINEL_AREA_MAX_KM,
  SENTINEL_SERIES_MAX_SCENES,
  SENTINEL_SERIES_MIN_CLEAR_SHARE,
  SENTINEL_SERIES_MIN_COVERAGE,
} from '@/lib/sentinel2/limits'
import type { SeriesPoint } from './areaSeries'
import type { SentinelArea, SentinelAreaSeries } from './useSentinelAreaSeries'

/** The plan's area sketch, as the panel needs it. */
export type AreaDrawing = {
  active: boolean
  /** False while another plan tool holds the plan's clicks. */
  canStart: boolean
  points: number
  start: () => void
  cancel: () => void
}

const SERIES_COLOUR = '#2563eb'
const DROP_COLOUR = '#dc2626'
const percent = (share: number) => `${Math.round(share * 100)}%`
const monthTick = new Intl.DateTimeFormat('en-CA', { year: '2-digit', month: 'short', timeZone: 'UTC' })
const value2 = (value: number) => value.toFixed(2)

type ChartPoint = { x: number; y: number | null; date: string; clear: number }
const chartPoint = (point: SeriesPoint): ChartPoint => ({
  x: Date.parse(point.datetime),
  y: point.mean,
  date: point.date,
  clear: point.clearShare,
})

/**
 * The area's index through time and the histogram for the selected scene, under the Sentinel-2
 * card's display. Values here; what they mean behind the InfoTips.
 */
export function Sentinel2AreaSeries({
  area,
  series,
  drawing,
  selectedSceneId,
  onClear,
}: {
  area: SentinelArea | null
  series: SentinelAreaSeries
  drawing: AreaDrawing
  /** The scene the histogram shows: the picked scene, or the later one of a change pair. */
  selectedSceneId: string | null
  onClear: () => void
}) {
  const spec = SENTINEL_INDICES[series.index]
  const clear = series.points.filter((point) => point.mean !== null)
  const gaps = series.points.filter((point) => point.gap)
  const chart = useMemo(() => {
    const line = series.points.filter((point) => point.mean !== null).map(chartPoint)
    const drop = series.drop ? [chartPoint(series.drop.earlier), chartPoint(series.drop.later)] : []
    const xs = series.points.map((point) => Date.parse(point.datetime))
    const ys = line.map((point) => point.y!)
    const [low, high] = ys.length ? [Math.min(...ys), Math.max(...ys)] : [0, 1]
    const pad = Math.max(0.05, (high - low) * 0.15)
    const span = Math.max(1, Math.max(...xs) - Math.min(...xs))
    const extent: XYDomain = [Math.min(...xs) - span * 0.03, Math.max(...xs) + span * 0.03, low - pad, high + pad]
    return {
      extent,
      lines: [
        { id: 'mean', label: `${spec.label} mean`, color: SERIES_COLOUR, points: line, strokeWidth: 1.5 },
        ...(drop.length
          ? [{ id: 'drop', label: `${spec.label} fall`, color: DROP_COLOUR, points: drop, strokeWidth: 3 }]
          : []),
      ],
    }
  }, [series.points, series.drop, spec.label])
  const selected = series.points.find((point) => point.sceneId === selectedSceneId) ?? null

  return (
    <div className="space-y-1.5 border-t pt-2" data-testid="road-sentinel2-area">
      <div className="flex items-center gap-1">
        <span className="font-medium">Area series</span>
        <InfoTip label="About the area series" bubbleClassName="max-w-72">
          The mean {spec.label} over the area&apos;s clear pixels in each scene the card offers (this list and earlier
          years you searched here), at most {SENTINEL_SERIES_MAX_SCENES}, spread evenly over time. A scene whose tile
          covers under {percent(SENTINEL_SERIES_MIN_COVERAGE)} of the area, or with under{' '}
          {percent(SENTINEL_SERIES_MIN_CLEAR_SHARE)} of it clear, is a gap, never a value. The red segment brackets
          where the index fell by {spec.drop} or more and stayed down: the median of the clear scenes before it minus
          the median of those after. The change happened some time between those two scenes. A fall that comes back
          (haze, smoke or thin cloud the scene classification missed) is a short dip and is left out. Areas up to{' '}
          {SENTINEL_AREA_MAX_KM} km across. Evidence only; nothing here is written into the project.
        </InfoTip>
        {area && (
          <Button
            size="icon-2xs"
            variant="ghost"
            className="ml-auto"
            aria-label="Clear the Sentinel-2 area"
            onClick={onClear}
          >
            <X className="size-3" />
          </Button>
        )}
      </div>
      {!area &&
        (drawing.active ? (
          <InlineAlert>
            <span>
              {drawing.points < 3 ? 'Click points on the plan.' : 'Click the first point or double-click to close.'}
            </span>
            <Button size="2xs" variant="outline" className="mt-1 w-full" onClick={drawing.cancel}>
              Cancel
            </Button>
          </InlineAlert>
        ) : (
          <div className="space-y-1">
            <Button
              size="2xs"
              variant="outline"
              className="w-full"
              disabled={!drawing.canStart}
              onClick={drawing.start}
            >
              <Pentagon className="size-3" />
              Draw area
            </Button>
            <p className="text-2xs text-muted-foreground">or click a cutblock and choose Sentinel-2 series</p>
          </div>
        ))}
      {area && (
        <>
          <p className="truncate" data-testid="road-sentinel2-area-name">
            {area.name} · {area.areaHa.toFixed(1)} ha · {spec.label}
          </p>
          {series.failure && <InlineAlert tone="error">{series.failure.message}</InlineAlert>}
          {series.loading && (
            <InlineAlert loading>
              Reading scene {Math.min(series.points.length + 1, series.total)} of {series.total}…
            </InlineAlert>
          )}
          {!series.loading && !series.failure && series.total === 0 && (
            <InlineAlert>No scenes listed for this view yet.</InlineAlert>
          )}
          {series.points.length > 0 && (
            <div data-testid="road-sentinel2-series-chart">
              <LineBandChart
                series={chart.lines}
                height={150}
                extent={chart.extent}
                label={`Mean ${spec.label} over ${area.name} in ${clear.length} clear scenes`}
                xAxis={{ format: (time) => monthTick.format(time) }}
                yAxis={{ width: 56, format: value2 }}
                empty={<InlineAlert>No clear scene yet.</InlineAlert>}
                renderTooltip={(point) => (
                  <>
                    <div className="font-medium">{point.date}</div>
                    <div>
                      {spec.label} {value2(Number(point.y))} · clear {percent(point.clear)}
                    </div>
                  </>
                )}
              />
            </div>
          )}
          {!series.loading && series.points.length > 0 && (
            <p data-testid="road-sentinel2-series-drop">
              {series.drop ? (
                <>
                  {spec.label} fell {value2(series.drop.fall)}: {series.drop.label} (Sentinel-2)
                  {series.drop.scenesAfter < 2 && <> · one clear scene after it so far</>}
                </>
              ) : clear.length < 2 ? (
                <>Fewer than two clear scenes</>
              ) : (
                <>
                  No lasting fall of {spec.drop} or more between clear scenes ({clear.length} of {series.points.length}{' '}
                  clear)
                </>
              )}
              {series.dips > 0 && (
                <span className="text-muted-foreground">
                  {' '}
                  · {series.dips} short {series.dips === 1 ? 'dip' : 'dips'} left out
                </span>
              )}
            </p>
          )}
          {gaps.length > 0 && (
            <p className="text-2xs text-muted-foreground" data-testid="road-sentinel2-series-gaps">
              Gaps: {gaps.map((point) => `${point.date} (${point.gap!.text})`).join('; ')}
            </p>
          )}
          {series.offered > series.total && (
            <p className="text-2xs text-muted-foreground">
              {series.total} of {series.offered} offered scenes, spread over time
            </p>
          )}
          {selected?.histogram ? (
            <ValueHistogram
              data-testid="road-sentinel2-histogram"
              histogram={selected.histogram}
              label={`${spec.label} in ${area.name} on ${selected.date}`}
              unit="pixels"
              formatValue={value2}
              barColor={(bin) => `rgb(${rampColour(spec.stops, (bin.from + bin.to) / 2).join(' ')})`}
              markers={[{ value: selected.histogram.mean, label: 'mean' }]}
              height={56}
            />
          ) : (
            selectedSceneId &&
            !series.loading &&
            series.points.length > 0 && (
              <p className="text-2xs text-muted-foreground">The selected scene is not in the series.</p>
            )
          )}
          {selected?.histogram && (
            <p className="text-2xs text-muted-foreground">
              {selected.date}: {selected.histogram.binned} clear pixels · clear {percent(selected.clearShare)}
              {selected.gap ? ` · gap: ${selected.gap.text}` : ''}
            </p>
          )}
        </>
      )}
    </div>
  )
}
