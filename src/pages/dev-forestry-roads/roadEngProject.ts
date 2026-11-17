/**
 * A RoadEng project brought in whole: its design (`.dsnx`), its terrain (`.terx`), or both, given
 * as separate files or inside one ZIP (RoadEng's "Zipped RoadEng Project"). The content of each file
 * decides what it is, never its name.
 *
 * - **Where it goes.** RoadEng keeps the coordinate system on the terrain (`[main] CoordSys` in its
 *   `.tlt`), not the design, so the design is placed in its terrain's CRS. A project whose terrain
 *   names none, whose CRS this workspace does not convert or would put its coordinates outside the
 *   area it applies to ({@link crsMisfit}: RoadEng's default code on a terrain made in another
 *   system), or that has no terrain, is laid on the local plane (`localPlane.ts`) and keeps where
 *   its coordinates came from, so **Place on map** can put it in its CRS later.
 * - **Ground.** The terrain's own TIN (RoadEng's triangles over its points) is kept as the ground
 *   analysis reads (`preparation` `roadeng-tin`, `tinGround.ts`): sections, the profile and
 *   quantities take its facets. The plan's grid is made from it through `rasterizeTin`, at a cell
 *   from the TIN's point spacing coarsened only as far as the cell limit needs; triangles longer
 *   than RoadEng's own limit were never made, so none is dropped for length. A TIN past what a
 *   project keeps (`MAX_RETAINED_TIN_VERTICES`) is read through the grid alone.
 * - **What was drawn.** Each terrain feature is classed (`classifyRoadEngFeature`) and becomes the
 *   project object that holds that kind of thing: streams are streams, roads are existing roads,
 *   D-lines with cable settings are D-lines at their first and last spars with RoadEng's heights,
 *   deflection and payload (`roadEngDLineCable`), rigged with their logging system's set; closed
 *   felling boundaries are proposed harvest blocks, and landings, rock bluffs, other boundaries,
 *   breaklines, D-lines without settings and anything else are reference layers, filed under their
 *   `.tlt` layer and drawn in RoadEng's colour, line type and symbol (`roadEngSymbols.ts`). Contours,
 *   point sets and the TIN boundary are the terrain itself and are counted, not drawn. A road line
 *   lying on an imported alignment is that alignment and is left out. The project's limits (500
 *   context features and 50,000 vertices, 500 reference features and 50,000 vertices, 100 D-lines)
 *   are filled in file order and whatever is left over is counted.
 * - **Cable and notes.** The terrain's logging systems become rigging sets (`roadeng-system-<n>`,
 *   with their equipment kept for writing back), and its map notes become map pins.
 * - **Design settings.** Each alignment's templates, ranges, curve rule and ground types
 *   (`roadEngDesignSettings.ts`; a ground type's slopes apply where RoadEng's template slope is
 *   AUTO, bending at stratum layers), parameter overrides, haul costs, quality and pits
 *   (`roadEngHaul.ts`) and optimizer standards, controls and vertical alignments
 *   (`roadEngOptimizer.ts`) are read, and where RoadEng flagged a range or pit on its stations
 *   (`stationEvents`) the two are compared and a disagreement is said.
 * - **Kept for writing back.** Each road keeps its design's parts (`Alignment.roadEngSource`), the
 *   terrain its own (`TerrainMetadata.roadEngSource`, with any `.ilt` window layouts chosen with it),
 *   each D-line its RoadEng settings; `roadEngProjectExport.ts` writes them back. The terrain's whole
 *   `Terrain1.ter` comes back in `originalTer` with the reference the page completes once it has
 *   hashed and stored the bytes (`withRoadEngOriginal`, `roadEngTerrainOriginal.ts`): the grid's
 *   fingerprint, the file's features by class and the fingerprint of every object made from one.
 * - **Units.** Coordinates and levels in feet are converted to metres; the terrain takes the
 *   design's unit, and without a design its own (`.tlt` `units`), else metres.
 *
 * Pure: no DOM or network access.
 */
import { strFromU8, unzipSync } from 'fflate'
import { csrsUtmZone, projectedCrsDefinition } from '@/lib/geo/projectedCrs'
import { distance } from './engine'
import { roadEngUnitName } from './roadEngUnits'
import { alignmentCrs, gridToLonLat, type XY } from './landXmlImport'
import { LOCAL_PLANE_EPSG, localPlaneOffset, localPlaneProjection, type LocalPlacement } from './localPlane'
import {
  isRoadEngDesign,
  parseRoadEngDesign,
  roadEngImportSummary,
  ROADENG_UNITS,
  roadEngRoads,
  stationEvents,
  type RoadEngRoad,
} from './roadEngImport'
import {
  classifyRoadEngFeature,
  isRoadEngTerrain,
  readRoadEngTerrainArchive,
  roadEngLayerMatches,
  MAX_ROADENG_LAYOUTS,
  type RoadEngCoordSys,
  type RoadEngFeatureClass,
  type RoadEngLayer,
  type RoadEngTerrainFeature,
} from './roadEngTerrain'
import { rasterizeTin } from './tinSurface'
import {
  isNativeTraverse,
  isNativeTraverseSettings,
  parseNativeTraverse,
  type NativeTraverse,
} from './softreeNativeTraverse'
import {
  isPLineStratum,
  MAX_PLINE_SOURCE_CHARS,
  pLineGroundStations,
  roadEngPLineChars,
  roadEngPLineReference,
  roadEngPStations,
  type PLineGround,
  type RoadEngPLineSource,
} from './roadEngPLine'
import { tinMedianEdge, tinStats } from './tinGround'
import {
  MAX_RETAINED_TIN_INDICES,
  MAX_RETAINED_TIN_VERTICES,
  type TerrainPreparationRecord,
} from './terrainPreparation'
import {
  readRoadEngSettings,
  roadEngDefaultGroundType,
  roadEngEngineeringFor,
  withRoadEngCurveSettings,
} from './roadEngDesignSettings'
import { applyRoadEngCostCarryover, roadEngHaulFor } from './roadEngHaul'
import { activeRoadEngSolution, readRoadEngStoredResults, roadEngStoredResultsNote } from './roadEngStoredResults'
import { applyRoadEngOptimizer, parseRoadEngOptimizer, roadEngOptimizerFor } from './roadEngOptimizer'
import { readRoadEngLayout, roadEngDLineCable } from './roadEngDLines'
import type { RoadEngLoggingSystem } from './roadEngLoggingSystems'
import { readRoadEngSymbolFile, type RoadEngSymbolTables } from './roadEngSymbolTables'
import {
  parseRoadEngFormatChunk,
  roadEngFeatureLook,
  roadEngReferenceLayers,
  type RoadEngStyledFeature,
} from './roadEngSymbols'
import { base64ToBytes, bytesToBase64 } from './roadEngText'
import {
  roadEngObjectFingerprint,
  roadEngTerrainGridFingerprint,
  MAX_ROADENG_ORIGINAL_TER_BYTES,
  type RoadEngOriginalRecord,
} from './roadEngTerrainOriginal'
import { roadEngLoggingSystemToRiggingSet, roadEngSystemFromDecoded } from './cableEquipment/cableEquipment'
import { applyRiggingSetToLine, MAX_RIGGING_SETS, type RiggingSet } from './dline/riggingSets'
import { MAP_NOTE_COLORS, MAX_MAP_NOTES, type MapNote } from './mapNotes'
import { validateEngineering, validateTemplate } from './templates'
import { carryWrittenCulvertFields, withDesignCulverts } from './roadEngPlacedCulverts'
import { createEngineeringDesign } from './engineeringTypes'
import type { LocalRaster } from '@/lib/forestry/terrain/localRaster'
import type { Alignment, CableLine, Coordinate, ContextFeature, RoadTemplate, TerrainMetadata } from './types'
import { referenceShape, type ReferenceFeature } from './referenceFeatures'
import type { ReferenceLayerStyle } from './referenceStyles'

