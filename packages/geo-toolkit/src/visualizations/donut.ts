/** SVG attribute text is escaped even when the caller supplies authored colors. */
function escapeAttribute(value: string): string {
  return value.replace(
    /[&"'<>]/g,
    (character) =>
      ({
        '&': '&amp;',
        '"': '&quot;',
        "'": '&apos;',
        '<': '&lt;',
        '>': '&gt;',
      })[character]!,
  )
}

/**
 * SVG path for one donut wedge spanning [start, end] (fractions of the circle).
 * Stroke matches the fill so neighbouring arcs seal into one continuous ring.
 * @internal Map marker implementation; use renderDonutSvg in consumers.
 */
export function donutSegment(start: number, end: number, r: number, r0: number, color: string): string {
  if (end - start >= 1) end -= 0.0001
  const a0 = 2 * Math.PI * (start - 0.25)
  const a1 = 2 * Math.PI * (end - 0.25)
  const x0 = Math.cos(a0)
  const y0 = Math.sin(a0)
  const x1 = Math.cos(a1)
  const y1 = Math.sin(a1)
  const largeArc = end - start > 0.5 ? 1 : 0
  const d =
    `M ${r + r0 * x0} ${r + r0 * y0} L ${r + r * x0} ${r + r * y0} ` +
    `A ${r} ${r} 0 ${largeArc} 1 ${r + r * x1} ${r + r * y1} ` +
    `L ${r + r0 * x1} ${r + r0 * y1} A ${r0} ${r0} 0 ${largeArc} 0 ${r + r0 * x0} ${r + r0 * y0}`
  const escapedColor = escapeAttribute(color)
  return `<path d="${d}" fill="${escapedColor}" stroke="${escapedColor}" stroke-width="0.75" stroke-linejoin="round"/>`
}

/** @internal Abbreviate cluster totals in the thousands, e.g. 4,200 → "4k". */
export function formatClusterCount(total: number): string {
  if (total < 1000) return String(total)
  return `${Math.round(total / 1000)}k`
}

/** @internal Values that require an existing donut marker's SVG to be repainted. */
export function getDonutRenderKey(props: Record<string, unknown>, bandColors: readonly string[]): string {
  return [
    Number(props.aggregate_count) || Number(props.count) || 0,
    Number(props.point_count) || 0,
    ...bandColors.map((_, index) => Number(props[`band${index}`]) || 0),
  ].join(':')
}

export interface DonutOptions {
  counts: readonly number[]
  colors: readonly string[]
  /** Optional known aggregate; otherwise the non-missing counts are summed. */
  total?: number
  showCount?: boolean
  centerStyle?: 'white' | 'transparent'
  /** Fill for a solid centre; the default preserves existing white markers. */
  centerColor?: string
  textColor?: string
  /** Outline for count text over a transparent centre. */
  textHaloColor?: string
  shadow?: boolean
}

/** Pure SVG renderer usable in map markers, sidebars, stories, or server output. */
export function renderDonutSvg({
  counts: rawCounts,
  colors,
  total: aggregate,
  showCount = true,
  centerStyle = 'white',
  centerColor = '#ffffff',
  textColor = '#0f172a',
  textHaloColor = '#ffffff',
  shadow = true,
}: DonutOptions): { svg: string; size: number; total: number } {
  const counts = colors.map((_, index) => Number(rawCounts[index]) || 0)
  const total = aggregate ?? counts.reduce((sum, count) => sum + count, 0)
  const r = total >= 50 ? 24 : total >= 25 ? 21 : total >= 10 ? 18 : 15
  const r0 = Math.round(r * 0.62)
  const w = r * 2
  const fontSize = total >= 50 ? 13 : total >= 10 ? 12 : 11
  const n = Math.max(total, 1)
  const segments: string[] = []
  let placed = 0
  counts.forEach((count, band) => {
    if (count <= 0) return
    segments.push(donutSegment(placed / n, (placed + count) / n, r, r0, colors[band]))
    placed += count
  })
  const isWhiteCenter = centerStyle === 'white'
  const svg =
    `<svg width="${w}" height="${w}" viewBox="0 0 ${w} ${w}" text-anchor="middle" ` +
    `style="display:block;font:700 ${fontSize}px system-ui,sans-serif;${shadow ? 'filter:drop-shadow(0 1px 2px rgba(0,0,0,0.45));' : ''}">` +
    (isWhiteCenter ? `<circle cx="${r}" cy="${r}" r="${r}" fill="${escapeAttribute(centerColor)}"/>` : '') +
    segments.join('') +
    (isWhiteCenter ? `<circle cx="${r}" cy="${r}" r="${r0}" fill="${escapeAttribute(centerColor)}"/>` : '') +
    (showCount
      ? `<text x="${r}" y="${r}" dominant-baseline="central" fill="${escapeAttribute(textColor)}"` +
        (isWhiteCenter
          ? ''
          : ` stroke="${escapeAttribute(textHaloColor)}" stroke-width="3" paint-order="stroke" stroke-linejoin="round"`) +
        `>${formatClusterCount(total)}</text>`
      : '') +
    '</svg>'
  return { svg, size: w, total }
}

/**
 * Update the existing marker root so its position, listeners, and focus survive
 * changes to aggregate data. MapLibre property normalization stays an adapter.
 * @internal Map marker adapter; use renderDonutSvg in consumers.
 */
export function updateDonutElement(
  element: HTMLDivElement,
  props: Record<string, unknown>,
  bandColors: readonly string[],
  showCount: boolean,
  centerStyle: 'white' | 'transparent',
): void {
  const counts = bandColors.map((_, index) => Number(props[`band${index}`]) || 0)
  const total =
    Number(props.aggregate_count) ||
    Number(props.count) ||
    Number(props.point_count) ||
    counts.reduce((sum, count) => sum + count, 0)
  const { svg, size } = renderDonutSvg({ counts, colors: bandColors, total, showCount, centerStyle })
  element.innerHTML = svg
  element.style.cursor = 'pointer'
  element.style.width = `${size}px`
  element.style.height = `${size}px`
}

/** @internal Map marker adapter; use renderDonutSvg in consumers. */
export function createDonutElement(
  props: Record<string, unknown>,
  bandColors: readonly string[],
  showCount: boolean,
  centerStyle: 'white' | 'transparent',
): HTMLDivElement {
  const element = document.createElement('div')
  updateDonutElement(element, props, bandColors, showCount, centerStyle)
  return element
}

/** @internal Normalize MapLibre aggregated properties for the marker adapter. */
export function pieMarkerDonutProperties(
  properties: Record<string, unknown>,
  bandColors: readonly string[],
): Record<string, unknown> {
  let rawCounts: unknown[] = []
  if (Array.isArray(properties.bandCounts)) {
    rawCounts = properties.bandCounts
  } else if (typeof properties.bandCounts === 'string') {
    try {
      const parsed = JSON.parse(properties.bandCounts) as unknown
      if (Array.isArray(parsed)) rawCounts = parsed
    } catch {
      // MapLibre normally JSON-encodes array properties; malformed input falls
      // back to an empty set of wedges while retaining the location count.
    }
  }
  const counts = bandColors.map((_, index) => Number(rawCounts[index]) || 0)
  const countedTotal = counts.reduce((sum, count) => sum + count, 0)
  const total = Number(properties.count) || countedTotal
  return Object.fromEntries([['point_count', total], ...counts.map((count, index) => [`band${index}`, count] as const)])
}
