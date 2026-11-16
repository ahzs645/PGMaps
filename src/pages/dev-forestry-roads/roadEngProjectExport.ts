/**
 * Roads written back as the same thing they can be opened from: a zipped RoadEng project holding a
 * design (`.dsnx`, `roadEngExport.ts`) and its terrain (`.terx`, `roadEngTerrainExport.ts`), so a
 * project goes to RoadEng and comes back whole.
 *
 * - **Grid.** The caller's export grid; a project on the flat plane writes its file's own
 *   coordinates ({@link roadEngExportGrid}), so a design opened without a CRS goes back where it was.
 *   A road read from RoadEng is written in the CRS it was read in (`RoadEngSource.epsg`), when the
 *   caller can project it, so its kept settings still apply.
 * - **Design settings** ({@link roadEngDesignRoads}): each road with a RoadEng source is written in
 *   its own station frame, and what PGMaps models goes back into the RoadEng field it came from:
 *   sections, template ranges and curve tables (`roadEngSectionExport.ts`), ground types, haul and
 *   pits (`roadEngHaul.ts`, the `104` records and pit keys), optimizer standards, controls and
 *   vertical alignments (`roadEngOptimizer.ts`), per-curve `108` values and the template-range,
 *   ground-layer and pit boundaries RoadEng flags on its stations. `.dsn` changes are applied in
 *   order, haul and sections first and the optimizer on the result; several roads are taken in
 *   order, a later road's new templates going into the first alignment's `.dsn`. An unedited road
 *   writes its `.dsn` back unchanged but for the appended `[PGMaps]` section.
 * - **Ground.** The project's terrain grid, clipped to {@link ROADENG_EXPORT_CORRIDOR_M} either side
 *   of the roads and thinned to the writer's vertex budget. A terrain held as tiles (regional DEM)
 *   or the training terrain has no grid to write, so the project goes without ground and says so.
 * - **Kept terrain parts.** The terrain's `roadEngSource` (`.tlt`, `.te1`, code table, logging
 *   systems, map notes, window layouts) is written back. Logging systems are rewritten from the
 *   rigging sets that hold RoadEng equipment (`roadeng-system-<n>`, or a new system for another set
 *   with equipment), map notes from the project's notes, each only when it changed.
 * - **Drawn layers.** The inverse of `roadEngProject.ts`: streams, existing roads, D-lines (with
 *   RoadEng's cable settings, `roadEngDLineFor`), proposed harvest blocks (felling boundaries),
 *   avoidance areas (boundaries) and reference layers, each at the terrain's level where it has one.
 *   A feature imported from RoadEng keeps its class, colour and format chunk; a layer whose look was
 *   changed writes its colour, line type and symbol back (`roadEngLookFromStyle`).
 *
 * Pure: no DOM or network access.
 */
import type { LocalRaster } from '../dev-forestry/types'
import { applyRoadEngSystemToDecoded, riggingSetToRoadEngLoggingSystem } from './cableEquipment/cableEquipment'
import { matchingRiggingSet, type RiggingSet } from './dline/riggingSets'
import { alignmentLength, designProfileAt, horizontalCurveFits } from './engine'
import type { XY } from './landXmlImport'
import { localPlaneProjection, isLocalPlane, LOCAL_PLANE_EPSG } from './localPlane'
import { noteAnchor, type MapNote } from './mapNotes'
import { referenceLayerKey, referenceShape, type ReferenceFeature } from './referenceFeatures'
import { referenceStyleFor, type ReferenceLayerStyle } from './referenceStyles'
import { parseRoadEngSettings } from './roadEngDesignSettings'
import { roadEngDLineFor, type RoadEngDLine } from './roadEngDLines'
import {
  centreSurfacingM,
  mergeRoadEngIni,
  roadEngDesign,
  roadEngWrittenFrame,
  roadEngWrittenRadii,
  ROADENG_PI_MATCH_M,
  type RoadEngCurveInput,
  type RoadEngDsnOverrides,
  type RoadEngExportRoad,
  type RoadEngReportEvent,
} from './roadEngExport'
import { roadEngHaulRecords } from './roadEngHaul'
import { readRoadEngIni, roadEngSourceDs2Text, ROADENG_UNITS, type RoadEngSource } from './roadEngImport'
import {
  encodeRoadEngLoggingSystems,
  newRoadEngLoggingSystem,
  roadEngLoggingSystems,
  type RoadEngLoggingSystem,
} from './roadEngLoggingSystems'
import { newRoadEngMapNote, readRoadEngMapNotes, type RoadEngMapNote } from './roadEngMapNotes'
import { roadEngOptimizerOverrides } from './roadEngOptimizer'
import { ROADENG_COLOR_ATTRIBUTE, ROADENG_FORMAT_ATTRIBUTE, roadEngNoteId, roadEngSystemSetId } from './roadEngProject'
import {
  mergeRoadEngOverrides,
  roadEngCurveChanges,
  roadEngOutsideAutoNote,
  roadEngCurveFromTables,
  roadEngCurveInputs,
  roadEngSectionOverrides,
  roadEngTypedSuperelevation,
} from './roadEngSectionExport'
import { roadEngDesignWriteBack } from './roadEngParameterOverrides'
import { isPLineStratum, roadEngPLineDsnOverrides, roadEngPLineFiles } from './roadEngPLine'
import { roadEngFillWriteBack } from './roadEngFillMaterials'
import { readRoadEngSymbolFile, type RoadEngSymbolTables } from './roadEngSymbolTables'
import {
  colorRefFromRgb,
  parseRoadEngFormatChunk,
  patchRoadEngFormatChunk,
  roadEngFeatureLook,
  roadEngLookFromStyle,
  ROADENG_AUTO_COLOR,
} from './roadEngSymbols'
import type { RoadEngFeatureClass, RoadEngTerrainSource } from './roadEngTerrain'
import {
  roadEngProjectFileNames,
  roadEngProjectZip,
  roadEngTerLayout,
  roadEngTerrainArchive,
  type RoadEngExportFeature,
  type RoadEngExportFeatureKind,
  type RoadEngTerrainArchive,
} from './roadEngTerrainExport'
import {
  roadEngClassLabel,
  roadEngKeptCounts,
  roadEngObjectFingerprint,
  roadEngSamePlace,
  roadEngTerrainGridFingerprint,
  ROADENG_FEATURE_CLASSES,
  type RoadEngCarryOver,
  type RoadEngOriginalTer,
} from './roadEngTerrainOriginal'
import { base64ToBytes } from './roadEngText'
import type { CableLine, ContextFeature, Coordinate, TerrainMetadata } from './types'

/** Ground kept either side of the exported roads, m. */
export const ROADENG_EXPORT_CORRIDOR_M = 250
/**
 * A road whose written frame is this close to the one it was read in (relative station scale, and
 * end station in metres) is written in the frame it was read in, so kept ranges compare exactly.
 * A millimetre a kilometre: Location 18's thirteen curves, each radius held to its record within
 * 10⁻⁵, rebuild its 1,066 m 0.16 mm short (1.5 × 10⁻⁷).
 */
export const ROADENG_FRAME_SCALE_TOLERANCE = 1e-6
export const ROADENG_FRAME_END_TOLERANCE_M = 0.001
/** A D-line or map note within this of where it was read, m in the file grid, has not moved. */
export const ROADENG_UNMOVED_M = 0.001

export interface RoadEngExportGrid {
  /** The CRS the coordinates are in; null for a project on the flat plane (its file's own grid). */
  epsg: number | null
  toGrid: (c: Coordinate) => XY
  /** The project's terrain grid in this grid, when it has one. */
  raster: LocalRaster | null
}

