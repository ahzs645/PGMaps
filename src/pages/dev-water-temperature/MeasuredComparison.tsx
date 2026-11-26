import { useCallback, useState } from 'react'
import { ChartViewport, TimeSeriesChart } from '@pgmaps/geo-toolkit/visualizations/react'
import { InlineAlert } from '@/components/ui/map-panels'
import { Button } from '@/components/ui/button'
import { DAY, isoDate, normalizeObservations, normalizeStations, timestamp, type DateRange } from './data'
import { dailyWaterFile, waterJson } from './source'
import { useSourceResource } from './useSourceResource'
import { COLOCATED_IDS, dailyMeasuredAir, type WeatherRow, type WeatherStation } from './weatherData'

type ComparisonProps = { station: WeatherStation; range: NonNullable<DateRange>; weatherRows: WeatherRow[] }

export function MeasuredComparison({ station, range, weatherRows }: ComparisonProps) {
  if (!COLOCATED_IDS.some((id) => id === station.id)) return null
  return <Comparison key={range.join()} station={station} range={range} weatherRows={weatherRows} />
}

function Comparison({ station, range, weatherRows }: ComparisonProps) {
  const [open, setOpen] = useState(false)
  const [zoom, setZoom] = useState<readonly [number, number] | null>(null)
  const load = useCallback(
    async (signal: AbortSignal) => {
      const catalog = await waterJson('stations.json', signal)
      const waterStation = normalizeStations(catalog).find((item) => item.station_id === station.id)
      if (!waterStation) throw new Error('The matching station is unavailable in the water catalog.')
      const series = normalizeObservations(await waterJson(dailyWaterFile(waterStation.filename), signal))
      const water = new Map(series.map((item) => [item.date, item.temp_c]))
      const air = dailyMeasuredAir(weatherRows)
      const start = timestamp(range[0])
      const days = Math.round((timestamp(range[1]) - start) / DAY) + 1
      return Array.from({ length: days }, (_, index) => {
        const x = start + index * DAY
        const date = isoDate(x)
        return { x, water: water.get(date) ?? null, air: air.get(date) ?? null }
      })
    },
    [station, range, weatherRows],
  )
  const source = useSourceResource(open ? load : null)
  const paired = source.data?.filter((row) => row.water !== null && row.air !== null).length ?? 0

  return (
    <section aria-label="Co-located temperature comparison" className="space-y-2 border-t pt-3">
      <Button variant="outline" size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>
        Compare with co-located water temperature
      </Button>
      {open && (
        <>
          <p className="text-xs text-muted-foreground">
            Matches UNBC’s daily water dates to the weather station’s source calendar dates. A daily air mean requires
            at least 72 of 96 quarter-hour readings marked Pass (P).
          </p>
          {source.loading && <InlineAlert loading>Loading co-located water and air readings…</InlineAlert>}
          {source.error && (
            <InlineAlert tone="error">
              {source.error}{' '}
              <Button variant="outline" size="sm" onClick={source.retry}>
                Retry
              </Button>
            </InlineAlert>
          )}
          {source.data && (
            <>
              <p role="status" className="text-xs text-muted-foreground">
                {paired} dates with both temperatures.
              </p>
              {source.data.some((row) => row.water !== null || row.air !== null) ? (
                <ChartViewport className="h-[275px]">
                  {(height) => (
                    <TimeSeriesChart
                      rows={source.data!}
                      series={[
                        { id: 'water', label: 'UNBC water mean', color: '#0284c7' },
                        { id: 'air', label: 'Weather station air mean', color: '#a45304' },
                      ]}
                      range={zoom}
                      onRange={setZoom}
                      height={height}
                      label={`${station.name} daily water and measured air temperature`}
                      xAxis={{ format: isoDate }}
                      yAxis={{ label: '°C' }}
                      showPoints
                      formatValue={(value) => `${value.toFixed(1)} °C`}
                    />
                  )}
                </ChartViewport>
              ) : (
                <p className="text-sm text-muted-foreground">No daily temperatures are available in this range.</p>
              )}
            </>
          )}
        </>
      )}
    </section>
  )
}