export const MAX_ROADENG_PROJECT_BYTES = 300_000_000
const MAX_CONTEXT = 500,
  MAX_CONTEXT_VERTICES = 50_000,
  MAX_REFERENCE = 500,
  MAX_REFERENCE_VERTICES = 50_000,
  MAX_CABLES = 100
/** The finest terrain cell made from a TIN, m; coarser where its points are sparse. */
export const ROADENG_TERRAIN_MIN_CELL_M = 1
/** A road line within this of an imported alignment's stations is that alignment. */
const ON_ALIGNMENT_M = 0.05
/**
 * A range or pit read from the `.dsn` is where RoadEng flagged it on its stations when within this,
 * m of road chainage (RoadEng flags 0.1 project unit either side of a boundary).
 */
export const ROADENG_EVENT_MATCH_M = 0.5
/** The rigging set a RoadEng logging system becomes, by its system number. */
export const roadEngSystemSetId = (systemId: string) => `roadeng-system-${systemId}`
/** The map note a RoadEng map note becomes, by its place in the file. */
export const roadEngNoteId = (index: number) => `roadeng-note-${index + 1}`
/** Attributes a reference feature from RoadEng keeps for writing its look back. */
export const ROADENG_FORMAT_ATTRIBUTE = 'roadEngFormat'
export const ROADENG_COLOR_ATTRIBUTE = 'roadEngColor'

export interface RoadEngFile {
  name: string
  bytes: Uint8Array
}

/** Whether a file's opening is a RoadEng window layout (`.ilt`): INI text with RoadEng's window sections. */
export function isRoadEngLayout(head: Uint8Array): boolean {
  if (!head.length || head[0] !== 0x5b) return false
  const text = strFromU8(head, true)
  return /^\[(3dwindow|multi|dline[a-z]*\d*|ControlBars-[^\]]*)\]\r?$/im.test(text) && !/\[TerLayers\]/i.test(text)
}

/** The designs, terrains and window layouts among some files, unpacking any ZIP that holds them. */
export function collectRoadEngFiles(files: readonly RoadEngFile[]): {
  designs: RoadEngFile[]
  terrains: RoadEngFile[]
  layouts: RoadEngFile[]
  /** P-line traverses (`.tr1`) and the settings files beside them (`.tr2`). */
  surveys: RoadEngFile[]
} {
  const designs: RoadEngFile[] = [],
    terrains: RoadEngFile[] = [],
    layouts: RoadEngFile[] = [],
    surveys: RoadEngFile[] = []
  const sort = (file: RoadEngFile, depth: number) => {
    const head = file.bytes.subarray(0, 4096)
    if (isRoadEngDesign(head)) designs.push(file)
    else if (isRoadEngTerrain(head)) terrains.push(file)
    else if (isNativeTraverse(strFromU8(head, true))) surveys.push(file)
    // A `.tr2` opens with RoadEng's control-bar sections too: told from a window layout by its [Traverse].
    else if (isNativeTraverseSettings(strFromU8(file.bytes.subarray(0, 64_000), true))) surveys.push(file)
    else if (isRoadEngLayout(head)) layouts.push(file)
    else if (depth === 0 && head[0] === 0x50 && head[1] === 0x4b) {
      let entries: Record<string, Uint8Array>
      try {
        entries = unzipSync(file.bytes, {
          filter: (entry) =>
            /\.(dsnx|terx|ilt|tr1|tr2)$/i.test(entry.name) && entry.originalSize <= MAX_ROADENG_PROJECT_BYTES,
        })
      } catch {
        throw Error(`${file.name} could not be unpacked: the archive is damaged.`)
      }
      const inside = Object.entries(entries)
      if (!inside.some(([name]) => /\.(dsnx|terx)$/i.test(name)))
        throw Error(`${file.name} holds no RoadEng design (.dsnx) or terrain (.terx).`)
      for (const [name, bytes] of inside) sort({ name: name.split('/').pop() ?? name, bytes }, 1)
    } else throw Error(`${file.name} is not a RoadEng design, terrain, traverse or window layout.`)
  }
  for (const file of files) sort(file, 0)
  if (!designs.length && !terrains.length)
    throw Error('Choose a RoadEng design (.dsnx), its terrain (.terx) or a zipped RoadEng project.')
  return { designs, terrains, layouts, surveys }
}

const latin1Head = (f: RoadEngFile) => strFromU8(f.bytes.subarray(0, 4096), true)
const fileStem = (name: string) => name.replace(/\.[^.]*$/, '').toLowerCase()

/**
 * The P-line a design part names (`[design] roadname`), read from the traverses given with the
 * design (`roadEngPLine.ts`): the named `.tr1` (or the only one given), its `.tr2` by the same stem,
 * the design-to-P-line stations and each surveyed station's ground layers. A named P-line that was
 * not given comes back with no ground, so its `**` ground stays unclassified. Null when the part
 * names none.
 */
function designPLine(
  text: { dsn: string; ds2: string } | undefined,
  surveys: readonly RoadEngFile[],
  designUnitM: number,
  defaultCode: string,
): {
  source: RoadEngPLineSource
  option: { name: string; ground: PLineGround | null }
  notes: string[]
  files: RoadEngFile[]
} | null {
  if (!text) return null
  const ref = roadEngPLineReference(text.dsn)
  if (!ref) return null
  const notes: string[] = []
  const traverses = surveys.filter((f) => isNativeTraverse(latin1Head(f)))
  const named = ref.name.toLowerCase()
  const tr1 = traverses.find((f) => f.name.toLowerCase() === named) ?? (traverses.length === 1 ? traverses[0] : null)
  const missing = (why: string) => {
    notes.push(why)
    return {
      source: { name: ref.name, tr1: null, tr2: null, stations: roadEngPStations(text.ds2, designUnitM, null).pairs },
      option: { name: ref.name, ground: null },
      notes,
      files: [],
    }
  }
  if (!tr1)
    return missing(
      `its P-line ${ref.name} was not given with the design, so ground RoadEng takes from it is left unclassified.`,
    )
  if (tr1.name.toLowerCase() !== named) notes.push(`the design names its P-line ${ref.name}; ${tr1.name} was used.`)
  const tr1Text = strFromU8(tr1.bytes, true)
  let traverse: NativeTraverse
  try {
    traverse = parseNativeTraverse(tr1Text)
  } catch (error) {
    return missing(
      `its P-line ${tr1.name} could not be read (${error instanceof Error ? error.message : String(error)}), so ground RoadEng takes from it is left unclassified.`,
    )
  }
  const unitM = traverse.unitM ?? designUnitM
  const placed = roadEngPStations(text.ds2, designUnitM, { traverse, unitM })
  const stations = pLineGroundStations(traverse, unitM, defaultCode)
  const tr2File = surveys.find(
    (f) => f !== tr1 && !isNativeTraverse(latin1Head(f)) && fileStem(f.name) === fileStem(tr1.name),
  )
  const source: RoadEngPLineSource = {
    name: ref.name,
    tr1: tr1Text,
    tr2: tr2File ? { name: tr2File.name, text: strFromU8(tr2File.bytes, true) } : null,
    stations: placed.pairs,
  }
  if (roadEngPLineChars(source) > MAX_PLINE_SOURCE_CHARS) {
    source.tr1 = null
    source.tr2 = null
    notes.push(
      `its P-line ${ref.name} is too large to keep in the project, so a RoadEng project written from here goes without it.`,
    )
  }
  const given = stations.filter((s) => s.given).length
  notes.push(
    `its P-line ${ref.name} was read: ${stations.length} surveyed stations, ${given ? `${given} giving ground layers of their own` : `none giving ground layers of its own, so its ground is ${defaultCode} throughout`}${traverse.unitM === null ? ", in the design's unit" : ''}; ${placed.from === 'design' ? "its stations lie on the road where the design's calculated stations put them" : placed.from === 'projection' ? 'its stations are placed on the road by their coordinates' : 'its stations could not be placed on the road'}.`,
  )
  return {
    source,
    option: {
      name: ref.name,
      ground: placed.pairs.length ? { stations, pairs: placed.pairs, apply: ref.apply } : null,
    },
    notes,
    files: [tr1, ...(tr2File ? [tr2File] : [])],
  }
}

