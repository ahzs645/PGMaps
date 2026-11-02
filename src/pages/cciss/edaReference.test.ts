import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { assessCurrentSite, currentOptions, parseCurrentBundle, type CurrentBundle } from './currentAnalysis'

// Expected values come from running ccissr's own edatopicOverlap (R/eda_overlap.R at the pinned
// commit, onlyRegular = TRUE: the NoPhase overlap that drives species votes) on generated cases.
// Regenerate with scripts/cciss/eda-reference (see its README).
interface Edatope {
  BGC: string
  SS_NoSpace: string
  Edatopic: string
  SpecialCode: string | null
  MainUnit?: string
}
interface ReferenceCase {
  id: number
  currentBgc: string
  members: string[]
  E1: Edatope[]
  E1_Phase: Edatope[]
}
interface ReferenceRow {
  series: string
  predictedBgc: string
  predictedSeries: string
  probability: number
}
const directory = new URL('../../../scripts/cciss/eda-reference/', import.meta.url)
const { cases } = JSON.parse(readFileSync(new URL('cases.json', directory), 'utf8')) as { cases: ReferenceCase[] }
const reference = JSON.parse(readFileSync(new URL('reference.json', directory), 'utf8')) as {
  commit: string
  cases: { id: number; overlap?: ReferenceRow[]; error?: string }[]
}
const BGCS = ['A', 'B', 'C', 'D']

/** One site, eight equally weighted 2041 members, and a unique species per site series. */
function bundle(entry: ReferenceCase): CurrentBundle {
  const dimensions = entry.members.map((_, index) => ({
    array_ordinal: index + 1,
    gcm_id: index + 1,
    scenario_id: 1,
    futureperiod_id: 1,
    run_id: 1,
    gcm: `model${index + 1}`,
    scenario: 'scenario1',
    futureperiod: '2041',
    run: 'run1',
  }))
  const series = [...new Set([...entry.E1, ...entry.E1_Phase].map((row) => `${row.BGC}|${row.SS_NoSpace}`))]
  return parseCurrentBundle(
    JSON.stringify({
      schema: 'cciss-current-analysis-v1',
      provenance: {
        datasetVersion: 'Synthetic edatopic-overlap reference',
        source: 'ccissr edatopicOverlap reference cases',
        ccissrCommit: reference.commit,
        versionMatched: true,
        synthetic: true,
      },
      pilot: {
        schema: 'cciss-current-pilot-v1',
        requestValid: true,
        requestedSites: [1],
        dimensions,
        bgcCodes: BGCS.map((bgc, index) => ({ bgc_id: index + 1, bgc })),
        future: [{ siteno: 1, bgc_id: entry.members.map((bgc) => BGCS.indexOf(bgc) + 1) }],
        novelty: [{ siteno: 1, novelty: entry.members.map(() => 0) }],
        observed: [{ siteno: 1, bgc_pred: entry.currentBgc }],
        attribution: [{ siteno: 1, bgc: entry.currentBgc }],
        siteGeometry: [
          {
            siteno: 1,
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [0, 0],
                  [1, 0],
                  [1, 1],
                  [0, 1],
                  [0, 0],
                ],
              ],
            },
          },
        ],
      },
      ecology: {
        schema: 'cciss-ecology-v1',
        tables: {
          E1: entry.E1,
          E1_Phase: entry.E1_Phase,
          S1: series.map((key) => {
            const [bgc, name] = key.split('|')
            return { BGC: bgc, SS_NoSpace: name, Spp: `sp:${name}`, Feasible: 1, OHR: false }
          }),
        },
      },
    }),
  )
}

describe('edatopic overlap matches ccissr edatopicOverlap (NoPhase) on generated cases', () => {
  it('has a complete R reference for every generated case', () => {
    expect(reference.cases.map((entry) => entry.id)).toEqual(cases.map((entry) => entry.id))
    expect(reference.cases.filter((entry) => entry.error)).toEqual([])
  })

  it.each(cases.map((entry) => [entry.id, entry] as const))('case %i', (id, entry) => {
    const expected = reference.cases.find((item) => item.id === id)!.overlap ?? []
    const loaded = bundle(entry)
    const selectable = currentOptions(loaded, 1).series
    // Every current series with R overlap must be selectable in the browser.
    for (const series of new Set(expected.map((row) => row.series))) expect(selectable).toContain(series)
    for (const series of selectable) {
      const assessment = assessCurrentSite(loaded, { siteId: 1, series })
      // A species unique to each predicted series: its first-class 2041 vote is that series' probability.
      const actual = new Map(
        assessment.species
          .map((row) => [row.species.slice(3), row.votes['2041']?.[0] ?? 0] as const)
          .filter(([, probability]) => probability > 1e-12),
      )
      const wanted = new Map<string, number>()
      for (const row of expected.filter((item) => item.series === series))
        wanted.set(row.predictedSeries, (wanted.get(row.predictedSeries) ?? 0) + row.probability)
      expect([...actual.keys()].sort(), `case ${id}, current ${series}: predicted series`).toEqual(
        [...wanted.keys()].sort(),
      )
      for (const [predicted, probability] of wanted)
        expect(actual.get(predicted), `case ${id}, current ${series} → ${predicted}`).toBeCloseTo(probability, 9)
    }
  })
})
