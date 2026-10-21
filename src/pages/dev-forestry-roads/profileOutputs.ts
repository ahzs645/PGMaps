import { cableCoordinateAtDistance, resolvedCableLine } from './cableGeometry'
import { distance, offsetCoordinate } from './engine'
import { classifySectionOffset } from './sectionGeometry'
import type {
  CableAnalysis,
  CableLine,
  Coordinate,
  ResolvedTemplate,
  RoadStation,
  RoadTemplate,
  TerrainMetadata,
} from './types'

export interface CableSummary {
  startCoordinate: Coordinate
  endCoordinate: Coordinate
  horizontalSpanM: number
  startSupportElevationM: number | null
  endSupportElevationM: number | null
  /** Signed physical end minus physical start; not yarder minus tailhold. */
  supportElevationDifferenceM: number | null
  straightSupportChordM: number | null
  assumedSagM: number
  sampledGeometricCableLengthM: number | null
  minClearanceM: number | null
  geometryComplete: boolean
  complete: boolean
  knownGroundPercent: number
  sampleCount: number
}

const finite = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

export const CABLE_GEOMETRY_ASSUMPTIONS =
  'Geometric screening with an assumed parabolic sag below the straight support chord. ' +
  'Sag is the entered percentage of horizontal span. Sampled cable length sums straight segments in the profile plane; ' +
  'it is not a purchase length or a catenary, tension, load, anchor, equipment or operating-safety calculation. ' +
  'Interior terrain gaps leave clearance unknown even when the assumed cable geometry is calculable.'

/**
 * Uses the existing native-terrain profile. No rendered map elevations or new
 * terrain queries enter an export. Only the two physical supports are needed
 * for assumed cable geometry; every ground sample is needed for full clearance.
 */
export function cableSummary(line: CableLine, analysis: CableAnalysis): CableSummary {
  const resolved = resolvedCableLine(line)
  if (!Number.isFinite(line.deflectionPercent) || line.deflectionPercent < 0 || line.deflectionPercent > 30)
    throw Error('Assumed D-line sag must be between 0% and 30%.')
  const horizontalSpanM = distance(resolved.start, resolved.end)
  const samples = analysis.samples
  const tolerance = Math.max(1e-5, horizontalSpanM * 1e-8)
  if (
    samples.length &&
    (samples.length < 2 ||
      samples.length > 1001 ||
      !Number.isFinite(analysis.length) ||
      Math.abs(analysis.length - horizontalSpanM) > tolerance ||
      Math.abs(samples[0].distance) > tolerance ||
      Math.abs(samples.at(-1)!.distance - horizontalSpanM) > tolerance ||
      samples.some(
        (sample, i) => !Number.isFinite(sample.distance) || (i > 0 && sample.distance <= samples[i - 1].distance),
      ))
  )
    throw Error('The D-line profile does not match the current support span. Recalculate before exporting.')
  const firstGround = finite(samples[0]?.ground)
  const lastGround = finite(samples.at(-1)?.ground)
  const startSupportElevationM = firstGround === null ? null : firstGround + resolved.startHeight
  const endSupportElevationM = lastGround === null ? null : lastGround + resolved.endHeight
  const supportElevationDifferenceM =
    startSupportElevationM === null || endSupportElevationM === null
      ? null
      : endSupportElevationM - startSupportElevationM
  const assumedSagM = (horizontalSpanM * line.deflectionPercent) / 100
  // Detect stale height/sag settings as well as stale offsets, rather than
  // labeling a previous profile with the current input assumptions.
  if (startSupportElevationM !== null && endSupportElevationM !== null && horizontalSpanM > 0) {
    for (const sample of samples) {
      const t = sample.distance / horizontalSpanM
      const expected = startSupportElevationM * (1 - t) + endSupportElevationM * t - 4 * assumedSagM * t * (1 - t)
      if (finite(sample.cable) !== null && Math.abs(sample.cable! - expected) > 1e-5)
        throw Error(
          'The D-line profile does not match the current support heights or sag. Recalculate before exporting.',
        )
    }
  }
  const geometryComplete =
    samples.length >= 2 &&
    supportElevationDifferenceM !== null &&
    samples.every((sample) => finite(sample.cable) !== null)
  let sampledGeometricCableLengthM: number | null = null
  if (geometryComplete) {
    sampledGeometricCableLengthM = 0
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1],
        b = samples[i]
      sampledGeometricCableLengthM += Math.hypot(b.distance - a.distance, b.cable! - a.cable!)
    }
  }
  const complete =
    analysis.complete &&
    geometryComplete &&
    finite(analysis.minClearance) !== null &&
    samples.every((sample) => finite(sample.ground) !== null && finite(sample.clearance) !== null)
  return {
    startCoordinate: resolved.start,
    endCoordinate: resolved.end,
    horizontalSpanM,
    startSupportElevationM,
    endSupportElevationM,
    supportElevationDifferenceM,
    straightSupportChordM:
      supportElevationDifferenceM === null ? null : Math.hypot(horizontalSpanM, supportElevationDifferenceM),
    assumedSagM,
    sampledGeometricCableLengthM,
    minClearanceM: complete ? analysis.minClearance : null,
    geometryComplete,
    complete,
    knownGroundPercent: samples.length
      ? (100 * samples.filter((sample) => finite(sample.ground) !== null).length) / samples.length
      : 0,
    sampleCount: samples.length,
  }
}

