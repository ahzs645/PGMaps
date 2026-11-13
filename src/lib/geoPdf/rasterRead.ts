import type { PDFPageProxy, PDFOperatorList, TextContent } from 'pdfjs-dist/types/src/display/api'
import { multiply, transform } from './paths'
import {
  applyMatrix,
  cellChecksum,
  colorClassifier,
  encodeCells,
  gridCorners,
  invertMatrix,
  UNKNOWN,
} from './classGrid'
import { normalizeLegend, type RasterProfile } from './rasterProfiles'
import { CANFOR_PROFILE, type LegendGeometry, type PdfTemplateProfile } from './profiles'
import { readJpegCoefficients } from './jpegCoefficients'
import { decodePaletteJpeg, nearestPaletteIndex, rasterPalette } from './paletteJpeg'
import {
  PDF_LIMITS,
  type Box,
  type Matrix,
  type PdfClassGrid,
  type PdfLayer,
  type PdfRasterClass,
  type PdfSource,
  type XY,
} from './types'
import type { MapFrame } from './georeference'

export interface DecodedPdfImage {
  width: number
  height: number
  kind?: number
  data?: Uint8Array | Uint8ClampedArray
  bitmap?: ImageBitmap
  ref?: string
}
export interface ImageInstance {
  id: string
  width: number
  height: number
  matrix: Matrix
  layers: string[]
}
interface Swatch {
  box: Box
  color: [number, number, number]
}
interface Content {
  getGroup(id: string): { name: string } | null
  isVisible(group: unknown): boolean
}
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]
function color(value: unknown): [number, number, number] | null {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) return null
  return [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16)) as [number, number, number]
}
/** Read the original image placements and vector legend swatches, without rasterizing the page. */
export function scanRasterContent(
  list: PDFOperatorList,
  ops: Record<string, number>,
  content: Content,
  frame: MapFrame,
  legend: LegendGeometry = CANFOR_PROFILE.legend,
) {
  let state = { matrix: IDENTITY, fill: null as [number, number, number] | null }
  const saves: (typeof state)[] = [],
    groups: (typeof state)[] = [],
    marks: { name: string; visible: boolean }[] = []
  const images: ImageInstance[] = [],
    swatches: Swatch[] = []
  const save = () => ({ ...state, matrix: [...state.matrix] as Matrix })
  for (let i = 0; i < list.fnArray.length; i++) {
    const f = list.fnArray[i],
      a = list.argsArray[i] ?? []
    if (f === ops.save || f === ops.paintFormXObjectBegin) {
      saves.push(save())
      if (f === ops.paintFormXObjectBegin && a[0]) state.matrix = multiply(state.matrix, a[0])
    } else if (f === ops.restore || f === ops.paintFormXObjectEnd) state = saves.pop() ?? state
    else if (f === ops.beginGroup) {
      groups.push(save())
      if (a[0]?.matrix) state.matrix = multiply(state.matrix, a[0].matrix)
    } else if (f === ops.endGroup) state = groups.pop() ?? state
    else if (f === ops.transform) state.matrix = multiply(state.matrix, a as Matrix)
    else if (f === ops.setFillRGBColor) state.fill = color(a[0])
    else if (f === ops.beginMarkedContent || f === ops.beginMarkedContentProps)
      marks.push({
        name: a[1]?.id ? (content.getGroup(a[1].id)?.name ?? '') : '',
        visible: a[0] !== 'OC' || content.isVisible(a[1]),
      })
    else if (f === ops.endMarkedContent) marks.pop()
    else if (f === ops.paintImageXObject && marks.every((m) => m.visible))
      images.push({ id: a[0], width: a[1], height: a[2], matrix: [...state.matrix], layers: marks.map((m) => m.name) })
    else if (
      f === ops.constructPath &&
      state.fill &&
      [ops.fill, ops.eoFill, ops.fillStroke, ops.eoFillStroke].includes(a[0]) &&
      a[2]
    ) {
      const [x0, y0, x1, y1] = Array.from(a[2] as ArrayLike<number>)
      const p = (
        [
          [x0, y0],
          [x1, y0],
          [x1, y1],
          [x0, y1],
        ] as XY[]
      ).map((p) => transform(state.matrix, p))
      const box: Box = [
        Math.min(...p.map((p) => p[0])),
        Math.min(...p.map((p) => p[1])),
        Math.max(...p.map((p) => p[0])),
        Math.max(...p.map((p) => p[1])),
      ]
      const width = box[2] - box[0],
        height = box[3] - box[1]
      const outside =
        legend.placement === 'right-of-frame'
          ? box[0] > frame.bbox[2]
          : box[0] > frame.bbox[2] || box[2] < frame.bbox[0] || box[1] > frame.bbox[3] || box[3] < frame.bbox[1]
      if (
        outside &&
        width > legend.swatchWidth[0] &&
        width < legend.swatchWidth[1] &&
        height > legend.swatchHeight[0] &&
        height < legend.swatchHeight[1]
      )
        swatches.push({ box, color: state.fill })
    }
  }
  return { images, swatches }
}

