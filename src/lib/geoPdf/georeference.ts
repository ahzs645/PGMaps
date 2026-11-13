import proj4 from 'proj4'
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFString } from 'pdf-lib'
import { PDF_LIMITS, type Box, type XY, type Matrix } from './types'

export interface MapFrame {
  page: number
  bbox: Box
  crs: string
  registrationErrorM: number
  toWorld: (point: XY) => XY
  corners: [XY, XY, XY, XY]
  wkt: string
  pageToProjected: Matrix
}
const key = PDFName.of
const numbers = (dict: PDFDict, name: string): number[] => {
  const a = dict.lookupMaybe(key(name), PDFArray)
  return a ? a.asArray().map((v) => dict.context.lookup(v, PDFNumber).asNumber()) : []
}

/** Small pivoted solve for the affine fit's 3×3 normal equations. */
function solve(rows: number[][], rhs: number[]): number[] {
  const a = rows.map((r, i) => [...r, rhs[i]])
  for (let i = 0; i < 3; i++) {
    let pivot = i
    for (let j = i + 1; j < 3; j++) if (Math.abs(a[j][i]) > Math.abs(a[pivot][i])) pivot = j
    ;[a[i], a[pivot]] = [a[pivot], a[i]]
    if (Math.abs(a[i][i]) < 1e-12) throw Error('The PDF map registration is singular.')
    const v = a[i][i]
    for (let j = i; j < 4; j++) a[i][j] /= v
    for (let k = 0; k < 3; k++) {
      if (k === i) continue
      const f = a[k][i]
      for (let j = i; j < 4; j++) a[k][j] -= f * a[i][j]
    }
  }
  return a.map((r) => r[3])
}

export function fitMapFrame(page: number, bbox: Box, local: number[], geographic: number[], wkt: string): MapFrame {
  if (
    bbox.length !== 4 ||
    !bbox.every(Number.isFinite) ||
    bbox[2] <= bbox[0] ||
    bbox[3] <= bbox[1] ||
    local.length < 6 ||
    local.length % 2 ||
    geographic.length !== local.length ||
    ![...local, ...geographic].every(Number.isFinite)
  )
    throw Error('The PDF has incomplete map control points.')
  if (local.some((v) => v < 0 || v > 1)) throw Error('The PDF local map controls must be normalized to the map frame.')
  // GPTS is latitude, longitude; fit in the declared projected CRS, never directly in degrees.
  if (!/^PROJCS\[/i.test(wkt)) throw Error('This PDF needs a supported projected map coordinate system.')
  const projection = proj4(wkt, 'EPSG:4326')
  const samples: { a: number[]; xy: number[] }[] = []
  for (let i = 0; i < local.length; i += 2) {
    const lat = geographic[i],
      lon = geographic[i + 1]
    if (Math.abs(lat) >= 85 || Math.abs(lon) > 180) throw Error('The PDF map control coordinates are invalid.')
    samples.push({ a: [1, local[i], local[i + 1]], xy: projection.inverse([lon, lat]) })
  }
  const normal = [0, 1, 2].map((i) => [0, 1, 2].map((j) => samples.reduce((s, p) => s + p.a[i] * p.a[j], 0)))
  const x = solve(
    normal,
    [0, 1, 2].map((i) => samples.reduce((s, p) => s + p.a[i] * p.xy[0], 0)),
  )
  const y = solve(
    normal,
    [0, 1, 2].map((i) => samples.reduce((s, p) => s + p.a[i] * p.xy[1], 0)),
  )
  if (Math.abs(x[1] * y[2] - x[2] * y[1]) < 1e-6) throw Error('The PDF map registration has no usable area.')
  const apply = (a: number[]) => [x.reduce((s, v, i) => s + v * a[i], 0), y.reduce((s, v, i) => s + v * a[i], 0)] as XY
  const registrationErrorM = Math.max(
    ...samples.map(({ a, xy }) => {
      const p = apply(a)
      return Math.hypot(p[0] - xy[0], p[1] - xy[1])
    }),
  )
  // The templates use metre-based Albers/UTM. Refuse other units rather than calling feet metres.
  const metre = /UNIT\["(?:Meter|Metre|metre|meter)",\s*1(?:\.0)?\]\s*\]\s*$/i.test(wkt)
  if (!metre) throw Error('PDF map registration currently requires a projected CRS in metres.')
  if (registrationErrorM > PDF_LIMITS.registrationErrorM)
    throw Error(
      `The PDF map controls disagree by ${registrationErrorM.toFixed(1)} m; georeference the sheet before importing.`,
    )
  const toWorld = ([px, py]: XY): XY =>
    projection.forward(apply([1, (px - bbox[0]) / (bbox[2] - bbox[0]), (py - bbox[1]) / (bbox[3] - bbox[1])])) as XY
  const corners = (
    [
      [bbox[0], bbox[3]],
      [bbox[2], bbox[3]],
      [bbox[2], bbox[1]],
      [bbox[0], bbox[1]],
    ] as XY[]
  ).map(toWorld) as MapFrame['corners']
  return {
    page,
    bbox,
    crs: /^PROJCS\["([^"]+)"/.exec(wkt)?.[1] ?? 'Projected map',
    registrationErrorM,
    toWorld,
    corners,
    wkt,
    pageToProjected: [
      x[1] / (bbox[2] - bbox[0]),
      y[1] / (bbox[2] - bbox[0]),
      x[2] / (bbox[3] - bbox[1]),
      y[2] / (bbox[3] - bbox[1]),
      x[0] - (x[1] * bbox[0]) / (bbox[2] - bbox[0]) - (x[2] * bbox[1]) / (bbox[3] - bbox[1]),
      y[0] - (y[1] * bbox[0]) / (bbox[2] - bbox[0]) - (y[2] * bbox[1]) / (bbox[3] - bbox[1]),
    ],
  }
}