/** Each alignment's `.dsn` and `.ds2` as Latin-1 text, by part name (`Location1`). */
function designTexts(bytes: Uint8Array): Map<string, { dsn: string; ds2: string }> {
  const out = new Map<string, { dsn: string; ds2: string }>()
  const entries = unzipSync(bytes, { filter: (f) => /^Location\d+\.ds[n2]$/i.test(f.name) })
  for (const [name, data] of Object.entries(entries)) {
    const m = /^(Location\d+)\.(ds[n2])$/i.exec(name)
    if (!m) continue
    const part = out.get(m[1]) ?? { dsn: '', ds2: '' }
    part[m[2].toLowerCase() as 'dsn' | 'ds2'] = strFromU8(data, true)
    out.set(m[1], part)
  }
  return out
}

export interface RoadEngProjectOptions {
  newId: () => string
  color: (index: number) => string
  template: RoadTemplate
  /** The terrain's vertical datum, as the person stated it; RoadEng does not record one. */
  verticalReference: string
  /** SHA-256 of a terrain archive, for the terrain's provenance (the page hashes; this module cannot). */
  sha256Of?: (file: RoadEngFile) => string | undefined
  /**
   * When no terrain states a CRS this workspace converts: `plane` (the default) lays the project
   * on a new flat plane; a placement puts it on that plane (the open project's, the same file
   * coordinates); `ask` raises {@link AlignmentCrsQuestion}, answered through `epsg`.
   */
  noCrs?: 'plane' | 'ask' | LocalPlacement
  /** The CRS the person gave, when asked. A CRS a terrain states is never overridden. */
  epsg?: number
  /** When the import happens, ISO 8601, for the map notes it makes; now when omitted. */
  importedAt?: string
}

export interface RoadEngProject {
  name: string
  /** The CRS the project is in: the terrain's, or the local plane. */
  epsg: number
  localPlane: LocalPlacement | null
  coordSys: RoadEngCoordSys | null
  roads: RoadEngRoad[]
  terrain: TerrainMetadata
  context: ContextFeature[]
  cables: CableLine[]
  reference: ReferenceFeature[]
  /** The terrain's logging systems as rigging sets (`roadeng-system-<n>`), equipment kept. */
  riggingSets: RiggingSet[]
  /** The terrain's map notes, as pins. */
  mapNotes: MapNote[]
  /** The looks of the reference layers made from the terrain's features. */
  referenceStyles: ReferenceLayerStyle[]
  /** RoadEng's embankment cost per m³ when every alignment's ground types give the same one. */
  fillRate: number | null
  /** One sentence each, for the import notice. */
  notes: string[]
  /** The roads' own summaries (also in `notes`), for an import that takes only the roads. */
  roadNotes: string[]
  /**
   * The terrain's `Terrain1.ter` as read and its reference without the checksum, for the page to
   * hash, store and record (`withRoadEngOriginal`); null without a terrain, or one too large to keep.
   */
  originalTer: { bytes: Uint8Array; record: RoadEngOriginalRecord } | null
}

/** A terrain with its reference to RoadEng's own `Terrain1.ter` filled in, once the page has its SHA-256. */
export function withRoadEngOriginal(
  terrain: TerrainMetadata,
  original: { record: RoadEngOriginalRecord; sha256: string },
): TerrainMetadata {
  if (!terrain.roadEngSource) return terrain
  return {
    ...terrain,
    roadEngSource: { ...terrain.roadEngSource, original: { sha256: original.sha256, ...original.record } },
  }
}

const stem = (name: string) => name.replace(/\.(dsnx|terx|zip)$/i, '')

/**
 * Where a supported CRS applies, as west, south, east, north in degrees: a UTM zone's six degrees
 * with a zone's grace either side, within its datum's hemisphere or continent; BC Albers over BC.
 */
function crsArea(epsg: number): [number, number, number, number] | null {
  const zone = (n: number) => -183 + 6 * n
  const utm = (n: number, south: number, north: number): [number, number, number, number] => [
    zone(n) - 6,
    south,
    zone(n) + 6,
    north,
  ]
  if (epsg === 3005) return [-145, 45, -109, 63]
  const csrs = csrsUtmZone(epsg)
  // NAD83 and NAD83(CSRS) are North America's datums (EPSG's area of use, 14.9° N to 86.5° N).
  if (csrs !== null) return utm(csrs, 14, 87)
  if (epsg >= 26901 && epsg <= 26923) return utm(epsg - 26900, 14, 87)
  if (epsg >= 32601 && epsg <= 32660) return utm(epsg - 32600, 0, 84)
  if (epsg >= 32701 && epsg <= 32760) return utm(epsg - 32700, -80, 0)
  return null
}

/**
 * The first of `points` (grid metres) that `epsg` puts outside where it applies, as "lat° N, lon° W"
 * for the notice; null when every point is inside, or the CRS has no area here.
 */
export function crsMisfit(epsg: number, points: readonly XY[]): string | null {
  const area = crsArea(epsg)
  if (!area || !points.length) return null
  const toLonLat = gridToLonLat(epsg)
  for (const xy of points) {
    const [lon, lat] = toLonLat(xy)
    if (
      Number.isFinite(lon) &&
      Number.isFinite(lat) &&
      lon >= area[0] &&
      lat >= area[1] &&
      lon <= area[2] &&
      lat <= area[3]
    )
      continue
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return 'no position on the earth'
    return `${Math.abs(lat).toFixed(2)}° ${lat < 0 ? 'S' : 'N'}, ${Math.abs(lon).toFixed(2)}° ${lon < 0 ? 'W' : 'E'}`
  }
  return null
}

