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

// Keep the bubble size proportional to the cluster spacing so big clusters
// can't grow wider than the gap between clusters (the cause of overlap). The
// floors keep 2–3 digit counts legible even at a small clusterRadius.
//
// tightPacking caps the largest bubble at exactly clusterRadius/2 so two
// adjacent clusters only touch (near-zero overlap), with lower text floors —
// the trade-off is cramped 3-digit counts.
export function getClusterCircleRadius(clusterRadius: number, tightPacking = false): ExpressionSpecification {
  if (tightPacking) {
    const base = Math.max(9, Math.round(clusterRadius * 0.32))
    const mid = Math.max(10, Math.round(clusterRadius * 0.4))
    const large = Math.max(12, Math.round(clusterRadius * 0.5))
    return ['step', ['get', 'point_count'], base, 40, mid, 150, large]
  }
  const base = Math.max(10, Math.round(clusterRadius * 0.4))
  const mid = Math.max(13, Math.round(clusterRadius * 0.48))
  const large = Math.max(15, Math.round(clusterRadius * 0.56))
  return ['step', ['get', 'point_count'], base, 40, mid, 150, large]
}
