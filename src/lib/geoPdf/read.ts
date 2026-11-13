import type * as PdfJs from 'pdfjs-dist'
import type { DocumentInitParameters } from 'pdfjs-dist/types/src/display/api'
import { projectedEpsg, readMapFrames, type MapFrame } from './georeference'
import { assignContourElevations, contourSurface, readContourLabels } from './contours'
import { extractPaths } from './paths'
import { PDF_DRAWING_NOTE, PDF_PROFILES } from './profiles'
import { PDF_LIMITS, type PdfImport, type PdfLayer, type PdfSheet } from './types'
import { extractClassRasters, type DecodedPdfImage } from './rasterRead'
import type { PdfClassGrid } from './types'

export interface PdfReadOptions {
  maxFeatures: number
  maxVertices: number
  renderSheet?: (page: PdfJs.PDFPageProxy, frame: MapFrame) => Promise<PdfSheet | undefined>
  configure?: Partial<DocumentInitParameters>
  imagePixels?: (image: DecodedPdfImage) => Uint8Array | Uint8ClampedArray
  renderClasses?: (grid: PdfClassGrid) => Promise<PdfSheet>
  /** Profiles to try, in order; the shipped list by default. A draft profile is tried here first. */
  profiles?: import('./profiles').PdfTemplateProfile[]
  /** How a contour surface fills between lines; the TIN by default (see `ContourMethod`). */
  contourMethod?: import('./contours').ContourMethod
}