/** Everything a RoadEng project brings into a new road project. */
export function roadEngProject(files: readonly RoadEngFile[], options: RoadEngProjectOptions): RoadEngProject {
  const { designs, terrains, layouts, surveys } = collectRoadEngFiles(files)
  if (designs.length > 1) throw Error('Choose one RoadEng design at a time, with its terrain.')
  const designFile = designs[0] ?? null
  const design = designFile ? parseRoadEngDesign(designFile.bytes) : null
  const notes: string[] = []

  // The design's terrain is the one it names, else the only one given.
  let terrainFile: RoadEngFile | null = null
  if (terrains.length) {
    const named = design?.terrain?.toLowerCase()
    terrainFile = terrains.find((t) => t.name.toLowerCase() === named) ?? (terrains.length === 1 ? terrains[0] : null)
    if (!terrainFile)
      throw Error(`The design uses ${design?.terrain ?? 'no named terrain'}; choose that terrain, or only one terrain.`)
    if (design?.terrain && terrainFile.name.toLowerCase() !== design.terrain.toLowerCase())
      notes.push(`The design names its terrain ${design.terrain}; ${terrainFile.name} was used.`)
  } else if (design?.terrain) notes.push(`Its terrain, ${design.terrain}, was not given, so the project has no ground.`)
  const archive = terrainFile ? readRoadEngTerrainArchive(terrainFile.bytes) : null
  // A terrain states its own unit (`.tlt` `units=`, the design's codes): a terrain opened alone in
  // feet is read in feet. With a design the design's unit is the project's; a terrain in another
  // unit is said.
  const terrainUnitCode = /^units=([\d.]+)\s*$/m.exec(archive?.source.tlt ?? '')?.[1]
  const terrainUnitM = terrainUnitCode === undefined ? undefined : ROADENG_UNITS[terrainUnitCode]
  const unitM = design?.unitM ?? terrainUnitM ?? 1
  if (design && terrainUnitM !== undefined && Math.abs(terrainUnitM - design.unitM) > 1e-12)
    notes.push(
      `Its terrain states its units in ${roadEngUnitName(terrainUnitM)} and the design in ${roadEngUnitName(design.unitM)}; the terrain is read in the design's.`,
    )
  const m = (v: number) => v * unitM

  // Where it goes.
  const coordSys = archive?.coordSys ?? null
  let epsg: number, toLonLat: (xy: XY) => Coordinate, localPlane: LocalPlacement | null
  const stated = coordSys?.epsg ?? null
  // Every coordinate the files hold, in metres: the design's stations and the terrain's extent.
  const extent: XY[] = []
  for (const a of design?.alignments ?? []) for (const s of a.stations) extent.push(s.xy)
  if (archive) {
    const [x0, x1, y0, y1] = archive.terrain.bbox
    extent.push([m(x0), m(y0)], [m(x1), m(y1)])
  }
  // A stated CRS is taken only where it puts the coordinates inside the area it is defined for:
  // RoadEng writes its default code (1|51|10010, NAD83 / UTM zone 10N) on terrains made in other
  // systems, which would put Softree's Washington tutorials on the equator.
  const misfit = stated !== null && projectedCrsDefinition(stated) ? crsMisfit(stated, extent) : null
  if (stated !== null && projectedCrsDefinition(stated) && unitM === 1 && misfit === null) {
    epsg = stated
    toLonLat = gridToLonLat(stated)
    localPlane = null
  } else if (options.epsg !== undefined && options.noCrs === 'ask') {
    if (unitM !== 1) throw Error('This design is in feet, and every coordinate system offered is in metres.')
    epsg = options.epsg
    toLonLat = gridToLonLat(options.epsg)
    localPlane = null
  } else if (typeof options.noCrs === 'object') {
    if (Math.abs(options.noCrs.unitM - unitM) > 1e-12)
      throw Error('This project is on a plane in other units; these files cannot share it.')
    epsg = LOCAL_PLANE_EPSG
    localPlane = options.noCrs
    toLonLat = localPlaneProjection(localPlane.offsetM).toLonLat
  } else {
    if (options.noCrs === 'ask') {
      const points: XY[] = (design?.alignments ?? []).flatMap((a) => a.stations.map((s) => s.xy))
      if (archive) {
        const [x0, x1, y0, y1] = archive.terrain.bbox
        points.push([m(x0), m(y0)], [m(x1), m(y1)])
      }
      alignmentCrs(null, undefined, { unitM, points, what: (terrainFile ?? designFile)!.name })
    }
    if (misfit)
      notes.push(
        `Its terrain states EPSG:${stated}${coordSys?.source === 'code' ? ` (RoadEng code ${coordSys.raw})` : ''}, which would put its coordinates at ${misfit}, outside where that system applies, so it is not taken as where the terrain is.`,
      )
    else if (stated !== null)
      notes.push(
        `Its terrain states EPSG:${stated}, which this workspace does not ${projectedCrsDefinition(stated) ? 'read in feet' : 'convert'}.`,
      )
    const offsetM = localPlaneOffset(extent)
    localPlane = { offsetM, unitM, source: (terrainFile ?? designFile)!.name.slice(0, 200) }
    epsg = LOCAL_PLANE_EPSG
    toLonLat = localPlaneProjection(offsetM).toLonLat
    notes.push(
      `It is on a flat plane: ${archive ? 'its terrain names no coordinate system this workspace converts' : 'no terrain says where it is'}. Use Place on map to put it in its coordinate system.`,
    )
  }

  // Roads, with the cross-section, template ranges, curve rule and ground types RoadEng gives them
  // (`roadEngDesignSettings.ts`). RoadEng's profile is the finished surface and this workspace's the
  // subgrade, so a road that takes RoadEng's template is lowered by that template's surfacing.
  const placedRoads = designFile
    ? roadEngRoads(designFile.bytes, {
        fileName: designFile.name,
        newId: options.newId,
        color: options.color,
        template: options.template,
        placement: { epsg, toLonLat },
      }).roads
    : []
  const settings = designFile ? readRoadEngSettings(designFile.bytes) : null
  const texts = designFile ? designTexts(designFile.bytes) : new Map<string, { dsn: string; ds2: string }>()
  const firstPart = design?.alignments[0]?.part
  const sectionNotes: string[] = []
  const fillRates: (number | null)[] = []
  const usedSurveys = new Set<RoadEngFile>()
  const roads = placedRoads.map((road) => {
    const read = road.source
    // The P-line the design names, read from the traverse given with it (`roadEngPLine.ts`).
    const defaultType = roadEngDefaultGroundType(
      settings?.parts.find((p) => p.part === read.part)?.settings.materials ?? [],
    )
    const pLine = designPLine(texts.get(read.part), surveys, unitM, defaultType?.code ?? 'OB')
    if (pLine) {
      sectionNotes.push(...pLine.notes.map((n) => `${road.alignment.name}: ${n}`))
      for (const f of pLine.files) usedSurveys.add(f)
    }
    // What the design holds besides the road, kept so a RoadEng file written from it loses nothing.
    // Each curve's own superelevation settings come from its 108 record, against the road's rule.
    const keep = (alignment: Alignment): Alignment =>
      read.source
        ? {
            ...withRoadEngCurveSettings(alignment, read),
            roadEngSource: {
              ...read.source,
              stationScale: road.stationScale,
              epsg,
              fallback: options.template,
              ...(read.name === null ? { importedName: alignment.name } : {}),
              ...(pLine ? { pLine: pLine.source } : {}),
            },
          }
        : withRoadEngCurveSettings(alignment, read)
    // A design this workspace wrote carries its own section and surfacing back, unless RoadEng saved it
    // since: then RoadEng's settings are read, and only what it has no field for comes from [PGMaps].
    const own = read.pgmaps && !read.pgmaps.nativeChanged ? read.pgmaps : null
    if (read.pgmaps?.nativeChanged)
      sectionNotes.push(
        `${road.alignment.name} was saved in RoadEng after this workspace wrote it: RoadEng's own settings are read.`,
      )
    if (own) {
      let template: RoadTemplate | null = null
      try {
        if (own.template && typeof own.template === 'object') {
          validateTemplate(own.template as RoadTemplate)
          template = own.template as RoadTemplate
        }
      } catch {
        sectionNotes.push(`${road.alignment.name}'s saved section could not be read; it takes the open road's.`)
      }
      const ownText = texts.get(read.part)
      const restored: Alignment = {
        ...road.alignment,
        ...(template ? { template } : {}),
        // Checked with the rest of the road when the project is parsed (`parseEngineering`).
        ...(own.engineering && typeof own.engineering === 'object'
          ? { engineering: own.engineering as Alignment['engineering'] }
          : {}),
        ...(own.curveDesign && typeof own.curveDesign === 'object'
          ? { curveDesign: own.curveDesign as Alignment['curveDesign'] }
          : {}),
        vertical: road.alignment.vertical.map((v) => ({
          ...v,
          elevation: Math.round((v.elevation - own.surfacingM) * 1000) / 1000,
        })),
      }
      // The design's placed culverts are the ones written with it; one only its .ds1 holds is added.
      if (road.culverts.length) {
        const e = restored.engineering ?? createEngineeringDesign()
        restored.engineering = {
          ...e,
          culverts: withDesignCulverts(Array.isArray(e.culverts) ? e.culverts : [], road.culverts),
        }
      }
      // Standards, controls and vertical alternatives, minimum lengths included, are RoadEng's optimizer settings.
      const optimizer = ownText
        ? roadEngOptimizerFor(parseRoadEngOptimizer(ownText.dsn, unitM), {
            startStationM: read.startStation,
            endStationM: read.endStation,
            stationScale: road.stationScale,
            unitM,
            surfaceDepthM: own.surfacingM,
            activeVertical: restored.vertical,
          })
        : null
      return { ...road, alignment: keep(optimizer ? applyRoadEngOptimizer(restored, optimizer) : restored) }
    }
    const part = settings?.parts.find((p) => p.part === read.part)
    if (!part)
      return {
        ...road,
        alignment: keep(
          road.culverts.length
            ? { ...road.alignment, engineering: { ...createEngineeringDesign(), culverts: road.culverts } }
            : road.alignment,
        ),
      }
    const frame = { startStation: read.startStation, endStation: read.endStation, stationScale: road.stationScale }
    // Ground types carry their slopes; each template says whether its slopes are AUTO and take them.
    const mapped = roadEngEngineeringFor(part.settings, {
      ...frame,
      fallback: options.template,
      ...(pLine ? { pLine: pLine.option } : {}),
    })
    // Saved in RoadEng with no RoadEng template of its own: the section this workspace wrote stays.
    let written: RoadTemplate | null = null
    try {
      if (!mapped.template && read.pgmaps?.template && typeof read.pgmaps.template === 'object') {
        validateTemplate(read.pgmaps.template as RoadTemplate)
        written = read.pgmaps.template as RoadTemplate
      }
    } catch {
      written = null
    }
    const depth = mapped.template
      ? (mapped.subgradeDepthM.left + mapped.subgradeDepthM.right) / 2
      : written
        ? read.pgmaps!.surfacingM
        : 0
    const name = road.alignment.name
    if (mapped.template)
      sectionNotes.push(
        `${name} takes RoadEng's section${depth > 0 ? `; its profile is lowered ${depth.toFixed(2)} m from the finished surface to the subgrade` : ''}.`,
      )
    if (mapped.notes.length) sectionNotes.push(...mapped.notes)
    const unmapped = [...mapped.unmapped]
    const text = texts.get(read.part)
    // Culverts placed in the design; after a save in RoadEng, each written here keeps what RoadEng has no field for.
    let engineering = {
      ...mapped.engineering,
      culverts: [
        ...mapped.engineering.culverts,
        ...(read.pgmaps ? carryWrittenCulvertFields(road.culverts, read.pgmaps.engineering) : road.culverts),
      ],
    }
    if (text) {
      const storedResults = readRoadEngStoredResults(text.dsn, unitM)
      const haul = roadEngHaulFor(
        {
          dsnText: text.dsn,
          ds2Text: text.ds2,
          ...(firstPart && read.part !== firstPart ? { projectDsnText: texts.get(firstPart)?.dsn ?? '' } : {}),
        },
        { ...frame, unitM, materials: engineering.materials, costed: activeRoadEngSolution(storedResults) !== null },
      )
      // The Site Prep's stripped-ground disposal (`roadEngEngineeringFor`) stays with RoadEng's haul.
      const sidecastRanges = engineering.haul.sidecastRanges
      engineering = {
        ...engineering,
        materials: haul.materials,
        haul: sidecastRanges ? { ...haul.haul, sidecastRanges } : haul.haul,
        sites: haul.sites,
      }
      if (read.pgmaps) {
        const carried = applyRoadEngCostCarryover(engineering, read.pgmaps.costs, {
          lengthM: (read.endStation - read.startStation) * road.stationScale,
          validate: validateEngineering,
        })
        engineering = carried.engineering
        sectionNotes.push(...carried.notes)
      }
      fillRates.push(haul.fillRate)
      sectionNotes.push(...haul.notes)
      unmapped.push(...haul.unmapped)
      // RoadEng's own last costing, set beside the road's in Compare with RoadEng….
      const stored = roadEngStoredResultsNote(name, storedResults)
      if (stored) sectionNotes.push(stored)
    } else fillRates.push(null)
    let alignment: Alignment = {
      ...road.alignment,
      ...(mapped.template
        ? { template: mapped.template }
        : // A section kept from the open road or written here states its own slopes, as a RoadEng
          // slope not on AUTO does, unless it says otherwise.
          {
            template: { cutSlopeFrom: 'template', fillSlopeFrom: 'template', ...(written ?? road.alignment.template) },
          }),
      ...(mapped.curveDesign ? { curveDesign: mapped.curveDesign } : {}),
      engineering,
      vertical: road.alignment.vertical.map((v) => ({
        ...v,
        elevation: Math.round((v.elevation - depth) * 1000) / 1000,
      })),
    }
    if (text) {
      const optimizer = roadEngOptimizerFor(parseRoadEngOptimizer(text.dsn, unitM), {
        startStationM: read.startStation,
        endStationM: read.endStation,
        stationScale: road.stationScale,
        unitM,
        surfaceDepthM: depth,
        activeVertical: alignment.vertical,
      })
      alignment = applyRoadEngOptimizer(alignment, optimizer)
      sectionNotes.push(...optimizer.notes)
      unmapped.push(...optimizer.unmapped)
    }
    const disagreements = eventDisagreements(alignment, road)
    if (disagreements) sectionNotes.push(`${name}: ${disagreements}`)
    if (unmapped.length) sectionNotes.push(`Not carried over: ${[...new Set(unmapped)].join('; ')}.`)
    return { ...road, alignment: keep(alignment) }
  })
  const unusedSurveys = surveys.filter((f) => !usedSurveys.has(f) && isNativeTraverse(latin1Head(f)))
  if (unusedSurveys.length)
    sectionNotes.push(
      `${unusedSurveys.map((f) => f.name).join(', ')} ${unusedSurveys.length === 1 ? 'is' : 'are'} not the P-line the design names, so ${unusedSurveys.length === 1 ? 'it was' : 'they were'} not used. Load a traverse into the survey field book under Terrain.`,
    )
  // The fill rate is project-wide: taken only when every alignment's ground types give the same one.
  const fillRate =
    fillRates.length && fillRates.every((r) => r !== null && Math.abs(r - fillRates[0]!) < 1e-9) ? fillRates[0]! : null
  if (fillRates.length > 1 && fillRate === null && fillRates.some((r) => r !== null))
    sectionNotes.push(
      "The alignments' ground types give different embankment costs, so the fill rate is left as it was.",
    )
  // The summary names a terrain it did not read; here the terrain was read, or its absence is said above.
  const summaryDesign = design ? { ...design, terrain: null } : null
  const roadNotes = [
    ...(summaryDesign ? roads.map((road) => roadEngImportSummary(road, summaryDesign)) : []),
    ...sectionNotes,
  ]
  notes.push(...roadNotes)

  // Ground.
  let terrain: TerrainMetadata
  const verticalReference = options.verticalReference.trim() || 'Not stated'
  const sha256 = (terrainFile && options.sha256Of?.(terrainFile)) || '0'.repeat(64)
  const grid = (xyM: XY): XY => (localPlane ? [xyM[0] - localPlane.offsetM[0], xyM[1] - localPlane.offsetM[1]] : xyM)
  const tin = archive?.terrain.tin
  if (archive && tin && tin.triangles.length) {
    const coords = new Float64Array(tin.coords.length),
      z = new Float64Array(tin.z.length)
    for (let i = 0; i < tin.z.length; i++) {
      const [x, y] = grid([m(tin.coords[i * 2]), m(tin.coords[i * 2 + 1])])
      coords[i * 2] = x
      coords[i * 2 + 1] = y
      z[i] = m(tin.z[i])
    }
    // Half the TIN's median edge (the one its facts state, `tinGround.ts`), so the grid keeps what
    // its densest points say; rasterizeTin coarsens it only as far as the cell limit needs.
    const edge = tinMedianEdge(coords, tin.triangles)
    const ground = rasterizeTin(
      { coords, z, triangles: tin.triangles, cloudPoints: tin.z.length, totalPoints: tin.z.length },
      {
        cellM: Math.max(ROADENG_TERRAIN_MIN_CELL_M, Number.isFinite(edge) ? edge / 2 : 0),
        maxEdgeM: Number.MAX_VALUE,
      },
    )
    const raster: LocalRaster = {
      id: `terrain-${sha256.slice(0, 16)}`,
      name: `${terrainFile!.name} (RoadEng TIN)`.slice(0, 200),
      kind: 'terrain',
      epsg,
      origin: ground.origin,
      pixelSize: ground.pixelSize,
      width: ground.width,
      height: ground.height,
      values: ground.values,
      acquired: '',
      verticalReference,
      sha256,
    }
    // The TIN itself is kept as the ground analysis reads (`tinGround.ts`): sections, the profile
    // and quantities take its facets, and the grid is what the plan draws. A TIN past what a project
    // keeps is read through the grid alone.
    const preparation = roadEngTinPreparation(coords, z, tin.triangles, {
      name: terrainFile!.name,
      sha256,
      epsg,
      verticalReference,
      gridCellM: ground.cellM,
    })
    terrain = {
      kind: 'geotiff',
      name: raster.name,
      resolutionM: ground.cellM,
      verticalReference,
      epsg,
      sha256,
      raster,
      ...(preparation ? { preparation } : {}),
      ...(localPlane ? { localPlane } : {}),
    }
    const triangleCount = (tin.triangles.length / 3).toLocaleString('en-CA')
    notes.push(
      preparation
        ? `Its ground is RoadEng's TIN, ${triangleCount} triangles: sections, the profile, quantities, drainage and the plan read its facets (median edge ${Number(preparation.parameters.medianEdgeM).toFixed(1)} m), and a ${ground.cellM.toFixed(2)} m grid over its box is kept to write it back.`
        : `Its ground is RoadEng's TIN, ${triangleCount} triangles, on ${ground.cellM.toFixed(2)} m cells: it has more than the ${MAX_RETAINED_TIN_VERTICES.toLocaleString('en-CA')} points or ${(MAX_RETAINED_TIN_INDICES / 3).toLocaleString('en-CA')} triangles a project keeps, so sections read the grid.`,
    )
  } else {
    // No ground: a grid with no levels over what was read, so the plane has an extent.
    const points: XY[] = (design?.alignments ?? []).flatMap((a) => a.stations.map((s) => grid(s.xy)))
    if (archive) {
      const [x0, x1, y0, y1] = archive.terrain.bbox
      points.push(grid([m(x0), m(y0)]), grid([m(x1), m(y1)]))
    }
    if (points.length < 2) throw Error('Nothing in these files has a place: no alignment, no terrain points.')
    const xs = points.map((p) => p[0]),
      ys = points.map((p) => p[1])
    const pad = 50
    const raster: LocalRaster = {
      id: 'terrain-none',
      name: 'No terrain',
      kind: 'terrain',
      epsg,
      origin: [Math.min(...xs) - pad, Math.max(...ys) + pad],
      pixelSize: [Math.max(...xs) - Math.min(...xs) + 2 * pad, -(Math.max(...ys) - Math.min(...ys) + 2 * pad)],
      width: 2,
      height: 2,
      values: [null, null, null, null],
      acquired: '',
      verticalReference,
      sha256,
    }
    terrain = {
      kind: 'geotiff',
      name: 'No terrain',
      // As the project checks it: the larger side of a cell.
      resolutionM: Math.max(...raster.pixelSize.map(Math.abs)),
      verticalReference,
      epsg,
      sha256,
      raster,
      ...(localPlane ? { localPlane } : {}),
    }
    if (archive) notes.push('Its terrain holds no TIN, so the project has no ground.')
  }

  // What the terrain holds that the grid does not, kept to be written back, with any window layouts.
  const keptLayouts = layouts.slice(0, MAX_ROADENG_LAYOUTS).map((f) => ({
    name: f.name.replace(/\.ilt(\.ilt)?$/i, '').slice(0, 200) || 'Layout',
    text: readRoadEngLayout(f.bytes).text,
  }))
  if (layouts.length > MAX_ROADENG_LAYOUTS)
    notes.push(`${layouts.length - MAX_ROADENG_LAYOUTS} window layouts past ${MAX_ROADENG_LAYOUTS} are not kept.`)
  if (archive)
    terrain = {
      ...terrain,
      roadEngSource: { ...archive.source, ...(keptLayouts.length ? { layouts: keptLayouts } : {}) },
    }
  else if (keptLayouts.length)
    notes.push('Window layouts are kept with a terrain; with none chosen, they are not kept.')
  if (keptLayouts.length && archive)
    notes.push(
      `${keptLayouts.length === 1 ? 'Its window layout is' : `${keptLayouts.length} window layouts are`} kept and written back beside the terrain.`,
    )

  // Logging systems become rigging sets, linked to their D-lines by system number.
  const riggingSets: RiggingSet[] = []
  const systemSets = new Map<string, RiggingSet>()
  const cableNotes: string[] = []
  for (const system of (archive?.terrain.loggingSystems ?? []) as RoadEngLoggingSystem[]) {
    if (riggingSets.length >= MAX_RIGGING_SETS) {
      cableNotes.push(`Logging systems past ${MAX_RIGGING_SETS} are kept in the terrain and not made rigging sets.`)
      break
    }
    const made = roadEngLoggingSystemToRiggingSet(roadEngSystemFromDecoded(system), {
      id: roadEngSystemSetId(system.id),
    })
    if (!made.ok) {
      cableNotes.push(`${made.error} It stays in the terrain unchanged.`)
      continue
    }
    let name = made.set.name
    for (let n = 2; riggingSets.some((s) => s.name.toLowerCase() === name.toLowerCase()); n++)
      name = `${made.set.name} (${n})`
    const set: RiggingSet = { ...made.set, name, equipment: made.equipment }
    riggingSets.push(set)
    systemSets.set(system.id, set)
    cableNotes.push(...made.issues)
  }
  if (riggingSets.length)
    cableNotes.unshift(
      `${riggingSets.length === 1 ? 'Its logging system becomes a rigging set' : `Its ${riggingSets.length} logging systems become rigging sets`}: ${riggingSets.map((s) => s.name).join(', ')}.`,
    )

  // Map notes become pins.
  const importedAt = options.importedAt ?? new Date().toISOString()
  const mapNotes: MapNote[] = (archive?.terrain.mapNotes ?? []).slice(0, MAX_MAP_NOTES).map((note, k) => ({
    id: roadEngNoteId(k),
    kind: 'pin',
    points: [toLonLat([m(note.x), m(note.y)])],
    text: note.text.slice(0, 1000),
    color: MAP_NOTE_COLORS[5],
    createdAt: importedAt,
  }))
  if (mapNotes.length)
    cableNotes.push(
      `${mapNotes.length === 1 ? 'Its map note becomes a pin' : `Its ${mapNotes.length} map notes become pins`}.`,
    )

  // What was drawn, in every terrain given: a design can draw on background terrains too. They are
  // read in the same grid as the design's own terrain.
  const others = terrains.filter((t) => t !== terrainFile)
  const archives = [...(archive ? [archive] : []), ...others.map((t) => readRoadEngTerrainArchive(t.bytes))]
  const tables = archives.map((a): RoadEngSymbolTables | null => {
    if (!a.source.te1) return null
    try {
      return readRoadEngSymbolFile(base64ToBytes(a.source.te1))
    } catch {
      return null
    }
  })
  const layers = archives.length
    ? drawnLayers(
        archives.flatMap((a, k) =>
          a.terrain.features.map((feature) => ({ feature, layers: a.layers, from: k, tables: tables[k] })),
        ),
        roads,
        (xy) => toLonLat(xy),
        m,
        systemSets,
      )
    : null
  if (others.length) notes.push(`Drawn features were also read from ${others.map((t) => t.name).join(', ')}.`)
  if (layers) notes.push(...layers.notes)
  notes.push(...cableNotes)

  // RoadEng's own Terrain1.ter, to go back as read while nothing in it changes.
  let originalTer: RoadEngProject['originalTer'] = null
  if (archive && archive.ter.length <= MAX_ROADENG_ORIGINAL_TER_BYTES) {
    const objects: RoadEngOriginalRecord['objects'] = {}
    const track = (id: string, fingerprint: string, cls: unknown) => {
      const m = /^roadeng-0-(\d+)$/.exec(id)
      if (!m) return
      const index = Number(m[1])
      objects[id] = [
        index,
        fingerprint,
        archive.terrain.features[index]?.inTin ? 1 : 0,
        (typeof cls === 'string' ? cls : 'other') as RoadEngFeatureClass,
      ]
    }
    for (const feature of layers?.context ?? [])
      track(feature.id, roadEngObjectFingerprint({ type: 'context', feature }), feature.attributes?.roadEngClass)
    for (const feature of layers?.reference ?? [])
      track(feature.id, roadEngObjectFingerprint({ type: 'reference', feature }), feature.attributes?.roadEngClass)
    for (const feature of layers?.cables ?? [])
      track(feature.id, roadEngObjectFingerprint({ type: 'cable', feature }), 'd-line')
    originalTer = {
      bytes: archive.ter,
      record: {
        size: archive.ter.length,
        grid: roadEngTerrainGridFingerprint(terrain),
        unitM,
        features: archive.terrain.features.length,
        triangles: (archive.terrain.tin?.triangles.length ?? 0) / 3,
        classes: layers?.classes ?? {},
        objects,
      },
    }
  } else if (archive)
    notes.push(
      `Its Terrain1.ter is over ${MAX_ROADENG_ORIGINAL_TER_BYTES / 1e6} MB, so a RoadEng project written from here writes the grid as its ground.`,
    )
  // The archive's first line repeats what was read, and a terrain with no CRS is on the plane, said above.
  if (archive)
    notes.push(
      ...archive.warnings
        .slice(1)
        .filter(
          (w) =>
            localPlane === null ||
            !/names no coordinate system|states no coordinate system|, from RoadEng code /.test(w),
        ),
    )

  return {
    name: stem(designFile?.name ?? terrainFile!.name).slice(0, 120),
    epsg,
    localPlane,
    coordSys,
    roads,
    terrain,
    context: layers?.context ?? [],
    cables: layers?.cables ?? [],
    reference: layers?.reference ?? [],
    riggingSets,
    mapNotes,
    referenceStyles: layers?.styles ?? [],
    fillRate,
    notes,
    roadNotes,
    originalTer,
  }
}

