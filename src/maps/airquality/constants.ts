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
