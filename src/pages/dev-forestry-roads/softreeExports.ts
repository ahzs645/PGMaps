/**
 * The Softree files Save & export writes, assembled from a calculated road: RoadEng's Mass Haul and
 * Optimal Haul exports, the Softree Optimal Areas file and API inputs (`softreeHaulCsv.ts`), the
 * location ASCII staking file and the terrain ASCII file (`softreeAscii.ts`). The format rules live
 * in those modules; this one only chooses the inputs, the units and the file names, and says why an
 * output cannot be made.
 *
 * - **Units.** No Softree file states its units. A project opened from a RoadEng design in feet keeps
 *   that unit on its flat plane (`LocalPlacement.unitM`); every file is written in it
 *   ({@link softreeUnitM}), and in metres otherwise. The location file's unit can be changed in its
 *   options; the haul files follow the project.
 * - **Terrain ASCII.** Written from the features of the RoadEng terrain the RoadEng project export
 *   builds (`roadEngProjectExport.ts`, read back with `readRoadEngTerrainArchive`), so the ASCII file
 *   and the `.terx` hold the same ground points and drawn features, in the same grid and units.
 *
 * Checked by `softreeExports.test.ts` against a calculated road. Pure: no DOM or network access.
 */
import { unzipSync } from 'fflate'
import type { AlignmentEngineering } from './engineeringTypes'
import type { ToGrid } from './designExports'
import { readRoadEngTerrainArchive } from './roadEngTerrain'
import {
  SOFTREE_LOCATION_DEFAULT_LAYOUT,
  softreeLocationStationsFromAnalysis,
  writeSoftreeLocationAscii,
  writeSoftreeTerrainAscii,
  type SoftreeDelimiter,
} from './softreeAscii'
import {
  massHaulItemsFromAnalysis,
  optimalAreasFromAnalysis,
  optimalCostModelFromHaul,
  optimalHaulFromAnalysis,
  optimalMaterialCodes,
  optimalMaterialsFromDesign,
  optimalPitsFromSites,
  softreeUnitsForRoadEng,
  SOFTREE_FT_M,
  writeMassHaulCsv,
  writeOptimalAreasCsv,
  writeOptimalCostModelCsv,
  writeOptimalHaulCsv,
  writeOptimalMaterialsCsv,
  writeOptimalPitsCsv,
  type SoftreeUnits,
} from './softreeHaulCsv'
import type { Alignment, ResolvedTemplate, RoadAnalysis, RoadSettings, RoadTemplate, TerrainMetadata } from './types'

/** Metres per file unit for a project: its RoadEng plane's unit (feet or metres), else metres. */
export function softreeUnitM(terrain: Pick<TerrainMetadata, 'localPlane'>): number {
  const unitM = terrain.localPlane?.unitM
  if (unitM === undefined) return 1
  // A plane in US survey feet keeps its own foot.
  return Math.abs(unitM - SOFTREE_FT_M) < 1e-9 ? SOFTREE_FT_M : Math.abs(unitM - 1200 / 3937) < 1e-12 ? unitM : 1
}

/** The haul files' units for a project. */
export function softreeUnits(terrain: Pick<TerrainMetadata, 'localPlane'>): SoftreeUnits {
  return softreeUnitsForRoadEng(softreeUnitM(terrain))
}

/** RoadEng's Mass Haul export of the road. */
export function massHaulCsvFile(
  analysis: RoadAnalysis,
  engineering: AlignmentEngineering | undefined,
  units: SoftreeUnits,
): string {
  return writeMassHaulCsv(massHaulItemsFromAnalysis(analysis, engineering?.haul), { units })
}

/** RoadEng's Optimal Haul export of the road's solved material plan, and what it has no column for. */
export function optimalHaulCsvFile(
  analysis: RoadAnalysis,
  engineering: AlignmentEngineering | undefined,
  units: SoftreeUnits,
): { text: string; leftOut: string[] } {
  if (!engineering) throw Error('Turn on haul allocation first: the Optimal Haul export is the material plan.')
  const data = optimalHaulFromAnalysis(analysis, engineering)
  return { text: writeOptimalHaulCsv(data, { units }), leftOut: data.leftOut }
}