/**
 * A RoadEng terrain's rigging sets, map notes and reference looks joined to an open project's: what
 * the terrain brings replaces what an earlier import of it left (same id or layer), and a set whose
 * name another set holds is renamed. Within the project's limits; what is over them is left out.
 */
export function mergeRoadEngParts(
  project: {
    riggingSets?: readonly RiggingSet[]
    notes?: readonly MapNote[]
    referenceStyles?: readonly ReferenceLayerStyle[]
  },
  imported: Pick<RoadEngProject, 'riggingSets' | 'mapNotes' | 'referenceStyles'>,
): { riggingSets?: RiggingSet[]; notes?: MapNote[]; referenceStyles?: ReferenceLayerStyle[] } {
  const out: { riggingSets?: RiggingSet[]; notes?: MapNote[]; referenceStyles?: ReferenceLayerStyle[] } = {}
  if (imported.riggingSets.length) {
    const ids = new Set(imported.riggingSets.map((s) => s.id))
    const sets = (project.riggingSets ?? []).filter((s) => !ids.has(s.id))
    for (const set of imported.riggingSets) {
      if (sets.length >= MAX_RIGGING_SETS) break
      let name = set.name
      for (let n = 2; sets.some((s) => s.name.toLowerCase() === name.toLowerCase()); n++) name = `${set.name} (${n})`
      sets.push({ ...set, name })
    }
    out.riggingSets = sets
  }
  if (imported.mapNotes.length) {
    const ids = new Set(imported.mapNotes.map((n) => n.id))
    out.notes = [...(project.notes ?? []).filter((n) => !ids.has(n.id)), ...imported.mapNotes].slice(0, MAX_MAP_NOTES)
  }
  if (imported.referenceStyles.length) {
    const layers = new Set(imported.referenceStyles.map((s) => s.layer))
    out.referenceStyles = [
      ...(project.referenceStyles ?? []).filter((s) => !layers.has(s.layer)),
      ...imported.referenceStyles,
    ]
  }
  return out
}

