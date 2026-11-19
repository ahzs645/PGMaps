/**
 * The maps a consideration's paragraph carries, as the planners paste them under the TAP and caribou paragraphs: the
 * block, its access road and the features the paragraph speaks of, drawn from the same reads the route card made, in
 * BC Albers, north up, with a legend, a north arrow and a scale bar. Plain SVG strings, rasterised by the page
 * (`sheetPngBlob`); drawn from data only, never a screenshot. No DOM or network access.
 */
import { planarBounds, type Planar, type PlanarBounds, type XY } from './geometry'
import type { RouteCardMatch } from './query'
import type { RouteCardRowState } from './results'
import type { ConsiderationId } from './rows'

export const FIGURE_SIZE = { width: 960, height: 720 }

type Layer = {
  label: string
  shapes: Array<{ shape: Planar; name: string | null }>
  style: 'tap' | 'ogma' | 'uwr' | 'uwrNoHarvest'
}

export type RouteCardMapFigure = {
  consideration: ConsiderationId
  caption: string
  svg: string
  width: number
  height: number
}

const STYLE: Record<Layer['style'], { fill: string; stroke: string; opacity: number; dash?: string; swatch: string }> =
  {
    tap: { fill: '#8f8ff0', stroke: '#5b5bc8', opacity: 0.55, swatch: '#8f8ff0' },
    ogma: { fill: 'url(#ogma-hatch)', stroke: '#23753a', opacity: 1, swatch: '#23753a' },
    uwr: { fill: '#d36ddf', stroke: '#a32fb3', opacity: 0.14, dash: '10 6', swatch: '#d36ddf' },
    uwrNoHarvest: { fill: '#a32fb3', stroke: '#7a1f87', opacity: 0.35, swatch: '#a32fb3' },
  }

const esc = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** A row's features near the block and along its road, each once. */
function matchesOf(state: RouteCardRowState | undefined): RouteCardMatch[] {
  if (state?.status !== 'read') return []
  const seen = new Set<Planar>()
  return [...state.finding.matches, ...(state.finding.alongAccess ?? [])].filter((match) => {
    if (seen.has(match.shape)) return false
    seen.add(match.shape)
    return true
  })
}

const unionBounds = (a: PlanarBounds, b: PlanarBounds): PlanarBounds => [
  Math.min(a[0], b[0]),
  Math.min(a[1], b[1]),
  Math.max(a[2], b[2]),
  Math.max(a[3], b[3]),
]

/** The frame: the block and its road, with a margin, widened to the figure's shape. */
function frameFor(block: Planar, access: Planar | null): PlanarBounds {
  let box = planarBounds(block)
  if (access) box = unionBounds(box, planarBounds(access))
  const span = Math.max(box[2] - box[0], box[3] - box[1], 1200)
  const margin = Math.max(250, span * 0.18)
  let [w, s, e, n] = [box[0] - margin, box[1] - margin, box[2] + margin, box[3] + margin]
  const aspect = FIGURE_SIZE.width / FIGURE_SIZE.height
  const width = e - w
  const height = n - s
  if (width / height < aspect) {
    const grow = (height * aspect - width) / 2
    w -= grow
    e += grow
  } else {
    const grow = (width / aspect - height) / 2
    s -= grow
    n += grow
  }
  return [w, s, e, n]
}

function projector(frame: PlanarBounds) {
  const k = FIGURE_SIZE.width / (frame[2] - frame[0])
  return {
    k,
    at: ([x, y]: XY): XY => [(x - frame[0]) * k, (frame[3] - y) * k],
  }
}

const pathOf = (shape: Planar, at: (point: XY) => XY): string => {
  const fmt = (point: XY) => {
    const [x, y] = at(point)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }
  if (shape.kind === 'polygon')
    return shape.polygons.flatMap((polygon) => polygon.map((ring) => `M${ring.map(fmt).join('L')}Z`)).join('')
  if (shape.kind === 'line') return shape.lines.map((line) => `M${line.map(fmt).join('L')}`).join('')
  return ''
}

const verticesOf = (shape: Planar): XY[] =>
  shape.kind === 'polygon' ? shape.polygons.flat(2) : shape.kind === 'line' ? shape.lines.flat() : shape.points