/**
 * Where a RoadEng export writes coordinates: the export grid, or on the flat plane the file's own
 * coordinates (plane + offset), with the terrain grid moved the same way.
 */
export function roadEngExportGrid(
  terrain: TerrainMetadata,
  exportGrid: { epsg: number; toGrid: (c: Coordinate) => XY },
): RoadEngExportGrid {
  // A grid with no levels (a design opened without terrain) is no ground to write.
  const levelled = terrain.raster?.values.some((v) => v !== null) ? terrain.raster : null
  if (isLocalPlane(terrain) && terrain.localPlane) {
    const { offsetM } = terrain.localPlane
    const raster = levelled
      ? { ...levelled, origin: [levelled.origin[0] + offsetM[0], levelled.origin[1] + offsetM[1]] as [number, number] }
      : null
    return { epsg: null, toGrid: localPlaneProjection(offsetM).toFile, raster }
  }
  const raster = levelled && levelled.epsg === exportGrid.epsg ? levelled : null
  return { epsg: exportGrid.epsg, toGrid: exportGrid.toGrid, raster }
}

// ---- Design ---------------------------------------------------------------------------------------

export interface RoadEngDesignOptions {
  /** The project's fill-placement rate (`RoadSettings.fillRate`), written as RoadEng's embankment cost. */
  fillRate?: number
  designSpeedKmh?: number
  /** A grid for a CRS a road was read in, when it is not the export grid's; null when not converted. */
  gridFor?: (epsg: number) => ((c: Coordinate) => XY) | null
}

/** Template-range, ground-layer and pit boundaries inside the road, for RoadEng's report stations. */
function reportEventsFor(road: RoadEngExportRoad['alignment']): RoadEngReportEvent[] {
  const e = road.engineering
  if (!e) return []
  const length = alignmentLength(road)
  const inside = (c: number) => c > 1e-6 && c < length - 1e-6
  const events: RoadEngReportEvent[] = []
  const add = (chainageM: number, kind: RoadEngReportEvent['kind']) => {
    if (inside(chainageM) && !events.some((x) => x.kind === kind && Math.abs(x.chainageM - chainageM) < 1e-6))
      events.push({ chainageM, kind })
  }
  for (const a of e.assignments ?? []) for (const at of [a.start, a.end]) add(at, 'template-range')
  // Horizons from the P-line's survey are not range assignments, which are what RoadEng flags.
  for (const s of e.strata ?? [])
    if (!isPLineStratum(s)) for (const at of [s.start, s.end]) add(at, 'ground-layer-range')
  for (const site of e.sites ?? []) if (site.enabled !== false) add(site.chainage, 'pit')
  return events.sort((a, b) => a.chainageM - b.chainageM)
}

/**
 * Each road ready for `roadEngDesign`: its kept RoadEng source, the grid and station frame it was
 * read in, its per-curve `108` values, report boundaries, `104` records and `.dsn` overrides. Roads
 * are taken in the order given, which is the order they are written in.
 */