/**
 * Where RoadEng's flagged stations (`stationEvents`) disagree with the template ranges, ground
 * layers and pits read from the `.dsn`: each boundary read should have a flag within
 * {@link ROADENG_EVENT_MATCH_M}. Null when they agree, or when the design flags none of a kind.
 */
function eventDisagreements(alignment: Alignment, road: RoadEngRoad): string | null {
  const events = stationEvents(road.source)
  const length = (road.source.endStation - road.source.startStation) * road.stationScale
  const chainage = (station: number) => (station - road.source.startStation) * road.stationScale
  const inside = (c: number) => c > ROADENG_EVENT_MATCH_M && c < length - ROADENG_EVENT_MATCH_M
  const check = (label: string, ours: number[], flagged: number[]) => {
    if (!flagged.length) return null
    const theirs = flagged.map(chainage)
    const missing = [...new Set(ours.filter(inside).map((c) => Math.round(c * 10) / 10))].filter(
      (c) => !theirs.some((t) => Math.abs(t - c) <= ROADENG_EVENT_MATCH_M),
    )
    return missing.length
      ? `${label} at ${missing
          .slice(0, 5)
          .map((c) => `${c.toFixed(1)} m`)
          .join(', ')}${missing.length > 5 ? ` and ${missing.length - 5} more` : ''}`
      : null
  }
  const e = alignment.engineering
  const found = [
    check(
      'template-range changes',
      (e?.assignments ?? []).flatMap((a) => [a.start, a.end]),
      events.templateRanges,
    ),
    check(
      'ground-layer changes',
      (e?.strata ?? []).filter((a) => !isPLineStratum(a)).flatMap((a) => [a.start, a.end]),
      events.groundLayerRanges,
    ),
    check(
      'pits',
      (e?.sites ?? []).map((site) => site.chainage),
      events.pits,
    ),
  ].filter((x): x is string => x !== null)
  return found.length
    ? `RoadEng's calculated stations flag none of these read from its settings: ${found.join('; ')}. The settings are used; recalculate the design in RoadEng to compare.`
    : null
}

