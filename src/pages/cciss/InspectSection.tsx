import type { CategoricalRasterPick } from '@/components/ui/map-categorical-raster'
import { InlineAlert, SidebarSection } from '@/components/ui/map-panels'
import { StatGroup, type StatItem } from '@/components/ui/stat-group'
import { traceLabel } from './palette'
import { feasibilityClass } from './raster'
import type { SampleState } from './useRasterSource'

const coordinate = (value: number, positive: string, negative: string) =>
  `${Math.abs(value).toFixed(5)}° ${value < 0 ? negative : positive}`

/** One raster readout as a stat tile: the value, and the cell it came from underneath. */
function sampleItem(label: string, sample: SampleState, asClass: boolean): StatItem {
  const base = { key: label, label, compact: true }
  switch (sample.status) {
    case 'value':
      return {
        ...base,
        value: asClass ? feasibilityClass(sample.value) : sample.value,
        note: `Numeric raster cell: ${sample.value} · column ${sample.column}, row ${sample.row}`,
      }
    case 'loading':
      return { ...base, value: 'Reading cell…', tone: 'muted' }
    case 'outside':
      return { ...base, value: 'Outside this raster', tone: 'muted' }
    case 'nodata':
      return { ...base, value: 'No data at this point', tone: 'muted' }
    case 'empty':
      return { ...base, value: 'No file', tone: 'muted', note: 'Choose a GeoTIFF to read the value.' }
    case 'error':
      return { ...base, value: 'Unreadable', tone: 'danger' }
  }
}

function pickedText(pick: CategoricalRasterPick, trace: boolean) {
  if (trace)
    return `${traceLabel(pick.value)} · ${pick.overview ? 'generalized overview; zoom in for the full cell' : 'inferred from WebP colours, not a measured value'}`
  return `${feasibilityClass(pick.value)} · numeric code ${pick.value}${pick.overview ? ' · generalized overview; exact GeoTIFF cell shown separately' : ''}`
}

export function InspectSection({
  point,
  trace,
  polygonLayer,
  numericLayer,
  limits,
  productLabel,
  localFileName,
  suitability,
  bgc,
  pick,
}: {
  point: [number, number]
  /** The drawn polygons are the colour trace, not the numeric vector. */
  trace: boolean
  polygonLayer: boolean
  numericLayer: boolean
  /** The prepared product's caveat, when one matches the selection. */
  limits: string | null
  productLabel: string | null
  localFileName: string | null
  suitability: SampleState
  bgc: SampleState
  pick: CategoricalRasterPick | null
}) {
  const local = localFileName !== null
  const errors = [suitability, bgc].flatMap((sample) =>
    sample.status === 'error' && sample.message ? [sample.message] : [],
  )
  return (
    <SidebarSection title="Inspect a location">
      <p className="text-xs text-muted-foreground">
        {trace && numericLayer
          ? 'Click a traced polygon to inspect its inferred display class. The downloaded GeoTIFF below is a separate source.'
          : polygonLayer
            ? 'Click a polygon to compare its stored class with the numeric GeoTIFF cell.'
            : 'Click the map to read the downloaded numeric GeoTIFF. Compare public CCISS tiles, numeric raster rendering, and vector polygons.'}
      </p>
      <p className="mt-1 text-xs font-medium tabular-nums">
        {coordinate(point[1], 'N', 'S')}, {coordinate(point[0], 'E', 'W')}
      </p>
      {numericLayer || local ? (
        <div className="mt-3 space-y-2">
          {local ? (
            <p className="text-xs text-muted-foreground">
              Local file values are shown without assigning a suitability class. Confirm this file’s legend, grid and
              product; changing map options does not change the selected file.
            </p>
          ) : (
            limits && <InlineAlert tone="warning">{limits}</InlineAlert>
          )}
          <StatGroup
            variant="tiles"
            size="sm"
            align="start"
            items={[
              sampleItem(
                local ? `Local GeoTIFF value · ${localFileName}` : `${productLabel} GeoTIFF class`,
                suitability,
                !local,
              ),
              sampleItem('BGC raster ID', bgc, false),
            ]}
          />
          {errors.map((message) => (
            <InlineAlert key={message} tone="error">
              {message}
            </InlineAlert>
          ))}
          {polygonLayer && (
            <InlineAlert title={trace ? 'Inferred tile colour class' : 'Picked vector polygon'}>
              {pick ? pickedText(pick, trace) : 'Click a polygon to inspect its class.'}
            </InlineAlert>
          )}
        </div>
      ) : (
        <InlineAlert className="mt-3">
          Numeric lookup currently covers mapped 1961–1990 suitability for Pl on C4. Other selections are available
          through original CCISS image tiles in Comparison options.
        </InlineAlert>
      )}
    </SidebarSection>
  )
}