export function roadEngDesignRoads(
  roads: readonly RoadEngExportRoad[],
  toGrid: (c: Coordinate) => XY,
  gridEpsg: number | null,
  options: RoadEngDesignOptions = {},
): { roads: RoadEngExportRoad[]; notes: string[] } {
  const notes: string[] = []
  const out: RoadEngExportRoad[] = []
  // The archive's first alignment holds the templates: its .dsn as overridden so far.
  let projectDsn: string | null = null
  const templateEdits: RoadEngDsnOverrides[] = []
  roads.forEach((input, k) => {
    const alignment = input.alignment
    const source: RoadEngSource | null = input.source ?? alignment.roadEngSource ?? null
    const name = alignment.name
    // The road's own grid: the CRS its source was read in, where that is not the export's.
    let ownGrid: ((c: Coordinate) => XY) | undefined
    if (source?.epsg !== undefined && gridEpsg !== null && source.epsg !== gridEpsg) {
      const grid = source.epsg === LOCAL_PLANE_EPSG ? null : (options.gridFor?.(source.epsg) ?? null)
      if (grid) {
        ownGrid = grid
        notes.push(`${name} is written in EPSG:${source.epsg}, the CRS it was read in, not EPSG:${gridEpsg}.`)
      } else
        notes.push(
          `${name} was read in ${source.epsg === LOCAL_PLANE_EPSG ? 'a design on the flat plane' : `EPSG:${source.epsg}`} and is written in EPSG:${gridEpsg}; its kept RoadEng settings keep their own stations.`,
        )
    }
    const road: RoadEngExportRoad = {
      ...input,
      source,
      ...(ownGrid ? { toGrid: ownGrid } : {}),
    }
    const unitM = source ? ROADENG_UNITS[source.unitCode] : 1
    const written = roadEngWrittenFrame(road, toGrid)
    // An unedited road is written in the frame it was read in, so kept ranges compare exactly.
    const sameFrame =
      source?.stationScale !== undefined &&
      source.endStation !== undefined &&
      Math.abs(written.stationScale / source.stationScale - 1) < ROADENG_FRAME_SCALE_TOLERANCE &&
      Math.abs(written.endStation - source.endStation) < ROADENG_FRAME_END_TOLERANCE_M
    const frame = sameFrame
      ? { startStation: source!.startStation, endStation: source!.endStation!, stationScale: source!.stationScale! }
      : { startStation: written.startStation, endStation: written.endStation, stationScale: written.stationScale }
    const surfacing = alignment.vertical.length >= 2 ? centreSurfacingM(alignment) : 0
    const levelAt = (chainage: number) => {
      const z = designProfileAt(alignment, Math.min(alignmentLength(alignment), Math.max(0, chainage)))?.elevation
      return z === undefined ? null : z + surfacing
    }

    // The frame the road was read in: the override and fill writers compare what was read in it.
    const readFrame =
      source && !sameFrame && source.endStation !== undefined && source.stationScale !== undefined
        ? { startStation: source.startStation, endStation: source.endStation, stationScale: source.stationScale }
        : undefined
    // The texts the settings writers start from: the alignment's own and the first alignment's.
    const dsnText = source?.dsn
    const ds2Text = source ? roadEngSourceDs2Text(source) : undefined
    const projectDsnText = k > 0 && projectDsn !== null ? projectDsn : source?.projectDsn
    if (k === 0 && source?.projectDsn !== undefined)
      notes.push(
        `${name} was a later alignment of its RoadEng design: its templates are kept in that design's first alignment, which is not written first here, so RoadEng opens it on the templates its own file holds.`,
      )

    // Sections, template ranges and curve tables.
    const section = roadEngSectionOverrides(
      alignment,
      source && dsnText !== undefined && ds2Text !== undefined
        ? {
            dsnText,
            ds2Text,
            ...(projectDsnText !== undefined ? { projectDsnText } : {}),
            unitM,
            ...frame,
            fallback: source.fallback ?? alignment.template,
          }
        : null,
    )
    if (source) notes.push(...section.notWritten)
    // AUTO slopes into the template table, parameter overrides into [design] (`roadEngParameterOverrides.ts`).
    const design =
      source && dsnText !== undefined && ds2Text !== undefined
        ? roadEngDesignWriteBack(
            alignment,
            {
              dsnText,
              ds2Text,
              ...(projectDsnText !== undefined ? { projectDsnText } : {}),
              unitM,
              ...frame,
              fallback: source.fallback ?? alignment.template,
              ...(readFrame ? { readFrame } : {}),
            },
            mergeRoadEngIni(projectDsnText ?? dsnText, section.templates),
          )
        : null
    if (design) {
      notes.push(...design.notWritten)
      section.alignment = mergeRoadEngOverrides(section.alignment, design.alignment).overrides
      section.templates = mergeRoadEngOverrides(section.templates, design.templates).overrides
    }
    // Ground types, haul and pits.
    const haul = alignment.engineering
      ? roadEngHaulRecords(
          {
            engineering: alignment.engineering,
            ...(options.fillRate !== undefined ? { fillRate: options.fillRate } : {}),
          },
          {
            unitM,
            ...(source
              ? {
                  original: {
                    dsnText,
                    ds2Text,
                    ...(projectDsnText !== undefined ? { projectDsnText } : {}),
                  },
                }
              : {}),
            ...frame,
            levelAt,
          },
        )
      : null
    if (haul) notes.push(...haul.notes.map((n) => `${name}: ${n}`))
    // Subgrade fill material by range into the rows the template ranges left (`roadEngFillMaterials.ts`).
    if (source && dsnText !== undefined && ds2Text !== undefined) {
      const fill = roadEngFillWriteBack(
        alignment,
        {
          dsnText,
          ds2Text,
          ...(projectDsnText !== undefined ? { projectDsnText } : {}),
          unitM,
          ...frame,
          ...(readFrame ? { readFrame } : {}),
        },
        mergeRoadEngIni(dsnText, section.alignment),
        haul?.codes ?? {},
      )
      notes.push(...fill.notWritten)
      section.alignment = mergeRoadEngOverrides(section.alignment, fill.alignment).overrides
    }
    // Costs RoadEng has no field for travel in the design's [PGMaps] section (`roadEngHaulRecords`).
    const own = mergeRoadEngOverrides(
      haul?.dsnOverrides ?? {},
      haul && Object.keys(haul.pgmaps).length ? { PGMaps: haul.pgmaps } : {},
      section.alignment,
      // Between or Ahead for the P-line's survey, where it was changed here (`roadEngPLine.ts`).
      roadEngPLineDsnOverrides(source?.pLine, dsnText),
    ).overrides
    // A later road's new templates go into the first alignment's .dsn; the first road's into its own.
    if (k === 0) Object.assign(own, mergeRoadEngOverrides(own, section.templates).overrides)
    else if (Object.keys(section.templates).length) {
      templateEdits.push(section.templates)
      if (projectDsn !== null) projectDsn = mergeRoadEngIni(projectDsn, section.templates)
    }
    // The optimizer reads the design as the haul and section changes leave it.
    const optimizer = roadEngOptimizerOverrides(
      alignment,
      {
        startStationM: frame.startStation,
        endStationM: frame.endStation,
        stationScale: frame.stationScale,
        unitM,
        surfaceDepthM: surfacing,
      },
      dsnText === undefined ? undefined : mergeRoadEngIni(dsnText, own),
    )
    notes.push(...optimizer.notes.map((n) => `${name}: ${n}`))
    const dsnOverrides = mergeRoadEngOverrides(own, optimizer.overrides).overrides
    if (k === 0) projectDsn = dsnText === undefined ? null : mergeRoadEngIni(dsnText, dsnOverrides)

    // Per-curve 108 values: PGMaps' rule when it changed, else each curve's own record, and the
    // design's own tables for a curve moved or re-radiused off the record it was read with.
    let curves: Record<string, RoadEngCurveInput> | undefined
    // Curves whose e PGMaps writes as its own value: RoadEng recalculates it unless the curve's
    // superelevation Auto is unticked there, and the bit for that box is not known.
    const typed: string[] = []
    const typedNote = (order: string[]) => {
      if (!typed.length) return
      const names = typed.map((id) => `H${order.indexOf(id) + 1}`)
      notes.push(
        `${name}: not written: RoadEng's superelevation Auto off for ${names.length === 1 ? 'curve' : 'curves'} ${names.join(', ')}. Their superelevation is written as a value, which RoadEng recalculates unless the curve's superelevation Auto box is unticked there.`,
      )
    }
    if (source && dsnText !== undefined && ds2Text !== undefined) {
      const settings = parseRoadEngSettings(dsnText, ds2Text, unitM, {
        ...(source.projectDsn !== undefined ? { projectDsnText: source.projectDsn } : {}),
      })
      // A curve whose record's radius the writer keeps is read at that radius, as RoadEng reads it.
      const gridRadii = roadEngWrittenRadii(alignment, road.toGrid ?? toGrid, {
        records: source.piRecords.map((line) => line.split(',')),
        unitM,
      })
      const given = roadEngCurveInputs(alignment, {
        original: settings,
        gridRadiusM: gridRadii,
        ...(options.designSpeedKmh ? { designSpeedKmh: options.designSpeedKmh } : {}),
      })
      if (!given.kept) {
        // Each curve writes only what differs from the record it was read with.
        const records = source.piRecords.map((line) => line.split(','))
        const grid = road.toGrid ?? toGrid
        const changed: Record<string, RoadEngCurveInput> = {}
        for (const [id, fields] of Object.entries(given.curves)) {
          const point = alignment.points.find((p) => p.id === id)
          if (!point) continue
          const [x, y] = grid(point.coordinate)
          const match = records.find(
            (f) => Math.hypot(Number(f[4]) * unitM - x, Number(f[5]) * unitM - y) <= ROADENG_PI_MATCH_M,
          )
          if (!match) {
            changed[id] = newCurveRecord(fields, given.from[id], given.insideWideningFromTable[id])
            if (roadEngTypedSuperelevation(changed[id], given.from[id])) typed.push(id)
            continue
          }
          const readRadius = Math.abs(Number(match[3])) * unitM
          const writtenRadius = gridRadii[id]
          const diff = roadEngCurveChanges(
            fields,
            match,
            unitM,
            given.from[id] ?? null,
            (point.spiralM ?? 0) > 0,
            given.insideWideningFromTable[id] ?? null,
            writtenRadius !== undefined && Math.abs(writtenRadius - readRadius) > 1e-9 * Math.max(1, readRadius),
          )
          if (diff) changed[id] = diff
          if (roadEngTypedSuperelevation(diff, given.from[id], match)) typed.push(id)
          const outsideNote = roadEngOutsideAutoNote(diff, match, unitM, given.outsideWideningFromTable[id] ?? null)
          if (outsideNote) notes.push(`${name}: not written: ${outsideNote}`)
        }
        if (Object.keys(changed).length) curves = changed
        typedNote(Object.keys(given.curves))
      } else {
        const records = source.piRecords.map((line) => line.split(','))
        const grid = road.toGrid ?? toGrid
        const speed = alignment.curveDesign?.designSpeedKmh ?? options.designSpeedKmh ?? 50
        const moved: Record<string, RoadEngCurveInput> = {}
        for (const fit of horizontalCurveFits(alignment)) {
          if (fit.status !== 'fitted' || !(fit.radiusM > 0)) continue
          const point = alignment.points[fit.point - 1]
          const [x, y] = grid(point.coordinate)
          const match = records.find(
            (f) => Math.hypot(Number(f[4]) * unitM - x, Number(f[5]) * unitM - y) <= ROADENG_PI_MATCH_M,
          )
          const radius = match ? Math.abs(Number(match[3])) * unitM : NaN
          if (!match || Math.abs(radius - fit.radiusM) > 1e-3 * fit.radiusM)
            moved[point.id] = roadEngCurveFromTables(settings, fit.radiusM, fit.deflectionDegrees, speed)
        }
        if (Object.keys(moved).length) curves = moved
      }
    } else {
      const given = roadEngCurveInputs(alignment, {
        gridRadiusM: roadEngWrittenRadii(alignment, road.toGrid ?? toGrid),
        ...(options.designSpeedKmh ? { designSpeedKmh: options.designSpeedKmh } : {}),
      })
      if (Object.keys(given.curves).length)
        curves = Object.fromEntries(
          Object.entries(given.curves).map(([id, fields]) => [
            id,
            newCurveRecord(fields, given.from[id], given.insideWideningFromTable[id]),
          ]),
        )
      for (const [id, fields] of Object.entries(curves ?? {}))
        if (roadEngTypedSuperelevation(fields, given.from[id])) typed.push(id)
      typedNote(Object.keys(given.curves))
    }

    out.push({
      ...road,
      ...(curves ? { curves } : {}),
      reportEvents: reportEventsFor(alignment),
      ...(haul ? { recordOverrides: { '104': haul.recordOverrides['104'] } } : {}),
      ...(Object.keys(dsnOverrides).length ? { dsnOverrides } : {}),
    })
  })
  // Templates later roads added go into the first alignment's .dsn, after its own changes.
  if (templateEdits.length && out.length) {
    const first = out[0]
    first.dsnOverrides = mergeRoadEngOverrides(first.dsnOverrides ?? {}, ...templateEdits).overrides
    if (!first.source)
      notes.push(
        'Templates of roads read from RoadEng are written into the first alignment, which was not read from RoadEng: RoadEng finds them there but the first road takes its default template.',
      )
  }
  return { roads: out, notes: [...new Set(notes)] }
}