const LABEL: Partial<Record<RoadEngFeatureClass, string>> = {
  landing: 'Landing',
  'rock-bluff': 'Rock bluff',
  boundary: 'Boundary',
  breakline: 'Breakline',
  other: 'Feature',
}

/** Terrain features as the project objects that hold them, within the project's limits. */
function drawnLayers(
  features: readonly {
    feature: RoadEngTerrainFeature
    layers: RoadEngLayer[]
    from: number
    tables: RoadEngSymbolTables | null
  }[],
  roads: readonly RoadEngRoad[],
  toLonLat: (xyM: XY) => Coordinate,
  m: (v: number) => number,
  systemSets: ReadonlyMap<string, RiggingSet>,
) {
  const context: ContextFeature[] = [],
    cables: CableLine[] = [],
    reference: ReferenceFeature[] = []
  const styled: RoadEngStyledFeature[] = []
  let contextVertices = 0,
    referenceVertices = 0,
    terrainParts = 0,
    onAlignment = 0,
    leftOut = 0,
    bareDLines = 0,
    clamped = 0
  const stations = roads.flatMap((road) => road.source.stations.map((s) => s.xy))
  const byClass = new Map<string, number>()
  /** The first terrain's features by class, for the reference to its file. */
  const classes: Partial<Record<RoadEngFeatureClass, number>> = {}
  const lookLeft = new Set<string>()
  for (const { feature, layers, from, tables } of features) {
    const kind = classifyRoadEngFeature(feature, layers)
    if (from === 0) classes[kind] = (classes[kind] ?? 0) + 1
    const id = `roadeng-${from}-${feature.index}`
    if (kind === 'contour' || kind === 'source-contour' || kind === 'mass-points' || kind === 'tin-boundary') {
      terrainParts++
      continue
    }
    const xyM: XY[] = []
    for (let i = 0; i < feature.points.length; i += 3) xyM.push([m(feature.points[i]), m(feature.points[i + 1])])
    if (!xyM.length) continue
    const coords = xyM.map(toLonLat)
    const closed = feature.type === 'closed-line' || feature.type === 'polygon'
    const name = (feature.name || LABEL[kind] || 'Feature').slice(0, 200)
    const attributes = { roadEngClass: kind, ...(feature.attributes ?? {}) }
    if (kind === 'road' && stations.length && onRoad(xyM, stations)) {
      onAlignment++
      continue
    }
    const cable = kind === 'd-line' ? roadEngDLineCable(feature) : null
    if (kind === 'd-line' && !cable) bareDLines++
    let placed = false
    if ((kind === 'stream' || kind === 'road') && coords.length >= 2) {
      if (context.length < MAX_CONTEXT && contextVertices + coords.length <= MAX_CONTEXT_VERTICES) {
        context.push({
          id,
          name,
          kind: kind === 'stream' ? 'stream' : 'existing-road',
          attributes,
          geometry: { type: 'LineString', coordinates: coords },
        })
        contextVertices += coords.length
        placed = true
      }
    } else if (cable && feature.dLine) {
      if (cables.length < MAX_CABLES) {
        // PGMaps' D-line holds the yarder's height first wherever the yarder stands (`yarderAt`).
        const atEnd = cable.yarderAt === 'end'
        const height = (v: number) => {
          const h = m(v)
          if (h < 0 || h > 100) clamped++
          return Math.min(100, Math.max(0, h))
        }
        const deflection = Math.min(30, Math.max(0, cable.deflectionPercent))
        if (deflection !== cable.deflectionPercent) clamped++
        let line: CableLine = {
          id,
          name,
          start: toLonLat([m(cable.start[0]), m(cable.start[1])]),
          end: toLonLat([m(cable.end[0]), m(cable.end[1])]),
          startHeight: height(atEnd ? cable.endHeight : cable.startHeight),
          endHeight: height(atEnd ? cable.startHeight : cable.endHeight),
          deflectionPercent: deflection,
          ...(atEnd ? { yarderAt: 'end' as const } : {}),
          roadEng: feature.dLine,
          ...(cable.systemId !== null ? { roadEngSystemId: cable.systemId } : {}),
        }
        const set = cable.systemId !== null ? systemSets.get(cable.systemId) : undefined
        if (set) {
          line = applyRiggingSetToLine(line, set)
          line = {
            ...line,
            rigging: {
              ...line.rigging!,
              ...(cable.payloadKg !== null && cable.payloadKg > 0 ? { payloadKg: cable.payloadKg } : {}),
              ...(cable.clearanceM !== null && cable.clearanceM >= 0 ? { minClearanceM: cable.clearanceM } : {}),
            },
          }
        }
        cables.push(line)
        placed = true
      }
    } else if (kind === 'boundary' && closed && /fall/i.test(feature.name) && coords.length >= 4) {
      if (context.length < MAX_CONTEXT && contextVertices + coords.length <= MAX_CONTEXT_VERTICES) {
        context.push({
          id,
          name,
          kind: 'harvest',
          attributes,
          harvestEvidence: { source: 'user', status: 'proposed', yearMethod: 'unknown' },
          geometry: { type: 'Polygon', coordinates: [ring(coords)] },
        })
        contextVertices += coords.length
        placed = true
      }
    } else if (reference.length < MAX_REFERENCE && referenceVertices + coords.length <= MAX_REFERENCE_VERTICES) {
      const geometry: ReferenceFeature['geometry'] =
        coords.length === 1 || kind === 'landing'
          ? { type: 'Point', coordinates: kind === 'landing' && coords.length > 1 ? centroid(coords) : coords[0] }
          : closed && coords.length >= 4
            ? { type: 'Polygon', coordinates: [ring(coords)] }
            : { type: 'LineString', coordinates: coords }
      // The look RoadEng draws it in, and what writes that look back.
      const format = feature.formatChunk ? parseRoadEngFormatChunk(feature.formatChunk) : null
      const shape = referenceShape({ geometry })
      const look = roadEngFeatureLook(
        { shape, color: feature.color, format },
        { lineTypes: tables?.lineTypes ?? null, symbols: tables?.symbols ?? null },
      )
      for (const why of look.left) lookLeft.add(why)
      const layer = layers.find((l) => l.description && roadEngLayerMatches(l.pattern, feature.name))
      styled.push({
        id,
        group: layer?.description || LABEL[kind] || feature.name.split(/[\s-]/)[0] || 'Features',
        shape,
        look,
      })
      reference.push({
        id,
        name,
        geometry,
        attributes: {
          ...attributes,
          ...(feature.formatChunk ? { [ROADENG_FORMAT_ATTRIBUTE]: bytesToBase64(feature.formatChunk) } : {}),
          ...(feature.color !== null ? { [ROADENG_COLOR_ATTRIBUTE]: feature.color } : {}),
        },
        source: 'RoadEng terrain',
      })
      referenceVertices += geometry.type === 'Point' ? 1 : coords.length
      placed = true
    }
    if (placed) byClass.set(kind, (byClass.get(kind) ?? 0) + 1)
    else leftOut++
  }
  const looks = roadEngReferenceLayers(styled)
  for (const f of reference) f.source = looks.layerOf.get(f.id) ?? f.source
  const notes: string[] = []
  const count = (n: number) => n.toLocaleString('en-CA')
  const counted = [...byClass].map(([kind, n]) => `${count(n)} ${kind.replace('-', ' ')}${n === 1 ? '' : 's'}`)
  if (counted.length) notes.push(`Drawn features read: ${counted.join(', ')}.`)
  if (terrainParts)
    notes.push(
      `${count(terrainParts)} contours, point sets and boundaries make up its terrain and are not drawn as layers.`,
    )
  if (onAlignment)
    notes.push(`${onAlignment} road line${onAlignment === 1 ? ' is' : 's are'} an imported alignment and left out.`)
  if (bareDLines)
    notes.push(
      `${bareDLines === 1 ? '1 D-line has' : `${bareDLines} D-lines have`} no cable settings and ${bareDLines === 1 ? 'is a reference line' : 'are reference lines'}.`,
    )
  if (clamped)
    notes.push(`${clamped} D-line heights or deflections outside PGMaps' limits are set to the nearest limit.`)
  if (styled.length && looks.styles.length)
    notes.push(`Reference layers take RoadEng's colours, line types and symbols (${looks.styles.length} looks).`)
  if (lookLeft.size) notes.push(`Not carried over in their looks: ${[...lookLeft].slice(0, 5).join(' ')}`)
  notes.push(...looks.notes)
  if (leftOut) notes.push(`${leftOut} drawn features are over the project's layer limits and left out.`)
  return { context, cables, reference, styles: looks.styles, notes, classes }
}

