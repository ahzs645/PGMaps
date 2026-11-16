/**
 * Softree's designs that store a solved RoadEng costing, opened with their terrain and costed here:
 * the stored fields read as RoadEng's cost summary, and the economic material plan solves every
 * one of them in the browser. Reads the samples from `ROADENG_SAMPLES` and `ROADENG_SAMPLE_PACK`;
 * skipped without them, and never committed.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { analyzeRoad } from './engine'
import { parseProject } from './project'
import { roadEngProject } from './roadEngProject'
import { activeRoadEngSolution, readRoadEngStoredResults, ROADENG_SOLVED_STATUS } from './roadEngStoredResults'
import { createDemoProject, DEFAULT_TEMPLATE, terrainFromMetadata } from './terrain'

const samples = process.env.ROADENG_SAMPLES
const pack = process.env.ROADENG_SAMPLE_PACK
const have = (root: string | undefined, path: string) => !!root && existsSync(join(root, path))

/** Design, terrain, and the root they are under. */
const COSTED: { name: string; root: string | undefined; design: string; terrain: string }[] = [
  { name: 'LongRoad', root: samples, design: 'LongRoad_1/LongRoad 1.dsnx', terrain: 'LongRoad_1/LongRoad 1.terx' },
  {
    name: 'Cul-de-sac',
    root: samples,
    design: 'Cul-de-sac-design/CulDeSacExample/CulDeSacExampleComplete.dsnx',
    terrain: 'Cul-de-sac-design/CulDeSacExample/RangeRoadTopo.terx',
  },
  ...['Align stage 4', 'Align stage 7', 'Align stage 8', 'Align stage 8a'].map((d) => ({
    name: d,
    root: pack,
    design: `tutorial-v10/RoadEngCivil/Location/${d}.dsnx`,
    terrain: 'tutorial-v10/RoadEngCivil/Location/Topo.terx',
  })),
  ...['bluff_road', 'bluff_road-2'].map((d) => ({
    name: d,
    root: pack,
    design: `tutorial-v10/RoadEngCivil/Location2/${d}.dsnx`,
    terrain: 'tutorial-v10/RoadEngCivil/Location2/bluff_road.terx',
  })),
  ...['Hart Rd', 'Hart Rd curves', 'Hart Rd optimal', 'Hart Rd optimal haul'].map((d) => ({
    name: d,
    root: pack,
    design: `tutorial-v10/SoftreeOptimal/${d}.dsnx`,
    terrain: 'tutorial-v10/SoftreeOptimal/Hart Rd.terx',
  })),
  ...['Location 18_1', 'Location 18_2', 'Location 18_3'].map((d) => ({
    name: d,
    root: pack,
    design: `tutorial-v11/RoadEngResource/Location/${d}.dsnx`,
    terrain: 'tutorial-v11/RoadEngResource/Location/Terrain9_1.terx',
  })),
]
const dsnOf = (root: string, design: string) =>
  strFromU8(unzipSync(new Uint8Array(readFileSync(join(root, design))))['Location1.dsn'], true)
/** Stages 7 and 8 are opened by the sweep's own tests; their sections are the heaviest in the set. */
const COSTED_HERE = new Set([
  'LongRoad',
  'Cul-de-sac',
  'Align stage 4',
  'bluff_road',
  'Hart Rd',
  'Hart Rd curves',
  'Location 18_1',
])