/**
 * A curve with no record to keep: every design value, RoadEng's Auto method where its e is the
 * table's or the side friction method's, Use Minimum Radius off (RoadEng's default word sets it), and
 * the side friction left for the writer, which takes it at the radius it writes.
 */
function newCurveRecord(
  fields: RoadEngCurveInput,
  from: 'formula' | 'table' | 'sideFriction' | 'minimumRadius' | 'stated' | undefined,
  insideWideningFromTable: boolean | undefined,
): RoadEngCurveInput {
  const { sideFriction: _atModelRadius, ...rest } = fields
  void _atModelRadius
  return {
    ...rest,
    useMinimumRadius: false,
    ...(from === 'table' || from === 'sideFriction' ? { superelevationByTable: from === 'table' } : {}),
    autoWideningInside: insideWideningFromTable === true,
  }
}

// ---- Terrain parts ----------------------------------------------------------------------------------

/** The terrain's symbol tables, from its kept `.te1`. */
function symbolTables(source: RoadEngTerrainSource | null | undefined): RoadEngSymbolTables | null {
  if (!source?.te1) return null
  try {
    return readRoadEngSymbolFile(base64ToBytes(source.te1))
  } catch {
    return null
  }
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i])

/**
 * The logging systems to write, or null to keep the terrain's section 8 as read: each kept system
 * with its rigging set's values (`roadeng-system-<n>`), then a new system for every other set that
 * holds yarder equipment. A kept system whose set was removed stays as read.
 */
export function roadEngLoggingSystemsFor(
  sets: readonly RiggingSet[],
  source: RoadEngTerrainSource | null | undefined,
): { systems: RoadEngLoggingSystem[] | null; idOfSet: Map<string, string>; notes: string[] } {
  const notes: string[] = []
  const keptBytes = source?.loggingSystems ? base64ToBytes(source.loggingSystems) : null
  let kept: RoadEngLoggingSystem[] = []
  try {
    kept = keptBytes ? roadEngLoggingSystems(keptBytes) : []
  } catch {
    kept = []
  }
  const idOfSet = new Map<string, string>()
  const systems = kept.map((system) => {
    const set = sets.find((s) => s.id === roadEngSystemSetId(system.id))
    if (!set) return system
    idOfSet.set(set.id, system.id)
    const made = riggingSetToRoadEngLoggingSystem(set, set.equipment)
    if (!made.ok) {
      notes.push(`${made.error} Its RoadEng logging system is written as read.`)
      return system
    }
    notes.push(...made.notes)
    return applyRoadEngSystemToDecoded(system, made.system)
  })
  let next = systems.reduce((n, s) => Math.max(n, Number(s.id) || 0), 0) + 1
  for (const set of sets) {
    if (idOfSet.has(set.id) || !set.equipment) continue
    const made = riggingSetToRoadEngLoggingSystem(set, set.equipment)
    if (!made.ok) {
      notes.push(made.error)
      continue
    }
    const zero = { maxTensionKN: 0, weightKgPerM: 0, maxLengthM: 0 }
    const id = String(next++)
    const blank = newRoadEngLoggingSystem({
      id,
      name: '',
      configuration: made.system.configuration,
      carriageKg: 0,
      equipment: {
        name: '',
        sparHeightM: 0,
        skyline: zero,
        mainline: zero,
        haulback: zero,
        fourth: zero,
        machineCode: 3,
      },
    })
    systems.push(applyRoadEngSystemToDecoded(blank, made.system))
    idOfSet.set(set.id, id)
    notes.push(...made.notes, `Rigging set ${set.name} is written as RoadEng logging system ${id}.`)
  }
  const unchanged = keptBytes !== null && sameBytes(encodeRoadEngLoggingSystems(systems), keptBytes)
  return {
    systems: unchanged || (!keptBytes && !systems.length) ? null : systems,
    idOfSet,
    notes: [...new Set(notes)],
  }
}

/**
 * The map notes to write, or null to keep the terrain's as read: a note read from RoadEng
 * (`roadeng-note-<n>`) keeps its stored label where its text and place did not change; any other
 * note with text becomes a new floating label at its anchor.
 */
export function roadEngMapNotesFor(
  notes: readonly MapNote[],
  source: RoadEngTerrainSource | null | undefined,
  toGrid: (c: Coordinate) => XY,
): RoadEngMapNote[] | null {
  const original = source?.tail ? readRoadEngMapNotes(base64ToBytes(source.tail)).notes : []
  const out: RoadEngMapNote[] = []
  for (const note of notes) {
    if (!note.text.trim()) continue
    const [x, y] = toGrid(noteAnchor(note))
    const index = original.findIndex((_, k) => roadEngNoteId(k) === note.id)
    const was = index >= 0 ? original[index] : null
    if (was) {
      const moved = Math.hypot(was.x - x, was.y - y) > ROADENG_UNMOVED_M
      out.push({ ...was, text: note.text === was.text ? was.text : note.text, ...(moved ? { x, y } : {}) })
    } else out.push(newRoadEngMapNote(note.text, x, y))
  }
  const same =
    out.length === original.length &&
    out.every(
      (n, k) => n === original[k] || (n.text === original[k].text && n.x === original[k].x && n.y === original[k].y),
    )
  if (same && source?.tail) return null
  return out.length || original.length ? out : null
}

