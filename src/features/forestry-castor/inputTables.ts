// SPDX-License-Identifier: Apache-2.0
import { CASTOR_COLUMN_FIELDS, parseLegacyPredicate } from './legacyPredicates'
import { interpolateYield } from './growth'
import { DEFAULT_CASTOR_CONFIG } from './types'
import type {
  CastorConstraint,
  CastorGrid,
  CastorHarvestFlow,
  CastorPixel,
  CastorProject,
  CastorTreatment,
  CastorYieldCurve,
} from './types'

export type CastorInputRow = Record<string, unknown>
export type CastorInputTables = Record<string, CastorInputRow[]>
export const CASTOR_IMPORT_LIMIT_BYTES = 64 * 1024 * 1024
export const CASTOR_IMPORT_MAX_ROWS = 200_000
export const CASTOR_SOURCE_SHA = 'e2a580eb1fcc634780bb3599da7265a1e871484f'
export const CASTOR_SAMPLE_SHA256 = '8d19a48acba51de568d6994b8b41c0d9b6d3533aa6ea8c7a0e3cd95afe23535d'

export function inputValue(row: CastorInputRow, ...keys: string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key)) return row[key]
    const found = Object.keys(row).find((item) => item.toLowerCase() === key.toLowerCase())
    if (found !== undefined) return row[found]
  }
  return undefined
}
export function inputNumber(value: unknown, label: string, fallback?: number): number {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback
    throw new Error(`${label} is required; missing values are not interpreted as zero.`)
  }
  if (
    typeof value !== 'number' &&
    (typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()))
  ) {
    throw new Error(`${label} must be a finite decimal number.`)
  }
  const result = Number(value)
  if (!Number.isFinite(result)) throw new Error(`${label} must be finite.`)
  return result
}
function text(value: unknown, label: string, fallback?: string): string {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback
    throw new Error(`${label} is required.`)
  }
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error(`${label} must be text or a number.`)
  return String(value)
}
function flag(value: unknown, label: string, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') return fallback
  if (value === true || value === 1 || value === '1' || value === 'true') return true
  if (value === false || value === 0 || value === '0' || value === 'false') return false
  throw new Error(`${label} must be true/false or 1/0.`)
}
function optionalNumber(value: unknown, label: string): number | undefined {
  return value === undefined || value === null || value === '' ? undefined : inputNumber(value, label)
}
function table(tables: CastorInputTables, ...names: string[]): CastorInputRow[] {
  for (const name of names) {
    const key = Object.keys(tables).find((key) => key.toLowerCase() === name.toLowerCase())
    if (key) return tables[key]
  }
  return []
}

export function castorGridFromTables(tables: CastorInputTables): CastorGrid | undefined {
  const rows = table(tables, 'raster_info', 'grid')
  if (!rows.length) return undefined
  const row = rows.find((row) => inputValue(row, 'name') === 'ras') ?? rows[0]
  const width = inputNumber(inputValue(row, 'width'), 'Grid width', Number.NaN)
  if (Number.isFinite(width))
    return {
      width,
      height: inputNumber(inputValue(row, 'height'), 'Grid height'),
      originX: inputNumber(inputValue(row, 'originX'), 'Grid originX'),
      originY: inputNumber(inputValue(row, 'originY'), 'Grid originY'),
      cellSize: inputNumber(inputValue(row, 'cellSize'), 'Grid cellSize'),
      crs: text(inputValue(row, 'crs'), 'Grid CRS'),
    }
  const height = inputNumber(inputValue(row, 'nrow'), 'raster_info.nrow')
  const count = inputNumber(inputValue(row, 'ncell'), 'raster_info.ncell')
  const xmin = inputNumber(inputValue(row, 'xmin'), 'raster_info.xmin')
  const xmax = inputNumber(inputValue(row, 'xmax'), 'raster_info.xmax')
  const ymin = inputNumber(inputValue(row, 'ymin'), 'raster_info.ymin')
  const ymax = inputNumber(inputValue(row, 'ymax'), 'raster_info.ymax')
  const columns = count / height
  const cellSize = (xmax - xmin) / columns
  if (
    !Number.isInteger(columns) ||
    columns < 1 ||
    height < 1 ||
    Math.abs((ymax - ymin) / height - cellSize) > 1e-6 ||
    cellSize <= 0
  ) {
    throw new Error('Castor raster metadata must describe a square, north-up grid with valid dimensions.')
  }
  const crs = text(inputValue(row, 'crs'), 'raster_info.crs')
  return {
    width: columns,
    height,
    originX: xmin,
    originY: ymax,
    cellSize,
    crs: /^\d+$/.test(crs) ? `EPSG:${crs}` : crs,
  }
}

