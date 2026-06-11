import type { CanueVariableSelection } from '../canueV2'

export function canueV2Paint(selection: CanueVariableSelection | null) {
  if (!selection) return '#e5e7eb'
  const low = selection.min ?? 0
  const high = selection.max != null && selection.max !== low ? selection.max : low + 1
  const mid = low + (high - low) / 2

  return [
    'case',
    ['!', ['has', selection.property]],
    '#e5e7eb',
    ['==', ['get', selection.property], null],
    '#e5e7eb',
    [
      'interpolate',
      ['linear'],
      ['to-number', ['get', selection.property]],
      low,
      '#67e8f9',
      mid,
      '#facc15',
      high,
      '#ef4444',
    ],
  ]
}

export function canueBoundaryPaint(property: string, minValue: number | null, maxValue: number | null) {
  const low = minValue ?? 0
  const high = maxValue != null && maxValue !== low ? maxValue : low + 1
  const mid = low + (high - low) / 2

  return [
    'case',
    ['!', ['has', property]],
    '#e5e7eb',
    ['==', ['get', property], null],
    '#e5e7eb',
    ['interpolate', ['linear'], ['to-number', ['get', property]], low, '#67e8f9', mid, '#facc15', high, '#ef4444'],
  ]
}