/** The D-line to write for a project D-line: its points from the yarder, and RoadEng's settings. */
function dLineFeature(
  cable: CableLine,
  toGrid: (c: Coordinate) => XY,
  systemId: string | null,
): { points: XY[]; dLine: RoadEngDLine; unchanged: boolean; inPlace: boolean } {
  const a = toGrid(cable.start),
    b = toGrid(cable.end)
  const length = Math.hypot(b[0] - a[0], b[1] - a[1])
  const atEnd = cable.yarderAt === 'end'
  const payloadKg = cable.rigging?.payloadKg
  const clearanceM = cable.rigging?.minClearanceM
  const base = cable.roadEng ?? null
  if (base) {
    const spars = [...base.spars].sort((x, y) => x.station - y.station)
    const first = spars[0],
      last = spars[spars.length - 1]
    const baseAtEnd = last.kind === 1 && first.kind !== 1
    const yarder = baseAtEnd ? last : first,
      tailhold = baseAtEnd ? first : last
    const close = (x: number, y: number) => Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x))
    const unchanged =
      baseAtEnd === atEnd &&
      Math.abs(length - (last.station - first.station)) <= ROADENG_UNMOVED_M &&
      close(yarder.height, cable.startHeight) &&
      close(tailhold.height, cable.endHeight) &&
      close(base.deflectionPercent, cable.deflectionPercent) &&
      (systemId ?? null) === (base.systemId ?? null) &&
      (!base.analysis ||
        ((payloadKg === undefined || close(base.analysis.payloadKg, payloadKg)) &&
          (clearanceM === undefined || close(base.analysis.clearanceM, clearanceM))))
    if (unchanged) {
      // The feature starts where the first spar's station says, so every spar lands where it was.
      const ux = length > 0 ? (b[0] - a[0]) / length : 1,
        uy = length > 0 ? (b[1] - a[1]) / length : 0
      return {
        points: [[a[0] - ux * first.station, a[1] - uy * first.station], b],
        dLine: base,
        unchanged: true,
        inPlace: true,
      }
    }
    // Same ends and way round, first spar at the start: its settings change over the feature as read.
    const span = last.station - first.station
    const inPlace =
      baseAtEnd === atEnd && first.station === 0 && Math.abs(length - span) <= ROADENG_UNMOVED_M && !baseAtEnd
    // RoadEng's D-line runs from the yarder; a base read the other way round is turned to match.
    const oriented: RoadEngDLine = baseAtEnd
      ? {
          ...base,
          spars: [...spars].reverse().map((s) => ({ ...s, station: last.station - s.station })),
        }
      : { ...base, spars: spars.map((s) => ({ ...s, station: s.station - first.station })) }
    return {
      unchanged: false,
      inPlace,
      points: atEnd ? [b, a] : [a, b],
      dLine: roadEngDLineFor(
        {
          lengthM: inPlace ? span : length,
          yarderHeight: cable.startHeight,
          tailholdHeight: cable.endHeight,
          deflectionPercent: cable.deflectionPercent,
          systemId,
          ...(payloadKg !== undefined ? { payloadKg } : {}),
          ...(clearanceM !== undefined ? { clearanceM } : {}),
        },
        oriented,
      ),
    }
  }
  return {
    unchanged: false,
    inPlace: false,
    points: atEnd ? [b, a] : [a, b],
    dLine: roadEngDLineFor({
      lengthM: length,
      yarderHeight: cable.startHeight,
      tailholdHeight: cable.endHeight,
      deflectionPercent: cable.deflectionPercent,
      comment: cable.name.slice(0, 200),
      systemId,
      ...(payloadKg !== undefined ? { payloadKg } : {}),
      ...(clearanceM !== undefined ? { clearanceM } : {}),
    }),
  }
}

/** The project object a written feature is, and whether it holds what it was read with. */
interface DrawnObject {
  id: string
  /** Its cable settings and look are as read. */
  same: boolean
  /** Where its settings changed and its place did not, they can be written over the feature as read. */
  inPlace: boolean
  /** Its {@link roadEngObjectFingerprint}, for an object made from a RoadEng terrain's feature. */
  fingerprint: string | null
}

/** What a road project's own layers become in a RoadEng terrain. */
function drawnFeatures(
  parts: {
    context: readonly ContextFeature[]
    cables: readonly CableLine[]
    reference: readonly ReferenceFeature[]
    referenceStyles?: readonly ReferenceLayerStyle[]
    riggingSets?: readonly RiggingSet[]
  },
  toGrid: (c: Coordinate) => XY,
  level: (c: Coordinate) => number | undefined,
  tables: RoadEngSymbolTables | null,
  systemOfSet: ReadonlyMap<string, string>,
  notes: string[],
): { features: RoadEngExportFeature[]; objects: DrawnObject[] } {
  const point = (c: Coordinate): readonly [number, number, number?] => {
    const [x, y] = toGrid(c),
      z = level(c)
    return z === undefined ? [x, y] : [x, y, z]
  }
  const from = (name: string, kind: RoadEngExportFeatureKind, coords: readonly Coordinate[], closed = false) => ({
    name,
    kind,
    points: coords.map(point),
    ...(closed ? { closed } : {}),
  })
  const features: RoadEngExportFeature[] = []
  // Which project object each feature is, and whether its settings and look are as read.
  const objects: DrawnObject[] = []
  let object: DrawnObject = { id: '', same: true, inPlace: true, fingerprint: null }
  // Only objects made from a RoadEng terrain's features are compared with what was read.
  const tracked = (id: string) => /^roadeng-0-\d+$/.test(id)
  const out = {
    push: (...made: RoadEngExportFeature[]) => {
      for (const f of made) {
        features.push(f)
        objects.push(object)
      }
    },
  }
  for (const f of parts.context) {
    object = {
      id: f.id,
      same: true,
      inPlace: true,
      fingerprint: tracked(f.id) ? roadEngObjectFingerprint({ type: 'context', feature: f }) : null,
    }
    const ring = f.geometry.type === 'Polygon' ? (f.geometry.coordinates[0] as Coordinate[]) : null
    const line = f.geometry.type === 'LineString' ? (f.geometry.coordinates as Coordinate[]) : null
    if (f.kind === 'stream' && line) out.push(from(f.name, 'stream', line))
    else if (f.kind === 'existing-road' && line) out.push(from(f.name, 'road', line))
    else if (f.kind === 'harvest' && ring) out.push(from(f.name, 'falling-boundary', ring, true))
    else if (ring) out.push(from(f.name, 'boundary', ring, true))
    else if (line) out.push(from(f.name, 'other', line))
  }
  for (const c of parts.cables) {
    // The logging system it is rigged with: the set its rigging is, else the one it was read with.
    const set = matchingRiggingSet(parts.riggingSets, c.rigging)
    const systemId = (set && systemOfSet.get(set.id)) ?? c.roadEngSystemId ?? c.roadEng?.systemId ?? null
    const { points, dLine, unchanged, inPlace } = dLineFeature(c, toGrid, systemId)
    object = {
      id: c.id,
      same: unchanged,
      inPlace,
      fingerprint: tracked(c.id) ? roadEngObjectFingerprint({ type: 'cable', feature: c }) : null,
    }
    const z = (xy: XY, at: Coordinate) => {
      const h = level(at)
      return h === undefined ? ([xy[0], xy[1]] as const) : ([xy[0], xy[1], h] as const)
    }
    const yarderEnd = c.yarderAt === 'end'
    out.push({
      name: c.name,
      kind: 'd-line',
      points: [z(points[0], yarderEnd ? c.end : c.start), z(points[1], yarderEnd ? c.start : c.end)],
      dLine,
    })
  }
  const KINDS: Record<string, RoadEngExportFeatureKind> = {
    landing: 'landing',
    boundary: 'boundary',
    stream: 'stream',
    road: 'road',
    'd-line': 'd-line',
  }
  const lookNotes = new Set<string>()
  for (const r of parts.reference) {
    const kind = KINDS[String(r.attributes?.roadEngClass ?? '')] ?? (r.geometry.type === 'Point' ? 'landing' : 'other')
    // Its look: as read where its layer's look is the one it was read with, else the layer's.
    const shape = referenceShape(r)
    const keptFormat =
      typeof r.attributes?.[ROADENG_FORMAT_ATTRIBUTE] === 'string'
        ? base64ToBytes(r.attributes[ROADENG_FORMAT_ATTRIBUTE] as string)
        : null
    const keptColor =
      typeof r.attributes?.[ROADENG_COLOR_ATTRIBUTE] === 'number'
        ? (r.attributes[ROADENG_COLOR_ATTRIBUTE] as number)
        : null
    const style = referenceStyleFor(parts.referenceStyles, referenceLayerKey(r))
    const { layer: _layer, ...look } = style ?? { layer: '' }
    void _layer
    const read = roadEngFeatureLook(
      { shape, color: keptColor, format: keptFormat ? parseRoadEngFormatChunk(keptFormat) : null },
      { lineTypes: tables?.lineTypes ?? null, symbols: tables?.symbols ?? null },
    ).style
    const asRead =
      keptFormat !== null || keptColor !== null ? JSON.stringify(sorted(read)) === JSON.stringify(sorted(look)) : !style
    // As read for the round trip too when its layer still draws the look it was read with.
    object = {
      id: r.id,
      same: asRead || !style || JSON.stringify(sorted(read)) === JSON.stringify(sorted(look)),
      inPlace: true,
      fingerprint: tracked(r.id) ? roadEngObjectFingerprint({ type: 'reference', feature: r }) : null,
    }
    let colorRef: number | undefined = keptColor === null ? undefined : colorRefFromRgb(keptColor)
    let formatChunk: Uint8Array | undefined = keptFormat ?? undefined
    if (!asRead && style) {
      const back = roadEngLookFromStyle(look, shape, {
        lineTypes: tables?.lineTypes ?? null,
        symbols: tables?.symbols ?? null,
      })
      back.notes.forEach((n) => lookNotes.add(n))
      if (back.colorRef !== null) colorRef = back.colorRef
      if (formatChunk) {
        const chunk = parseRoadEngFormatChunk(formatChunk)
        const ownColour = chunk && chunk.color !== -1 && chunk.color !== ROADENG_AUTO_COLOR
        formatChunk = patchRoadEngFormatChunk(formatChunk, {
          ...(back.lineType !== null ? { lineType: back.lineType } : {}),
          ...(back.symbol !== null ? { symbol: back.symbol } : {}),
          ...(ownColour && back.colorRef !== null ? { color: back.colorRef } : {}),
        })
      }
    }
    const extra = {
      ...(colorRef !== undefined ? { colorRef } : {}),
      ...(formatChunk ? { formatChunk } : {}),
    }
    const g = r.geometry
    if (g.type === 'Point') out.push({ ...from(r.name, kind, [g.coordinates as Coordinate]), ...extra })
    else if (g.type === 'LineString') out.push({ ...from(r.name, kind, g.coordinates as Coordinate[]), ...extra })
    else if (g.type === 'MultiLineString')
      g.coordinates.forEach((part, k) =>
        out.push({ ...from(`${r.name} ${k + 1}`, kind, part as Coordinate[]), ...extra }),
      )
    else if (g.type === 'Polygon') out.push({ ...from(r.name, kind, g.coordinates[0] as Coordinate[], true), ...extra })
  }
  notes.push(...lookNotes)
  return { features, objects }
}