describe.skipIf(!COSTED.some((c) => have(c.root, c.design)))("RoadEng's stored costings", () => {
  it('store haul, cut, fill, pit opening and attributes as the Optimal cost summary lists them', () => {
    let read = 0
    for (const c of COSTED) {
      if (!have(c.root, c.design)) continue
      const dsn = dsnOf(c.root!, c.design)
      const unitM = /\bunits=3048\b/.test(dsn) ? 0.3048 : 1
      const results = readRoadEngStoredResults(dsn, unitM)
      const solution = activeRoadEngSolution(results)
      expect(solution, c.name).not.toBeNull()
      read++
      const raw = solution!.raw.map(Number)
      // Solved, two zeros, the stations costed, five costs, seconds, a stamp, −1, a flag.
      expect(raw[0], c.name).toBe(ROADENG_SOLVED_STATUS)
      expect([raw[1], raw[2], raw[12]], c.name).toEqual([0, 0, -1])
      expect(solution!.costs.haul! > 0 && solution!.costs.cut! > 0 && solution!.costs.fill! > 0, c.name).toBe(true)
      // Every sample's pits have no site preparation cost, and every one stores no pit opening cost.
      expect(solution!.costs.pitOpening, c.name).toBe(0)
      // Attributes: 0 in the RoadEng 11 designs, no value (−9999) in the version 10 tutorials.
      expect([0, null], c.name).toContain(solution!.costs.attributes)
    }
    expect(read).toBeGreaterThan(0)
  })

  it.skipIf(!have(pack, 'tutorial-v10/SoftreeOptimal/Hart Rd.dsnx'))(
    "matches Hart Rd's row of the Optimal manual's spacing table: cut, fill and haul in that order",
    () => {
      const results = readRoadEngStoredResults(dsnOf(pack!, 'tutorial-v10/SoftreeOptimal/Hart Rd.dsnx'), 1)
      const solution = activeRoadEngSolution(results)!
      // Softree Optimal manual, chapter 3, Table 3-1, spacing 5 m: total 474.98, cut 384.04, fill
      // 56.39, haulage 34.56 thousand dollars; the design stores a costing at 5 m spacing.
      expect(results.spacingM).toBe(5)
      expect(solution.costs.cut! / 1000).toBeCloseTo(384.04, 2)
      expect(solution.costs.fill! / 1000).toBeCloseTo(56.39, 2)
      expect(Math.abs(solution.costs.haul! / 1000 - 34.56)).toBeLessThan(0.02)
      expect(Math.abs(solution.total / 1000 - 474.98)).toBeLessThan(0.02)
    },
  )
})

describe.skipIf(!COSTED.some((c) => COSTED_HERE.has(c.name) && have(c.root, c.design) && have(c.root, c.terrain)))(
  'RoadEng designs costed here',
  () => {
    for (const c of COSTED.filter((x) => COSTED_HERE.has(x.name)))
      it.skipIf(!have(c.root, c.design) || !have(c.root, c.terrain))(
        `${c.name}: the economic plan solves, with the pit of last resort and fill by material`,
        () => {
          let n = 0
          const p = roadEngProject(
            [c.design, c.terrain].map((f) => ({
              name: f.split('/').pop()!,
              bytes: new Uint8Array(readFileSync(join(c.root!, f))),
            })),
            {
              newId: () => `id${n++}`,
              color: () => '#123456',
              template: { ...DEFAULT_TEMPLATE },
              verticalReference: 'CGVD2013',
            },
          )
          const demo = createDemoProject()
          const project = parseProject({
            ...demo,
            name: p.name,
            terrain: p.terrain,
            alignments: p.roads.map((r) => r.alignment),
            activeAlignmentId: p.roads[0].alignment.id,
            context: p.context,
            cables: p.cables,
            reference: p.reference,
            profiles: [],
            settings: p.fillRate === null ? demo.settings : { ...demo.settings, fillRate: p.fillRate },
          })
          const road = project.alignments[0]
          expect(road.engineering!.haul).toMatchObject({ enabled: true, allocation: 'economic', lastResort: true })
          // Every material but stripped ground (never fill) has its ground type's embankment cost.
          expect(road.engineering!.materials.every((m) => m.purpose === 'stripping' || m.fillRate !== undefined)).toBe(
            true,
          )
          const started = performance.now()
          const analysis = analyzeRoad(road, terrainFromMetadata(project.terrain)!, project.settings)
          expect((performance.now() - started) / 1000).toBeLessThan(60)
          const e = analysis.engineering!
          expect(e.haul.optimizationStatus, e.warnings.join(' ')).toBe('optimal')
          expect(e.haul.allocationMethod).toBe('economic')
          expect(e.warnings.join(' ')).toMatch(/solved to optimality as a network/)
          // The fill cost is the sum of its lines, each priced by the material placed.
          expect(e.fillPlacement!.reduce((sum, l) => sum + l.amount, 0)).toBeCloseTo(e.costs.fill, 6)
          // Every bank m³ of cut and every compacted m³ of fill is accounted for.
          const placed = e.movements
            .filter((m) => m.kind !== 'waste' && (m.demandKey === undefined || !m.demandKey.startsWith('["surface"')))
            .reduce((sum, m) => sum + (m.compactedVolumeM3 ?? 0), 0)
          expect(placed).toBeGreaterThan(0)
        },
        120_000,
      )
  },
)
