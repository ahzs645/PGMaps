import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const records = JSON.parse(readFileSync('public/data/cimd/prince_george_cimd_2021.json', 'utf8')) as Array<
  Record<string, number | string>
>

describe('prince_george_cimd_2021.json', () => {
  it('covers Prince George dissemination areas', () => {
    expect(records.length).toBe(135)
    expect(records.every((record) => String(record.daCode).startsWith('5953'))).toBe(true)
  })

  it.each([
    'composite',
    'residentialInstability',
    'economicDependency',
    'situationalVulnerability',
    'ethnoCulturalComposition',
  ])('keeps %s in the 0-1 range the scorer reads, with real spread', (key) => {
    const values = records.map((record) => Number(record[key]))
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...values)).toBeLessThanOrEqual(1)
    expect(new Set(values).size).toBeGreaterThan(4)
  })
})
