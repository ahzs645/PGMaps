/** Final fitted-connector gates. Pure: terrain is supplied; no DOM, fetching or model mutation. */
import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js'
import GeometryFactory from 'jsts/org/locationtech/jts/geom/GeometryFactory.js'
import IsValidOp from 'jsts/org/locationtech/jts/operation/valid/IsValidOp.js'
import DistanceOp from 'jsts/org/locationtech/jts/operation/distance/DistanceOp.js'
import {
  analyzeRoad,
  createRoadStationSampler,
  curveDesignAt,
  distance,
  horizontalCurveSummary,
  horizontalGeometry,
  offsetCoordinate,
  verticalCurveSummary,
} from './engine'
import { parseConnectorCheckOptions, type ConnectorCheckOptions } from './connectorCheckOptions'
import type {
  Alignment,
  ContextFeature,
  Coordinate,
  RoadAnalysis,
  RoadSettings,
  RoadStation,
  TerrainSource,
} from './types'
export * from './connectorCheckOptions'

export const MAX_CONNECTOR_SECTION_SPACING_M = 1
export const MAX_CONNECTOR_SITE_TERRAIN_RESOLUTION_M = 2
export const MAX_CONNECTOR_HEADING_GAP_DEGREES = 0.05
export const CONNECTOR_ENDPOINT_TOLERANCE_M = 0.05
export const CONNECTOR_POSITION_GAP_TOLERANCE_M = 0.001
export const MAX_CONNECTOR_CHECK_STATIONS = 16000
export const MAX_CONNECTOR_TERRAIN_SAMPLES = 4_000_000
export const MAX_CONNECTOR_GEOMETRY_OPERATIONS = 5_000_000
const MAX_CONTEXT_VERTICES = 50000
const R = 6371008.8,
  RAD = Math.PI / 180,
  EPS = 1e-6

type XY = [number, number]
type Box = [number, number, number, number]
export interface ConnectorCheckIssue {
  code: string
  message: string
  chainage?: number
  featureId?: string
}
export interface ConnectorCheckMetrics {
  lengthM: number
  checkedStations: number
  terrainSamples: number
  geometryOperations: number
  maxSectionSpacingM: number
  maxCutDepthM: number
  maxFillHeightM: number
  maxAdverseGradePercent: number
  maxFavourableGradePercent: number
  /** Signed direction is fixed from alignment start to end, independent of the timber loaded-direction input. */
  maxFormationUphillGradePercent: number
  maxFormationDownhillGradePercent: number
  minFittedRadiusM: number | null
  maxFootprintWidthM: number
}
export interface ConnectorCheckResult {
  status: 'pass' | 'fail' | 'unknown'
  adoptable: boolean
  failures: ConnectorCheckIssue[]
  unknowns: ConnectorCheckIssue[]
  analysis: RoadAnalysis | null
  metrics: ConnectorCheckMetrics
}
export interface ConnectorCheckInput {
  alignment: Alignment
  terrain: TerrainSource
  settings: RoadSettings
  context?: ContextFeature[]
  referenceSurfaces?: Record<string, TerrainSource>
  verticalReference?: string
  options?: Partial<ConnectorCheckOptions>
  /** Native horizontal source resolution. Coarse/unknown resolution cannot pass a site-level connector gate. */
  terrainResolutionM?: number
  expectedStart?: Coordinate
  expectedEnd?: Coordinate
}
const boxOf = (points: XY[]): Box => [
  Math.min(...points.map((p) => p[0])),
  Math.min(...points.map((p) => p[1])),
  Math.max(...points.map((p) => p[0])),
  Math.max(...points.map((p) => p[1])),
]
const overlaps = (a: Box, b: Box, padding: number) =>
  a[0] <= b[2] + padding && a[2] >= b[0] - padding && a[1] <= b[3] + padding && a[3] >= b[1] - padding
