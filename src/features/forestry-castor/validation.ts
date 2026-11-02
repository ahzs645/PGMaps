import { DEFAULT_CASTOR_CONFIG, type CastorValidation, type CastorValidationIssue } from './types'

export const CASTOR_LIMITS = {
  pixels: 50_000,
  periods: 100,
  pixelPeriods: 2_000_000,
  harvestEvents: 250_000,
  flowCellVisits: 40_000_000,
  constraints: 200,
  constraintCellPeriods: 40_000_000,
  yieldCurves: 10_000,
  yieldPoints: 1_000,
  flows: 20_000,
  treatments: 200,
  scheduleEntries: 20_000,
  gridCells: 2_000_000,
  uncertaintyReplicates: 2_000,
  predicateDepth: 8,
  predicateNodes: 100,
  geometryCoordinates: 500_000,
} as const

const baseFields = new Set([
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
  'culminationVolume',
])
const unsafeKeys = new Set(['__proto__', 'constructor', 'prototype'])
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const string = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 500

/** Validates untrusted JSON without accessing nested fields before their shape is checked. */
export function validateCastorProject(project: unknown, config: unknown = DEFAULT_CASTOR_CONFIG): CastorValidation {
  const errors: CastorValidationIssue[] = []
  const warnings: string[] = []
  const fail = (path: string, message: string) => {
    if (errors.length < 100) errors.push({ path, message })
  }
  const number = (value: unknown, path: string, min = 0, max = Number.MAX_VALUE, integer = false) => {
    if (!finite(value) || value < min || value > max || (integer && !Number.isInteger(value)))
      fail(path, `Expected ${integer ? 'an integer' : 'a finite number'} between ${min} and ${max}.`)
  }
  const text = (value: unknown, path: string) => {
    if (!string(value)) fail(path, 'Expected a nonempty string of at most 500 characters.')
  }
  const metricCrs = (value: unknown, path: string) => {
    text(value, path)
    if (typeof value !== 'string') return
    const units = /(?:^|\s)\+units=([^\s]+)/i.exec(value)?.[1]
    const toMeter = /(?:^|\s)\+to_meter=([^\s]+)/i.exec(value)?.[1]
    if (
      (units && units.toLowerCase() !== 'm') ||
      (toMeter && Number(toMeter) !== 1) ||
      /4326|4269|4267|CRS:84|longlat|latlong/i.test(value)
    )
      fail(path, 'Projected coordinates and cell size must be declared in metres.')
  }
  const fields = new Set(baseFields)
  let geometryCoordinates = 0
  const geometry = (value: unknown, path: string): void => {
    if (!record(value)) {
      fail(path, 'Expected a WGS84 Point, Polygon, or MultiPolygon.')
      return
    }
    const position = (coordinates: unknown, positionPath: string): boolean => {
      geometryCoordinates++
      if (geometryCoordinates > CASTOR_LIMITS.geometryCoordinates) {
        if (geometryCoordinates === CASTOR_LIMITS.geometryCoordinates + 1)
          fail(path, 'Geometry coordinate budget exceeded.')
        return false
      }
      if (
        !Array.isArray(coordinates) ||
        coordinates.length < 2 ||
        coordinates.length > 3 ||
        coordinates.some((coordinate) => !finite(coordinate)) ||
        coordinates[0] < -180 ||
        coordinates[0] > 180 ||
        coordinates[1] < -90 ||
        coordinates[1] > 90
      ) {
        fail(positionPath, 'Expected finite WGS84 longitude/latitude coordinates within world bounds.')
        return false
      }
      return true
    }
    const polygon = (coordinates: unknown, polygonPath: string): void => {
      if (
        !Array.isArray(coordinates) ||
        !coordinates.length ||
        coordinates.length > CASTOR_LIMITS.geometryCoordinates
      ) {
        fail(polygonPath, 'A polygon requires a bounded, nonempty array of rings.')
        return
      }
      coordinates.forEach((ring, r) => {
        const ringPath = `${polygonPath}[${r}]`
        if (!Array.isArray(ring) || ring.length < 4 || ring.length > CASTOR_LIMITS.geometryCoordinates) {
          fail(ringPath, 'A linear ring requires at least four positions.')
          return
        }
        for (let j = 0; j < ring.length && geometryCoordinates <= CASTOR_LIMITS.geometryCoordinates; j++)
          position(ring[j], `${ringPath}[${j}]`)
        const first = ring[0]
        const last = ring[ring.length - 1]
        if (
          !Array.isArray(first) ||
          !Array.isArray(last) ||
          first.length !== last.length ||
          first.some((coordinate, j) => coordinate !== last[j])
        )
          fail(ringPath, 'Polygon rings must close at their first position.')
      })
    }
    if (value.type === 'Point') position(value.coordinates, `${path}.coordinates`)
    else if (value.type === 'Polygon') polygon(value.coordinates, `${path}.coordinates`)
    else if (value.type === 'MultiPolygon') {
      if (
        !Array.isArray(value.coordinates) ||
        !value.coordinates.length ||
        value.coordinates.length > CASTOR_LIMITS.geometryCoordinates
      )
        fail(path, 'A multipolygon requires a bounded, nonempty polygon array.')
      else value.coordinates.forEach((part, i) => polygon(part, `${path}.coordinates[${i}]`))
    } else fail(path, 'Only WGS84 Point, Polygon, and MultiPolygon geometry is supported.')
  }
  const predicate = (value: unknown, path: string, depth = 0, budget = { count: 0 }): void => {
    if (!record(value) || depth > CASTOR_LIMITS.predicateDepth || ++budget.count > CASTOR_LIMITS.predicateNodes) {
      fail(path, 'Invalid condition or condition complexity limit exceeded.')
      return
    }
    const variants = ['all', 'any', 'not', 'field'].filter((key) => Object.prototype.hasOwnProperty.call(value, key))
    if (variants.length !== 1) {
      fail(path, 'Use exactly one of all, any, not, or field.')
      return
    }
    if (variants[0] === 'all' || variants[0] === 'any') {
      const children = value[variants[0]]
      if (!Array.isArray(children) || children.length === 0 || children.length > CASTOR_LIMITS.predicateNodes) {
        fail(path, 'Compound conditions require a bounded, nonempty array.')
        return
      }
      children.forEach((child, i) => predicate(child, `${path}.${variants[0]}[${i}]`, depth + 1, budget))
    } else if (variants[0] === 'not') predicate(value.not, `${path}.not`, depth + 1, budget)
    else {
      if (!string(value.field) || !fields.has(value.field) || unsafeKeys.has(value.field))
        fail(`${path}.field`, 'Unknown inventory field.')
      if (!['eq', 'ne', 'gt', 'ge', 'lt', 'le'].includes(String(value.op)))
        fail(`${path}.op`, 'Unsupported comparison operator.')
      if (!(finite(value.value) || typeof value.value === 'boolean' || typeof value.value === 'string'))
        fail(`${path}.value`, 'Expected a finite number, string, or boolean.')
      if (['gt', 'ge', 'lt', 'le'].includes(String(value.op)) && !finite(value.value))
        fail(`${path}.value`, 'Ordered comparisons require a numeric value.')
    }
  }
  if (!record(project)) return { errors: [{ path: 'project', message: 'Expected a project object.' }], warnings }
  if (project.schema !== 'pgmaps-castor-project-v1') fail('schema', 'Unsupported project schema.')
  text(project.name, 'name')
  if (typeof project.description !== 'string') fail('description', 'Expected a description string.')
  if (
    !record(project.provenance) ||
    !string(project.provenance.source) ||
    !Array.isArray(project.provenance.notes) ||
    project.provenance.notes.some((note) => typeof note !== 'string')
  )
    fail('provenance', 'Provide a source and an array of provenance notes.')
  if (record(project.provenance)) {
    if (project.provenance.revision !== undefined) text(project.provenance.revision, 'provenance.revision')
    if (project.provenance.synthetic !== undefined && typeof project.provenance.synthetic !== 'boolean')
      fail('provenance.synthetic', 'Expected true or false.')
    if (project.provenance.url !== undefined) {
      const value = project.provenance.url
      if (typeof value !== 'string' || value.length > 2048 || !/^https?:\/\//i.test(value))
        fail('provenance.url', 'Expected an http(s) source URL.')
      else {
        try {
          if (!new URL(value).hostname) fail('provenance.url', 'Expected an http(s) source URL.')
        } catch {
          fail('provenance.url', 'Expected an http(s) source URL.')
        }
      }
    }
  }
  const arrays: Array<[string, number, boolean]> = [
    ['pixels', CASTOR_LIMITS.pixels, true],
    ['yieldCurves', CASTOR_LIMITS.yieldCurves, true],
    ['constraints', CASTOR_LIMITS.constraints, true],
    ['harvestFlows', CASTOR_LIMITS.flows, true],
    ['adjacency', CASTOR_LIMITS.pixels * 8, true],
    ['landings', CASTOR_LIMITS.pixels, true],
    ['treatments', CASTOR_LIMITS.treatments, false],
    ['schedule', CASTOR_LIMITS.scheduleEntries, false],
  ]
  for (const [key, limit, required] of arrays) {
    if (project[key] === undefined && !required) continue
    if (!Array.isArray(project[key]) || project[key].length > limit)
      fail(key, `Expected an array containing no more than ${limit} entries.`)
  }
  if (errors.length) return { errors, warnings }
  const pixels = project.pixels as unknown[]
  if (!pixels.length) fail('pixels', 'At least one inventory pixel is required.')
  const ids = new Set<number>()
  const blockIds = new Set<string>()
  const compartments = new Set<string>()
  const gridIndices = new Set<number>()
  for (const [i, entry] of pixels.entries()) {
    const path = `pixels[${i}]`
    if (!record(entry)) {
      fail(path, 'Expected an inventory object.')
      continue
    }
    number(entry.id, `${path}.id`, 0, Number.MAX_SAFE_INTEGER, true)
    if (finite(entry.id)) {
      if (ids.has(entry.id)) fail(`${path}.id`, 'Duplicate pixel id.')
      ids.add(entry.id)
    }
    for (const key of ['blockId', 'compartment']) text(entry[key], `${path}.${key}`)
    if (string(entry.blockId)) blockIds.add(entry.blockId)
    if (string(entry.compartment)) compartments.add(entry.compartment)
    number(entry.areaHa, `${path}.areaHa`, Number.MIN_VALUE, 1_000_000)
    number(entry.thlbHa, `${path}.thlbHa`, 0, finite(entry.areaHa) ? entry.areaHa : Number.MAX_VALUE)
    if (typeof entry.owned !== 'boolean') fail(`${path}.owned`, 'Expected true or false.')
    number(entry.age, `${path}.age`, 0, 10_000)
    number(entry.height, `${path}.height`, 0, 10_000)
    number(entry.distance, `${path}.distance`, 0, 1e12)
    for (const key of ['volume', 'salvageVolume']) number(entry[key], `${path}.${key}`, 0, 1e9)
    number(entry.eca, `${path}.eca`, 0, 1)
    for (const key of ['basalArea', 'crownClosure', 'deciduousPercent', 'qmd', 'culminationVolume'])
      if (entry[key] !== undefined) number(entry[key], `${path}.${key}`, 0, 1e9)
    for (const key of ['x', 'y', 'elevation'])
      if (entry[key] !== undefined) number(entry[key], `${path}.${key}`, -1e12, 1e12)
    if ((entry.x === undefined) !== (entry.y === undefined))
      fail(path, 'Projected x and y coordinates must be supplied together.')
    if (entry.geometry !== undefined) geometry(entry.geometry, `${path}.geometry`)
    if (entry.gridIndex !== undefined) {
      number(entry.gridIndex, `${path}.gridIndex`, 0, CASTOR_LIMITS.gridCells - 1, true)
      if (finite(entry.gridIndex)) {
        if (gridIndices.has(entry.gridIndex)) fail(`${path}.gridIndex`, 'Duplicate grid cell.')
        gridIndices.add(entry.gridIndex)
      }
    }
    if (!record(entry.zones) || Object.entries(entry.zones).some(([key, val]) => unsafeKeys.has(key) || !string(val)))
      fail(`${path}.zones`, 'Expected a map of safe zone names to string identifiers.')
    if (entry.attributes !== undefined) {
      if (!record(entry.attributes)) fail(`${path}.attributes`, 'Expected an attribute map.')
      else
        for (const [key, val] of Object.entries(entry.attributes)) {
          if (unsafeKeys.has(key) || baseFields.has(key))
            fail(`${path}.attributes.${key}`, 'Attribute names must not shadow model fields.')
          else fields.add(key)
          if (!(val === null || finite(val) || typeof val === 'boolean' || typeof val === 'string'))
            fail(`${path}.attributes.${key}`, 'Expected a finite number, string, boolean, or null.')
        }
    }
  }
  const curveIds = new Set<string>()
  for (const [i, entry] of (project.yieldCurves as unknown[]).entries()) {
    const path = `yieldCurves[${i}]`
    if (!record(entry)) {
      fail(path, 'Expected a yield curve.')
      continue
    }
    text(entry.id, `${path}.id`)
    if (string(entry.id)) {
      if (curveIds.has(entry.id)) fail(`${path}.id`, 'Duplicate yield curve.')
      curveIds.add(entry.id)
    }
    if (!Array.isArray(entry.points) || !entry.points.length || entry.points.length > CASTOR_LIMITS.yieldPoints) {
      fail(`${path}.points`, `Provide 1–${CASTOR_LIMITS.yieldPoints} yield points.`)
      continue
    }
    let lastAge = -1
    entry.points.forEach((point, j) => {
      const pointPath = `${path}.points[${j}]`
      if (!record(point)) {
        fail(pointPath, 'Expected a yield point.')
        return
      }
      number(point.age, `${pointPath}.age`, 0, 10_000)
      number(point.volume, `${pointPath}.volume`, 0, 1e9)
      number(point.height, `${pointPath}.height`, 0, 10_000)
      if (finite(point.age)) {
        if (point.age <= lastAge) fail(`${pointPath}.age`, 'Yield ages must increase strictly, without duplicates.')
        lastAge = point.age
      }
      if (point.eca !== undefined) number(point.eca, `${pointPath}.eca`, 0, 1)
      for (const key of ['basalArea', 'crownClosure', 'deciduousPercent', 'qmd'])
        if (point[key] !== undefined) number(point[key], `${pointPath}.${key}`)
    })
  }
  const treatmentIds = new Set<string>()
  const unique = (entry: Record<string, unknown>, path: string, set: Set<string>) => {
    text(entry.id, `${path}.id`)
    if (string(entry.id)) {
      if (set.has(entry.id)) fail(`${path}.id`, 'Duplicate identifier.')
      set.add(entry.id)
    }
  }
  const window = (entry: Record<string, unknown>, path: string) => {
    for (const key of ['startYear', 'stopYear']) if (entry[key] !== undefined) number(entry[key], `${path}.${key}`)
    if (finite(entry.startYear) && finite(entry.stopYear) && entry.startYear > entry.stopYear)
      fail(path, 'Start must not follow stop. These are elapsed simulation years.')
  }
  for (const [i, entry] of ((project.treatments ?? []) as unknown[]).entries()) {
    const path = `treatments[${i}]`
    if (!record(entry)) {
      fail(path, 'Expected a treatment object.')
      continue
    }
    unique(entry, path, treatmentIds)
    predicate(entry.condition, `${path}.condition`)
    window(entry, path)
    if (entry.method !== undefined && !['fraction', 'curve-transition'].includes(String(entry.method)))
      fail(`${path}.method`, 'Unknown treatment method.')
    if (entry.method === 'fraction' || !entry.nextCurveId)
      number(entry.removeFraction, `${path}.removeFraction`, Number.MIN_VALUE, 1)
    for (const key of ['nextCurveId', 'nextManagedCurveId'])
      if (entry[key] !== undefined && (!string(entry[key]) || !curveIds.has(entry[key])))
        fail(`${path}.${key}`, 'Yield curve is missing.')
    if (entry.resetAge !== undefined) number(entry.resetAge, `${path}.resetAge`)
    if (entry.nextSilviculturalSystem !== undefined)
      number(entry.nextSilviculturalSystem, `${path}.nextSilviculturalSystem`, 0, 10000, true)
    if (entry.method === 'curve-transition' && !entry.nextCurveId)
      fail(`${path}.nextCurveId`, 'Curve-transition treatments require a post-treatment curve.')
  }
  for (const [i, entry] of ((project.treatments ?? []) as unknown[]).entries())
    if (
      record(entry) &&
      entry.nextTreatmentId !== undefined &&
      (!string(entry.nextTreatmentId) || !treatmentIds.has(entry.nextTreatmentId))
    )
      fail(`treatments[${i}].nextTreatmentId`, 'The next treatment is not defined.')
  let missingCurve = 0
  for (const [i, entry] of pixels.entries())
    if (record(entry)) {
      for (const key of ['curveId', 'managedCurveId'])
        if (entry[key] !== undefined && (!string(entry[key]) || !curveIds.has(entry[key])))
          fail(`pixels[${i}].${key}`, 'Referenced yield curve is missing.')
      if (!entry.curveId && finite(entry.thlbHa) && entry.thlbHa > 0) missingCurve++
      if (entry.treatmentId !== undefined && (!string(entry.treatmentId) || !treatmentIds.has(entry.treatmentId)))
        fail(`pixels[${i}].treatmentId`, 'Referenced treatment is missing.')
    }
  if (missingCurve)
    warnings.push(
      `${missingCurve} THLB pixels have no growth curve; their supplied live volume, height and ECA will be held constant as age advances.`,
    )
  const constraintIds = new Set<string>()
  for (const [i, entry] of (project.constraints as unknown[]).entries()) {
    const path = `constraints[${i}]`
    if (!record(entry)) {
      fail(path, 'Expected a constraint object.')
      continue
    }
    unique(entry, path, constraintIds)
    text(entry.zone, `${path}.zone`)
    text(entry.zoneId, `${path}.zoneId`)
    window(entry, path)
    if (!['nh', 'ge', 'le'].includes(String(entry.type))) fail(`${path}.type`, 'Expected nh, ge, or le.')
    if (entry.type !== 'nh') {
      number(entry.percentage, `${path}.percentage`, 0, 100)
      if (entry.condition !== undefined) predicate(entry.condition, `${path}.condition`)
      else {
        if (!string(entry.variable) || !fields.has(entry.variable))
          fail(`${path}.variable`, 'Unknown inventory variable.')
        number(entry.threshold, `${path}.threshold`, -Number.MAX_VALUE)
      }
      if (entry.variable === 'eca') {
        if (entry.type !== 'le') fail(`${path}.type`, 'ECA constraints require le.')
        number(entry.threshold, `${path}.threshold`, 0, 100)
      }
    }
    if (entry.denominator !== undefined) predicate(entry.denominator, `${path}.denominator`)
  }
  const flowIds = new Set<string>()
  for (const [i, entry] of (project.harvestFlows as unknown[]).entries()) {
    const path = `harvestFlows[${i}]`
    if (!record(entry)) {
      fail(path, 'Expected a harvest flow.')
      continue
    }
    unique(entry, path, flowIds)
    text(entry.compartment, `${path}.compartment`)
    if (string(entry.compartment) && !compartments.has(entry.compartment))
      fail(`${path}.compartment`, 'No inventory exists for this compartment.')
    number(entry.period, `${path}.period`, 1, CASTOR_LIMITS.periods, true)
    number(entry.targetM3, `${path}.targetM3`, 0, 1e18)
    if (!['live', 'salvage'].includes(String(entry.type))) fail(`${path}.type`, 'Expected live or salvage.')
    if (entry.condition !== undefined) predicate(entry.condition, `${path}.condition`)
  }
  for (const [i, pair] of (project.adjacency as unknown[]).entries())
    if (
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      pair.some((id) => !string(id) || !blockIds.has(id)) ||
      pair[0] === pair[1]
    )
      fail(`adjacency[${i}]`, 'An adjacency link must connect two different existing blocks.')
  const landingBlocks = new Set<string>()
  for (const [i, entry] of (project.landings as unknown[]).entries()) {
    if (
      !record(entry) ||
      !string(entry.blockId) ||
      !blockIds.has(entry.blockId) ||
      !finite(entry.pixelId) ||
      !ids.has(entry.pixelId)
    ) {
      fail(`landings[${i}]`, 'Landing must reference an existing block and pixel.')
      continue
    }
    if (landingBlocks.has(entry.blockId)) fail(`landings[${i}]`, 'Provide at most one landing per block.')
    landingBlocks.add(entry.blockId)
  }
  for (const [i, entry] of ((project.schedule ?? []) as unknown[]).entries()) {
    const path = `schedule[${i}]`
    if (!record(entry)) {
      fail(path, 'Expected a schedule entry.')
      continue
    }
    number(entry.period, `${path}.period`, 1, CASTOR_LIMITS.periods, true)
    if (!Array.isArray(entry.pixelIds) && !Array.isArray(entry.blockIds)) fail(path, 'Provide pixelIds or blockIds.')
    if (
      entry.pixelIds !== undefined &&
      (!Array.isArray(entry.pixelIds) ||
        entry.pixelIds.length > CASTOR_LIMITS.pixels ||
        entry.pixelIds.some((id) => !finite(id) || !ids.has(id)))
    )
      fail(`${path}.pixelIds`, 'Unknown or invalid pixel list.')
    if (
      entry.blockIds !== undefined &&
      (!Array.isArray(entry.blockIds) ||
        entry.blockIds.length > CASTOR_LIMITS.pixels ||
        entry.blockIds.some((id) => !string(id) || !blockIds.has(id)))
    )
      fail(`${path}.blockIds`, 'Unknown or invalid block list.')
    if (entry.type !== undefined && !['live', 'salvage'].includes(String(entry.type)))
      fail(`${path}.type`, 'Unknown harvest type.')
    if (entry.removeFraction !== undefined) number(entry.removeFraction, `${path}.removeFraction`, Number.MIN_VALUE, 1)
  }
  if (project.grid !== undefined) {
    if (!record(project.grid)) fail('grid', 'Expected grid metadata.')
    else {
      const g = project.grid
      number(g.width, 'grid.width', 1, CASTOR_LIMITS.gridCells, true)
      number(g.height, 'grid.height', 1, CASTOR_LIMITS.gridCells, true)
      number(g.cellSize, 'grid.cellSize', Number.MIN_VALUE, 1e6)
      number(g.originX, 'grid.originX', -1e12, 1e12)
      number(g.originY, 'grid.originY', -1e12, 1e12)
      metricCrs(g.crs, 'grid.crs')
      if (finite(g.width) && finite(g.height)) {
        if (g.width * g.height > CASTOR_LIMITS.gridCells) fail('grid', `Grid exceeds ${CASTOR_LIMITS.gridCells} cells.`)
        for (const index of gridIndices)
          if (index >= g.width * g.height) {
            fail('pixels.gridIndex', 'A pixel index lies outside the grid.')
            break
          }
      }
      if (gridIndices.size !== pixels.length)
        fail('pixels.gridIndex', 'Every pixel requires a gridIndex when grid metadata are present.')
      if (typeof g.crs === 'string' && /4326|4269|CRS:84|longlat/i.test(g.crs))
        fail('grid.crs', 'Grid coordinates and cell size must use a projected metre CRS.')
    }
  }
  if (!record(config)) {
    fail('config', 'Expected simulation settings.')
    return { errors, warnings }
  }
  text(config.scenario, 'config.scenario')
  number(config.periods, 'config.periods', 1, CASTOR_LIMITS.periods, true)
  number(config.stepYears, 'config.stepYears', 1, 100, true)
  number(config.startYear, 'config.startYear', 0, 9999, true)
  number(config.minimumHarvestAge, 'config.minimumHarvestAge')
  number(config.maxYieldAge, 'config.maxYieldAge', 1, 1000)
  number(config.targetMultiplier, 'config.targetMultiplier', 0, 100)
  number(config.growingStockRetention, 'config.growingStockRetention', 0, 1)
  if (config.adjacencyHeight !== null) number(config.adjacencyHeight, 'config.adjacencyHeight', 0, 100)
  for (const key of ['initializeFromYield', 'updateDistance'])
    if (typeof config[key] !== 'boolean') fail(`config.${key}`, 'Expected true or false.')
  if (!['queue', 'schedule'].includes(String(config.mode))) fail('config.mode', 'Expected queue or schedule.')
  if (!['pixel', 'block'].includes(String(config.harvestUnit))) fail('config.harvestUnit', 'Expected pixel or block.')
  if (!['period-end', 'upstream-midpoint'].includes(String(config.growthTiming)))
    fail('config.growthTiming', 'Expected period-end or upstream-midpoint.')
  if (config.mode === 'schedule' && !(project.schedule as unknown[] | undefined)?.length)
    fail('schedule', 'Schedule mode requires scheduled harvest entries.')
  const priority = (value: unknown, path: string) => {
    if (!Array.isArray(value) || !value.length || value.length > 10) {
      fail(path, 'Provide 1–10 priority fields.')
      return
    }
    value.forEach((item, i) => {
      if (
        !record(item) ||
        !string(item.field) ||
        !fields.has(item.field) ||
        !['asc', 'desc'].includes(String(item.direction))
      )
        fail(`${path}[${i}]`, 'Invalid priority field or direction.')
    })
  }
  priority(config.blockPriority, 'config.blockPriority')
  if (config.zonePriority !== undefined) {
    if (!record(config.zonePriority)) fail('config.zonePriority', 'Expected a zone priority object.')
    else {
      text(config.zonePriority.zone, 'config.zonePriority.zone')
      priority(config.zonePriority.order, 'config.zonePriority.order')
      number(config.zonePriority.refreshPeriods, 'config.zonePriority.refreshPeriods', 0, CASTOR_LIMITS.periods, true)
    }
  }
  if (finite(config.periods)) {
    const activeFlowCount = (project.harvestFlows as Array<{ period: number }>).filter(
      (flow) => flow && flow.period <= (config.periods as number),
    ).length
    if (pixels.length * activeFlowCount > CASTOR_LIMITS.flowCellVisits)
      fail('harvestFlows', 'The flow/region combination exceeds the browser operation budget.')
    if (pixels.length * config.periods > CASTOR_LIMITS.pixelPeriods)
      fail(
        'config.periods',
        `This run exceeds ${CASTOR_LIMITS.pixelPeriods.toLocaleString()} pixel-periods; reduce the region or horizon.`,
      )
    if (
      pixels.length * config.periods * (project.constraints as unknown[]).length >
      CASTOR_LIMITS.constraintCellPeriods
    )
      fail('constraints', 'The constraint/region/horizon combination exceeds the browser operation budget.')
  }
  if (config.updateDistance && pixels.some((pixel) => !record(pixel) || !finite(pixel.x) || !finite(pixel.y)))
    fail('pixels', 'Distance updates require projected metre x/y coordinates for every pixel.')
  if (config.updateDistance && !string(record(project.grid) ? project.grid.crs : project.crs))
    fail('crs', 'Distance updates require a declared projected metre CRS.')
  if (project.crs !== undefined) metricCrs(project.crs, 'crs')
  if (config.adjacencyHeight !== null && !(project.adjacency as unknown[]).length)
    warnings.push(
      'Adjacency is enabled but no block-neighbour links were supplied; only the low-height blocks themselves can be excluded.',
    )
  if (!record(config.uncertainty)) fail('config.uncertainty', 'Expected uncertainty settings.')
  else {
    if (typeof config.uncertainty.enabled !== 'boolean') fail('config.uncertainty.enabled', 'Expected true or false.')
    number(
      config.uncertainty.replicates,
      'config.uncertainty.replicates',
      20,
      CASTOR_LIMITS.uncertaintyReplicates,
      true,
    )
    number(config.uncertainty.coefficientOfVariation, 'config.uncertainty.coefficientOfVariation', 0, 2)
    number(config.uncertainty.seed, 'config.uncertainty.seed', 0, 4_294_967_295, true)
  }
  return { errors, warnings }
}
