/** Explicit final-connector criteria. Numeric bounds are computation limits, not road standards. */
export interface ApprovedConnectorCrossing {
  featureId: string
  structureId: string
  startM: number
  endM: number
}
export interface ConnectorCheckOptions {
  loadedDirection: 'start-to-end' | 'end-to-start' | null
  maxAdverseGradePercent: number | null
  maxFavourableGradePercent: number | null
  clearingExtraM: number
  exclusionClearanceM: number
  streamSetbackM: number
  allowStreamCrossings: boolean
  requireFormationDesign: boolean
  maxCutDepthM: number | null
  maxFillHeightM: number | null
  approvedCrossings: ApprovedConnectorCrossing[]
}
export const DEFAULT_CONNECTOR_CHECK_OPTIONS: ConnectorCheckOptions = {
  loadedDirection: null,
  maxAdverseGradePercent: null,
  maxFavourableGradePercent: null,
  clearingExtraM: 0,
  exclusionClearanceM: 0,
  streamSetbackM: 0,
  allowStreamCrossings: false,
  requireFormationDesign: true,
  maxCutDepthM: null,
  maxFillHeightM: null,
  approvedCrossings: [],
}
export function createDefaultConnectorCheckOptions(): ConnectorCheckOptions {
  return { ...DEFAULT_CONNECTOR_CHECK_OPTIONS, approvedCrossings: [] }
}
export function parseConnectorCheckOptions(input?: unknown): ConnectorCheckOptions {
  if (input !== undefined && (!input || typeof input !== 'object' || Array.isArray(input)))
    throw Error('Final connector criteria must be an object.')
  const raw = (input ?? {}) as Record<string, unknown>
  const value = {
    ...createDefaultConnectorCheckOptions(),
    ...Object.fromEntries(
      Object.keys(DEFAULT_CONNECTOR_CHECK_OPTIONS)
        .filter((key) => raw[key] !== undefined)
        .map((key) => [key, raw[key]]),
    ),
  } as ConnectorCheckOptions
  const bounded = (n: unknown, minimum: number, maximum: number): n is number =>
    typeof n === 'number' && Number.isFinite(n) && n >= minimum && n <= maximum
  if (
    value.loadedDirection !== null &&
    value.loadedDirection !== 'start-to-end' &&
    value.loadedDirection !== 'end-to-start'
  )
    throw Error('Choose loaded travel from road start to end or end to start, or leave it unknown.')
  for (const [label, n] of [
    ['adverse', value.maxAdverseGradePercent],
    ['favourable', value.maxFavourableGradePercent],
  ] as const)
    if (n !== null && !bounded(n, 0.1, 100))
      throw Error(`Enter a ${label} loaded grade limit from 0.1% to 100%, or leave it unknown.`)
  for (const [label, n] of [
    ['clearing allowance', value.clearingExtraM],
    ['exclusion clearance', value.exclusionClearanceM],
    ['stream setback', value.streamSetbackM],
  ] as const)
    if (!bounded(n, 0, 500)) throw Error(`Enter a ${label} from 0 to 500 m.`)
  for (const [label, n] of [
    ['cut depth', value.maxCutDepthM],
    ['fill height', value.maxFillHeightM],
  ] as const)
    if (n !== null && !bounded(n, 0, 1000))
      throw Error(`Enter a maximum ${label} from 0 to 1,000 m, or leave it unchecked.`)
  if (typeof value.allowStreamCrossings !== 'boolean' || typeof value.requireFormationDesign !== 'boolean')
    throw Error('Crossing and independent-formation criteria must be true or false.')
  if (!Array.isArray(value.approvedCrossings) || value.approvedCrossings.length > 100)
    throw Error('Enter at most 100 reviewed crossing windows.')
  value.approvedCrossings = value.approvedCrossings.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      throw Error(`Crossing window ${index + 1} must be an object.`)
    for (const key of ['featureId', 'structureId'] as const)
      if (typeof entry[key] !== 'string' || !entry[key].trim() || entry[key].length > 200)
        throw Error(`Crossing window ${index + 1} needs a stream and structure ID.`)
    if (!bounded(entry.startM, 0, 100000) || !bounded(entry.endM, 0, 100000) || entry.endM <= entry.startM)
      throw Error(`Crossing window ${index + 1} needs an increasing station range inside 0–100,000 m.`)
    return { featureId: entry.featureId, structureId: entry.structureId, startM: entry.startM, endM: entry.endM }
  })
  return value
}
