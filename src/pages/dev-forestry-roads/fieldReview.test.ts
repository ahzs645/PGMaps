import { describe, expect, it } from 'vitest'
import { offsetCoordinate } from './engine'
import {
  crossingCheckDrafts,
  fieldPackKml,
  issueRoad,
  nextIssueLabel,
  parseFieldReview,
  readObservation,
  readObservations,
  roadCentreline,
  stationCandidates,
  type FieldReviewState,
} from './fieldReview'
import { parseKml } from './surveyInterchange'
import { DEFAULT_TEMPLATE } from './terrain'
import type { Alignment, Coordinate } from './types'

const origin: Coordinate = [-122.8, 53.9]
function road(points: Coordinate[], id = 'r'): Alignment {
  return {
    id,
    name: `Road ${id}`,
    color: '#16817a',
    points: points.map((coordinate, i) => ({ id: `${id}${i}`, coordinate, radiusM: 0 })),
    vertical: [{ id: 's', chainage: 0, elevation: 800, curveLength: 0 }],
    template: { ...DEFAULT_TEMPLATE },
    overrides: [],
  }
}
const north = (m: number, from = origin) => offsetCoordinate(from, 0, m)
let n = 0
const ids = () => `id-${++n}`
const station = (s: number) => `${Math.floor(s / 1000)}+${String(Math.round(s % 1000)).padStart(3, '0')}`

function issued(alignment = road([origin, north(400)])) {
  return issueRoad({
    alignment,
    label: 'FR-01',
    revision: 'A',
    issuedOn: '2026-11-17',
    terrain: { name: 'LiDAR', verticalReference: 'CGVD2013' },
    checks: [
      ...crossingCheckDrafts([
        { id: 'x2', chainage: 300, name: 'Mapped stream B' },
        { id: 'x1', chainage: 120, name: 'Mapped stream A' },
      ]),
      { kind: 'rock', chainage: 200, endChainage: 260 },
    ],
    station,
    id: ids,
  })
}

describe('issuing a road for field review', () => {
  it('keeps the fitted centreline, labels checks in station order and prints stations', () => {
    const issue = issued()
    expect(issue.lengthM).toBeCloseTo(400, 1)
    expect(issue.centreline.length).toBe(issue.chainages.length)
    expect(issue.checks.map((c) => [c.label, c.chainage, c.station])).toEqual([
      ['C-01', 120, '0+120'],
      ['C-02', 300, '0+300'],
      ['R-01', 200, '0+200 to 0+260'],
    ])
    expect(issue.checks[0].crossingId).toBe('x1')
    expect(issue.ticks.map((t) => t.label)).toEqual(['0+000', '0+100', '0+200', '0+300', '0+400'])
    expect(nextIssueLabel({ issues: [issue], observations: [] })).toBe('FR-02')
  })

  it('leaves an empty revision blank in the KML unless the project asks for "not recorded"', () => {
    const unrevised = { ...issued(), revision: '' }
    const centreline = (kml: string) => /Issued centreline\. (.*?)\. Preliminary/.exec(kml)?.[1]
    expect(centreline(fieldPackKml(unrevised))).toBe('FR-01 · Road r · Rev · 2026-11-17')
    expect(centreline(fieldPackKml(unrevised, 'stated'))).toBe('FR-01 · Road r · Rev not recorded · 2026-11-17')
    expect(centreline(fieldPackKml(issued()))).toBe('FR-01 · Road r · Rev A · 2026-11-17')
  })

  it('writes a KML whose check labels and ids survive PGMaps’ own reader', () => {
    const issue = issued()
    const read = parseKml(fieldPackKml(issue))
    const checks = read.features.filter((f) => f.properties?.check)
    expect(checks.map((f) => [f.properties!.check, f.properties!.issue_label, f.geometry.type])).toEqual([
      ['C-01', 'FR-01', 'Point'],
      ['C-02', 'FR-01', 'Point'],
      ['R-01', 'FR-01', 'LineString'],
    ])
    expect(checks[0].properties!.check_id).toBe(issue.checks[0].id)
    expect(checks[0].properties!.name).toBe('C-01 Crossing')
  })
})