export async function readMapFrames(bytes: Uint8Array) {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false })
  if (pdf.getPageCount() > PDF_LIMITS.pages) throw Error(`Import at most ${PDF_LIMITS.pages} PDF pages at a time.`)
  const frames: MapFrame[] = []
  const notices: string[] = []
  for (const [index, p] of pdf.getPages().entries()) {
    const viewports = p.node.lookupMaybe(key('VP'), PDFArray)
    if (!viewports?.size()) {
      notices.push(`Page ${index + 1}: no embedded map registration; no geometry extracted.`)
      continue
    }
    // Insets have their own projection. Never apply the main frame's registration to them.
    if (viewports.size() !== 1)
      throw Error(`Page ${index + 1} has multiple map frames; import a sheet with one map frame.`)
    const vp = viewports.lookup(0, PDFDict)
    const measure = vp.lookup(key('Measure'), PDFDict)
    if (measure.lookup(key('Subtype'), PDFName).asString() !== '/GEO') throw Error('Unsupported PDF map registration.')
    const gcs = measure.lookup(key('GCS'), PDFDict)
    const wkt = gcs.lookup(key('WKT'))
    if (!(wkt instanceof PDFString || wkt instanceof PDFHexString))
      throw Error('The PDF map needs an embedded CRS definition.')
    const bounds = numbers(measure, 'Bounds')
    if (bounds.join(',') !== '0,0,0,1,1,1,1,0,0,0' && bounds.join(',') !== '0,0,0,1,1,1,1,0')
      throw Error('This PDF has a non-rectangular map frame; georeference it before importing.')
    frames.push(
      fitMapFrame(
        index + 1,
        numbers(vp, 'BBox') as Box,
        numbers(measure, 'LPTS'),
        numbers(measure, 'GPTS'),
        wkt.decodeText(),
      ),
    )
  }
  if (!frames.length)
    throw Error(
      'This PDF has no supported embedded map registration. Import its original GIS files or georeference the image first.',
    )
  const lossyImages = new Set<string>()
  const jpegs = new Map<string, PDFRawStream>()
  for (const [ref, object] of pdf.context.enumerateIndirectObjects()) {
    const dict = object instanceof PDFDict ? object : 'dict' in object ? object.dict : null
    if (!(dict instanceof PDFDict)) continue
    const filter = dict.get(key('Filter'))?.toString() ?? ''
    const id = `${ref.objectNumber}R${ref.generationNumber || ''}`
    if (/DCTDecode|JPXDecode/.test(filter)) lossyImages.add(id)
    // A stream whose only filter is DCTDecode holds the JPEG file itself, coefficients and tables.
    if (/^\[?\s*\/DCTDecode\s*\]?$/.test(filter) && object instanceof PDFRawStream) jpegs.set(id, object)
  }
  return {
    creator: pdf.getCreator() ?? '',
    frames,
    notices,
    lossyImages,
    jpegBytes: (reference: string) => jpegs.get(reference)?.getContents(),
  }
}

/** A WKT parameter by any of its names: Esri and OGC spell several differently. */
const parameter = (wkt: string, ...names: string[]) => {
  for (const name of names) {
    const match = new RegExp(`PARAMETER\\["${name}",\\s*(-?[\\d.]+)\\]`, 'i').exec(wkt)
    if (match) return Number(match[1])
  }
  return NaN
}
const MERIDIAN = ['Central_Meridian', 'longitude_of_center', 'longitude_of_origin']
const ORIGIN = ['Latitude_Of_Origin', 'latitude_of_center']
/**
 * The EPSG code of a sheet's projected CRS when it is one the road tools accept: BC Albers, or
 * NAD83 / NAD83(CSRS) / WGS84 UTM zones 7–11. Decided from the projection's parameters, never its
 * name. Null for anything else, so a surface is never placed in a guessed CRS.
 */
export function projectedEpsg(wkt: string): number | null {
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6
  const nad83 = /DATUM\["D_North_American_1983"|DATUM\["North_American_Datum_1983"/i.test(wkt)
  const csrs = /DATUM\["D_North_American_1983_CSRS"|NAD83\(CSRS\)/i.test(wkt)
  const wgs84 = /DATUM\["D_WGS_1984"|DATUM\["WGS_1984"/i.test(wkt)
  if (
    /PROJECTION\["Albers(?:_Conic_Equal_Area)?"\]/i.test(wkt) &&
    nad83 &&
    near(parameter(wkt, ...MERIDIAN), -126) &&
    near(parameter(wkt, 'Standard_Parallel_1'), 50) &&
    near(parameter(wkt, 'Standard_Parallel_2'), 58.5) &&
    near(parameter(wkt, ...ORIGIN), 45) &&
    near(parameter(wkt, 'False_Easting'), 1_000_000) &&
    near(parameter(wkt, 'False_Northing'), 0)
  )
    return 3005
  if (
    /PROJECTION\["Transverse_Mercator"\]/i.test(wkt) &&
    near(parameter(wkt, 'Scale_Factor'), 0.9996) &&
    near(parameter(wkt, 'False_Easting'), 500_000) &&
    near(parameter(wkt, 'False_Northing'), 0)
  ) {
    const zone = (parameter(wkt, ...MERIDIAN) + 183) / 6
    if (!Number.isInteger(zone) || zone < 7 || zone > 11) return null
    if (csrs) return zone === 10 ? 3157 : null
    if (nad83) return 26900 + zone
    if (wgs84) return 32600 + zone
  }
  return null
}
