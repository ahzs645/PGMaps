export const NETWORK_COLORS: Record<string, string> = {
  PA: '#a855f7',
  FEM: '#22c55e',
  EGG: '#3b82f6',
  SPARTAN: '#f59e0b',
  ASCENT: '#0ea5e9',
  'BC ENV': '#0d9488',
  'EPA IMPROVE': '#14b8a6',
  'EPA NATTS': '#f97316',
  'EPA NCORE': '#6366f1',
  'EPA CSN STN': '#8b5cf6',
  'EPA NEAR ROAD': '#facc15'
}

export function getNetworkColor(network: string): string {
  return NETWORK_COLORS[network] || '#64748b'
}

/**
 * Study-area fill ramps, low to high: a green-to-red scale for PM2.5 and a
 * blue scale for sensor counts and densities. The boundary layer and its
 * legend both read these.
 */
export const BOUNDARY_PM25_COLOR_RAMP = ['#dcfce7', '#fde047', '#fb923c', '#b91c1c'] as const
export const BOUNDARY_COUNT_COLOR_RAMP = ['#e0f2fe', '#7dd3fc', '#0ea5e9', '#0369a1'] as const

export function getBoundaryColorRamp(metric: string): readonly [string, string, string, string] {
  return metric === 'correctedPm25' || metric === 'rawPm25' ? BOUNDARY_PM25_COLOR_RAMP : BOUNDARY_COUNT_COLOR_RAMP
}