const sorted = (style: object) => Object.entries(style).sort(([a], [b]) => a.localeCompare(b))

// ---- RoadEng's own terrain file -----------------------------------------------------------------------

/** How a RoadEng project export treats RoadEng's own `Terrain1.ter`. */
export interface RoadEngOriginalPlan {
  /** The file to write over, or null to write the grid. */
  base: Uint8Array | null
  /** Why the grid is written though the terrain came from RoadEng; null otherwise. */
  why: string | null
  /** The reference the decision was made on. */
  original: RoadEngOriginalTer | null
  /** Drawn features (by their place in the list given) that stay as read. */
  unchanged: Set<number>
  /** The file's features that change, by index: the drawn feature written in its place, or null (removed). */
  replaced: Map<number, number | null>
  /** Of those, the ones whose name and place did not change: only their settings or look are written. */
  keepGeometry: Set<number>
  /** Classes of the file's features rewritten and removed. */
  rewrittenClasses: Map<RoadEngFeatureClass, number>
  removedClasses: Map<RoadEngFeatureClass, number>
}

/**
 * Whether RoadEng's own `Terrain1.ter` is written back, and which of its features change. It is,
 * unless one of these holds (each is the `why`, in this order): the terrain was read before the file
 * was kept; the project's grid is not the one read from it; the export grid is not the terrain's
 * CRS; a feature RoadEng's TIN is built on was edited or removed; it is in feet and a feature was
 * edited or added; the file is not in this browser, or is not the one read. A tracked object whose fingerprint and settings match is
 * unchanged; one that differs is rewritten in its feature's place; a tracked id no object holds is
 * removed; every other drawn feature is added.
 */
export function roadEngOriginalPlan(input: {
  source: RoadEngTerrainSource | null
  terrain: Pick<TerrainMetadata, 'epsg' | 'raster' | 'localPlane'> | null
  gridEpsg: number | null
  originalTer: Uint8Array | null
  objects: readonly DrawnObject[]
}): RoadEngOriginalPlan {
  const original = input.source?.original ?? null
  const plan: RoadEngOriginalPlan = {
    base: null,
    why: null,
    original,
    unchanged: new Set(),
    replaced: new Map(),
    keepGeometry: new Set(),
    rewrittenClasses: new Map(),
    removedClasses: new Map(),
  }
  const grid = (why: string) => ({
    ...plan,
    why,
    unchanged: new Set<number>(),
    replaced: new Map(),
    keepGeometry: new Set<number>(),
  })
  if (!input.source) return plan
  if (!original)
    return grid(
      "This terrain was read before PG Maps kept RoadEng's own terrain file; open its .terx again to write it back as read.",
    )
  const terrain = input.terrain
  if (!terrain || roadEngTerrainGridFingerprint(terrain) !== original.grid)
    return grid(
      "The project's terrain is no longer the grid read from RoadEng's terrain file: it was replaced, re-gridded, edited or moved.",
    )
  if (input.gridEpsg !== null && terrain.epsg !== input.gridEpsg)
    return grid(`This export is in EPSG:${input.gridEpsg}, not the terrain's EPSG:${terrain.epsg}.`)
  const bump = (map: Map<RoadEngFeatureClass, number>, cls: RoadEngFeatureClass) =>
    map.set(cls, (map.get(cls) ?? 0) + 1)
  const claimed = new Set<string>()
  let blocked = 0
  const entryOf = (id: string) =>
    Object.prototype.hasOwnProperty.call(original.objects, id) ? original.objects[id] : undefined
  // Unchanged objects claim their features first, so another object with the same id (an earlier
  // import's) never takes the place of the one made from this file.
  input.objects.forEach((object, k) => {
    const entry = entryOf(object.id)
    if (!entry || claimed.has(object.id) || !object.same || object.fingerprint !== entry[1]) return
    claimed.add(object.id)
    plan.unchanged.add(k)
  })
  input.objects.forEach((object, k) => {
    const entry = entryOf(object.id)
    if (!entry || claimed.has(object.id)) return
    claimed.add(object.id)
    const [index, fingerprint, inTin, cls] = entry
    plan.replaced.set(index, k)
    if (object.fingerprint !== null && roadEngSamePlace(object.fingerprint, fingerprint) && object.inPlace)
      plan.keepGeometry.add(index)
    bump(plan.rewrittenClasses, cls)
    if (inTin) blocked++
  })
  for (const [id, [index, , inTin, cls]] of Object.entries(original.objects)) {
    if (claimed.has(id)) continue
    plan.replaced.set(index, null)
    bump(plan.removedClasses, cls)
    if (inTin) blocked++
  }
  if (blocked)
    return grid(
      `${blocked === 1 ? '1 feature' : `${blocked} features`} RoadEng's TIN is built on ${blocked === 1 ? 'was' : 'were'} edited or removed here, so its TIN no longer holds.`,
    )
  // A file in feet goes back as read, its features removed but none written: this export writes
  // features in metres.
  if (original.unitM !== 1 && input.objects.some((_, k) => !plan.unchanged.has(k)))
    return grid("RoadEng's terrain is in feet, and features edited or added here are written in metres.")
  const ter = input.originalTer
  if (!ter)
    return grid(
      "RoadEng's own Terrain1.ter is not stored in this browser; choose its .terx under Terrain → RoadEng terrain to write the terrain back as read.",
    )
  if (ter.length !== original.size) return grid('The stored Terrain1.ter is not the one this terrain was read from.')
  try {
    if (roadEngTerLayout(ter).featureCount !== original.features)
      return grid('The stored Terrain1.ter is not the one this terrain was read from.')
  } catch (error) {
    return grid((error as Error).message)
  }
  return { ...plan, base: ter }
}