function convexHull(points: XY[]): XY[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (a: XY, b: XY, c: XY) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  const half = (items: XY[]) => {
    const out: XY[] = []
    for (const point of items) {
      while (out.length > 1 && cross(out[out.length - 2], out[out.length - 1], point) <= 1e-10) out.pop()
      out.push(point)
    }
    return out
  }
  const lower = half(sorted),
    upper = half([...sorted].reverse())
  const ring = [...lower.slice(0, -1), ...upper.slice(0, -1)]
  return ring.length >= 3 ? [...ring, ring[0]] : []
}
/** Tangent directions from the compiled pieces, including linearly varying clothoid curvature. */
function pieceHeadings(
  piece: ReturnType<typeof horizontalGeometry>[number],
  xy: (coordinate: number[]) => XY,
): [number, number] {
  const a = xy(piece.start),
    b = xy(piece.end)
  if (piece.kind === 'line') {
    const angle = Math.atan2(b[1] - a[1], b[0] - a[0])
    return [angle, angle]
  }
  const sign = piece.rotation === 'ccw' ? 1 : -1
  if (piece.kind === 'arc') {
    const center = xy(piece.center)
    return [
      Math.atan2(a[1] - center[1], a[0] - center[0]) + (sign * Math.PI) / 2,
      Math.atan2(b[1] - center[1], b[0] - center[0]) + (sign * Math.PI) / 2,
    ]
  }
  const k0 = Number.isFinite(piece.radiusStart) ? sign / piece.radiusStart : 0
  const k1 = Number.isFinite(piece.radiusEnd) ? sign / piece.radiusEnd : 0
  let x = 0,
    y = 0
  for (let i = 0; i <= 64; i++) {
    const t = (piece.length * i) / 64,
      theta = k0 * t + ((k1 - k0) * t * t) / (2 * piece.length)
    const weight = i === 0 || i === 64 ? 1 : i % 2 ? 4 : 2
    x += weight * Math.cos(theta)
    y += weight * Math.sin(theta)
  }
  const start = Math.atan2(b[1] - a[1], b[0] - a[0]) - Math.atan2(y, x)
  return [start, start + ((k0 + k1) * piece.length) / 2]
}
const stationText = (s: number) => `${Math.floor(s / 1000)}+${(s % 1000).toFixed(1).padStart(5, '0')}`

