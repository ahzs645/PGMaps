/**
 * Describes a map PDF for someone writing a company profile: its registration, its named layers
 * and how each is painted, its images and their compression and masks, its legend swatches with
 * the text beside them, and the numbers printed inside the map. It interprets nothing and never
 * guesses a rule; `docs/forestry-road-design/map-pdf-profiles.md` says how to read the report.
 * The report repeats the sheet's own text, so it stays with the source files, never the repo.
 * DOM and network free: the PDF.js runtime is passed in, as for `readGeoPdf`.
 */
import type * as PdfJs from 'pdfjs-dist'
import { PDFDocument, PDFName, PDFRawStream, PDFRef } from 'pdf-lib'
import { projectedEpsg, readMapFrames, type MapFrame } from './georeference'
import { readJpegCoefficients } from './jpegCoefficients'
import { drawingPaths, multiply, transform } from './paths'
import { PDF_PROFILES, type PdfTemplateProfile } from './profiles'
import { scanRasterContent, type DecodedPdfImage } from './rasterRead'
import { readContourLabels, SegmentIndex } from './contours'
import type { Box, Matrix, XY } from './types'

export interface LayerInspection {
  /** Innermost optional-content layer, as the reader matches rules against it. */
  name: string
  /** Enclosing layers, outermost first: a halo or mask sublayer shares its group's name. */
  parents: string[]
  strokedPaths: number
  filledPaths: number
  /** Path points (curve points counted once), a guide to how detailed the drawing is. */
  points: number
  strokeColours: string[]
  fillColours: string[]
  images: number
  /** Share of painted paths whose start lies inside the registered map frame. */
  insideFrame: number
  /** The profile rule this layer would match, when a profile recognizes the PDF. */
  rule: string | null
}
export interface ImageInspection {
  reference: string
  width: number
  height: number
  layers: string[]
  /** Placement on the page, PDF points [left, bottom, right, top]. */
  box: Box
  filter: string
  lossy: boolean
  mask: { filter: string; lossless: boolean; alphaValues: number[] } | null
  /** Only for baseline JPEGs: luma DC quantization step and chroma subsampling. */
  jpeg: { lumaDcStep: number; subsampling: string } | null
  /** Lossless images only: the colours drawn (alpha above 0), most common first, and the colour under transparent pixels. */
  colours: { drawn: string[]; distinct: number; underTransparent: string | null } | null
}
export interface PdfInspection {
  file: string
  creator: string
  pages: number
  /** The supported profile that recognizes this PDF, or null. */
  profile: string | null
  frames: {
    page: number
    crs: string
    epsg: number | null
    registrationErrorM: number
    bbox: Box
    widthM: number
    heightM: number
    metresPerPoint: number
  }[]
  notices: string[]
  layers: LayerInspection[]
  images: ImageInspection[]
  /** Distinct non-white swatches; white boxes are icon backgrounds, counted in `whiteSwatches`. */
  swatches: { colour: string; box: Box; label: string | null }[]
  whiteSwatches: number
  numbers: {
    inFrame: number
    rotated: number
    range: [number, number] | null
    /** Largest of 1, 2, 5, 10, 20, 25, 50, 100 that at least 80% of in-frame numbers sit on. */
    likelyInterval: number | null
    examples: number[]
    /**
     * Numbers lying on a stroked line (within 1 point, no other line within half a point more),
     * grouped by that line's layer: printed contour heights show up as one layer with one step.
     */
    onLines: { layer: string; count: number; range: [number, number]; likelyInterval: number | null }[]
  }
  /** Distinct text outside the map frame: legend headings, class labels, title block. */
  outsideText: string[]
}