/** The Softree Optimal Areas file of the road, in the export grid. */
export function optimalAreasCsvFile(
  analysis: RoadAnalysis,
  engineering: AlignmentEngineering | undefined,
  toGrid: ToGrid,
  units: SoftreeUnits,
): string {
  return writeOptimalAreasCsv(optimalAreasFromAnalysis(analysis, engineering, { toGrid }), { units })
}

/** The Softree Optimal API inputs of the road: materials, pits and the haul cost model, one CSV each. */
export function optimalInputFiles(
  engineering: AlignmentEngineering | undefined,
  settings: Pick<RoadSettings, 'cutRate' | 'fillRate' | 'shrinkFactor'>,
  units: SoftreeUnits,
  stem: string,
): { path: string; content: string }[] {
  if (!engineering) throw Error('Set up the road’s ground materials and haul in Engineering first.')
  const codes = optimalMaterialCodes(engineering.materials)
  const materials = optimalMaterialsFromDesign(engineering.materials, {
    codes,
    embankmentRate: settings.fillRate,
    unclassified: { cutRate: settings.cutRate, compactionFactor: settings.shrinkFactor },
  })
  const pits = optimalPitsFromSites(engineering.sites, {
    codes,
    smart: engineering.haul.allocation === 'economic',
  })
  return [
    { path: `${stem}-optimal-materials.csv`, content: writeOptimalMaterialsCsv(materials, { units }) },
    { path: `${stem}-optimal-pits.csv`, content: writeOptimalPitsCsv(pits, { units }) },
    {
      path: `${stem}-optimal-cost-model.csv`,
      content: writeOptimalCostModelCsv(optimalCostModelFromHaul(engineering.haul), { units }),
    },
  ]
}

export interface LocationAsciiOptions {
  /** Metres per file unit. */
  unitM: number
  /** The road's first station, m (PGMaps' chainage starts at 0). */
  startStationM: number
  delimiter: SoftreeDelimiter
  /** RoadEng's *Single line per station*. */
  singleLine: boolean
}

/**
 * The road's calculated stations as a location ASCII coordinate file in the help's *All Surfaces*
 * layout: ground, prepared ground and the subgrade's named points, each station with its own template.
 */
export function locationAsciiFile(
  alignment: Pick<Alignment, 'template'>,
  analysis: Pick<RoadAnalysis, 'stations' | 'engineering'>,
  toGrid: ToGrid,
  options: LocationAsciiOptions,
): string {
  if (!(options.unitM > 0)) throw Error('Choose the file’s unit.')
  if (!Number.isFinite(options.startStationM)) throw Error('Enter the road’s start station.')
  if (!analysis.stations.length) throw Error('The road has no calculated stations yet.')
  const templates = new Map<number, RoadTemplate | ResolvedTemplate>(
    (analysis.engineering?.stations ?? []).map((s) => [s.chainage, s.template]),
  )
  const stations = analysis.stations.flatMap((station) =>
    softreeLocationStationsFromAnalysis([station], templates.get(station.chainage) ?? alignment.template, {
      toGrid,
      unitM: options.unitM,
      startStation: options.startStationM,
    }),
  )
  return writeSoftreeLocationAscii(stations, {
    ...SOFTREE_LOCATION_DEFAULT_LAYOUT,
    delimiter: options.delimiter,
    singleLine: options.singleLine,
  })
}

/**
 * A terrain ASCII file holding the features of the RoadEng terrain inside a zipped RoadEng project
 * (the `.terx` the RoadEng project export wrote): its ground point sets and drawn features.
 */
export function terrainAsciiFromRoadEngProject(projectZip: Uint8Array): { text: string; notes: string[] } {
  const entries = unzipSync(projectZip, { filter: (entry) => /\.terx$/i.test(entry.name) })
  const terx = Object.values(entries)[0]
  if (!terx) throw Error('The RoadEng project holds no terrain to write.')
  const { terrain } = readRoadEngTerrainArchive(terx)
  if (!terrain.features.length) throw Error('The terrain has no ground points or drawn features to write.')
  const written = writeSoftreeTerrainAscii(terrain.features)
  const points = terrain.features.reduce((sum, f) => sum + f.points.length / 3, 0)
  return {
    text: written.text,
    notes: [
      `${terrain.features.length.toLocaleString('en-CA')} features, ${points.toLocaleString('en-CA')} points.`,
      ...written.notes,
    ],
  }
}
