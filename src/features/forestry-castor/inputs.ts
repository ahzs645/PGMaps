// SPDX-License-Identifier: Apache-2.0
import type { Database, SqlJsStatic } from 'sql.js'
import type { FeatureCollection, Point, Polygon, MultiPolygon } from 'geojson'
import {
  CASTOR_IMPORT_LIMIT_BYTES,
  CASTOR_IMPORT_MAX_ROWS,
  castorProjectFromTables,
  inputNumber,
  inputValue,
} from './inputTables'
import type { CastorInputRow, CastorInputTables } from './inputTables'
import { DEFAULT_CASTOR_CONFIG } from './types'
import type { CastorConfig, CastorProject } from './types'
import { validateCastorProject } from './validation'

let browserSqlite: Promise<SqlJsStatic> | undefined
function loadSqlite(): Promise<SqlJsStatic> {
  browserSqlite ??= Promise.all([import('sql.js'), import('sql.js/dist/sql-wasm.wasm?url')])
    .then(([module, wasm]) => module.default({ locateFile: () => wasm.default }))
    .catch((error) => {
      browserSqlite = undefined
      throw error
    })
  return browserSqlite
}

export function castorConfig(project: CastorProject, override: Partial<CastorConfig> = {}): CastorConfig {
  return {
    ...DEFAULT_CASTOR_CONFIG,
    ...project.config,
    ...override,
    blockPriority:
      override.blockPriority ??
      project.config?.blockPriority ??
      DEFAULT_CASTOR_CONFIG.blockPriority.map((item) => ({ ...item })),
    uncertainty: { ...DEFAULT_CASTOR_CONFIG.uncertainty, ...project.config?.uncertainty, ...override.uncertainty },
  }
}

export function requireCastorProject(value: unknown, configOverride?: Partial<CastorConfig>): CastorProject {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('A Castor project must be a JSON object.')
  const project = value as CastorProject
  if (project.schema !== 'pgmaps-castor-project-v1') throw new Error('Expected a pgmaps-castor-project-v1 project.')
  for (const key of ['pixels', 'yieldCurves', 'constraints', 'harvestFlows', 'adjacency', 'landings'] as const) {
    if (!Array.isArray(project[key])) throw new Error(`Project ${key} must be an array.`)
  }
  if (!project.provenance || typeof project.provenance !== 'object' || !Array.isArray(project.provenance.notes))
    throw new Error('Project provenance and its notes array are required.')
  const config = castorConfig(project, configOverride)
  const validation = validateCastorProject(project, config)
  if (validation.errors.length)
    throw new Error(
      validation.errors
        .slice(0, 8)
        .map((item) => `${item.path}: ${item.message}`)
        .join('\n'),
    )
  return project
}

export function parseCastorProject(text: string): CastorProject {
  if (text.length > CASTOR_IMPORT_LIMIT_BYTES) throw new Error('Project JSON exceeds the 64 MB import limit.')
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('The selected file is not valid JSON.')
  }
  if (data && typeof data === 'object' && !Array.isArray(data) && 'project' in data)
    return requireCastorProject(data.project)
  return requireCastorProject(data)
}

/** RFC4180 CSV, including quoted newlines; bounded before table normalization. */
export function castorCsvRows(text: string): CastorInputRow[] {
  if (text.length > CASTOR_IMPORT_LIMIT_BYTES) throw new Error('CSV exceeds the 64 MB import limit.')
  const rows: string[][] = []
  let row: string[] = [],
    value = '',
    quoted = false,
    closed = false
  const source = text.replace(/^\uFEFF/, '')
  const finish = () => {
    row.push(value)
    value = ''
    closed = false
    if (row.some((cell) => cell !== '')) rows.push(row)
    row = []
    if (rows.length > CASTOR_IMPORT_MAX_ROWS + 1)
      throw new Error(`CSV exceeds ${CASTOR_IMPORT_MAX_ROWS.toLocaleString()} data rows.`)
  }
  for (let i = 0; i < source.length; i++) {
    const char = source[i]
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          value += '"'
          i++
        } else {
          quoted = false
          closed = true
        }
      } else value += char
    } else if (char === '"') {
      if (value || closed) throw new Error('A CSV quote must begin a field.')
      quoted = true
    } else if (char === ',') {
      row.push(value)
      value = ''
      closed = false
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && source[i + 1] === '\n') i++
      finish()
    } else {
      if (closed && char !== ' ' && char !== '\t') throw new Error('Unexpected text after a CSV closing quote.')
      if (!closed) value += char
    }
  }
  if (quoted) throw new Error('The CSV contains an unclosed quoted field.')
  finish()
  if (rows.length < 2) throw new Error('CSV needs a header and at least one row.')
  const headers = rows.shift()!.map((key) => key.trim())
  if (headers.some((key) => !key) || new Set(headers.map((key) => key.toLowerCase())).size !== headers.length)
    throw new Error('CSV headers must be nonempty and unique.')
  return rows.map((cells, index) => {
    if (cells.length !== headers.length)
      throw new Error(`CSV row ${index + 2} has ${cells.length} fields; expected ${headers.length}.`)
    return Object.fromEntries(headers.map((key, column) => [key, cells[column]]))
  })
}