/** Same reader in a browser worker and the env-gated private-source tests. No upload or server. */
export async function readGeoPdf(
  bytes: Uint8Array,
  file: string,
  runtime: typeof PdfJs,
  options: PdfReadOptions,
): Promise<PdfImport> {
  if (bytes.byteLength > PDF_LIMITS.bytes) throw Error('Import a PDF of at most 64 MB.')
  const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  const { creator, frames, notices, lossyImages, jpegBytes } = await readMapFrames(bytes)
  const task = runtime.getDocument({
    ...options.configure,
    data: bytes,
    enableXfa: false,
    verbosity: 0,
    stopAtErrors: true,
  })
  try {
    const doc = await task.promise
    const content = await doc.getOptionalContentConfig({ intent: 'any' })
    const names = [...content].map(([, group]) => String(group.name))
    const profiles = options.profiles ?? PDF_PROFILES
    const profile = profiles.find((p) => p.matches(creator, names))
    if (!profile)
      throw Error(
        `This PDF template is not supported yet. Supported: ${profiles.map((p) => p.label).join('; ')}. Import the original GIS files for this template.`,
      )
    const layers: PdfLayer[] = []
    for (const frame of frames) {
      const page = await doc.getPage(frame.page)
      const source = {
        file,
        sha256,
        page: frame.page,
        profile: profile.label,
        registrationErrorM: frame.registrationErrorM,
      }
      const text = await page.getTextContent()
      const labels = [
        ...new Set(
          text.items.flatMap((item) => ('str' in item && /[a-z]{3}/i.test(item.str) ? [item.str.trim()] : [])),
        ),
      ]
      const sheet = await options.renderSheet?.(page, frame)
      layers.push({
        name: 'Map sheet',
        source: { ...source, layer: 'Map sheet' },
        features: [
          {
            type: 'Feature',
            properties: {
              name: `${file.split('/').at(-1)} · page ${frame.page}`,
              template: profile.id,
              mapText: labels.join(' · ').slice(0, 2000),
            },
            geometry: { type: 'Polygon', coordinates: [[...frame.corners, frame.corners[0]]] },
          },
        ],
        suggestedRole: 'reference',
        selected: true,
        sheet,
        note: 'Georeferenced source sheet. Its image is a display preview; colours are not measured elevation, slope or canopy height.',
      })
      const list = await page.getOperatorList({ intent: 'any', annotationMode: runtime.AnnotationMode.DISABLE })
      try {
        const classified = await extractClassRasters({
          page,
          list,
          text,
          ops: runtime.OPS,
          content,
          frame,
          source,
          lossyImages,
          jpegBytes,
          imagePixels: options.imagePixels,
          template: profile,
        })
        for (const layer of classified) {
          if (options.renderClasses) layer.sheet = await options.renderClasses(layer.classGrid!)
          layers.push(layer)
        }
      } catch (error) {
        notices.push(
          `Page ${frame.page}: class raster not recovered: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
      const result = extractPaths(list, runtime.OPS, content, frame, profile.rules, options)
      for (const [name, { rule, features, overBudget }] of result.layers) {
        if (overBudget) {
          notices.push(
            `Page ${frame.page} · ${rule.name}: exceeds ${options.maxFeatures} drawing parts or ${options.maxVertices.toLocaleString()} vertices per layer. Use the source GIS layer. The sheet preview still shows it.`,
          )
          continue
        }
        if (!features.length) continue
        const vertices = features.reduce(
          (s, f) =>
            s +
            (f.geometry.type === 'LineString'
              ? f.geometry.coordinates.length
              : (f.geometry as GeoJSON.Polygon).coordinates.reduce((n, r) => n + r.length, 0)),
          0,
        )
        if (features.length > options.maxFeatures || vertices > options.maxVertices) {
          notices.push(
            `Page ${frame.page} · ${rule.name}: ${features.length} drawing parts, ${vertices.toLocaleString()} vertices; exceeds the layer budget. Use the source GIS layer. The sheet preview still shows it.`,
          )
          continue
        }
        layers.push({
          name: rule.name,
          source: { ...source, layer: name },
          features,
          suggestedRole: 'reference',
          selected: rule.selected,
          note: PDF_DRAWING_NOTE,
        })
      }
      if (result.contourOverBudget)
        notices.push(
          `Page ${frame.page}: the contours exceed the terrain vertex budget; no surface was built from them.`,
        )
      else if (result.contours.length) {
        try {
          const epsg = projectedEpsg(frame.wkt)
          if (!epsg) throw Error('its map projection is not BC Albers or a UTM zone the road tools accept')
          const items = text.items.flatMap((item) => ('str' in item ? [item] : []))
          const stated = items.map((item) => profile.contours.statedInterval?.exec(item.str.trim())).find(Boolean)
          const assignment = assignContourElevations(
            result.contours,
            readContourLabels(items, frame.bbox, profile.contours.label),
            frame.bbox,
            {
              statedInterval: stated ? Number(stated[1]) : undefined,
              metresPerUnit: Math.sqrt(
                Math.abs(
                  frame.pageToProjected[0] * frame.pageToProjected[3] -
                    frame.pageToProjected[1] * frame.pageToProjected[2],
                ),
              ),
            },
          )
          if (assignment.labelledLines < 3) throw Error('too few contour lines carry a printed elevation')
          const surface = contourSurface(result.contours, assignment, frame, epsg, { method: options.contourMethod })
          layers.push({
            name: 'Terrain from contours',
            source: { ...source, layer: 'Contours' },
            features: [
              {
                type: 'Feature',
                properties: { name: `Contour surface · ${assignment.interval} m contours` },
                geometry: { type: 'Polygon', coordinates: [[...frame.corners, frame.corners[0]]] },
              },
            ],
            suggestedRole: 'terrain',
            selected: false,
            contourSurface: surface,
            note: `Ground surface from the sheet's ${assignment.interval} m contours: ${assignment.labelledLines} labelled lines, ${assignment.inferredLines} inferred from their neighbours, ${assignment.unassignedLines} left out. Coarser than LiDAR: use it where no LiDAR terrain covers the block.`,
          })
        } catch (error) {
          notices.push(
            `Page ${frame.page}: no terrain from the contours: ${error instanceof Error ? error.message : String(error)}.`,
          )
        }
      }
      if (result.omittedClips)
        notices.push(
          `Page ${frame.page}: ${result.omittedClips} drawings under non-rectangular clips were left on the sheet only.`,
        )
      page.cleanup()
    }
    notices.push(
      'PDF drawings have no original GIS attributes. Native shapefiles take priority when available. Legends, text glyphs and content outside the registered map frame are excluded from geometry.',
    )
    return { sha256, layers, notices }
  } finally {
    await task.destroy()
  }
}