type CsvValue = string | number | null | undefined
function csvValue(value: CsvValue): string {
  if (value === null || value === undefined || (typeof value === 'number' && !Number.isFinite(value))) return ''
  if (typeof value === 'number') return String(value)
  const guarded = /^\s*[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return `"${guarded.replace(/"/g, '""')}"`
}
function csv(headers: string[], rows: CsvValue[][]) {
  return headers.join(',') + '\r\n' + rows.map((row) => row.map(csvValue).join(',')).join('\r\n') + '\r\n'
}
const sourceHeaders = [
  'terrain',
  'terrain_kind',
  'terrain_resolution_m',
  'source_epsg',
  'vertical_reference',
  'source_url',
  'terrain_sha256',
]
const sourceValues = (metadata: TerrainMetadata): CsvValue[] => [
  metadata.name,
  metadata.kind,
  metadata.resolutionM,
  metadata.epsg,
  metadata.verticalReference,
  metadata.sourceUrl,
  metadata.sha256,
]

export function cableProfileCsv(line: CableLine, analysis: CableAnalysis, metadata: TerrainMetadata): string {
  const summary = cableSummary(line, analysis)
  if (!analysis.samples.length) throw Error('The D-line profile is unavailable. Recalculate before exporting.')
  const resolved = resolvedCableLine(line)
  return csv(
    [
      'line_id',
      'line_name',
      'distance_m',
      'longitude',
      'latitude',
      'ground_elevation_m',
      'assumed_cable_elevation_m',
      'clearance_m',
      'horizontal_span_m',
      'start_support_elevation_m',
      'end_support_elevation_m',
      'support_elevation_difference_m',
      'straight_support_chord_m',
      'assumed_sag_m',
      'sampled_geometric_cable_length_m',
      'minimum_clearance_m',
      'geometry_complete',
      'clearance_complete',
      'known_ground_percent',
      'yarder_at',
      'start_offset_m',
      'end_offset_m',
      'yarder_height_m',
      'tailhold_height_m',
      'assumed_sag_percent',
      ...sourceHeaders,
      'assumptions',
    ],
    analysis.samples.map((sample) => [
      line.id,
      line.name,
      sample.distance,
      ...cableCoordinateAtDistance(resolved, sample.distance),
      sample.ground,
      sample.cable,
      sample.clearance,
      summary.horizontalSpanM,
      summary.startSupportElevationM,
      summary.endSupportElevationM,
      summary.supportElevationDifferenceM,
      summary.straightSupportChordM,
      summary.assumedSagM,
      summary.sampledGeometricCableLengthM,
      summary.minClearanceM,
      summary.geometryComplete ? 'yes' : 'no',
      summary.complete ? 'yes' : 'no',
      summary.knownGroundPercent,
      line.yarderAt ?? 'start',
      line.startOffsetM ?? 0,
      line.endOffsetM ?? 0,
      line.startHeight,
      line.endHeight,
      line.deflectionPercent,
      ...sourceValues(metadata),
      CABLE_GEOMETRY_ASSUMPTIONS,
    ]),
  )
}

/** Negative offsets are left when looking along increasing road chainage. */
export function crossSectionCsv(
  station: RoadStation,
  resolvedTemplate: RoadTemplate | ResolvedTemplate,
  metadata: TerrainMetadata,
  alignmentName = 'Selected road',
): string {
  if (!station.section.length) throw Error('The selected cross-section is unavailable. Recalculate before exporting.')
  const names =
    'template' in resolvedTemplate
      ? [resolvedTemplate.leftName, resolvedTemplate.rightName]
      : ['Base section', 'Base section']
  return csv(
    [
      'alignment_name',
      'chainage_m',
      'signed_offset_m',
      'longitude',
      'latitude',
      'location_code',
      'ground_elevation_m',
      'design_elevation_m',
      'cut_fill_depth_m',
      'left_width_m',
      'right_width_m',
      'left_template',
      'right_template',
      'section_complete',
      'section_flags',
      ...sourceHeaders,
      'conventions',
    ],
    station.section.map((sample) => {
      const ground = finite(sample.ground),
        design = finite(sample.design)
      return [
        alignmentName,
        station.chainage,
        sample.offset,
        ...offsetCoordinate(station.coordinate, station.bearing + 90, sample.offset),
        classifySectionOffset(station, resolvedTemplate, sample.offset),
        ground,
        design,
        ground === null || design === null ? null : ground - design,
        station.leftWidth,
        station.rightWidth,
        ...names,
        station.complete ? 'yes' : 'no',
        station.flags.join('; '),
        ...sourceValues(metadata),
        'WGS84 longitude/latitude; negative offset left along increasing chainage; cut_fill_depth = ground minus design (positive cut, negative fill); blank means unknown or outside designed section; location codes describe PGMaps geometry, not proprietary survey codes.',
      ]
    }),
  )
}

const html = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const fmt = (value: number | null, digits = 2) =>
  value === null || !Number.isFinite(value) ? 'Unknown' : value.toFixed(digits)

function profileSvg(analysis: CableAnalysis): string {
  const values = analysis.samples
    .flatMap((sample) => [finite(sample.ground), finite(sample.cable)])
    .filter((v): v is number => v !== null)
  if (!values.length) return '<p>No known elevations are available for the profile plot.</p>'
  const low = Math.min(...values),
    high = Math.max(...values),
    range = Math.max(1, high - low)
  const left = 72,
    right = 952,
    top = 24,
    bottom = 280
  const x = (distanceM: number) => left + (distanceM / Math.max(analysis.length, 0.01)) * (right - left)
  const y = (elevation: number) => bottom - ((elevation - low + range * 0.08) / (range * 1.16)) * (bottom - top)
  const path = (key: 'ground' | 'cable') => {
    let open = false
    return analysis.samples
      .map((sample) => {
        const value = finite(sample[key])
        if (value === null) {
          open = false
          return ''
        }
        const command = open ? 'L' : 'M'
        open = true
        return `${command}${x(sample.distance).toFixed(2)},${y(value).toFixed(2)}`
      })
      .join(' ')
  }
  const grid = Array.from({ length: 5 }, (_, i) => {
    const elevation = low + (range * i) / 4
    const distanceM = (analysis.length * i) / 4
    return `<line x1="${left}" y1="${y(elevation)}" x2="${right}" y2="${y(elevation)}" stroke="#d8e0db"/><text x="${left - 8}" y="${y(elevation) + 4}" text-anchor="end">${fmt(elevation, 1)}</text><text x="${x(distanceM)}" y="${bottom + 22}" text-anchor="middle">${fmt(distanceM, 0)}</text>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 336" role="img" aria-label="D-line profile of sampled ground and assumed cable elevation"><g font-size="12" font-family="sans-serif" fill="#34483f">${grid}<text x="${left}" y="14">Elevation (m)</text><text x="512" y="329" text-anchor="middle">Horizontal distance from effective start (m)</text></g><path d="${path('ground')}" fill="none" stroke="#536e48" stroke-width="2"/><path d="${path('cable')}" fill="none" stroke="#bd4d19" stroke-width="2.5"/></svg><p class="muted">Green: source ground. Orange: assumed cable. Gaps remain blank. Horizontal and vertical plot scales differ.</p>`
}

/** Standalone, escaped, script-free report suitable for browser Print / Save PDF. */
export function cableProfileHtml(line: CableLine, analysis: CableAnalysis, metadata: TerrainMetadata): string {
  const summary = cableSummary(line, analysis)
  if (!analysis.samples.length) throw Error('The D-line profile is unavailable. Recalculate before exporting.')
  const resolved = resolvedCableLine(line)
  const rows = analysis.samples
    .map(
      (sample) =>
        `<tr><td>${fmt(sample.distance)}</td><td>${fmt(finite(sample.ground))}</td><td>${fmt(finite(sample.cable))}</td><td>${fmt(finite(sample.clearance))}</td></tr>`,
    )
    .join('')
  const sourceNote =
    metadata.kind === 'demo'
      ? 'Synthetic training terrain; locations and elevations are illustrative.'
      : metadata.kind === 'regional'
        ? 'Coarse regional terrain for screening; it does not establish local clearance.'
        : 'Source terrain is sampled at its native analysis resolution; accuracy is not independently surveyed.'
  const measurements: [string, number | null][] = [
    ['Horizontal span (m)', summary.horizontalSpanM],
    ['Start support elevation (m)', summary.startSupportElevationM],
    ['End support elevation (m)', summary.endSupportElevationM],
    ['End minus start elevation (m)', summary.supportElevationDifferenceM],
    ['Straight support chord (m)', summary.straightSupportChordM],
    ['Assumed maximum sag below chord (m)', summary.assumedSagM],
    ['Sampled geometric cable length (m)', summary.sampledGeometricCableLengthM],
    ['Minimum sampled clearance (m)', summary.minClearanceM],
  ]
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:;"><title>${html(line.name)} · D-line profile</title><style>body{font:14px/1.5 system-ui,sans-serif;color:#172b25;max-width:1000px;margin:36px auto;padding:0 24px}h1{font-size:28px}h2{font-size:19px;margin-top:28px;border-bottom:1px solid #d1d5db;padding-bottom:6px}.eyebrow{font-size:11px;letter-spacing:2px;color:#527465}.status{padding:12px 16px;background:#fff7ed;border-left:4px solid #d97706}.muted{color:#53665e}dl{display:grid;grid-template-columns:minmax(190px,1fr) 2fr;gap:6px}dd{margin:0;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;font-size:12px}th,td{text-align:right;padding:6px;border-bottom:1px solid #d8e0db}th{background:#eaf0ec}tr{break-inside:avoid}svg{width:100%;height:auto;break-inside:avoid}@media print{body{margin:0;max-width:none;font-size:10pt}h2{break-after:avoid}thead{display:table-header-group}}</style></head><body><div class="eyebrow">PGMAPS · D-LINE GEOMETRIC SCREENING</div><h1>${html(line.name)}</h1><p class="status"><strong>${summary.complete ? 'Complete sampled clearance profile' : 'Incomplete clearance profile · unknown samples remain unresolved'}</strong><br>${fmt(summary.knownGroundPercent, 1)}% known ground across ${summary.sampleCount} samples. ${sourceNote}</p><h2>Profile measurements</h2><dl>${measurements.map(([label, value]) => `<dt>${label}</dt><dd>${fmt(value)}</dd>`).join('')}</dl><h2>Ground and assumed cable</h2>${profileSvg(analysis)}<h2>Support inputs and assumptions</h2><dl><dt>Effective start (longitude, latitude)</dt><dd>${resolved.start.map((v) => fmt(v, 8)).join(', ')}</dd><dt>Effective end (longitude, latitude)</dt><dd>${resolved.end.map((v) => fmt(v, 8)).join(', ')}</dd><dt>Yarder position</dt><dd>${line.yarderAt ?? 'start'}</dd><dt>Yarder / tailhold height above ground</dt><dd>${fmt(line.startHeight)} / ${fmt(line.endHeight)} m</dd><dt>Start / end endpoint offset</dt><dd>${fmt(line.startOffsetM ?? 0)} / ${fmt(line.endOffsetM ?? 0)} m; positive inward, negative outward</dd><dt>Assumed sag</dt><dd>${fmt(line.deflectionPercent)}% of horizontal span</dd><dt>Geometry available</dt><dd>${summary.geometryComplete ? 'Yes' : 'No — required support or cable elevations are missing'}</dd></dl><p>${CABLE_GEOMETRY_ASSUMPTIONS}</p><p>Distances are horizontal along the resolved physical start-to-end direction. The support elevation difference is signed end minus start. Negative clearance means the assumed cable passes below sampled ground. A complete geometric profile does not establish a safe cable operation.</p><h2>Terrain provenance</h2><dl><dt>Source</dt><dd>${html(metadata.name)}</dd><dt>Source kind</dt><dd>${html(metadata.kind)}</dd><dt>Native terrain spacing</dt><dd>${fmt(metadata.resolutionM)} m; resolution is not vertical accuracy</dd><dt>Source horizontal CRS</dt><dd>${metadata.epsg ? `EPSG:${metadata.epsg}` : 'Unspecified'}</dd><dt>Export coordinate CRS</dt><dd>WGS84 longitude / latitude</dd><dt>Vertical reference</dt><dd>${html(metadata.verticalReference)}</dd><dt>Source URL</dt><dd>${html(metadata.sourceUrl ?? 'Local or synthetic source')}</dd><dt>SHA-256</dt><dd>${html(metadata.sha256 ?? 'Not recorded')}</dd></dl><h2>Sample schedule</h2><p class="muted">Unknown values are not zero. Cable geometry can remain known over an interior terrain gap while clearance remains unknown.</p><table><thead><tr><th>Distance (m)</th><th>Ground (m)</th><th>Assumed cable (m)</th><th>Clearance (m)</th></tr></thead><tbody>${rows}</tbody></table></body></html>`
}
