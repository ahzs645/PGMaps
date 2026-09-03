export type BcEnviroScreenSourceStatus =
  | 'independent-match'
  | 'independent-proxy'
  | 'revised-proxy'
  | 'benchmark-gap'
  | 'missing'

export interface BcEnviroScreenIndicatorValue {
  value: number | null
  percentile: number | null
  sourceKey: string | null
  sourceStatus: BcEnviroScreenSourceStatus
  missing: boolean
}

export interface BcEnviroScreenLhaRow {
  lha_code: string
  lha_name: string
  indicators: Record<string, BcEnviroScreenIndicatorValue>
}

export interface BcEnviroScreenManifest {
  schemaVersion: number
  releaseId: string
  indicatorKeys: string[]
  boundary: { level: string; rowCount: number; joinKey: string }
}

interface ReleaseDocument<T> {
  schemaVersion: number
  releaseId: string
  rows: T[]
}

export function validateBcEnviroScreenRelease(
  manifest: BcEnviroScreenManifest,
  indicators: ReleaseDocument<BcEnviroScreenLhaRow>,
): Map<string, BcEnviroScreenLhaRow> {
  if (manifest.schemaVersion !== 1 || indicators.schemaVersion !== 1) {
    throw new Error('Unsupported BC EnviroScreen release schema.')
  }
  if (manifest.releaseId !== indicators.releaseId) {
    throw new Error('BC EnviroScreen release IDs do not match.')
  }
  if (manifest.boundary.level !== 'lha' || manifest.boundary.rowCount !== 89 || indicators.rows.length !== 89) {
    throw new Error('BC EnviroScreen release must contain all 89 Local Health Areas.')
  }
  if (manifest.indicatorKeys.length !== 21 || new Set(manifest.indicatorKeys).size !== 21) {
    throw new Error('BC EnviroScreen release must declare 21 unique indicators.')
  }
  const rows = new Map<string, BcEnviroScreenLhaRow>()
  indicators.rows.forEach((row) => {
    if (!row.lha_code || rows.has(row.lha_code)) throw new Error(`Duplicate or empty LHA code: ${row.lha_code}`)
    const keys = Object.keys(row.indicators)
    if (keys.length !== 21 || manifest.indicatorKeys.some((key) => !(key in row.indicators))) {
      throw new Error(`LHA ${row.lha_code} does not contain all 21 indicators.`)
    }
    rows.set(row.lha_code, row)
  })
  return rows
}

export type BcEnviroScreenReleaseDocument = ReleaseDocument<BcEnviroScreenLhaRow>
