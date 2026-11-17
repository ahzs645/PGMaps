/**
 * Writes a geospatial PDF map frame (ISO 32000 extension: a page `/VP` viewport whose `/Measure` is
 * `/GEO`) over a map image already placed on a page, so Avenza Maps, QGIS/GDAL and PGMaps' own reader
 * (`georeference.ts`) can place the page. The frame is the image's rectangle; its four corners carry
 * their geographic positions, and the CRS is the one the image was drawn in, so the reader's affine fit
 * in that CRS is exact. No DOM or network access: pdf-lib is passed the bytes and returns bytes.
 */
import { PDFDocument, PDFName, PDFString } from 'pdf-lib'
import type { Box } from './types'

/** Web Mercator (EPSG:3857) in Esri WKT: what a north-up, unpitched MapLibre plan is drawn in. */
export const WEB_MERCATOR_WKT =
  'PROJCS["WGS_1984_Web_Mercator_Auxiliary_Sphere",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Mercator_Auxiliary_Sphere"],PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",0.0],PARAMETER["Standard_Parallel_1",0.0],PARAMETER["Auxiliary_Sphere_Type",0.0],UNIT["Meter",1.0]]'

export interface MapViewport {
  /** Zero-based page index. */
  page: number
  /** The image's rectangle in PDF points, origin bottom-left: [left, bottom, right, top]. */
  bbox: Box
  /** Longitude, latitude of the image's corners: top-left, top-right, bottom-right, bottom-left. */
  corners: [[number, number], [number, number], [number, number], [number, number]]
  /** The CRS the image was drawn in, as WKT. */
  wkt: string
  name?: string
}

/** Returns the PDF with one georegistered map frame added to each listed page. */
export async function addMapViewports(bytes: Uint8Array | ArrayBuffer, viewports: MapViewport[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false })
  const context = pdf.context
  for (const viewport of viewports) {
    const { bbox, corners } = viewport
    if (
      !bbox.every(Number.isFinite) ||
      bbox[2] <= bbox[0] ||
      bbox[3] <= bbox[1] ||
      !corners.flat().every(Number.isFinite) ||
      corners.some(([lon, lat]) => Math.abs(lon) > 180 || Math.abs(lat) >= 85)
    )
      throw Error('A map frame needs a rectangle on the page and four geographic corners.')
    const page = pdf.getPage(viewport.page)
    const [topLeft, topRight, bottomRight, bottomLeft] = corners
    // Local points run from the frame's bottom-left; geographic points are latitude, longitude.
    const local = [0, 0, 0, 1, 1, 1, 1, 0]
    const geographic = [bottomLeft, topLeft, topRight, bottomRight].flatMap(([lon, lat]) => [lat, lon])
    const measure = context.obj({
      Type: 'Measure',
      Subtype: 'GEO',
      Bounds: [0, 0, 0, 1, 1, 1, 1, 0],
      GCS: context.obj({ Type: 'PROJCS', WKT: PDFString.of(viewport.wkt) }),
      GPTS: geographic,
      LPTS: local,
      PDU: [PDFName.of('M'), PDFName.of('SQM'), PDFName.of('DEG')],
    })
    const vp = context.obj({
      Type: 'Viewport',
      BBox: [...bbox],
      Name: PDFString.of(viewport.name ?? 'Map'),
      Measure: measure,
    })
    page.node.set(PDFName.of('VP'), context.obj([vp]))
  }
  return pdf.save({ useObjectStreams: false })
}