const SQLITE_TABLES = [
  'pixels',
  'yields',
  'raster_info',
  'zone',
  'zoneConstraints',
  'blocks',
  'adjacentBlocks',
  'landings',
  'harvestFlow',
  'silvSystem',
  'transitions',
]
export function projectFromCastorDatabase(db: Database, name: string): CastorProject {
  db.run('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF;')
  const tables: CastorInputTables = {}
  const present = new Set(
    db
      .exec("SELECT name FROM sqlite_master WHERE type='table'")
      .flatMap((result) => result.values.map((row) => String(row[0]).toLowerCase())),
  )
  for (const name of SQLITE_TABLES) {
    if (!present.has(name.toLowerCase())) continue
    const statement = db.prepare(`SELECT * FROM "${name}" LIMIT ${CASTOR_IMPORT_MAX_ROWS + 1}`)
    const rows: CastorInputRow[] = []
    try {
      while (statement.step()) {
        // Preserve 64-bit identifiers; only exactly representable integers become numbers.
        const raw = (
          statement as unknown as {
            getAsObject(params: undefined, config: { useBigInt: true }): Record<string, unknown>
          }
        ).getAsObject(undefined, { useBigInt: true })
        rows.push(
          Object.fromEntries(
            Object.entries(raw).map(([key, value]) => [
              key,
              typeof value === 'bigint'
                ? value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)
                  ? Number(value)
                  : String(value)
                : value,
            ]),
          ),
        )
        if (rows.length > CASTOR_IMPORT_MAX_ROWS)
          throw new Error(`${name} exceeds the browser import row limit; no partial project was created.`)
      }
    } finally {
      statement.free()
    }
    tables[name] = rows
  }
  return requireCastorProject(castorProjectFromTables(tables, name, 'Local SQLite castordb'))
}

export async function importCastorSqlite(
  bytes: ArrayBuffer,
  name: string,
  runtime?: SqlJsStatic,
): Promise<CastorProject> {
  if (bytes.byteLength > CASTOR_IMPORT_LIMIT_BYTES)
    throw new Error('SQLite input exceeds the 64 MB import limit. Prepare a smaller area first.')
  if (new TextDecoder().decode(new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 16))) !== 'SQLite format 3\u0000')
    throw new Error('The selected file is not a SQLite 3 database.')
  const SQL = runtime ?? (await loadSqlite())
  const db = new SQL.Database(new Uint8Array(bytes))
  try {
    return projectFromCastorDatabase(db, name)
  } finally {
    db.close()
  }
}

function geoJsonRows(data: unknown): { rows: CastorInputRow[]; shapes: Map<number, Point | Polygon | MultiPolygon> } {
  if (
    !data ||
    typeof data !== 'object' ||
    (data as FeatureCollection).type !== 'FeatureCollection' ||
    !Array.isArray((data as FeatureCollection).features)
  )
    throw new Error('Inventory GeoJSON must be a FeatureCollection of points or polygons.')
  const features = (data as FeatureCollection).features
  if (features.length > CASTOR_IMPORT_MAX_ROWS) throw new Error('GeoJSON exceeds the browser inventory limit.')
  const shapes = new Map<number, Point | Polygon | MultiPolygon>()
  const rows = features.map((feature, index) => {
    if (
      !feature.properties ||
      !feature.geometry ||
      !['Point', 'Polygon', 'MultiPolygon'].includes(feature.geometry.type)
    )
      throw new Error(`GeoJSON feature ${index + 1} needs inventory properties and point/polygon geometry.`)
    const geometry = feature.geometry as Point | Polygon | MultiPolygon
    const coordinates =
      geometry.type === 'Point'
        ? [geometry.coordinates]
        : geometry.type === 'Polygon'
          ? geometry.coordinates.flat()
          : geometry.coordinates.flat(2)
    if (
      !coordinates.length ||
      coordinates.some(
        (xy) =>
          xy.length < 2 ||
          !Number.isFinite(xy[0]) ||
          !Number.isFinite(xy[1]) ||
          Math.abs(xy[0]) > 180 ||
          Math.abs(xy[1]) > 90,
      )
    )
      throw new Error(`GeoJSON feature ${index + 1} must use longitude/latitude WGS84 coordinates.`)
    const row: CastorInputRow = {
      ...feature.properties,
      id: inputValue(feature.properties, 'id', 'pixelId') ?? feature.id ?? index + 1,
    }
    const id = inputNumber(row.id, `Feature ${index + 1} ID`)
    if (shapes.has(id)) throw new Error(`GeoJSON contains duplicate pixel ID ${id}.`)
    shapes.set(id, geometry)
    return row
  })
  return { rows, shapes }
}