const hex = (c: number[]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`
const top = (counts: Map<string, number>, n = 3) =>
  [...counts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `${k} ×${v}`)
const INTERVALS = [1, 2, 5, 10, 20, 25, 50, 100]
/** Stroked points kept for the numbers-on-lines check; a dense contour sheet has under a million. */
const STROKED_POINT_BUDGET = 3_000_000

/** Compression and mask of every image XObject, from the file's own objects. */
async function imageObjects(bytes: Uint8Array) {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false })
  const out = new Map<string, { filter: string; mask: string | null }>()
  const streams = new Map<string, PDFRawStream>()
  const id = (ref: PDFRef) => `${ref.objectNumber}R${ref.generationNumber || ''}`
  for (const [ref, object] of pdf.context.enumerateIndirectObjects())
    if (object instanceof PDFRawStream) streams.set(id(ref), object)
  for (const [reference, stream] of streams) {
    const dict = stream.dict
    if (dict.get(PDFName.of('Subtype'))?.toString() !== '/Image') continue
    const mask = dict.get(PDFName.of('SMask'))
    out.set(reference, {
      filter: dict.get(PDFName.of('Filter'))?.toString() ?? 'none',
      mask: mask instanceof PDFRef ? id(mask) : null,
    })
  }
  const filterOf = (reference: string) => streams.get(reference)?.dict.get(PDFName.of('Filter'))?.toString() ?? 'none'
  return { pdf, images: out, filterOf, streams }
}

export async function inspectPdf(
  bytes: Uint8Array,
  file: string,
  runtime: typeof PdfJs,
  { profiles = PDF_PROFILES }: { profiles?: PdfTemplateProfile[] } = {},
): Promise<PdfInspection> {
  const notices: string[] = []
  let frames: MapFrame[] = []
  let creator = ''
  try {
    const read = await readMapFrames(bytes)
    frames = read.frames
    creator = read.creator
    notices.push(...read.notices)
  } catch (error) {
    notices.push(`No usable map registration: ${error instanceof Error ? error.message : String(error)}`)
  }
  const objects = await imageObjects(bytes)
  creator ||= objects.pdf.getCreator() ?? ''
  const task = runtime.getDocument({ data: bytes.slice(), verbosity: 0, enableXfa: false })
  try {
    const doc = await task.promise
    const content = await doc.getOptionalContentConfig({ intent: 'any' })
    const names = [...content].map(([, group]) => String(group.name))
    const profile = profiles.find((p) => p.matches(creator, names)) ?? null
    const page = await doc.getPage(frames[0]?.page ?? 1)
    const [, , pageWidth, pageHeight] = page.view
    const frame: Box = frames[0]?.bbox ?? [0, 0, pageWidth, pageHeight]
    const list = await page.getOperatorList({ intent: 'any', annotationMode: runtime.AnnotationMode.DISABLE })
    const ops = runtime.OPS as unknown as Record<string, number>
    // Layers: walk the drawing as the reader does, counting what each named layer paints.
    const layers = new Map<
      string,
      LayerInspection & { stroke: Map<string, number>; fill: Map<string, number>; inside: number }
    >()
    let state = { matrix: [1, 0, 0, 1, 0, 0] as Matrix, stroke: '#000000', fill: '#000000' }
    const saves: (typeof state)[] = []
    const marks: string[] = []
    const entry = () => {
      const name = marks.at(-1) ?? '(no layer)'
      const key = [...marks, name].join(' › ')
      let layer = layers.get(key)
      if (!layer) {
        layer = {
          name,
          parents: marks.slice(0, -1),
          strokedPaths: 0,
          filledPaths: 0,
          points: 0,
          strokeColours: [],
          fillColours: [],
          images: 0,
          insideFrame: 0,
          rule: profile?.rules.find((r) => [...marks].reverse().some((m) => r.match.test(m)))?.name ?? null,
          stroke: new Map(),
          fill: new Map(),
          inside: 0,
        }
        layers.set(key, layer)
      }
      return layer
    }
    const lines: XY[][] = [],
      lineLayer: string[] = []
    let strokedPoints = 0
    const inFrame = ([x, y]: XY) => x >= frame[0] && x <= frame[2] && y >= frame[1] && y <= frame[3]
    for (let i = 0; i < list.fnArray.length; i++) {
      const f = list.fnArray[i],
        a = (list.argsArray[i] ?? []) as unknown[]
      if (f === ops.save || f === ops.paintFormXObjectBegin) {
        saves.push({ ...state, matrix: [...state.matrix] as Matrix })
        if (f === ops.paintFormXObjectBegin && a[0]) state.matrix = multiply(state.matrix, a[0] as Matrix)
      } else if (f === ops.restore || f === ops.paintFormXObjectEnd) state = saves.pop() ?? state
      else if (f === ops.transform) state.matrix = multiply(state.matrix, a as Matrix)
      else if (f === ops.setStrokeRGBColor && typeof a[0] === 'string') state.stroke = a[0]
      else if (f === ops.setFillRGBColor && typeof a[0] === 'string') state.fill = a[0]
      else if (f === ops.beginMarkedContent || f === ops.beginMarkedContentProps) {
        const group = a[1] as { id?: string } | undefined
        marks.push(group?.id ? (content.getGroup(group.id)?.name ?? '') : '')
      } else if (f === ops.endMarkedContent) marks.pop()
      else if (f === ops.paintImageXObject && marks.length) entry().images++
      else if (f === ops.constructPath) {
        const paint = Number(a[0])
        if (paint === ops.endPath) continue
        const data = (a[1] as ArrayLike<ArrayLike<number>> | undefined)?.[0]
        if (!data?.length) continue
        const layer = entry()
        const stroked = [ops.stroke, ops.closeStroke, ops.fillStroke, ops.eoFillStroke].includes(paint)
        // Stroked linework, in page points, for finding which layer printed numbers sit on. White
        // strokes are halos and masks around labels, never the line a label names.
        if (stroked && state.stroke !== '#ffffff' && strokedPoints < STROKED_POINT_BUDGET)
          for (const line of drawingPaths(data, state.matrix)) {
            lines.push(line)
            lineLayer.push(layer.name)
            strokedPoints += line.length
          }
        const filled = [ops.fill, ops.eoFill, ops.fillStroke, ops.eoFillStroke].includes(paint)
        if (stroked) {
          layer.strokedPaths++
          layer.stroke.set(state.stroke, (layer.stroke.get(state.stroke) ?? 0) + 1)
        }
        if (filled) {
          layer.filledPaths++
          layer.fill.set(state.fill, (layer.fill.get(state.fill) ?? 0) + 1)
        }
        // Draw ops: 0 move, 1 line (2 numbers each), 2 cubic (6), 3 quadratic (4), 4 close.
        for (let k = 0; k < data.length; ) {
          const op = data[k++]
          layer.points++
          k += op === 0 || op === 1 ? 2 : op === 2 ? 6 : op === 3 ? 4 : 0
        }
        if (data[0] === 0 && inFrame(transform(state.matrix, [data[1], data[2]]))) layer.inside++
      }
    }
    const layerList: LayerInspection[] = [...layers.values()]
      .map(({ stroke, fill, inside, ...l }) => ({
        ...l,
        strokeColours: top(stroke),
        fillColours: top(fill),
        insideFrame:
          l.strokedPaths + l.filledPaths ? Math.round((inside / (l.strokedPaths + l.filledPaths)) * 100) / 100 : 0,
      }))
      .sort((a, b) => b.points - a.points)
    // Images and legend swatches, with a deliberately loose swatch geometry.
    const mapFrame = (frames[0] ?? { bbox: frame }) as MapFrame
    const loose = {
      swatchWidth: [2, 80],
      swatchHeight: [2, 40],
      placement: 'outside-frame',
      labelGap: 20,
      labelOffset: 8,
    } as const
    const scanned = scanRasterContent(list as never, ops, content as never, mapFrame, {
      ...loose,
      swatchWidth: [...loose.swatchWidth],
      swatchHeight: [...loose.swatchHeight],
    })
    const text = await page.getTextContent()
    const items = text.items.flatMap((item) => ('str' in item && item.str.trim() ? [item] : []))
    const images: ImageInspection[] = []
    for (const placed of scanned.images) {
      const image = await new Promise<DecodedPdfImage>((resolve) => page.objs.get(placed.id, resolve))
      const reference = image.ref ?? 'unknown'
      const info = objects.images.get(reference)
      const filter = info?.filter ?? 'unknown'
      const corners = (
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ] as XY[]
      ).map((p) => transform(placed.matrix, p))
      let mask: ImageInspection['mask'] = null
      if (info?.mask) {
        const maskFilter = objects.filterOf(info.mask)
        const alpha = new Set<number>()
        if (image.data && image.data.length === image.width * image.height * 4)
          for (let i = 3; i < image.data.length && alpha.size <= 8; i += 4) alpha.add(image.data[i])
        mask = {
          filter: maskFilter,
          lossless: !/DCT|JPX/.test(maskFilter),
          alphaValues: [...alpha].sort((x, y) => x - y),
        }
      }
      let colours: ImageInspection['colours'] = null
      if (!/DCT|JPX/.test(filter) && image.data && image.data.length % (image.width * image.height) === 0) {
        const stride = image.data.length / (image.width * image.height)
        const drawn = new Map<string, number>(),
          clear = new Map<string, number>()
        for (let i = 0; i < image.data.length; i += stride) {
          const key = hex([image.data[i], image.data[i + 1], image.data[i + 2]])
          const target = stride === 4 && image.data[i + 3] === 0 ? clear : drawn
          if (target.size < 4096 || target.has(key)) target.set(key, (target.get(key) ?? 0) + 1)
        }
        colours = { drawn: top(drawn, 12), distinct: drawn.size, underTransparent: top(clear, 1)[0] ?? null }
      }
      let jpeg: ImageInspection['jpeg'] = null
      if (/^\[?\s*\/DCTDecode\s*\]?$/.test(filter)) {
        try {
          const read = readJpegCoefficients(objects.streams.get(reference)!.getContents())
          const chroma = read.components[1]
          jpeg = {
            lumaDcStep: read.components[0].quant[0],
            subsampling: chroma ? `${read.maxH / chroma.h}×${read.maxV / chroma.v}` : 'greyscale',
          }
        } catch (error) {
          notices.push(`${reference}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      images.push({
        reference,
        width: placed.width,
        height: placed.height,
        layers: placed.layers.filter(Boolean),
        box: [
          Math.min(...corners.map((p) => p[0])),
          Math.min(...corners.map((p) => p[1])),
          Math.max(...corners.map((p) => p[0])),
          Math.max(...corners.map((p) => p[1])),
        ],
        filter,
        lossy: /DCT|JPX/.test(filter),
        mask,
        jpeg,
        colours,
      })
    }
    const seenSwatch = new Set<string>()
    const distinct = scanned.swatches.filter((s) => {
      const key = `${hex(s.color)}:${s.box.map((v) => Math.round(v)).join(',')}`
      if (seenSwatch.has(key)) return false
      seenSwatch.add(key)
      return true
    })
    const whiteSwatches = distinct.filter((s) => hex(s.color) === '#ffffff').length
    const swatches = distinct
      .filter((s) => hex(s.color) !== '#ffffff')
      .map((s) => {
        const label = items
          .map((item) => {
            const gap = item.transform[4] - s.box[2],
              dy = Math.abs(item.transform[5] + item.height / 2 - (s.box[1] + s.box[3]) / 2)
            return gap >= 0 && gap < loose.labelGap && dy < loose.labelOffset
              ? { text: item.str.trim(), score: gap + 4 * dy }
              : null
          })
          .filter((x) => x !== null)
          .sort((x, y) => x.score - y.score)[0]
        return { colour: hex(s.color), box: s.box, label: label?.text ?? null }
      })
    const numbers = readContourLabels(items, frame, profile?.contours.label)
    const values = numbers.map((n) => n.value)
    const likely = (vs: number[]) =>
      vs.length
        ? ([...INTERVALS].reverse().find((step) => vs.filter((v) => v % step === 0).length >= vs.length * 0.8) ?? null)
        : null
    const index = new SegmentIndex(lines, 4)
    const byLayer = new Map<string, number[]>()
    for (const n of numbers) {
      // Nearest distance per layer: pieces of one layer's lines never make a number ambiguous.
      const perLayer = new Map<string, number>()
      for (const [line, d] of index.near(n.at, 2.5))
        perLayer.set(lineLayer[line], Math.min(d, perLayer.get(lineLayer[line]) ?? Infinity))
      const near = [...perLayer].sort((a, b) => a[1] - b[1])
      if (!near.length || near[0][1] > 1 || (near[1] && near[1][1] < near[0][1] + 0.5)) continue
      const name = near[0][0]
      byLayer.set(name, [...(byLayer.get(name) ?? []), n.value])
    }
    const onLines = [...byLayer]
      .map(([layer, vs]) => ({
        layer,
        count: vs.length,
        range: [Math.min(...vs), Math.max(...vs)] as [number, number],
        likelyInterval: likely(vs),
      }))
      .sort((a, b) => b.count - a.count)
    const rotated = items.filter(
      (item) =>
        /^-?\d{1,5}$/.test(item.str.trim()) &&
        Math.abs(item.transform[1]) > 1e-3 &&
        inFrame([item.transform[4], item.transform[5]]),
    ).length
    const outsideText = [
      ...new Set(
        items.filter((item) => !inFrame([item.transform[4], item.transform[5]])).map((item) => item.str.trim()),
      ),
    ].slice(0, 200)
    return {
      file,
      creator,
      pages: doc.numPages,
      profile: profile?.label ?? null,
      frames: frames.map((f) => {
        const origin = transform(f.pageToProjected, [f.bbox[0], f.bbox[1]]),
          right = transform(f.pageToProjected, [f.bbox[2], f.bbox[1]]),
          up = transform(f.pageToProjected, [f.bbox[0], f.bbox[3]])
        const widthM = Math.hypot(right[0] - origin[0], right[1] - origin[1]),
          heightM = Math.hypot(up[0] - origin[0], up[1] - origin[1])
        return {
          page: f.page,
          crs: f.crs,
          epsg: projectedEpsg(f.wkt),
          registrationErrorM: Math.round(f.registrationErrorM * 100) / 100,
          bbox: f.bbox,
          widthM: Math.round(widthM),
          heightM: Math.round(heightM),
          metresPerPoint: Math.round((widthM / (f.bbox[2] - f.bbox[0])) * 1000) / 1000,
        }
      }),
      notices,
      layers: layerList,
      images,
      swatches,
      whiteSwatches,
      numbers: {
        inFrame: values.length,
        rotated,
        range: values.length ? [Math.min(...values), Math.max(...values)] : null,
        likelyInterval: values.length
          ? ([...INTERVALS]
              .reverse()
              .find((step) => values.filter((v) => v % step === 0).length >= values.length * 0.8) ?? null)
          : null,
        examples: [...new Set(values)].slice(0, 12),
        onLines,
      },
      outsideText,
    }
  } finally {
    await task.destroy()
  }
}