/** Converts only known table meanings; unsupported legacy logic fails explicitly. */
export function castorProjectFromTables(
  tables: CastorInputTables,
  name: string,
  source = 'Local Castor tables',
): CastorProject {
  const notes: string[] = []
  const grid = castorGridFromTables(tables)
  const inventory = table(tables, 'pixels', 'inventory')
  if (!inventory.length) throw new Error('The import needs a pixels or inventory table.')
  if (inventory.length > CASTOR_IMPORT_MAX_ROWS)
    throw new Error(`Inventory exceeds ${CASTOR_IMPORT_MAX_ROWS.toLocaleString()} rows.`)
  const legacy = inventory.some((row) => inputValue(row, 'pixelid') !== undefined)
  if (legacy && (!grid || Math.abs(grid.cellSize - 100) > 1e-6)) {
    throw new Error(
      'Legacy castordb import requires its 100 m raster_info grid: upstream THLB and volume calculations assume one-hectare cells. Convert other grids to explicit areaHa/thlbHa project JSON first.',
    )
  }
  const curves = new Map<string, CastorYieldCurve>()
  for (const row of table(tables, 'yields', 'yieldCurves')) {
    const id = text(inputValue(row, 'curveId', 'yieldid'), 'Yield curve ID')
    let curve = curves.get(id)
    if (!curve) {
      curve = { id, points: [] }
      curves.set(id, curve)
    }
    curve.points.push({
      age: inputNumber(inputValue(row, 'age'), `Yield ${id} age`),
      volume: inputNumber(inputValue(row, 'volume', 'tvol'), `Yield ${id} volume`),
      height: inputNumber(inputValue(row, 'height'), `Yield ${id} height`),
      eca: optionalNumber(inputValue(row, 'eca'), `Yield ${id} eca`),
      basalArea: optionalNumber(inputValue(row, 'basalArea', 'basalarea'), `Yield ${id} basalArea`),
      crownClosure: optionalNumber(inputValue(row, 'crownClosure', 'crownclosure'), `Yield ${id} crownClosure`),
      deciduousPercent: optionalNumber(inputValue(row, 'deciduousPercent', 'dec_pcnt'), `Yield ${id} deciduousPercent`),
      qmd: optionalNumber(inputValue(row, 'qmd'), `Yield ${id} qmd`),
    })
  }
  for (const curve of curves.values()) curve.points.sort((a, b) => a.age - b.age)
  const zoneRows = table(tables, 'zone')
  const zoneColumns = zoneRows.map((row) => text(inputValue(row, 'zone_column'), 'Zone column'))
  if (!zoneColumns.length) {
    for (const key of Object.keys(inventory[0]))
      if (/^zone\d+$/.test(key) || key.startsWith('zone:')) zoneColumns.push(key)
  }
  let missingBlocks = 0
  let missingVolume = 0
  const pixels: CastorPixel[] = inventory.map((row, index) => {
    const id = inputNumber(inputValue(row, 'id', 'pixelid'), `Inventory row ${index + 1} ID`)
    const label = `Pixel ${id}`
    const initialConstraint = inputNumber(inputValue(row, 'zone_const'), `${label} zone_const`, 0)
    if (initialConstraint !== 0 && initialConstraint !== 1)
      throw new Error(
        `${label} has an unsupported zone_const value. Map permanent exclusions to explicit no-harvest constraints before importing.`,
      )
    const gridIndex =
      optionalNumber(inputValue(row, 'gridIndex', 'grid_index'), `${label} gridIndex`) ?? (legacy ? id - 1 : undefined)
    const cellArea = grid ? grid.cellSize ** 2 / 10000 : undefined
    const areaHa = inputNumber(inputValue(row, 'areaHa', 'area_ha'), `${label} areaHa`, cellArea)
    const thlbHa = inputNumber(inputValue(row, 'thlbHa', 'thlb_ha', 'thlb'), `${label} thlbHa`)
    const curveId = inputValue(row, 'curveId', 'yieldid')
    const rawVolume = inputValue(row, 'volume', 'vol')
    const rawHeight = inputValue(row, 'height')
    const age = inputNumber(inputValue(row, 'age'), `${label} age`)
    const missingInitialVolume = rawVolume === null || rawVolume === undefined || rawVolume === ''
    if (
      (rawVolume === null || rawVolume === undefined || rawVolume === '') &&
      (curveId === null || curveId === undefined || !curves.has(String(curveId)))
    ) {
      throw new Error(`${label} needs observed volume or a valid yield curve for initialization.`)
    }
    if (missingInitialVolume) missingVolume++
    const curve = curves.get(String(curveId))
    const derived = curve ? interpolateYield(curve, age) : undefined
    const managedCurve = inputValue(row, 'managedCurveId', 'yieldid_trans')
    const blockId = inputValue(row, 'blockId', 'blockid')
    if (blockId === null || blockId === undefined || blockId === '') missingBlocks++
    const zones: Record<string, string> = Object.create(null) as Record<string, string>
    for (const column of zoneColumns) {
      const value = inputValue(row, column)
      if (value !== undefined && value !== null && value !== '') zones[column.replace(/^zone:/, '')] = String(value)
    }
    const attributes: CastorPixel['attributes'] = Object.create(null) as CastorPixel['attributes']
    const modelFields = new Set([
      'id',
      'blockId',
      'compartment',
      'areaHa',
      'thlbHa',
      'owned',
      'age',
      'volume',
      'height',
      'eca',
      'distance',
      'salvageVolume',
      'curveId',
      'managedCurveId',
      'treatmentId',
      'basalArea',
      'crownClosure',
      'deciduousPercent',
      'qmd',
      'elevation',
      'x',
      'y',
      'gridIndex',
      'zones',
      'attributes',
      'geometry',
      'culminationVolume',
    ])
    const knownLegacy = new Set([...Object.keys(CASTOR_COLUMN_FIELDS), 'silvsystem', 'zone_const'])
    for (const [rawKey, value] of Object.entries(row)) {
      const key = knownLegacy.has(rawKey.toLowerCase()) ? rawKey.toLowerCase() : rawKey
      if (modelFields.has(key)) continue
      if (typeof value === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()))
        attributes![key] = inputNumber(value, `${label} ${key}`)
      else if (['string', 'number', 'boolean'].includes(typeof value) || value === null)
        attributes![key] = value as string | number | boolean | null
    }
    const x =
      optionalNumber(inputValue(row, 'x'), `${label} x`) ??
      (grid && gridIndex !== undefined ? grid.originX + ((gridIndex % grid.width) + 0.5) * grid.cellSize : undefined)
    const y =
      optionalNumber(inputValue(row, 'y'), `${label} y`) ??
      (grid && gridIndex !== undefined
        ? grid.originY - (Math.floor(gridIndex / grid.width) + 0.5) * grid.cellSize
        : undefined)
    return {
      id,
      blockId: text(blockId, `${label} blockId`, `pixel-${id}`),
      compartment: text(inputValue(row, 'compartment', 'compartid'), `${label} compartment`, 'all'),
      areaHa,
      thlbHa,
      owned: flag(inputValue(row, 'owned', 'own'), `${label} owned`, true),
      age,
      volume: inputNumber(rawVolume, `${label} volume`, derived?.volume),
      height: inputNumber(rawHeight, `${label} height`, derived?.height),
      eca: inputNumber(inputValue(row, 'eca'), `${label} ECA`, derived?.eca),
      distance: inputNumber(inputValue(row, 'distance', 'dist'), `${label} distance`),
      salvageVolume: inputNumber(inputValue(row, 'salvageVolume', 'salvage_vol'), `${label} salvageVolume`, 0),
      ...(curveId === undefined || curveId === null || curveId === '' ? {} : { curveId: String(curveId) }),
      ...(managedCurve == null || managedCurve === '' ? {} : { managedCurveId: String(managedCurve) }),
      basalArea: optionalNumber(inputValue(row, 'basalArea', 'basalarea'), `${label} basalArea`),
      crownClosure: optionalNumber(inputValue(row, 'crownClosure', 'crownclosure'), `${label} crownClosure`),
      deciduousPercent: optionalNumber(inputValue(row, 'deciduousPercent', 'dec_pcnt'), `${label} deciduousPercent`),
      qmd: optionalNumber(inputValue(row, 'qmd'), `${label} qmd`),
      elevation: optionalNumber(inputValue(row, 'elevation', 'elv'), `${label} elevation`),
      x,
      y,
      gridIndex,
      zones,
      attributes,
    }
  })
  if (missingBlocks)
    notes.push(
      `${missingBlocks} pixels had no block ID. Separate pixel planning units were assigned; these are not operational harvest blocks. Supply real blocks and adjacency before block-level planning.`,
    )
  if (missingVolume)
    notes.push(
      `${missingVolume} missing initial volumes were filled from the supplied yield curves; observed volumes are preserved. When all volumes were missing, yield initialization is enabled by default. At the last yield knot, the browser holds the final known value instead of propagating the upstream missing next-knot value.`,
    )
  if (legacy)
    notes.push(
      'Legacy THLB values are interpreted as hectares on the required 100 m one-hectare grid. Original pixel attributes are retained.',
    )
  const constraints: CastorConstraint[] = table(tables, 'zoneConstraints', 'constraints').map((row, index) => {
    const reference = inputValue(row, 'reference_zone')
    const zone =
      inputValue(row, 'zone', 'zone_column') ??
      inputValue(zoneRows.find((z) => inputValue(z, 'reference_zone') === reference) ?? {}, 'zone_column')
    const type = text(inputValue(row, 'type'), `Constraint ${index + 1} type`)
    if (!['nh', 'ge', 'le'].includes(type)) throw new Error(`Unsupported Castor constraint type ${type}.`)
    const rawVariable = inputValue(row, 'variable')
    const variable =
      typeof rawVariable === 'string' ? (CASTOR_COLUMN_FIELDS[rawVariable.toLowerCase()] ?? rawVariable) : undefined
    const rawCondition = inputValue(row, 'multi_condition', 'condition')
    const condition =
      typeof rawCondition === 'object' && rawCondition !== null
        ? (rawCondition as CastorConstraint['condition'])
        : parseLegacyPredicate(rawCondition)
    return {
      id: text(inputValue(row, 'id'), 'Constraint ID', `constraint-${index + 1}`),
      zone: text(zone, `Constraint ${index + 1} zone`).replace(/^zone:/, ''),
      zoneId: text(inputValue(row, 'zoneId', 'zoneid'), `Constraint ${index + 1} zone ID`),
      type: type as CastorConstraint['type'],
      variable: variable === 'multi' ? undefined : variable,
      threshold: optionalNumber(inputValue(row, 'threshold'), 'Constraint threshold'),
      percentage: optionalNumber(inputValue(row, 'percentage'), 'Constraint percentage'),
      condition,
      denominator: parseLegacyPredicate(inputValue(row, 'denom'), true),
      startYear: optionalNumber(inputValue(row, 'startYear', 'start'), 'Constraint start'),
      stopYear: optionalNumber(inputValue(row, 'stopYear', 'stop'), 'Constraint stop'),
    }
  })
  const harvestFlows: CastorHarvestFlow[] = table(tables, 'harvestFlow', 'harvestFlows', 'harvest-flow', 'flows').map(
    (row, index) => {
      const type = text(inputValue(row, 'type', 'partition_type'), 'Harvest flow type', 'live')
      if (!['live', 'dead', 'salvage'].includes(type)) throw new Error(`Unknown harvest flow type ${type}.`)
      return {
        id: text(inputValue(row, 'id'), 'Harvest flow ID', `flow-${index + 1}`),
        compartment: text(inputValue(row, 'compartment', 'compartid'), 'Harvest flow compartment'),
        period: inputNumber(inputValue(row, 'period'), 'Harvest flow period'),
        targetM3: inputNumber(inputValue(row, 'targetM3', 'flow'), 'Harvest flow target m³ per period'),
        type: type === 'live' ? 'live' : 'salvage',
        condition: parseLegacyPredicate(inputValue(row, 'partition')),
      }
    },
  )
  const adjacency: Array<[string, string]> = table(tables, 'adjacentBlocks', 'adjacency').map((row) => [
    text(inputValue(row, 'blockId', 'blockid', 'from'), 'Adjacent block ID'),
    text(inputValue(row, 'adjblockid', 'to'), 'Adjacent neighbour ID'),
  ])
  const landings = table(tables, 'landings', 'blocks')
    .filter((row) => inputValue(row, 'pixelId', 'landing') != null)
    .map((row) => ({
      blockId: text(inputValue(row, 'blockId', 'blockid'), 'Landing block ID'),
      pixelId: inputNumber(inputValue(row, 'pixelId', 'landing'), 'Landing pixel ID'),
    }))
  const silv = table(tables, 'silvSystem')
  const activePartial = pixels.filter((p) => Number(p.attributes?.silvsystem ?? 0) > 1)
  const treatments: CastorTreatment[] = []
  const transitions = table(tables, 'transitions')
  const builtTreatments = new Set<string>()
  const makeTreatment = (systemId: number, targetCurveId: string | undefined): string => {
    const treatmentId = `legacy-silv-${systemId}-curve-${targetCurveId ?? 'missing'}`
    if (builtTreatments.has(treatmentId)) return treatmentId
    const options = silv.filter((row) => inputNumber(inputValue(row, 'silvsystem'), 'silvSystem ID') === systemId)
    if (options.length !== 1 || !targetCurveId || !curves.has(targetCurveId))
      throw new Error(
        `Partial-cut system ${systemId} requires one explicit silvSystem definition and a supplied post-treatment yield curve. Import normalized project JSON if the legacy transition is ambiguous.`,
      )
    const row = options[0]
    const legacyField = text(inputValue(row, 'entry_var'), 'Partial-cut entry field')
    const field = CASTOR_COLUMN_FIELDS[legacyField.toLowerCase()] ?? legacyField
    if (!['age', 'height', 'basalArea'].includes(field))
      throw new Error(
        `Unsupported partial-cut entry field ${legacyField}. Use a structured treatment condition in project JSON.`,
      )
    const nextSystem = inputNumber(inputValue(row, 'transition_silv'), 'Partial-cut next silvicultural system')
    const nextTransitions = transitions.filter((item) => String(inputValue(item, 'yieldid_from')) === targetCurveId)
    if (nextTransitions.length > 1)
      throw new Error(
        `Yield curve ${targetCurveId} has ambiguous legacy transitions. Specify the next curve and treatment explicitly in project JSON.`,
      )
    const nextCurve = nextTransitions.length
      ? text(inputValue(nextTransitions[0], 'yieldid_to'), 'Next managed yield curve')
      : targetCurveId
    if (!curves.has(nextCurve)) throw new Error(`Partial-cut next yield curve ${nextCurve} is missing.`)
    builtTreatments.add(treatmentId)
    const nextTreatmentId = nextSystem > 1 ? makeTreatment(nextSystem, nextCurve) : undefined
    const reset = inputNumber(inputValue(row, 'reset_age'), 'Partial-cut age-reset flag', 0)
    if (reset !== 0 && reset !== 1) throw new Error('Legacy reset_age must be 0 (retain age) or 1 (reset to zero).')
    treatments.push({
      id: treatmentId,
      method: 'curve-transition',
      condition: { field, op: 'ge', value: inputNumber(inputValue(row, 'entry_req'), 'Partial-cut entry threshold') },
      nextCurveId: targetCurveId,
      nextManagedCurveId: nextCurve,
      nextTreatmentId,
      nextSilviculturalSystem: nextSystem,
      ...(reset === 1 ? { resetAge: 0 } : {}),
      startYear: optionalNumber(inputValue(row, 'start'), 'Partial-cut start'),
      stopYear: optionalNumber(inputValue(row, 'stop'), 'Partial-cut stop'),
    })
    return treatmentId
  }
  for (const pixel of activePartial)
    pixel.treatmentId = makeTreatment(Number(pixel.attributes!.silvsystem), pixel.managedCurveId)
  if (activePartial.length)
    notes.push(
      `Imported ${activePartial.length} partial-cut cells using explicit entry rules and yield-curve transitions. The browser accounts for removed volume as pre-treatment minus post-treatment curve volume, completing an upstream TODO. Age is retained unless reset_age is explicitly 1; increasing-volume transitions are not harvested.`,
    )
  if (silv.length)
    notes.push(
      `${silv.length} upstream silvicultural-system definitions are present. Active partial-cut definitions were converted to explicit browser treatment records; inactive definitions are not applied automatically.`,
    )
  if (!harvestFlows.length)
    notes.push(
      'No harvest-flow targets were supplied. Set targets before running a harvest scenario; zero-target growth runs remain possible.',
    )
  return {
    schema: 'pgmaps-castor-project-v1',
    name,
    description: 'Imported forest planning inputs. Review source assumptions before simulation.',
    provenance: { source, notes },
    pixels,
    yieldCurves: [...curves.values()],
    constraints,
    harvestFlows,
    adjacency,
    landings,
    grid,
    treatments,
    config: {
      ...DEFAULT_CASTOR_CONFIG,
      initializeFromYield: missingVolume === pixels.length,
      harvestUnit: missingBlocks ? 'pixel' : 'block',
    },
  }
}