/** File reads remain local; SQLite Wasm is the only lazily fetched code asset. */
export async function importCastorFiles(files: File[]): Promise<CastorProject> {
  if (!files.length) throw new Error('Select a project JSON, SQLite database, or inventory and yield CSV files.')
  if (files.length > 20 || files.reduce((sum, file) => sum + file.size, 0) > CASTOR_IMPORT_LIMIT_BYTES)
    throw new Error('Import at most 20 files totalling 64 MB.')
  const sqlite = files.find((file) => /\.(sqlite|sqlite3|db)$/i.test(file.name))
  if (sqlite) {
    if (files.length !== 1)
      throw new Error('Import a SQLite database on its own. Add normalized data through a project JSON afterward.')
    return importCastorSqlite(await sqlite.arrayBuffer(), sqlite.name)
  }
  const tables: CastorInputTables = {}
  let shapes: Map<number, Point | Polygon | MultiPolygon> | undefined
  let metadata: Partial<CastorProject> = {}
  for (const file of files) {
    const source = await file.text()
    if (/\.(json|geojson)$/i.test(file.name)) {
      let data: unknown
      try {
        data = JSON.parse(source)
      } catch {
        throw new Error(`${file.name} is not valid JSON.`)
      }
      if (data && typeof data === 'object' && 'type' in data && data.type === 'FeatureCollection') {
        if (tables.pixels) throw new Error('Only one inventory file may be imported at a time.')
        const parsed = geoJsonRows(data)
        tables.pixels = parsed.rows
        shapes = parsed.shapes
      } else if (data && typeof data === 'object' && 'schema' in data && data.schema === 'pgmaps-castor-tables-v1') {
        const manifest = data as {
          grid?: CastorProject['grid']
          name?: string
          description?: string
          config?: Partial<CastorConfig>
        }
        if (manifest.grid) tables.grid = [manifest.grid as unknown as CastorInputRow]
        metadata = { name: manifest.name, description: manifest.description, config: manifest.config }
      } else {
        if (files.length !== 1)
          throw new Error(
            'Import a complete project/session JSON on its own; use a pgmaps-castor-tables-v1 manifest alongside CSV tables.',
          )
        return parseCastorProject(source)
      }
    } else if (/\.csv$/i.test(file.name)) {
      const rows = castorCsvRows(source)
      const stem = file.name
        .replace(/\.csv$/i, '')
        .toLowerCase()
        .replace(/_/g, '-')
      const aliases: Record<string, string> = {
        inventory: 'pixels',
        pixels: 'pixels',
        yields: 'yields',
        'yield-curves': 'yields',
        constraints: 'zoneConstraints',
        zoneconstraints: 'zoneConstraints',
        zone: 'zone',
        'harvest-flow': 'harvestFlow',
        harvestflow: 'harvestFlow',
        flows: 'harvestFlow',
        blocks: 'blocks',
        adjacency: 'adjacentBlocks',
        adjacentblocks: 'adjacentBlocks',
        landings: 'landings',
        grid: 'grid',
        'raster-info': 'raster_info',
        silvsystem: 'silvSystem',
        transitions: 'transitions',
      }
      const key = aliases[stem]
      if (!key)
        throw new Error(
          `Unrecognized table ${file.name}. Use inventory.csv, yields.csv, constraints.csv, harvest-flow.csv, adjacency.csv, landings.csv, or grid.csv.`,
        )
      if (tables[key]) throw new Error(`Duplicate ${key} table in selected files.`)
      tables[key] = rows
    } else throw new Error(`Unsupported file ${file.name}. Import JSON, CSV, GeoJSON, or a SQLite database.`)
  }
  const project = castorProjectFromTables(tables, metadata.name ?? files[0].name)
  if (metadata.description) project.description = metadata.description
  if (metadata.config) project.config = { ...project.config, ...metadata.config }
  if (shapes) {
    for (const pixel of project.pixels) pixel.geometry = shapes.get(pixel.id)
    project.provenance.notes.push(
      'GeoJSON geometry is preserved in WGS84. Inventory areaHa/thlbHa values are explicit inputs; geographic polygon area is not silently substituted. GeoTIFF exports require a separately supplied regular grid.',
    )
  }
  return requireCastorProject(project)
}