/** The inspection as Markdown, in the order a profile is written. */
export function formatInspection(r: PdfInspection): string {
  const lines = [
    `# ${r.file}`,
    '',
    `- Creator: ${r.creator || '(none)'}; pages: ${r.pages}`,
    `- Recognized by: ${r.profile ?? 'no supported profile'}`,
    ...r.frames.map(
      (f) =>
        `- Map frame, page ${f.page}: ${f.crs} (EPSG ${f.epsg ?? 'not accepted by the road tools'}), ${f.widthM} × ${f.heightM} m, ${f.metresPerPoint} m per point, control fit ${f.registrationErrorM} m`,
    ),
    ...r.notices.map((n) => `- Notice: ${n}`),
    '',
    '## Layers',
    '',
    '| Layer | Inside | Stroked | Filled | Points | Stroke colours | Fill colours | Images | In frame | Rule |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...r.layers.map(
      (l) =>
        `| ${l.name || '(unnamed)'} | ${l.parents.map((p) => p || '(unnamed)').join(' › ')} | ${l.strokedPaths} | ${l.filledPaths} | ${l.points} | ${l.strokeColours.join(', ')} | ${l.fillColours.join(', ')} | ${l.images} | ${Math.round(l.insideFrame * 100)}% | ${l.rule ?? ''} |`,
    ),
    '',
    '## Images',
    '',
    '| Image | Pixels | Layers | Placed at (pt) | Filter | Mask | Alpha values | JPEG | Under transparent |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...r.images.map(
      (i) =>
        `| ${i.reference} | ${i.width} × ${i.height} | ${i.layers.join(' › ')} | ${i.box.map((v) => Math.round(v)).join(', ')} | ${i.filter} | ${i.mask ? `${i.mask.filter}${i.mask.lossless ? ' (lossless)' : ' (lossy)'}` : 'none'} | ${i.mask?.alphaValues.join(', ') ?? ''} | ${i.jpeg ? `DC step ${i.jpeg.lumaDcStep}, chroma ${i.jpeg.subsampling}` : ''} | ${i.colours?.underTransparent ?? ''} |`,
    ),
    '',
    '### Colours drawn in lossless images',
    '',
    ...r.images.flatMap((i) =>
      i.colours?.drawn.length
        ? [
            `- ${i.reference} (${i.layers.at(-1) ?? 'no layer'}): ${i.colours.distinct} colours; ${i.colours.drawn.join(', ')}`,
          ]
        : [],
    ),
    '',
    '## Legend swatches (filled boxes outside the map frame)',
    '',
    '| Colour | Box (pt) | Text beside it |',
    '| --- | --- | --- |',
    ...r.swatches.map((s) => `| ${s.colour} | ${s.box.map((v) => Math.round(v)).join(', ')} | ${s.label ?? ''} |`),
    '',
    `${r.whiteSwatches} white boxes (symbol backgrounds) left out.`,
    '',
    '## Numbers inside the map frame',
    '',
    `${r.numbers.inFrame} numbers, ${r.numbers.rotated} rotated; range ${r.numbers.range?.join('–') ?? 'none'}; most sit on a step of ${r.numbers.likelyInterval ?? '—'}. Examples: ${r.numbers.examples.join(', ')}`,
    '',
    'Numbers lying on a drawn line, by that line’s layer:',
    '',
    '| Layer | Numbers | Range | Likely step |',
    '| --- | --- | --- | --- |',
    ...r.numbers.onLines.map((n) => `| ${n.layer} | ${n.count} | ${n.range.join('–')} | ${n.likelyInterval ?? '—'} |`),
    '',
    '## Text outside the map frame',
    '',
    r.outsideText.map((t) => `\`${t.replace(/`/g, "'")}\``).join(' · '),
    '',
  ]
  return lines.join('\n')
}