const KIND_NOUN: Record<RoadEngExportFeatureKind, [string, string]> = {
  stream: ['stream', 'streams'],
  road: ['road line', 'road lines'],
  'd-line': ['D-line', 'D-lines'],
  boundary: ['boundary', 'boundaries'],
  'falling-boundary': ['felling boundary', 'felling boundaries'],
  landing: ['landing', 'landings'],
  other: ['other feature', 'other features'],
}
/** RoadEng's own classes the project's ground rebuilds when the grid is written. */
const GROUND_CLASSES: readonly RoadEngFeatureClass[] = ['contour', 'source-contour', 'mass-points', 'tin-boundary']

/** What goes back to RoadEng, for the Save & export preview (`roadEngCarryOverHtml`). */
function roadEngCarryOver(input: {
  plan: RoadEngOriginalPlan
  source: RoadEngTerrainSource | null
  drawn: readonly RoadEngExportFeature[]
  written: RoadEngTerrainArchive
  logging: readonly RoadEngLoggingSystem[] | null
  mapNotes: readonly RoadEngMapNote[] | null
  layouts: number
}): RoadEngCarryOver {
  const { plan, source, written } = input
  const original = plan.original
  const carry: RoadEngCarryOver = {
    ground: plan.base ? 'roadeng' : written.ground?.vertices ? 'grid' : 'none',
    why: plan.why,
    unchanged: [],
    rewritten: [],
    leftOut: [],
  }
  const tally = (kinds: readonly RoadEngExportFeatureKind[]) => {
    const out = new Map<RoadEngExportFeatureKind, number>()
    for (const kind of kinds) out.set(kind, (out.get(kind) ?? 0) + 1)
    return [...out]
  }
  if (plan.base && original) {
    if (original.triangles) carry.unchanged.push({ label: "triangles of RoadEng's TIN", count: original.triangles })
    for (const cls of ROADENG_FEATURE_CLASSES) {
      const n =
        (original.classes[cls] ?? 0) - (plan.rewrittenClasses.get(cls) ?? 0) - (plan.removedClasses.get(cls) ?? 0)
      if (n > 0) carry.unchanged.push({ label: roadEngClassLabel(cls, n), count: n })
    }
    for (const [cls, n] of plan.rewrittenClasses)
      carry.rewritten.push({ label: `${roadEngClassLabel(cls, n)} edited here`, count: n })
    const replacing = new Set([...plan.replaced.values()].filter((k): k is number => k !== null))
    const added = input.drawn.filter((_, k) => !plan.unchanged.has(k) && !replacing.has(k))
    for (const [kind, n] of tally(added.map((f) => f.kind)))
      carry.rewritten.push({ label: `${KIND_NOUN[kind][n === 1 ? 0 : 1]} added here`, count: n })
    for (const [cls, n] of plan.removedClasses)
      carry.leftOut.push({ label: roadEngClassLabel(cls, n), count: n, why: 'removed from the project' })
  } else {
    if (written.ground?.vertices) {
      carry.rewritten.push({ label: 'mass points from the terrain grid', count: written.ground.vertices })
      if (written.ground.triangles)
        carry.rewritten.push({ label: 'TIN triangles over those points', count: written.ground.triangles })
    }
    for (const [kind, n] of tally(input.drawn.map((f) => f.kind)))
      carry.rewritten.push({ label: `${KIND_NOUN[kind][n === 1 ? 0 : 1]} from the project's layers`, count: n })
    if (original) {
      if (original.triangles)
        carry.leftOut.push({
          label: "triangles of RoadEng's TIN",
          count: original.triangles,
          why: 'the grid is written instead',
        })
      const made = new Map<RoadEngFeatureClass, number>()
      for (const [, , , cls] of Object.values(original.objects)) made.set(cls, (made.get(cls) ?? 0) + 1)
      for (const cls of ROADENG_FEATURE_CLASSES) {
        const n = (original.classes[cls] ?? 0) - (made.get(cls) ?? 0)
        if (n > 0)
          carry.leftOut.push({
            label: roadEngClassLabel(cls, n),
            count: n,
            why: GROUND_CLASSES.includes(cls) ? 'part of the ground the grid replaces' : 'not a project layer',
          })
      }
    } else if (source)
      carry.leftOut.push({
        label: "RoadEng's own TIN and the features that are not project layers",
        why: 'the grid is written instead',
      })
  }
  if (source) {
    const kept = roadEngKeptCounts(source)
    const systems = kept.loggingSystems
    if (input.logging)
      carry.rewritten.push({ label: 'logging systems, from the rigging sets', count: input.logging.length })
    else if (systems)
      carry.unchanged.push({ label: systems === 1 ? 'logging system' : 'logging systems', count: systems })
    const notes = kept.mapNotes
    if (input.mapNotes)
      carry.rewritten.push({ label: "map notes, from the project's notes", count: input.mapNotes.length })
    else if (notes) carry.unchanged.push({ label: notes === 1 ? 'map note' : 'map notes', count: notes })
    if (source.tlt)
      carry.unchanged.push({
        label: 'display settings and layers (Terrain1.tlt)',
        why: 'its coordinate system and units lines are written from the project',
      })
    if (source.te1) carry.unchanged.push({ label: 'symbol library (Terrain1.te1)' })
    if (!plan.base && (source.codeTable || source.attributeChunks))
      carry.unchanged.push({ label: 'feature codes, attribute schema and default formats' })
    if (input.layouts)
      carry.unchanged.push({
        label: input.layouts === 1 ? 'window layout (.ilt)' : 'window layouts (.ilt)',
        count: input.layouts,
      })
    for (const part of source.omitted ?? [])
      carry.leftOut.push({ label: OMITTED_LABEL[part] ?? part, why: 'too large to keep when the terrain was read' })
  }
  return carry
}

const OMITTED_LABEL: Record<string, string> = {
  tlt: 'display settings (Terrain1.tlt)',
  te1: 'symbol library (Terrain1.te1)',
  codeTable: 'feature-code table',
  headerExtra: 'header fields',
  loggingSystems: 'logging systems',
  attributeChunks: 'attribute schema and default formats',
  tail: 'map notes',
}

// ---- The project --------------------------------------------------------------------------------------