export function createExampleProject(): CastorProject {
  const width = 12,
    height = 8,
    cellSize = 100
  const grid = { width, height, cellSize, originX: 1170000, originY: 844000, crs: 'EPSG:3005' }
  const pixels: CastorProject['pixels'] = Array.from({ length: width * height }, (_, index) => {
    const column = index % width,
      row = Math.floor(index / width)
    const age = 35 + ((index * 17) % 150)
    return {
      id: index + 1,
      blockId: `B${Math.floor(row / 2) * 6 + Math.floor(column / 2) + 1}`,
      compartment: column < width / 2 ? 'west' : 'east',
      areaHa: 1,
      thlbHa: row === 0 ? 0 : 1,
      owned: true,
      age,
      volume: Math.max(0, (age - 20) * 3),
      height: Math.min(35, age * 0.22),
      eca: Math.max(0, 1 - age / 80),
      distance: 200 + column * 100,
      salvageVolume: index % 13 === 0 ? 60 : 0,
      curveId: 'natural',
      managedCurveId: 'managed',
      gridIndex: index,
      x: grid.originX + (column + 0.5) * cellSize,
      y: grid.originY - (row + 0.5) * cellSize,
      zones: { watershed: column < width / 2 ? 'west' : 'east', reserve: row === 0 ? 'protected' : 'working' },
    }
  })
  const blockIds = [...new Set(pixels.map((pixel) => pixel.blockId))]
  const adjacency: Array<[string, string]> = []
  for (let row = 0; row < 4; row++)
    for (let column = 0; column < 6; column++) {
      const id = row * 6 + column + 1
      if (column < 5) adjacency.push([`B${id}`, `B${id + 1}`])
      if (row < 3) adjacency.push([`B${id}`, `B${id + 6}`])
    }
  return {
    schema: 'pgmaps-castor-project-v1',
    name: 'Illustrative forest planning landscape',
    description:
      'A fabricated 96 ha landscape for learning the workflow. Locations, stand attributes, yield curves, constraints and targets are illustrative.',
    provenance: {
      source: 'PGMaps synthetic demonstration',
      synthetic: true,
      notes: [
        'No operational inventory or locally calibrated growth data are represented. Example coordinates use the upstream tutorial grid origin only to demonstrate map and export behavior.',
      ],
    },
    pixels,
    grid,
    adjacency,
    landings: blockIds.map((blockId) => ({ blockId, pixelId: pixels.find((pixel) => pixel.blockId === blockId)!.id })),
    yieldCurves: ['natural', 'managed'].map((id) => ({
      id,
      points: Array.from({ length: 36 }, (_, i) => ({
        age: i * 10,
        volume: Math.min(id === 'managed' ? 600 : 500, Math.max(0, (i * 10 - 20) * (id === 'managed' ? 3.8 : 3))),
        height: Math.min(35, i * 2.2),
        eca: Math.max(0, 1 - i / 8),
      })),
    })),
    constraints: [
      { id: 'reserve', zone: 'reserve', zoneId: 'protected', type: 'nh' },
      {
        id: 'west-old',
        zone: 'watershed',
        zoneId: 'west',
        type: 'ge',
        variable: 'age',
        threshold: 120,
        percentage: 20,
      },
      { id: 'east-eca', zone: 'watershed', zoneId: 'east', type: 'le', variable: 'eca', threshold: 30, percentage: 30 },
    ],
    harvestFlows: Array.from({ length: 8 }, (_, index) => ({
      id: `flow-${index + 1}`,
      compartment: index % 2 ? 'east' : 'west',
      period: Math.floor(index / 2) + 1,
      targetM3: 1200,
      type: 'live' as const,
    })),
    config: {
      ...DEFAULT_CASTOR_CONFIG,
      scenario: 'Illustrative management',
      periods: 4,
      stepYears: 5,
      startYear: 2025,
      minimumHarvestAge: 60,
      initializeFromYield: true,
      growingStockRetention: 0.3,
    },
  }
}