export function checkConnector({
  alignment,
  terrain,
  settings,
  context = [],
  referenceSurfaces,
  verticalReference,
  options: input,
  terrainResolutionM,
  expectedStart,
  expectedEnd,
}: ConnectorCheckInput): ConnectorCheckResult {
  const failures: ConnectorCheckIssue[] = [],
    unknowns: ConnectorCheckIssue[] = []
  const keys = new Set<string>()
  let analysis: RoadAnalysis | null = null
  const metrics: ConnectorCheckMetrics = {
    lengthM: 0,
    checkedStations: 0,
    terrainSamples: 0,
    geometryOperations: 0,
    maxSectionSpacingM: 0,
    maxCutDepthM: 0,
    maxFillHeightM: 0,
    maxAdverseGradePercent: 0,
    maxFavourableGradePercent: 0,
    maxFormationUphillGradePercent: 0,
    maxFormationDownhillGradePercent: 0,
    minFittedRadiusM: null,
    maxFootprintWidthM: 0,
  }
  const add = (kind: 'failure' | 'unknown', code: string, message: string, chainage?: number, featureId?: string) => {
    const key = `${kind}:${code}:${featureId ?? ''}`
    if (keys.has(key)) return
    keys.add(key)
    ;(kind === 'failure' ? failures : unknowns).push({
      code,
      message: chainage === undefined ? message : `${stationText(chainage)}: ${message}`,
      ...(chainage === undefined ? {} : { chainage }),
      ...(featureId ? { featureId } : {}),
    })
  }
  const result = (): ConnectorCheckResult => ({
    status: failures.length ? 'fail' : unknowns.length ? 'unknown' : 'pass',
    adoptable: !failures.length && !unknowns.length,
    failures,
    unknowns,
    analysis,
    metrics,
  })
  try {
    const options = parseConnectorCheckOptions(input)
    if (
      options.loadedDirection === null ||
      options.maxAdverseGradePercent === null ||
      options.maxFavourableGradePercent === null
    )
      add(
        'unknown',
        'loaded-haul-criteria',
        'Set loaded travel direction and both adverse/uphill and favourable/downhill formation-grade limits before adoption.',
      )
    if (options.requireFormationDesign && alignment.vertical.length < 2)
      add(
        'unknown',
        'independent-formation',
        'The road has no independent formation profile. Ground-following elevations are not a designed loaded-haul grade.',
      )
    if (!(terrainResolutionM !== undefined && Number.isFinite(terrainResolutionM) && terrainResolutionM > 0))
      add(
        'unknown',
        'terrain-resolution',
        'Native terrain resolution is unknown; provide checked terrain provenance before adoption.',
      )
    else if (terrainResolutionM > MAX_CONNECTOR_SITE_TERRAIN_RESOLUTION_M)
      add(
        'unknown',
        'coarse-terrain',
        `The ${terrainResolutionM.toFixed(2)} m terrain is coarse screening ground; site-level formation, daylight and quantities remain unverified.`,
      )
    if (!(settings.minRadius > 0))
      add('unknown', 'minimum-radius-unset', 'Set a positive minimum fitted radius before adopting a connector.')
    const countSource = (source: TerrainSource): TerrainSource => ({
      elevationAt: (longitude, latitude) => {
        if (++metrics.terrainSamples > MAX_CONNECTOR_TERRAIN_SAMPLES)
          throw Error('Final connector terrain-sampling budget exceeded; split the planning section.')
        return source.elevationAt(longitude, latitude)
      },
    })
    const countedTerrain = countSource(terrain)
    const countedReferences = Object.fromEntries(
      Object.entries(referenceSurfaces ?? {}).map(([id, source]) => [id, countSource(source)]),
    )
    let sampler: ReturnType<typeof createRoadStationSampler>
    try {
      sampler = createRoadStationSampler(alignment, countedTerrain, settings, {
        context,
        referenceSurfaces: countedReferences,
        verticalReference,
      })
    } catch (error) {
      add(
        'failure',
        'invalid-final-geometry',
        error instanceof Error ? error.message : 'The final alignment or design inputs are invalid.',
      )
      return result()
    }
    metrics.lengthM = sampler.length
    if (!(sampler.length >= 2)) {
      add('failure', 'empty-geometry', 'The final connector needs at least 2 m of continuous geometry.')
      return result()
    }
    if (alignment.vertical.some((point) => point.chainage > sampler.length + EPS))
      add(
        'failure',
        'vertical-control-outside-road',
        'A formation control is stationed beyond the fitted road end; rebuild the profile on the final alignment.',
      )
    const geometry = horizontalGeometry(alignment)
    const frameOrigin = alignment.points[0].coordinate,
      frameCos = Math.cos(frameOrigin[1] * RAD)
    const frameXY = (p: number[]): XY => [
      (p[0] - frameOrigin[0]) * R * RAD * frameCos,
      (p[1] - frameOrigin[1]) * R * RAD,
    ]
    for (let i = 1; i < geometry.length; i++) {
      const previous = pieceHeadings(geometry[i - 1], frameXY)[1],
        next = pieceHeadings(geometry[i], frameXY)[0]
      const turn = Math.abs(Math.atan2(Math.sin(next - previous), Math.cos(next - previous))) / RAD
      if (!Number.isFinite(turn) || turn > MAX_CONNECTOR_HEADING_GAP_DEGREES)
        add(
          'failure',
          'horizontal-tangent-continuity',
          `Compiled pieces have a ${turn.toFixed(3)}° tangent discontinuity.`,
          geometry[i].station,
        )
    }
    const curves = horizontalCurveSummary(alignment)
    metrics.minFittedRadiusM = curves.length ? Math.min(...curves.map((curve) => curve.radius)) : null
    for (const curve of curves) {
      if (curve.radius + EPS < settings.minRadius)
        add(
          'failure',
          'minimum-radius',
          `Fitted radius ${curve.radius.toFixed(2)} m is below the entered ${settings.minRadius} m minimum.`,
          curve.start,
        )
      const criteria = curveDesignAt(alignment, (curve.start + curve.end) / 2)
      for (const warning of criteria?.warnings ?? []) add('failure', 'road-class-criteria', warning, curve.start)
    }
    for (const warning of sampler.warnings)
      if (/sharp|overlap|does not fit|coincident|simple curve is used/i.test(warning))
        add('failure', 'invalid-final-geometry', warning)
    for (const curve of verticalCurveSummary(alignment))
      if (!curve.valid)
        add(
          'failure',
          'invalid-vertical-curve',
          'The final vertical curve does not fit; a fallback tangent cannot pass the connector gate.',
          curve.chainage,
        )
    for (let i = 1; i < geometry.length; i++)
      if (distance(geometry[i - 1].end, geometry[i].start) > CONNECTOR_POSITION_GAP_TOLERANCE_M)
        add(
          'failure',
          'discontinuous-geometry',
          'Compiled horizontal pieces do not meet within 1 mm.',
          geometry[i].station,
        )
    for (const [expected, actual, label] of [
      [expectedStart, geometry[0]?.start, 'start'],
      [expectedEnd, geometry.at(-1)?.end, 'end'],
    ] as const)
      if (expected && (!actual || distance(expected, actual) > CONNECTOR_ENDPOINT_TOLERANCE_M))
        add(
          'failure',
          'endpoint-registration',
          `The fitted connector ${label} does not meet its reviewed target within 0.05 m.`,
        )
    // Invalid fitted geometry cannot be adopted or priced; avoid expensive terrain work for it.
    if (failures.length) return result()
    const samples = [
      ...new Set([
        ...sampler.boundaries,
        ...options.approvedCrossings
          .flatMap((window) => [window.startM, window.endM])
          .filter((s) => s <= sampler.length),
      ]),
    ]
    const count = Math.ceil(sampler.length / MAX_CONNECTOR_SECTION_SPACING_M)
    if (count + samples.length > MAX_CONNECTOR_CHECK_STATIONS) {
      add(
        'unknown',
        'station-budget',
        'The final connector exceeds the dense-section budget; split it into shorter planning sections.',
      )
      return result()
    }
    for (let index = 0; index <= count; index++) samples.push((sampler.length * index) / count)
    const chainages = [...new Set(samples)]
      .sort((a, b) => a - b)
      .filter((s, index, all) => !index || s - all[index - 1] > 1e-7)
    analysis = analyzeRoad(alignment, countedTerrain, { ...settings, stationInterval: 2 }, context, {
      referenceSurfaces: countedReferences,
      verticalReference,
    })
    if (
      ![
        analysis.length,
        analysis.cutVolumeM3,
        analysis.fillVolumeM3,
        analysis.surfaceVolumeM3,
        analysis.clearingAreaM2,
        analysis.estimatedCost,
      ].every(Number.isFinite)
    )
      add(
        'unknown',
        'nonfinite-analysis',
        'The assembled road has non-finite quantities or costs; correct the inputs before adoption.',
      )
    for (const check of analysis.verticalChecks ?? [])
      add('failure', 'vertical-design-standard', check.message, check.chainage)
    for (const culvert of analysis.engineering?.culverts ?? []) {
      if (culvert.gradePercent !== null && Number.isFinite(culvert.gradePercent) && culvert.gradePercent >= -EPS)
        add(
          'failure',
          'culvert-flow-grade',
          `Entered gravity culvert ${culvert.name} has no positive fall from inlet to outlet. Correct the known pipe flow direction; an exception is not modelled.`,
          culvert.chainage,
          culvert.id,
        )
    }
    const approvals = options.approvedCrossings.map((window) => {
      const stream = context.find((feature) => feature.id === window.featureId && feature.kind === 'stream')
      const structure = alignment.engineering?.culverts.find((culvert) => culvert.id === window.structureId)
      const calculated = analysis?.engineering?.culverts.find((culvert) => culvert.id === window.structureId)
      let valid = true
      if (
        !stream ||
        !structure ||
        structure.sourceFeatureId !== window.featureId ||
        window.endM > sampler.length + EPS ||
        structure.chainage < window.startM ||
        structure.chainage > window.endM
      ) {
        add(
          'unknown',
          'crossing-reference',
          'A reviewed crossing window needs a matching mapped stream, entered structure and valid station range.',
          window.startM,
          window.featureId,
        )
        valid = false
      } else if (!calculated?.complete || structure.inletInvertM === null || structure.outletInvertM === null) {
        add(
          'unknown',
          'crossing-geometry',
          `Crossing structure ${structure.name} has incomplete inverts, coverage or geometry.`,
          structure.chainage,
          window.featureId,
        )
        valid = false
      } else if (
        calculated.gradePercent === null ||
        !Number.isFinite(calculated.gradePercent) ||
        calculated.gradePercent >= -EPS
      ) {
        // The explicit gravity-flow failure above cannot be waived by a reviewed crossing window.
        valid = false
      } else if (
        (calculated.coverM ?? -Infinity) < structure.minCoverM - EPS ||
        (calculated.requiredLengthM ?? Infinity) > structure.lengthM + EPS
      ) {
        add(
          'failure',
          'crossing-cover-span',
          `Crossing structure ${structure.name} does not meet its entered cover or barrel-span criteria.`,
          structure.chainage,
          window.featureId,
        )
        valid = false
      }
      return { ...window, valid }
    })
    const origin = alignment.points[0].coordinate,
      cos = Math.cos(origin[1] * RAD)
    const xy = (p: number[]): XY => [(p[0] - origin[0]) * R * RAD * cos, (p[1] - origin[1]) * R * RAD]
    const reader = new GeoJSONReader(new GeometryFactory())
    let vertices = 0
    const constraints = context
      .filter(
        (feature) => (feature.kind === 'avoid' && !Number.isFinite(feature.routeCostPerM)) || feature.kind === 'stream',
      )
      .map((feature) => {
        const rings =
          feature.geometry.type === 'Polygon' ? feature.geometry.coordinates : [feature.geometry.coordinates]
        vertices += rings.reduce((sum, ring) => sum + ring.length, 0)
        if (vertices > MAX_CONTEXT_VERTICES || context.length > 500)
          throw Error('Final connector context budget exceeded; crop the constraint layers.')
        const coordinates = rings.map((ring) =>
          ring.map((point) => {
            if (!point.slice(0, 2).every(Number.isFinite))
              throw Error('A connector constraint has non-finite coordinates.')
            return xy(point)
          }),
        )
        const shape = reader.read(
          feature.geometry.type === 'Polygon'
            ? { type: 'Polygon', coordinates }
            : { type: 'LineString', coordinates: coordinates[0] },
        )
        if (!IsValidOp.isValid(shape))
          throw Error(`Constraint ${feature.name} has invalid topology; repair it before adoption.`)
        return {
          feature,
          shape,
          bounds: boxOf(coordinates.flat()),
          vertices: coordinates.reduce((sum, ring) => sum + ring.length, 0),
        }
      })
    const fullSections: RoadStation[] = []
    for (const s of chainages) {
      const station = sampler.at(s)
      metrics.checkedStations++
      fullSections.push(station)
      if (station.curveRadiusM === 0)
        add('failure', 'sharp-final-corner', 'A sharp horizontal corner remains after curve fitting.', s)
      if (
        station.groundElevation === null ||
        station.designElevation === null ||
        !Number.isFinite(station.groundElevation + station.designElevation)
      )
        add('unknown', 'missing-ground-formation', 'Ground or formation elevation is missing or non-finite.', s)
      if (
        station.complete &&
        ![
          station.cutAreaM2,
          station.fillAreaM2,
          station.leftDaylightM,
          station.rightDaylightM,
          station.leftWidth,
          station.rightWidth,
        ].every((value) => value !== null && Number.isFinite(value))
      )
        add(
          'unknown',
          'nonfinite-complete-section',
          'A section marked complete has unresolved numeric areas, widths or daylight.',
          s,
        )
      if (!station.complete) {
        if (station.flags.some((flag) => /batter runs past/.test(flag)))
          add('failure', 'unresolved-daylight', 'Cut/fill daylight is outside the entered section reach.', s)
        else
          add('unknown', 'incomplete-section', 'The whole road prism has incomplete terrain or daylight coverage.', s)
      }
      for (const point of station.section) {
        const prepared = point.preparedGround === undefined ? point.ground : point.preparedGround
        if (
          point.preparedGround !== undefined &&
          point.ground !== null &&
          prepared !== null &&
          Number.isFinite(point.ground) &&
          Number.isFinite(prepared)
        )
          metrics.maxCutDepthM = Math.max(metrics.maxCutDepthM, point.ground - prepared)
        if (point.design !== null) {
          if (
            !Number.isFinite(point.design) ||
            point.ground === null ||
            !Number.isFinite(point.ground) ||
            prepared === null ||
            !Number.isFinite(prepared)
          )
            add('unknown', 'missing-prism-ground', 'A designed formation, ditch or batter point has missing ground.', s)
          else {
            metrics.maxCutDepthM = Math.max(metrics.maxCutDepthM, point.ground - point.design)
            metrics.maxFillHeightM = Math.max(metrics.maxFillHeightM, point.design - prepared)
          }
        }
      }
      if (options.maxCutDepthM !== null && metrics.maxCutDepthM > options.maxCutDepthM + EPS)
        add('failure', 'maximum-cut', `Cut exceeds the entered ${options.maxCutDepthM} m depth limit.`, s)
      if (options.maxFillHeightM !== null && metrics.maxFillHeightM > options.maxFillHeightM + EPS)
        add('failure', 'maximum-fill', `Fill exceeds the entered ${options.maxFillHeightM} m height limit.`, s)
      if (station.gradePercent === null || !Number.isFinite(station.gradePercent))
        add('unknown', 'formation-grade-unavailable', 'An independent formation grade is unavailable.', s)
      else {
        metrics.maxFormationUphillGradePercent = Math.max(metrics.maxFormationUphillGradePercent, station.gradePercent)
        metrics.maxFormationDownhillGradePercent = Math.max(
          metrics.maxFormationDownhillGradePercent,
          -station.gradePercent,
        )
        if (Math.abs(station.gradePercent) > settings.maxGradePercent + EPS)
          add(
            'failure',
            'absolute-formation-grade',
            `Formation grade ${station.gradePercent.toFixed(2)}% exceeds the ${settings.maxGradePercent}% screening limit.`,
            s,
          )
        const loadedGrade = station.gradePercent * (options.loadedDirection === 'end-to-start' ? -1 : 1)
        if (options.loadedDirection !== null) {
          metrics.maxAdverseGradePercent = Math.max(metrics.maxAdverseGradePercent, loadedGrade)
          metrics.maxFavourableGradePercent = Math.max(metrics.maxFavourableGradePercent, -loadedGrade)
          if (loadedGrade > (options.maxAdverseGradePercent ?? Infinity) + EPS)
            add(
              'failure',
              'adverse-loaded-grade',
              `Loaded uphill formation grade ${loadedGrade.toFixed(2)}% exceeds the entered ${options.maxAdverseGradePercent}% adverse limit.`,
              s,
            )
          if (-loadedGrade > (options.maxFavourableGradePercent ?? Infinity) + EPS)
            add(
              'failure',
              'favourable-loaded-grade',
              `Loaded downhill formation grade ${(-loadedGrade).toFixed(2)}% exceeds the entered ${options.maxFavourableGradePercent}% favourable limit.`,
              s,
            )
        }
      }
    }
    // Each convex strip covers the entire interpolated daylight prism, not only its sample points.
    // An additional bounded curvature envelope covers the swept offsets between dense sections.
    const side = (station: RoadStation, name: 'left' | 'right') =>
      Math.max(
        name === 'left' ? station.leftWidth : station.rightWidth,
        Math.abs((name === 'left' ? station.leftDaylightM : station.rightDaylightM) ?? 0),
        (name === 'left' ? station.leftClearingM : station.rightClearingM) ?? 0,
      ) + options.clearingExtraM
    const maxK = Math.max(
      0,
      ...geometry.flatMap((piece) =>
        piece.kind === 'line'
          ? []
          : piece.kind === 'arc'
            ? [1 / piece.radius]
            : [1 / piece.radiusStart, 1 / piece.radiusEnd],
      ),
    )
    const hasSpiral = geometry.some((piece) => piece.kind === 'spiral')
    const latitudeChange =
      (sampler.length +
        settings.crossSectionHalfWidth +
        options.clearingExtraM +
        Math.max(options.exclusionClearanceM, options.streamSetbackM)) /
      R
    const scaleError = Math.max(
      Math.abs(Math.cos(origin[1] * RAD - latitudeChange) / cos - 1),
      Math.abs(Math.cos(origin[1] * RAD + latitudeChange) / cos - 1),
    )
    for (let index = 1; index < fullSections.length; index++) {
      const a = fullSections[index - 1],
        b = fullSections[index],
        ds = b.chainage - a.chainage
      metrics.maxSectionSpacingM = Math.max(metrics.maxSectionSpacingM, ds)
      if (!a.complete || !b.complete) continue
      const al = side(a, 'left'),
        ar = side(a, 'right'),
        bl = side(b, 'left'),
        br = side(b, 'right')
      metrics.maxFootprintWidthM = Math.max(metrics.maxFootprintWidthM, al + ar, bl + br)
      const width = Math.max(al, ar, bl, br)
      const ring = convexHull([
        xy(offsetCoordinate(a.coordinate, a.bearing - 90, al)),
        xy(offsetCoordinate(a.coordinate, a.bearing + 90, ar)),
        xy(offsetCoordinate(b.coordinate, b.bearing - 90, bl)),
        xy(offsetCoordinate(b.coordinate, b.bearing + 90, br)),
      ])
      if (!ring.length) {
        add('failure', 'invalid-prism-strip', 'The final road footprint has a degenerate section strip.', a.chainage)
        continue
      }
      const polygon = reader.read({ type: 'Polygon', coordinates: [ring] }),
        box = boxOf(ring)
      const curvePad =
        (ds * ds * maxK) / 8 +
        (hasSpiral ? (width * maxK * ds) / 2 : (width * maxK * maxK * ds * ds) / 8) +
        (Math.max(Math.abs(al - bl), Math.abs(ar - br)) * maxK * ds) / 4
      for (const constraint of constraints) {
        const stream = constraint.feature.kind === 'stream'
        const clearance = stream ? options.streamSetbackM : options.exclusionClearanceM
        const allowance = curvePad + Math.max(0.01, (width + clearance + ds) * scaleError)
        if (!overlaps(box, constraint.bounds, clearance + allowance)) continue
        metrics.geometryOperations += constraint.vertices + ring.length
        if (metrics.geometryOperations > MAX_CONNECTOR_GEOMETRY_OPERATIONS)
          throw Error('Final connector geometry budget exceeded; crop the constraints or split the road.')
        const gap = DistanceOp.distance(polygon, constraint.shape) as number
        if (!Number.isFinite(gap)) throw Error('A final road/constraint distance could not be resolved.')
        if (gap > clearance + allowance + EPS) continue
        if (stream && options.allowStreamCrossings) {
          const approved = approvals.some(
            (window) =>
              window.valid &&
              window.featureId === constraint.feature.id &&
              a.chainage >= window.startM - EPS &&
              b.chainage <= window.endM + EPS,
          )
          if (approved) continue
          if (!approvals.some((window) => window.valid && window.featureId === constraint.feature.id)) {
            add(
              'unknown',
              'unreviewed-stream-crossing',
              `Mapped stream ${constraint.feature.name} needs an explicit reviewed crossing window and complete matching structure.`,
              a.chainage,
              constraint.feature.id,
            )
            continue
          }
        }
        if (gap <= clearance + EPS)
          add(
            'failure',
            stream ? 'stream-footprint-setback' : 'exclusion-footprint',
            `The full road prism/clearing strip meets ${constraint.feature.name} or its entered ${clearance} m ${stream ? 'stream setback' : 'exclusion clearance'}.`,
            a.chainage,
            constraint.feature.id,
          )
        else
          add(
            'unknown',
            'curvature-clearance-envelope',
            `The conservative curved-footprint envelope reaches ${constraint.feature.name}; clearance cannot be established within the dense-section bound.`,
            a.chainage,
            constraint.feature.id,
          )
      }
    }
  } catch (error) {
    add(
      'unknown',
      'check-incomplete',
      error instanceof Error ? error.message : 'Final connector checks did not complete.',
    )
  }
  return result()
}