describe('reading returned observations', () => {
  const returned = (body: string) =>
    parseKml(`<kml xmlns="http://www.opengis.net/kml/2.2"><Document>${body}</Document></kml>`)

  it('matches by the label a crew wrote, and adds nothing when the same file is read again', () => {
    const issue = issued()
    const at = offsetCoordinate(north(298), 90, 6)
    const file = returned(
      `<Placemark id="a1"><name>c-02 culvert needed</name><description>1.2 m channel, flowing</description><Point><coordinates>${at[0]},${at[1]}</coordinates></Point></Placemark>` +
        `<Placemark><name>Seep</name><ExtendedData><Data name="check"><value>R-01</value></Data><Data name="notes"><value>bedrock at 0.4 m</value></Data></ExtendedData><Point><coordinates>${north(230)[0]},${north(230)[1]}</coordinates></Point></Placemark>` +
        `<Placemark><name>Track</name><LineString><coordinates>${origin[0]},${origin[1]} ${north(50)[0]},${north(50)[1]}</coordinates></LineString></Placemark>`,
    )
    let state: FieldReviewState = { issues: [issue], observations: [] }
    const first = readObservations(state, file, 'return.kml')
    expect(first.skipped).toBe(1)
    expect(first.added.map((o) => [o.name, o.checkId, o.match, o.issueId])).toEqual([
      ['c-02 culvert needed', issue.checks[1].id, 'file', issue.id],
      ['Seep', issue.checks[2].id, 'file', issue.id],
    ])
    expect(first.added[1].note).toBe('bedrock at 0.4 m')
    state = { ...state, observations: first.added }
    const again = readObservations(state, file, 'return.kml')
    expect(again).toMatchObject({ added: [], duplicates: 2 })
  })

  it('keeps an observation on the issued station after the road has moved', () => {
    const issue = issued()
    const at = offsetCoordinate(north(300), 90, 4)
    const [observation] = readObservations(
      { issues: [issue], observations: [] },
      returned(`<Placemark><name>C-02</name><Point><coordinates>${at[0]},${at[1]}</coordinates></Point></Placemark>`),
      'r.kml',
    ).added
    // The designer swings the road 30 m east and starts it 50 m further north.
    const moved = road([offsetCoordinate(north(50), 90, 30), offsetCoordinate(north(450), 90, 30)])
    const reading = readObservation(
      { issues: [issue], observations: [observation] },
      observation,
      roadCentreline(moved),
    )
    expect(reading.check?.label).toBe('C-02')
    expect(reading.issued[0].chainage).toBeCloseTo(300, 0)
    expect(reading.issued[0].offset).toBeCloseTo(4, 0)
    expect(reading.current[0].chainage).toBeCloseTo(250, 0)
    expect(reading.current[0].offset).toBeCloseTo(-26, 0)
  })

  it('gives both legs of a switchback as candidates and never picks one', () => {
    const hairpin = road([origin, north(300), offsetCoordinate(north(300), 90, 40), offsetCoordinate(origin, 90, 40)])
    const line = roadCentreline(hairpin)!
    const between = offsetCoordinate(north(150), 90, 20)
    const candidates = stationCandidates(line.line, line.chainages, between)
    expect(candidates).toHaveLength(2)
    expect(candidates.map((c) => Math.round(c.chainage)).sort((a, b) => a - b)).toEqual([150, 490])
    // Right of the up leg, and right of the down leg too: offsets are signed looking up-station.
    expect(candidates.every((c) => c.offset > 0 && Math.abs(c.distanceM - 20) < 0.5)).toBe(true)
  })

  it('lists nearby checks for an unlabelled point and leaves the match to the designer', () => {
    const issue = issued()
    const at = offsetCoordinate(north(125), 270, 8)
    const [observation] = readObservations(
      { issues: [issue], observations: [] },
      returned(`<Placemark><name>Wet</name><Point><coordinates>${at[0]},${at[1]}</coordinates></Point></Placemark>`),
      'r.kml',
    ).added
    expect(observation).toMatchObject({ checkId: null, match: null, issueId: issue.id })
    const reading = readObservation({ issues: [issue], observations: [observation] }, observation, null)
    expect(reading.nearChecks.map((c) => c.check.label)).toEqual(['C-01'])
    expect(reading.current).toEqual([])
  })
})

describe('saving field review', () => {
  it('round-trips and refuses broken records', () => {
    const state: FieldReviewState = { issues: [issued()], observations: [] }
    expect(parseFieldReview(JSON.parse(JSON.stringify(state)))).toEqual(state)
    const twice = { issues: [state.issues[0], state.issues[0]], observations: [] }
    expect(() => parseFieldReview(twice)).toThrow(/Invalid field review issue/)
    const bad = structuredClone(state)
    bad.issues[0].checks[0].kind = 'bridge' as never
    expect(() => parseFieldReview(bad)).toThrow(/Invalid field review issue/)
  })
})
