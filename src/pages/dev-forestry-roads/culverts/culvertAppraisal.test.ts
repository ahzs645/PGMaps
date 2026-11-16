import { describe, expect, it } from 'vitest'
import { COAST_CULVERT_ROWS, INTERIOR_CULVERT_ROWS } from '../appraisalScope'
import { BC_COAST_2026, BC_INTERIOR_2026, CULVERT_APPRAISAL_PACKS } from './appraisalPacks'
import {
  appraisalPackForPlace,
  culvertAppraisalInput,
  culvertAppraisalTreatment,
  type CulvertAppraisalInput,
} from './culvertAppraisal'

const pipe = (
  diameterM: number,
  lengthM: number,
  more: Partial<CulvertAppraisalInput> = {},
): CulvertAppraisalInput => ({
  shape: 'round',
  diameterM,
  barrels: 1,
  embedded: false,
  lengthM,
  lengthBasis: 'barrel',
  ...more,
})
const interior = (diameterM: number, lengthM: number, more?: Partial<CulvertAppraisalInput>) =>
  culvertAppraisalTreatment(pipe(diameterM, lengthM, more), BC_INTERIOR_2026)
const coast = (diameterM: number, lengthM: number, more?: Partial<CulvertAppraisalInput>) =>
  culvertAppraisalTreatment(pipe(diameterM, lengthM, more), BC_COAST_2026)

describe('the appraisal tables as transcribed', () => {
  it('agree with the rows read into appraisalScope.ts on 12 November', () => {
    const table = BC_INTERIOR_2026.table
    if (table.kind !== 'installed-by-length') throw Error('Interior table kind')
    const twelve = table.installedCad[table.lengthsM.indexOf(12)]
    for (const row of INTERIOR_CULVERT_ROWS) {
      const column = table.diametersM.indexOf(row.diameterM)
      expect(twelve[column]).toBe(row.installed12mCad)
      expect(table.supplyPerMCad[column]).toBe(row.supplyPerMCad)
    }
    const coastTable = BC_COAST_2026.table
    if (coastTable.kind !== 'per-metre') throw Error('Coast table kind')
    for (const row of COAST_CULVERT_ROWS) {
      const column = coastTable.diametersM.indexOf(row.diameterM)
      expect(coastTable.installedPerMCad[column]).toBe(row.installedPerMCad)
      expect(coastTable.supplyPerMCad[column]).toBe(row.materialsPerMCad)
    }
  })
  it('are complete, and rise with diameter and with length', () => {
    for (const pack of CULVERT_APPRAISAL_PACKS) {
      const table = pack.table
      expect(table.supplyPerMCad).toHaveLength(table.diametersM.length)
      const rows = table.kind === 'installed-by-length' ? table.installedCad : [table.installedPerMCad]
      if (table.kind === 'installed-by-length') expect(rows).toHaveLength(table.lengthsM.length)
      rows.forEach((row, r) => {
        expect(row).toHaveLength(table.diametersM.length)
        row.forEach((cell, c) => {
          if (c) expect(cell).toBeGreaterThan(row[c - 1])
          if (r) expect(cell).toBeGreaterThanOrEqual(rows[r - 1][c])
        })
      })
    }
  })
  it('step evenly along each Interior column, which a misread digit would break', () => {
    // Part A is a fixed amount plus a rate per metre, rounded to the dollar, with a $963 floor:
    // successive rows of a column differ by the same step to within the rounding.
    const table = BC_INTERIOR_2026.table
    if (table.kind !== 'installed-by-length') throw Error('Interior table kind')
    table.diametersM.forEach((_, column) => {
      const steps = table.installedCad
        .map((row, r) => (r ? row[column] - table.installedCad[r - 1][column] : null))
        .filter((step): step is number => step !== null && step > 0)
      // The $963 floor makes the first step off it a partial one; the rest are whole.
      const whole = table.installedCad[0][column] === 963 && steps.length < 11 ? steps.slice(1) : steps
      expect(Math.max(...whole) - Math.min(...whole)).toBeLessThanOrEqual(2)
    })
  })
})