export function readRasterLegend(
  text: TextContent,
  swatches: Swatch[],
  profile: RasterProfile,
  geometry: LegendGeometry = CANFOR_PROFILE.legend,
): PdfRasterClass[] {
  const items = text.items.flatMap((item) => ('str' in item ? [item] : []))
  if (!items.some((item) => normalizeLegend(item.str) === normalizeLegend(profile.heading)))
    throw Error(`Missing ${profile.heading} legend heading.`)
  const used = new Set<Swatch>()
  return profile.classes.map((range) => {
    const candidates = items
      .filter((item) => normalizeLegend(item.str) === normalizeLegend(range.label))
      .flatMap((item) =>
        swatches.flatMap((swatch) => {
          const gap = item.transform[4] - swatch.box[2]
          const dy = Math.abs(item.transform[5] + item.height / 2 - (swatch.box[1] + swatch.box[3]) / 2)
          return gap >= 0 && gap < geometry.labelGap && dy < geometry.labelOffset
            ? [{ swatch, score: gap + 4 * dy }]
            : []
        }),
      )
      .sort((a, b) => a.score - b.score)
    if (
      !candidates[0] ||
      used.has(candidates[0].swatch) ||
      (candidates[1] && candidates[1].score - candidates[0].score < 1)
    )
      throw Error(`Could not unambiguously match legend swatch ${range.label}.`)
    used.add(candidates[0].swatch)
    return { ...range, color: candidates[0].swatch.color }
  })
}

const imageMatrix = (image: ImageInstance): Matrix =>
  multiply(image.matrix, [1 / image.width, 0, 0, -1 / image.height, 0, 1])
export function mosaicPlacement(images: ImageInstance[]) {
  if (!images.length || images.length > PDF_LIMITS.rasterImages) throw Error('Unsupported raster image tile count.')
  const reference = imageMatrix(images[0]),
    inverse = invertMatrix(reference)
  const offsets = images.map((image) => {
    const m = imageMatrix(image)
    if (m.slice(0, 4).some((v, i) => Math.abs(v - reference[i]) > 1e-7))
      throw Error('Raster tiles have different pixel bases; no resampling is applied automatically.')
    const [col, row] = applyMatrix(inverse, [m[4], m[5]])
    if (Math.abs(col - Math.round(col)) > 0.005 || Math.abs(row - Math.round(row)) > 0.005)
      throw Error('Raster tiles do not align to a native pixel grid.')
    return { image, col: Math.round(col), row: Math.round(row) }
  })
  const minCol = Math.min(...offsets.map((o) => o.col)),
    minRow = Math.min(...offsets.map((o) => o.row))
  const width = Math.max(...offsets.map((o) => o.col + o.image.width)) - minCol,
    height = Math.max(...offsets.map((o) => o.row + o.image.height)) - minRow
  if (width * height > PDF_LIMITS.rasterCells)
    throw Error('The source raster exceeds the native pixel budget; no automatic downsampling was applied.')
  const origin = applyMatrix(reference, [minCol, minRow])
  return {
    width,
    height,
    pageTransform: [...reference.slice(0, 4), ...origin] as Matrix,
    offsets: offsets.map((o) => ({ ...o, col: o.col - minCol, row: o.row - minRow })),
  }
}

