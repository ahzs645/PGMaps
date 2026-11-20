import { describe, expect, it } from 'vitest'
import { createEngineeringDesign } from '../engineeringTypes'
import { culvertInventoryStatus } from './culvertInventoryStatus'
import { buildCulvertSchedule } from './culvertSchedule'
import type { CulvertCheckState } from './culvertChecks'

function rowWithChecks(states: CulvertCheckState[]) {
  const row = buildCulvertSchedule({
    alignment: {
      engineering: {
        ...createEngineeringDesign(),
        culverts: [
          {
            id: 'cross-drain',
            name: 'Cross-drain',
            kind: 'cross-drain',
            chainage: 100,
            skewDegrees: 0,
            lengthM: 16,
            diameterM: 0.8,
            inletInvertM: null,
            outletInvertM: null,
            minCoverM: 0.6,
            unitCost: 0,
            fixedCost: 0,
          },
        ],
      },
    },
    analysis: undefined,
    place: undefined,
  }).rows[0]
  return {
    ...row,
    class: { ...row.class, major: false },
    checks: states.map((state, index) => ({ ...row.checks[index], state })),
  }
}

describe('culvert inventory evidence status', () => {
  it('does not present missing or partly assessed evidence as checks met', () => {
    expect(culvertInventoryStatus(undefined)).toEqual({ label: 'Not calculated', tone: 'neutral' })
    expect(culvertInventoryStatus(rowWithChecks([]))).toEqual({ label: 'Not fully assessed', tone: 'neutral' })
    expect(culvertInventoryStatus(rowWithChecks(['met', 'not-assessed']))).toEqual({
      label: 'Not fully assessed',
      tone: 'neutral',
    })
    expect(culvertInventoryStatus(rowWithChecks(['met', 'note']))).toEqual({ label: 'Checks met', tone: 'success' })
  })

  it('prioritizes a failed check or geometry warning even when another check is unassessed', () => {
    expect(culvertInventoryStatus(rowWithChecks(['not-assessed', 'not-met']))).toEqual({
      label: 'Needs attention',
      tone: 'warning',
    })
    expect(culvertInventoryStatus(rowWithChecks(['met']), ['Barrel does not span the road'])).toEqual({
      label: 'Needs attention',
      tone: 'warning',
    })
    const major = rowWithChecks(['met'])
    expect(culvertInventoryStatus({ ...major, class: { ...major.class, major: true } })).toEqual({
      label: 'Needs attention',
      tone: 'warning',
    })
  })

  it('flags the invalid editable entry even when retained results have passing checks or no row', () => {
    expect(culvertInventoryStatus(rowWithChecks(['met']), [], true)).toEqual({
      label: 'Invalid input',
      tone: 'danger',
    })
    expect(culvertInventoryStatus(undefined, [], true)).toEqual({ label: 'Invalid input', tone: 'danger' })
  })
})
