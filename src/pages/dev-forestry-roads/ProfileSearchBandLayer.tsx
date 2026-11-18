import type { SearchBandSample } from './profileSearchBand'

/** RoadEng draws its vertical band dotted green. */
export const SEARCH_BAND_COLOR = '#16a34a'

/**
 * The band the last profile search placed PVIs in, behind the ground and formation: a light hatched
 * fill bounded by dotted lines at the band's low and high edges (`searchBandSamples`).
 */
export function ProfileSearchBandLayer({
  samples,
  x,
  y,
  id,
}: {
  samples: readonly SearchBandSample[]
  x: (chainage: number) => number
  y: (elevation: number) => number
  /** Unique per chart, for the hatch pattern's id. */
  id: string
}) {
  if (samples.length < 2) return null
  const point = (chainage: number, elevation: number) => `${x(chainage).toFixed(1)},${y(elevation).toFixed(1)}`
  const high = samples.map((p) => point(p.chainage, p.high))
  const low = samples.map((p) => point(p.chainage, p.low))
  const outline = [...high, ...[...low].reverse()].join(' ')
  const pattern = `profile-search-band-${id}`
  return (
    <g pointerEvents="none" data-testid="road-profile-search-band">
      <defs>
        <pattern id={pattern} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1={0} y1={0} x2={0} y2={6} stroke={SEARCH_BAND_COLOR} strokeWidth={1} strokeOpacity={0.3} />
        </pattern>
      </defs>
      <polygon points={outline} fill={SEARCH_BAND_COLOR} fillOpacity={0.05} />
      <polygon points={outline} fill={`url(#${pattern})`} />
      {[high, low].map((line, index) => (
        <polyline
          key={index}
          points={line.join(' ')}
          fill="none"
          stroke={SEARCH_BAND_COLOR}
          strokeWidth={1.25}
          strokeDasharray="1 3"
          strokeLinecap="round"
        />
      ))}
    </g>
  )
}
