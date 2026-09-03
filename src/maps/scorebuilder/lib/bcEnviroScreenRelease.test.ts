import { describe, expect, it } from 'vitest'
import { validateBcEnviroScreenRelease, type BcEnviroScreenLhaRow } from './bcEnviroScreenRelease'

const indicatorKeys = Array.from({ length: 21 }, (_, index) => `indicator-${index}`)

function rows(): BcEnviroScreenLhaRow[] {
  return Array.from({ length: 89 }, (_, index) => ({
    lha_code: String(index + 1),
    lha_name: `LHA ${index + 1}`,
    indicators: Object.fromEntries(
      indicatorKeys.map((key) => [
        key,
        { value: index, percentile: 0.5, sourceKey: key, sourceStatus: 'independent-proxy', missing: false },
      ]),
    ),
  }))
}

describe('validateBcEnviroScreenRelease', () => {
  it('accepts exactly 89 unique LHA rows with 21 indicators', () => {
    const result = validateBcEnviroScreenRelease(
      {
        schemaVersion: 1,
        releaseId: 'release',
        indicatorKeys,
        boundary: { level: 'lha', rowCount: 89, joinKey: 'lha_code' },
      },
      { schemaVersion: 1, releaseId: 'release', rows: rows() },
    )
    expect(result.size).toBe(89)
  })

  it('rejects duplicate LHA codes', () => {
    const duplicateRows = rows()
    duplicateRows[1].lha_code = duplicateRows[0].lha_code
    expect(() =>
      validateBcEnviroScreenRelease(
        {
          schemaVersion: 1,
          releaseId: 'release',
          indicatorKeys,
          boundary: { level: 'lha', rowCount: 89, joinKey: 'lha_code' },
        },
        { schemaVersion: 1, releaseId: 'release', rows: duplicateRows },
      ),
    ).toThrow(/Duplicate/)
  })
})