export async function extractClassRasters({
  page,
  list,
  text,
  ops,
  content,
  frame,
  source,
  lossyImages,
  jpegBytes,
  imagePixels,
  template = CANFOR_PROFILE,
}: {
  page: PDFPageProxy
  list: PDFOperatorList
  text: TextContent
  ops: Record<string, number>
  content: Content
  frame: MapFrame
  source: Omit<PdfSource, 'layer'>
  lossyImages: Set<string>
  /** The stored JPEG file of a DCT-only image, for the coefficient decoder. */
  jpegBytes?: (reference: string) => Uint8Array | undefined
  imagePixels?: (image: DecodedPdfImage) => Uint8Array | Uint8ClampedArray
  /** The matched company template: its raster definitions, legend geometry and transparent fill. */
  template?: PdfTemplateProfile
}): Promise<PdfLayer[]> {
  if (!template.rasters.length) return []
  const { images, swatches } = scanRasterContent(list, ops, content, frame, template.legend)
  const results: PdfLayer[] = []
  for (const profile of template.rasters) {
    const base = images.filter((image) => image.layers.includes(profile.layer))
    if (!base.length) continue
    if (
      base.length + images.filter((i) => profile.overlay && i.layers.includes(profile.overlay.layer)).length >
      PDF_LIMITS.rasterImages
    )
      throw Error('The class raster exceeds the source image budget.')
    const legend = readRasterLegend(text, swatches, profile, template.legend)
    const mosaic = mosaicPlacement(base)
    const values = new Uint8Array(mosaic.width * mosaic.height),
      written = new Uint8Array(values.length),
      lossyTile = new Uint8Array(values.length)
    const sourceImages: PdfClassGrid['sourceImages'] = []
    const excluded = profile.overlay
      ? legend.findIndex((c) => normalizeLegend(c.label) === normalizeLegend(profile.overlay!.label))
      : -1
    // The base raster draws every class except a separately masked overlay (slope 95+).
    const palette = rasterPalette(legend, excluded)
    const legendCode = legend.flatMap((_, i) => (i === excluded ? [] : [i + 1]))
    let decodedTiles = 0
    const decodeFailures: string[] = []
    for (const tile of mosaic.offsets) {
      const image = await new Promise<DecodedPdfImage>((resolve) => page.objs.get(tile.image.id, resolve))
      const pixels = image.data ?? imagePixels?.(image)
      if (!pixels || image.width !== tile.image.width || image.height !== tile.image.height)
        throw Error('The original raster pixels could not be read.')
      const stride = pixels.length / (image.width * image.height)
      if (![3, 4].includes(stride)) throw Error('Unsupported source raster colour channels.')
      const reference = image.ref ?? 'unknown'
      const lossy = reference === 'unknown' || lossyImages.has(reference)
      const classify = colorClassifier(legend, lossy, profile.alpha, excluded)
      sourceImages.push({ reference, width: image.width, height: image.height, lossy, layer: profile.layer })
      const alphaAt = (i: number) => (stride === 4 ? pixels[i * 4 + 3] : 255)
      // A JPEG tile's drawn pixels take the classes whose encoding best matches the stored
      // coefficients. Transparency comes from the lossless soft mask and is never decoded.
      let decoded: Uint8Array | null = null
      const stored = lossy ? jpegBytes?.(reference) : undefined
      if (stored)
        try {
          const jpeg = readJpegCoefficients(stored)
          if (jpeg.width !== image.width || jpeg.height !== image.height)
            throw Error('stored JPEG size differs from the placed image')
          const size = image.width * image.height
          const drawn = new Uint8Array(size),
            initial = new Uint8Array(size)
          for (let i = 0; i < size; i++) {
            drawn[i] = alphaAt(i) ? 1 : 0
            initial[i] = nearestPaletteIndex(
              palette,
              pixels[i * stride],
              pixels[i * stride + 1],
              pixels[i * stride + 2],
            )
          }
          decoded = decodePaletteJpeg({ jpeg, palette, background: template.transparentFill, drawn, initial }).labels
          decodedTiles++
        } catch (error) {
          decodeFailures.push(`${reference}: ${error instanceof Error ? error.message : String(error)}`)
        }
      for (let row = 0; row < image.height; row++)
        for (let col = 0; col < image.width; col++) {
          const i = (row * image.width + col) * stride,
            target = (row + tile.row) * mosaic.width + col + tile.col
          const p = applyMatrix(mosaic.pageTransform, [col + tile.col + 0.5, row + tile.row + 0.5])
          const clipped = p[0] < frame.bbox[0] || p[0] > frame.bbox[2] || p[1] < frame.bbox[1] || p[1] > frame.bbox[3]
          let code: number
          if (clipped) code = UNKNOWN.clipped
          else if (decoded) {
            const alpha = alphaAt(row * image.width + col),
              label = decoded[row * image.width + col]
            code =
              alpha === 0
                ? UNKNOWN.absent
                : Math.abs(alpha - profile.alpha) > 1
                  ? UNKNOWN.alpha
                  : label === 255
                    ? UNKNOWN.color
                    : legendCode[label]
          } else code = classify(pixels[i], pixels[i + 1], pixels[i + 2], stride === 4 ? pixels[i + 3] : 255)
          if (lossy && code > 0 && code <= legend.length) code += 64
          if (written[target] && values[target] !== code) code = UNKNOWN.conflict
          values[target] = code
          written[target] = 1
          lossyTile[target] = lossy ? 1 : 0
        }
    }
    if (profile.overlay) {
      const overlays = images.filter((image) => image.layers.includes(profile.overlay!.layer))
      if (overlays.length !== base.length) throw Error('The separate 95+ slope overlay is missing or incomplete.')
      const inverse = invertMatrix(mosaic.pageTransform)
      const overlayCode = excluded + 1,
        baseCode = legend.findIndex((c) => normalizeLegend(c.label) === normalizeLegend(profile.overlay!.base)) + 1
      for (const tile of overlays) {
        const image = await new Promise<DecodedPdfImage>((resolve) => page.objs.get(tile.id, resolve))
        const pixels = image.data ?? imagePixels?.(image),
          reference = image.ref ?? 'unknown'
        if (
          !pixels ||
          reference === 'unknown' ||
          pixels.length !== image.width * image.height * 4 ||
          lossyImages.has(reference)
        )
          throw Error('The 95+ overlay must preserve lossless RGB and alpha.')
        const toGrid = multiply(inverse, imageMatrix(tile))
        if (
          toGrid.slice(0, 4).some((v, i) => Math.abs(v - [1, 0, 0, 1][i]) > 1e-6) ||
          Math.abs(toGrid[4] - Math.round(toGrid[4])) > 0.005 ||
          Math.abs(toGrid[5] - Math.round(toGrid[5])) > 0.005
        )
          throw Error('The slope overlay does not align with the class pixels.')
        sourceImages.push({
          reference,
          width: image.width,
          height: image.height,
          lossy: false,
          layer: profile.overlay.layer,
        })
        for (let row = 0; row < image.height; row++)
          for (let col = 0; col < image.width; col++) {
            const i = (row * image.width + col) * 4
            if (!pixels[i + 3]) continue
            const c = col + Math.round(toGrid[4]),
              r = row + Math.round(toGrid[5])
            if (c < 0 || c >= mosaic.width || r < 0 || r >= mosaic.height)
              throw Error('Slope overlay extends outside its source grid.')
            const target = r * mosaic.width + c
            if (values[target] === UNKNOWN.clipped) continue
            const black = pixels[i] === 0 && pixels[i + 1] === 0 && pixels[i + 2] === 0 && pixels[i + 3] === 255
            // The black overlay itself is lossless. JPEG colour damage to a nontransparent
            // base must not turn that independent published mask into a JPEG estimate.
            const jpegBase =
              lossyTile[target] &&
              values[target] !== UNKNOWN.absent &&
              values[target] !== UNKNOWN.alpha &&
              values[target] !== UNKNOWN.conflict
            values[target] = black && (values[target] === baseCode || jpegBase) ? overlayCode : UNKNOWN.overlay
          }
      }
    }
    const counts = Array(256).fill(0) as number[]
    for (const code of values) counts[code]++
    const grid: PdfClassGrid = {
      version: 1,
      kind: profile.kind,
      unit: profile.unit,
      legend,
      undrawn: profile.undrawn,
      width: mosaic.width,
      height: mosaic.height,
      transform: multiply(frame.pageToProjected, mosaic.pageTransform),
      wkt: frame.wkt,
      cells: encodeCells(values),
      checksum: cellChecksum(values),
      counts,
      sourceImages,
      notes: [
        'Ranges recovered from original embedded image pixels and the printed legend. No labels, roads or contour layers enter the class grid.',
        `Transparent pixels are the sheet's unpainted class: ${profile.undrawn.label} ${profile.unit}, or cells without data. The transparency mask is stored losslessly in every tile, JPEG tiles included, so drawn/not drawn is exact; only the class within a drawn JPEG pixel can be uncertain.`,
        decodedTiles
          ? `${decodedTiles} JPEG tile${decodedTiles === 1 ? '' : 's'}: drawn pixels take the classes whose JPEG encoding best matches the coefficients the file stores. These are estimates, kept out of exact totals: in the calibration a single pixel was right about half the time, while class shares over 27–108 m squares came within about 9% (slope) and 12% (canopy) of the original.`
          : 'All JPEG-derived matches remain estimates and are excluded from lossless matched-class area totals. Colour proximity alone did not reliably reproduce classes in the template compression benchmark.',
        ...(decodeFailures.length
          ? [`Coefficient decoding failed for ${decodeFailures.join('; ')}; those tiles use the colour match.`]
          : []),
        ...(profile.overlay
          ? [
              'The printed 85+ and 95+ ranges overlap. 95+ comes from the separate lossless black Slope Breaks mask. A lossless base must agree as 85+; JPEG base colour damage does not invalidate this independent mask. Transparent or conflicting bases remain unknown. Labels are kept as printed.',
            ]
          : []),
      ],
    }
    const corners = gridCorners(grid)
    results.push({
      name: profile.kind === 'canopy' ? 'Canopy height classes' : 'Slope classes',
      source: { ...source, layer: profile.layer },
      classGrid: grid,
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [[...corners, corners[0]]] },
          properties: { name: profile.heading },
        },
      ],
      suggestedRole: 'reference',
      selected: true,
      note: `Queryable published ${profile.kind} ranges (${profile.unit}); unknown pixels retained. Native PDF pixel grid, not the original LiDAR measurements.`,
    })
  }
  return results
}