describe('Interior treatment of a pipe culvert', () => {
  it('puts a pipe under 950 mm inside the subgrade allowance, with no figure of its own', () => {
    const result = interior(0.6, 12)
    expect(result.kind).toBe('in-subgrade')
    expect(result.allowanceCad).toBeNull()
    expect(result.locator).toContain('4.3.3(1)')
    expect(interior(0.9, 20).kind).toBe('in-subgrade')
  })
  it('reads the three figures the note gives for 12 m pipes from Table 4-3, Part A', () => {
    expect(interior(0.95, 12).allowanceCad).toBe(4405)
    expect(interior(1.2, 12).allowanceCad).toBe(6728)
    expect(interior(1.8, 12).allowanceCad).toBe(14525)
    expect(interior(1.2, 12).summary).toBe('Table 4-3, Part A: $6,728 installed (1.2 m × 12 m)')
  })
  it('keeps exactly 1.8 m and exactly 20 m in the table', () => {
    const edge = interior(1.8, 20)
    expect(edge.kind).toBe('table')
    expect(edge.allowanceCad).toBe(23890)
  })
  it('sends a pipe over 1.8 m, or over 20 m at any diameter, to an engineered estimate', () => {
    const wide = interior(2, 12)
    expect(wide.kind).toBe('engineered-estimate')
    expect(wide.reasons[0]).toContain('larger than 1.8 m')
    expect(wide.allowanceCad).toBeNull()
    const long = interior(0.6, 24)
    expect(long.kind).toBe('engineered-estimate')
    expect(long.reasons[0]).toContain('longer than 20 m')
    expect(interior(2.4, 26).reasons).toHaveLength(2)
    expect(interior(2.4, 26).summary).toBe('Engineered cost estimate (over 1.8 m in diameter, over 20 m long)')
    expect(interior(0.6, 12, { barrels: 2, embedded: true }).summary).toBe(
      'Engineered cost estimate (2 barrels, embedded)',
    )
    expect(wide.toConfirm.join(' ')).toContain('approach fills to 15 m')
  })
  it('gives the neighbouring entries, never an interpolated figure, between table entries', () => {
    const betweenLengths = interior(1.2, 12.4)
    expect(betweenLengths.kind).toBe('table')
    expect(betweenLengths.allowanceCad).toBeNull()
    expect(betweenLengths.between).toMatchObject({ lowCad: 6728, highCad: 7248 })
    expect(betweenLengths.reasons.join(' ')).toContain('no interpolation')
    const betweenBoth = interior(1.1, 12.4)
    expect(betweenBoth.between!.cells).toHaveLength(4)
    expect(betweenBoth.between).toMatchObject({ lowCad: 4847, highCad: 7248 })
    // Shorter than the table's shortest pipe: the 9 m entry is the nearest, and it is said to be one.
    const short = interior(1.2, 7)
    expect(short.allowanceCad).toBeNull()
    expect(short.between).toMatchObject({ lowCad: 5165, highCad: 5165 })
    expect(short.summary).toContain('nearest entry $5,165')
  })
  it('treats multiple barrels, another shape and an embedded pipe as special structures at any size', () => {
    for (const more of [
      { barrels: 2 },
      { shape: 'pipe-arch' as const },
      { shape: 'box' as const },
      { embedded: true },
    ]) {
      const result = interior(0.6, 12, more)
      expect(result.kind).toBe('engineered-estimate')
      expect(result.locator).toContain('4.3.6(8)(p)')
    }
  })
  it('says when the length is still the horizontal span', () => {
    const input = culvertAppraisalInput({ diameterM: 1.2, lengthM: 12 }, null)
    expect(input.lengthBasis).toBe('span')
    expect(culvertAppraisalTreatment(input, BC_INTERIOR_2026).toConfirm[0]).toContain('horizontal span')
    expect(culvertAppraisalInput({ diameterM: 1.2, lengthM: 12 }, 12.04).lengthM).toBe(12.04)
    expect(culvertAppraisalInput({ diameterM: 1.2, lengthM: 12, embedmentM: 0.5 }, 12).embedded).toBe(true)
    expect(culvertAppraisalInput({ diameterM: 1.2, lengthM: 12 }, 12, true).embedded).toBe(true)
  })
})

describe('Coast treatment of a pipe culvert', () => {
  it('costs every pipe from 0.3 m to 1.8 m per lineal metre, small ones included', () => {
    const small = coast(0.6, 12)
    expect(small.kind).toBe('table')
    expect(small.allowanceCad).toBe(173 * 12)
    expect(coast(1.8, 30).allowanceCad).toBe(996 * 30)
  })
  it('has no length rule, and sends a pipe over 1.8 m to an engineered estimate', () => {
    expect(coast(1.2, 40).kind).toBe('table')
    expect(coast(2, 12).kind).toBe('engineered-estimate')
  })
  it('does not decide a shape, barrel count or embedment the manual was not read for', () => {
    for (const more of [{ barrels: 2 }, { shape: 'box' as const }, { embedded: true }])
      expect(coast(0.9, 12, more).kind).toBe('not-determined')
  })
  it('gives the neighbouring rates between two diameters', () => {
    expect(coast(1.1, 10).between).toMatchObject({ lowCad: 3190, highCad: 4400 })
  })
})

describe('which manual a cost location reads', () => {
  it('follows the BC cost region, and says when Interior is only a default', () => {
    expect(appraisalPackForPlace(undefined)!.pack.id).toBe('bc-interior-2026')
    expect(appraisalPackForPlace(undefined)!.basis).toContain('default')
    const bc = { country: 'CA', subdivision: 'CA-BC' }
    expect(appraisalPackForPlace(bc)!.basis).toContain('default')
    expect(appraisalPackForPlace({ ...bc, region: 'bc-nr:cariboo' })).toMatchObject({
      pack: { id: 'bc-interior-2026' },
      basis: 'Cariboo is an Interior appraisal region.',
    })
    expect(appraisalPackForPlace({ ...bc, region: 'bc-nr:west-coast' })!.pack.id).toBe('bc-coast-2026')
  })
  it('has no appraisal rules outside BC', () => {
    expect(appraisalPackForPlace({ country: 'CA', subdivision: 'CA-AB' })).toBeNull()
    expect(appraisalPackForPlace({ country: 'US', subdivision: 'US-MT' })).toBeNull()
  })
})