/** Whether most of a line's points sit on an alignment's stations. */
function onRoad(line: readonly XY[], stations: readonly XY[]) {
  let on = 0
  for (const p of line)
    if (stations.some((s) => Math.abs(s[0] - p[0]) < ON_ALIGNMENT_M && Math.abs(s[1] - p[1]) < ON_ALIGNMENT_M)) on++
  return on >= 0.9 * line.length
}

/**
 * RoadEng's TIN as the terrain's ground (`preparation` with operation `roadeng-tin`), in the grid's
 * metres with coordinates and levels to the millimetre; null when it is past what a project keeps.
 */
function roadEngTinPreparation(
  coords: Float64Array,
  z: Float64Array,
  triangles: Uint32Array,
  source: { name: string; sha256: string; epsg: number; verticalReference: string; gridCellM: number },
): TerrainPreparationRecord | null {
  if (z.length > MAX_RETAINED_TIN_VERTICES || triangles.length > MAX_RETAINED_TIN_INDICES) return null
  const mm = (v: number) => Math.round(v * 1000) / 1000
  const kept = { coordinates: Array.from(coords, mm), elevations: Array.from(z, mm), triangles: Array.from(triangles) }
  const stats = tinStats(kept)
  return {
    operation: 'roadeng-tin',
    sources: [
      {
        name: source.name.slice(0, 200),
        sha256: source.sha256,
        epsg: source.epsg,
        verticalReference: source.verticalReference,
      },
    ],
    method: "RoadEng's TIN, read at its facets",
    parameters: {
      vertices: stats.vertices,
      triangles: stats.triangles,
      medianEdgeM: mm(stats.medianEdgeM),
      areaM2: Math.round(stats.areaM2),
      gridCellM: mm(source.gridCellM),
    },
    tin: kept,
  }
}

const ring = (coords: Coordinate[]) =>
  distance(coords[0], coords[coords.length - 1]) < 1e-6 ? coords : [...coords, coords[0]]
const centroid = (coords: Coordinate[]): Coordinate => [
  coords.reduce((s, c) => s + c[0], 0) / coords.length,
  coords.reduce((s, c) => s + c[1], 0) / coords.length,
]
