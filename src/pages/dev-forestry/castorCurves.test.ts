import { describe, expect, it } from 'vitest'
import { castorConfig, castorCsvRows, createExampleProject } from '@/features/forestry-castor/inputs'
import { parseCastorSession, serializeCastorSession } from '@/features/forestry-castor/persistence'
import { ageReaching, heightCurveProblem, heightCurvesFromYieldRows, readCastorHeightCurves } from './castorCurves'

const readers = {
  csvRows: castorCsvRows,
  projectYields: (text: string) => parseCastorSession(text).project.yieldCurves,
}

describe('height–age curves from a Castor scenario', () => {
  it('reads every curve of a session saved from the Castor workbench, heights as given', () => {
    const project = createExampleProject()
    const saved = serializeCastorSession(project, castorConfig(project))
    const read = readCastorHeightCurves('example-session.json', saved, readers)
    expect(read.curves.map((c) => c.label).sort()).toEqual(project.yieldCurves.map((c) => c.id).sort())
    const natural = project.yieldCurves.find((c) => c.id === 'natural')!
    const curve = read.curves.find((c) => c.label === 'natural')!
    expect(curve.points).toEqual(natural.points.map((p) => ({ age: p.age, height: p.height })))
    expect(curve.source).toBe('Castor project example-session.json, yield curves')
  })

  it('groups a yields.csv by curveId or castordb yieldid, and leaves out falling or short curves by name', () => {
    const csv = [
      'yieldid,age,tvol,height',
      '1,0,0,0',
      '1,20,40,6.5',
      '1,40,180,15',
      '2,0,0,0',
      '2,10,5,4',
      '2,20,9,3',
      '3,0,0,0',
    ].join('\n')
    const read = readCastorHeightCurves('yields.csv', csv, readers)
    expect(read.curves).toEqual([
      {
        id: 'castor:1',
        label: '1',
        source: 'Castor yield table yields.csv',
        points: [
          { age: 0, height: 0 },
          { age: 20, height: 6.5 },
          { age: 40, height: 15 },
        ],
      },
    ])
    expect(read.skipped).toEqual(['Curve 2 falls from 4 m at age 10.', 'Curve 3 needs at least two ages.'])
  })

  it('refuses a table without heights, and files that are neither', () => {
    expect(() => heightCurvesFromYieldRows([{ curveId: 'a', age: '0', volume: '0' }], 'v.csv')).toThrow(
      'no height column',
    )
    expect(() => readCastorHeightCurves('notes.txt', '', readers)).toThrow('Castor yields.csv')
    expect(
      heightCurveProblem([
        { age: 0, height: 0 },
        { age: 0, height: 1 },
      ]),
    ).toContain('repeats')
  })

  it('finds the first age a curve reaches a height, never past its last age', () => {
    const points = [
      { age: 0, height: 0 },
      { age: 10, height: 3 },
      { age: 20, height: 8 },
    ]
    expect(ageReaching(points, 5.5)).toBe(15)
    expect(ageReaching(points, 0)).toBe(0)
    expect(ageReaching(points, 9)).toBeNull()
  })
})