/** Where a feature's label goes: the mean of its vertices inside the frame, or null when none are. */
function labelPoint(shape: Planar, frame: PlanarBounds): XY | null {
  const inside = verticesOf(shape).filter(([x, y]) => x > frame[0] && x < frame[2] && y > frame[1] && y < frame[3])
  if (!inside.length) return null
  return [inside.reduce((s, p) => s + p[0], 0) / inside.length, inside.reduce((s, p) => s + p[1], 0) / inside.length]
}

/** A round length for the scale bar, about a quarter of the frame. */
function scaleLength(frameWidth: number): number {
  const target = frameWidth / 4
  const power = 10 ** Math.floor(Math.log10(target))
  return (
    [1, 2, 5, 10]
      .map((step) => step * power)
      .filter((value) => value <= target)
      .pop() ?? power
  )
}

function text(x: number, y: number, label: string, options: { size?: number; anchor?: string; weight?: string } = {}) {
  return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="Arial, Helvetica, sans-serif" font-size="${options.size ?? 15}" font-weight="${options.weight ?? 'normal'}" text-anchor="${options.anchor ?? 'middle'}" fill="#1f1f1f" stroke="#ffffff" stroke-width="3.5" paint-order="stroke">${esc(label)}</text>`
}

function mapSvg(blockName: string, block: Planar, access: Planar | null, layers: readonly Layer[]): string {
  const frame = frameFor(block, access)
  const { k, at } = projector(frame)
  const { width, height } = FIGURE_SIZE
  const parts: string[] = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<defs><clipPath id="frame"><rect width="${width}" height="${height}"/></clipPath>`,
    `<pattern id="ogma-hatch" width="9" height="9" patternUnits="userSpaceOnUse"><rect width="9" height="9" fill="#ffffff" fill-opacity="0"/><path d="M4.5 0V9" stroke="#23753a" stroke-width="1.4" stroke-opacity="0.7"/></pattern></defs>`,
    `<rect width="${width}" height="${height}" fill="#fbfaf6"/>`,
    `<g clip-path="url(#frame)">`,
  )
  const labels: string[] = []
  for (const layer of layers) {
    const style = STYLE[layer.style]
    for (const { shape, name } of layer.shapes) {
      if (shape.kind !== 'polygon') continue
      parts.push(
        `<path d="${pathOf(shape, at)}" fill="${style.fill}" fill-opacity="${style.opacity}" fill-rule="evenodd" stroke="${style.stroke}" stroke-width="2"${style.dash ? ` stroke-dasharray="${style.dash}"` : ''}/>`,
      )
      const point = name ? labelPoint(shape, frame) : null
      if (point && name) {
        const [x, y] = at(point)
        labels.push(text(x, y, name, { size: 14 }))
      }
    }
  }
  parts.push(`<path d="${pathOf(block, at)}" fill="#7b2d36" fill-rule="evenodd" stroke="#4a1a20" stroke-width="2"/>`)
  if (access)
    parts.push(
      `<path d="${pathOf(access, at)}" fill="none" stroke="#e3864f" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
  const blockLabel = labelPoint(block, frame)
  if (blockLabel) {
    const [x, y] = at(blockLabel)
    labels.push(text(x, y, blockName, { size: 17, weight: 'bold' }))
  }
  parts.push(...labels, `</g>`)

  // Legend, north arrow and scale bar.
  const legend: Array<{ label: string; swatch: string; kind: 'area' | 'line' }> = [
    { label: blockName, swatch: '#7b2d36', kind: 'area' },
    ...(access ? [{ label: 'Access road', swatch: '#e3864f', kind: 'line' as const }] : []),
    ...layers
      .filter((layer) => layer.shapes.length)
      .map((layer) => ({
        label: layer.label,
        swatch: STYLE[layer.style].swatch,
        kind: 'area' as const,
      })),
  ]
  const legendHeight = 14 + legend.length * 24
  parts.push(
    `<rect x="12" y="${height - legendHeight - 12}" width="330" height="${legendHeight}" fill="#ffffff" fill-opacity="0.92" stroke="#9a9a9a"/>`,
  )
  legend.forEach((entry, i) => {
    const y = height - legendHeight - 12 + 12 + i * 24
    parts.push(
      entry.kind === 'line'
        ? `<path d="M24 ${y + 8}H54" stroke="${entry.swatch}" stroke-width="5" stroke-linecap="round"/>`
        : `<rect x="24" y="${y}" width="30" height="16" fill="${entry.swatch}" fill-opacity="0.75" stroke="#555555"/>`,
      `<text x="64" y="${y + 13}" font-family="Arial, Helvetica, sans-serif" font-size="14" fill="#1f1f1f">${esc(entry.label)}</text>`,
    )
  })
  parts.push(
    `<g transform="translate(${width - 40},52)"><path d="M0 -30L11 6L0 0L-11 6Z" fill="#1f1f1f"/>${text(0, 24, 'N', { size: 16, weight: 'bold' })}</g>`,
  )
  const meters = scaleLength(frame[2] - frame[0])
  const barPixels = meters * k
  const barX = width - 24 - barPixels
  const barY = height - 28
  parts.push(
    `<rect x="${(barX - 10).toFixed(1)}" y="${barY - 24}" width="${(barPixels + 24).toFixed(1)}" height="40" fill="#ffffff" fill-opacity="0.85"/>`,
    `<path d="M${barX.toFixed(1)} ${barY}h${barPixels.toFixed(1)}" stroke="#1f1f1f" stroke-width="4"/>`,
    text(barX + barPixels / 2, barY - 8, meters >= 1000 ? `${meters / 1000} km` : `${meters} m`, { size: 13 }),
    `</svg>`,
  )
  return parts.join('')
}

const isNoHarvest = (props: Record<string, unknown>) => /no harvest/i.test(String(props.TIMBER_HARVEST_CODE ?? ''))

/**
 * The maps the considerations carry, for the ones the report prints: TAP remnant old ecosystems and the draft OGMAs
 * beside the block, and the ungulate winter range units it or its road enters. A consideration with nothing to draw
 * gets no map.
 */
export function considerationMaps(input: {
  blockName: string
  block: Planar
  access: Planar | null
  states: Readonly<Record<string, RouteCardRowState>>
  considerations: readonly ConsiderationId[]
}): RouteCardMapFigure[] {
  const out: RouteCardMapFigure[] = []
  const add = (consideration: ConsiderationId, caption: string, layers: Layer[]) => {
    if (!layers.some((layer) => layer.shapes.length)) return
    out.push({
      consideration,
      caption,
      svg: mapSvg(input.blockName, input.block, input.access, layers),
      ...FIGURE_SIZE,
    })
  }
  if (input.considerations.includes('tap-ogma')) {
    const tap = matchesOf(input.states['tap-remnant']).map((match) => ({
      shape: match.shape,
      name: `TAP ${match.name}`,
    }))
    const ogma = matchesOf(input.states['cofa-non-legal-ogma']).map((match) => ({
      shape: match.shape,
      name: String(match.props.NON_LEGAL_OGMA_PROVID ?? match.name),
    }))
    add('tap-ogma', `TAP remnant old ecosystems and draft OGMAs around ${input.blockName}.`, [
      { label: 'Draft OGMA (non-legal)', shapes: ogma, style: 'ogma' },
      { label: 'TAP remnant old ecosystem', shapes: tap, style: 'tap' },
    ])
  }
  if (input.considerations.includes('caribou-uwr')) {
    const units = matchesOf(input.states['ungulate-winter-range'])
    const name = (match: RouteCardMatch) =>
      [match.props.UWR_UNIT_NUMBER, match.props.TIMBER_HARVEST_CODE].filter(Boolean).join(' · ') || match.name
    add('caribou-uwr', `Ungulate winter range units around ${input.blockName} and its access.`, [
      {
        label: 'Ungulate winter range',
        shapes: units
          .filter((match) => !isNoHarvest(match.props))
          .map((match) => ({ shape: match.shape, name: name(match) })),
        style: 'uwr',
      },
      {
        label: 'Ungulate winter range: no harvest',
        shapes: units
          .filter((match) => isNoHarvest(match.props))
          .map((match) => ({ shape: match.shape, name: name(match) })),
        style: 'uwrNoHarvest',
      },
    ])
  }
  return out
}