/** A plain file name a kept design's `[design] surface` gives its terrain, or null. */
function keptTerrainName(roads: readonly RoadEngExportRoad[]): string | null {
  const first = roads[0]?.source ?? roads[0]?.alignment.roadEngSource
  if (!first) return null
  const surface = readRoadEngIni(first.dsn).get('design')?.get('surface')
  return surface && /^[^\\/:*?"<>|\r\n]{1,200}\.terx$/i.test(surface) ? surface : null
}

/** The zipped RoadEng project for some roads of a project. */
export function roadEngProjectExport(input: {
  name: string
  roads: readonly RoadEngExportRoad[]
  grid: RoadEngExportGrid
  context: readonly ContextFeature[]
  cables: readonly CableLine[]
  reference: readonly ReferenceFeature[]
  /** Terrain level at a place, for drawn features. */
  elevationAt?: (c: Coordinate) => number
  designSpeedKmh?: number
  fillRate?: number
  riggingSets?: readonly RiggingSet[]
  notes?: readonly MapNote[]
  referenceStyles?: readonly ReferenceLayerStyle[]
  /** What the project's RoadEng terrain kept (`TerrainMetadata.roadEngSource`). */
  terrainSource?: RoadEngTerrainSource | null
  /** A grid for a CRS a road was read in, when not the export grid's. */
  gridFor?: RoadEngDesignOptions['gridFor']
  /** The project's terrain, to tell whether its grid is still the one read from RoadEng's own file. */
  terrain?: Pick<TerrainMetadata, 'epsg' | 'raster' | 'localPlane'> | null
  /**
   * RoadEng's own `Terrain1.ter` that `terrainSource.original` names, from this browser's store
   * (`roadEngTerrainStore.ts`); null when it is not there. With it, an unchanged terrain goes back
   * as read ({@link roadEngOriginalPlan}).
   */
  originalTer?: Uint8Array | null
  /**
   * Write the whole terrain grid, not the corridor along the roads (a project that is its terrain).
   * With no roads the zip holds the terrain alone.
   */
  wholeTerrain?: boolean
}): {
  bytes: Uint8Array
  fileName: string
  notes: string[]
  parts: Record<string, string>
  /** What goes back to RoadEng as read, what is rewritten from the project and what is left out. */
  carryOver: RoadEngCarryOver
} {
  const files = roadEngProjectFileNames(input.name)
  // A project that is only its terrain goes back as the terrain alone, with no design beside it.
  const noDesign = input.roads.length === 0
  const prepared = roadEngDesignRoads(input.roads, input.grid.toGrid, input.grid.epsg, {
    ...(input.fillRate !== undefined ? { fillRate: input.fillRate } : {}),
    ...(input.designSpeedKmh ? { designSpeedKmh: input.designSpeedKmh } : {}),
    ...(input.gridFor ? { gridFor: input.gridFor } : {}),
  })
  const level = (c: Coordinate) => {
    const z = input.elevationAt?.(c)
    return z !== undefined && Number.isFinite(z) ? z : undefined
  }
  const source = input.terrainSource ?? null
  const terrainNotes: string[] = []
  const logging = roadEngLoggingSystemsFor(input.riggingSets ?? [], source)
  const drawn = drawnFeatures(input, input.grid.toGrid, level, symbolTables(source), logging.idOfSet, terrainNotes)
  const plan = roadEngOriginalPlan({
    source,
    terrain: input.terrain ?? null,
    gridEpsg: input.grid.epsg,
    originalTer: input.originalTer ?? null,
    objects: drawn.objects,
  })
  // Map notes sit in the file's unit: RoadEng's own file in feet keeps them in feet.
  const fileUnitM = plan.base ? (plan.original?.unitM ?? 1) : 1
  const mapNotes = roadEngMapNotesFor(input.notes ?? [], source, (c) => {
    const [x, y] = input.grid.toGrid(c)
    return [x / fileUnitM, y / fileUnitM]
  })
  // Over RoadEng's own file, unchanged features stay as read and are not given again.
  const given = drawn.features.map((_, k) => k).filter((k) => !plan.base || !plan.unchanged.has(k))
  const features = given.map((k) => drawn.features[k])
  // A design with no ground and nothing drawn (RoadEng's own design with no terrain) goes without one.
  const withTerrain =
    noDesign ||
    input.grid.raster !== null ||
    plan.base !== null ||
    drawn.features.length > 0 ||
    !!mapNotes?.length ||
    !!logging.systems?.length
  const terrainName = withTerrain ? (keptTerrainName(prepared.roads) ?? files.terrain) : null
  const design = noDesign
    ? null
    : roadEngDesign(prepared.roads, input.grid.toGrid, {
        ...(terrainName ? { terrainName } : {}),
        ...(input.designSpeedKmh ? { designSpeedKmh: input.designSpeedKmh } : {}),
      })
  const terrain: RoadEngTerrainArchive = !withTerrain
    ? { bytes: new Uint8Array(), notes: [], ground: null, original: null }
    : roadEngTerrainArchive({
        raster: input.grid.raster,
        corridor: input.wholeTerrain
          ? null
          : {
              lines: input.roads.map((road) => road.alignment.points.map((p) => input.grid.toGrid(p.coordinate))),
              halfWidthM: ROADENG_EXPORT_CORRIDOR_M,
            },
        features,
        coordSys: input.grid.epsg === null ? null : { epsg: input.grid.epsg },
        ...(source ? { source } : {}),
        ...(logging.systems ? { loggingSystems: logging.systems } : {}),
        ...(mapNotes ? { mapNotes } : {}),
        ...(plan.base
          ? {
              original: {
                ter: plan.base,
                replaced: new Map(
                  [...plan.replaced].map(([index, k]) => [index, k === null ? null : given.indexOf(k)]),
                ),
                keepGeometry: plan.keepGeometry,
              },
            }
          : {}),
      })
  const layouts = Object.fromEntries(
    (source?.layouts ?? []).map((l) => [`${l.name}.ilt`, Uint8Array.from(l.text, (ch) => ch.charCodeAt(0) & 0xff)]),
  )
  // Each road's P-line goes back beside the design as read, under the name the design gives it.
  const pLines: Record<string, Uint8Array> = {}
  for (const road of prepared.roads) Object.assign(pLines, roadEngPLineFiles(road.source?.pLine))
  const notes = [
    ...prepared.notes,
    ...(design?.notes ?? []),
    ...(input.grid.raster
      ? []
      : ['This project has no terrain grid with levels to write, so the RoadEng project goes without ground.']),
    ...terrain.notes,
    ...logging.notes,
    ...terrainNotes,
    ...(Object.keys(layouts).length
      ? [
          `${Object.keys(layouts).length === 1 ? 'Its window layout goes' : 'Its window layouts go'} beside the terrain as read.`,
        ]
      : []),
  ]
  const carryOver = roadEngCarryOver({
    plan,
    source,
    drawn: drawn.features,
    written: terrain,
    logging: logging.systems,
    mapNotes,
    layouts: Object.keys(layouts).length,
  })
  return {
    carryOver,
    bytes: roadEngProjectZip({
      name: files.stem,
      design: design?.bytes ?? null,
      terrain: withTerrain ? terrain.bytes : null,
      ...(terrainName && terrainName !== files.terrain ? { terrainName } : {}),
      ...(Object.keys(layouts).length ? { layouts } : {}),
      ...(Object.keys(pLines).length ? { surveys: pLines } : {}),
    }),
    fileName: files.zip,
    notes: [...new Set(notes)],
    parts: design?.parts ?? {},
  }
}
