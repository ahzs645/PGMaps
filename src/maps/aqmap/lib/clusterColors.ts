import type { ExpressionSpecification } from 'maplibre-gl'
import type { AqClusterColorScheme } from './aqMapTypes'

// erstat.ca-inspired sequential blue-gray ramp for the Reveal-mode cluster
// bubbles: it starts at a light slate and darkens as the cluster count rises
// (more monitors = darker). Anchored on erstat's accent #4f6479.
const SLATE_FILL: ExpressionSpecification = [
  'step', ['get', 'point_count'],
  '#cbd6e2',
  10, '#9fb2c4',
  25, '#6e879d',
  50, '#4f6479',
  100, '#3a4a5a',
  250, '#1e2730',
]

// Light outline once the fill goes dark so the bubble keeps its edge.
const SLATE_STROKE: ExpressionSpecification = [
  'step', ['get', 'point_count'],
  '#64748b',
  50, '#cbd5e1',
]

// Flip the count label to light text on the darker (higher-count) bubbles.
const SLATE_TEXT: ExpressionSpecification = [
  'step', ['get', 'point_count'],
  '#0f172a',
  50, '#f8fafc',
]

// Classic look (unchanged from the original): near-white bubble, slate edge.
const CLASSIC_FILL = '#f8fafc'
const CLASSIC_STROKE = '#334155'
const CLASSIC_TEXT = '#0f172a'

export function getClusterCircleColor(scheme: AqClusterColorScheme): string | ExpressionSpecification {
  return scheme === 'slate' ? SLATE_FILL : CLASSIC_FILL
}

export function getClusterStrokeColor(scheme: AqClusterColorScheme): string | ExpressionSpecification {
  return scheme === 'slate' ? SLATE_STROKE : CLASSIC_STROKE
}

export function getClusterCountTextColor(scheme: AqClusterColorScheme): string | ExpressionSpecification {
  return scheme === 'slate' ? SLATE_TEXT : CLASSIC_TEXT
}

// Keep the drawn bubble size proportional to the cluster spacing, while using
// the same count breaks as the slate color ramp. This lets darker/higher-count
// clusters stay visually larger without making the whole cluster field dominate
// the map at continental zooms.
export function getClusterCircleRadius(clusterRadius: number, tightPacking = false): ExpressionSpecification {
  if (tightPacking) {
    const xs = Math.max(8, Math.round(clusterRadius * 0.22))
    const sm = Math.max(9, Math.round(clusterRadius * 0.26))
    const md = Math.max(10, Math.round(clusterRadius * 0.3))
    const lg = Math.max(12, Math.round(clusterRadius * 0.34))
    const xl = Math.max(14, Math.round(clusterRadius * 0.39))
    const xxl = Math.max(16, Math.round(clusterRadius * 0.44))
    return ['step', ['get', 'point_count'], xs, 10, sm, 25, md, 50, lg, 100, xl, 250, xxl]
  }
  const xs = Math.max(9, Math.round(clusterRadius * 0.26))
  const sm = Math.max(10, Math.round(clusterRadius * 0.3))
  const md = Math.max(12, Math.round(clusterRadius * 0.34))
  const lg = Math.max(14, Math.round(clusterRadius * 0.39))
  const xl = Math.max(16, Math.round(clusterRadius * 0.44))
  const xxl = Math.max(18, Math.round(clusterRadius * 0.49))
  return ['step', ['get', 'point_count'], xs, 10, sm, 25, md, 50, lg, 100, xl, 250, xxl]
}
