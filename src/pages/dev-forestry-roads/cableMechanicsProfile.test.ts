import { describe, expect, it } from 'vitest'
import { EXAMPLE_RIGGING } from './cableMechanics'
import { analyzeCable, distance, offsetCoordinate } from './engine'
import { cableProfileCsv, cableProfileHtml } from './profileOutputs'
import { parseProject } from './project'
import { createDemoProject } from './terrain'
import type { CableLine, Coordinate, TerrainMetadata, TerrainSource } from './types'

const origin: Coordinate = [-122.8, 53.9]
const north = (metres: number) => offsetCoordinate(origin, 0, metres)
const along = (lng: number, lat: number) => distance(origin, [lng, lat])
const flat: TerrainSource = { elevationAt: () => 800 }
const metadata: TerrainMetadata = { kind: 'demo', name: 'Synthetic', resolutionM: 1, verticalReference: 'Synthetic' }
const assumed: CableLine = {
  id: 'd-line',
  name: 'D-line',
  start: origin,
  end: north(300),
  startHeight: 15,
  endHeight: 12,
  deflectionPercent: 4,
}
const mechanics: CableLine = { ...assumed, sagModel: 'mechanics', rigging: { ...EXAMPLE_RIGGING, minClearanceM: 2 } }

describe('D-line rope mechanics', () => {
  it('leaves the assumed-sag analysis unchanged and adds the solved skyline beside it', () => {
    const plain = analyzeCable(assumed, flat)
    expect(plain.mechanics).toBeUndefined()
    // Rigging saved on an assumed-sag line is kept but not used.
    expect(analyzeCable({ ...assumed, sagModel: 'assumed', rigging: EXAMPLE_RIGGING }, flat)).toEqual(plain)
    const solved = analyzeCable(mechanics, flat)
    const { mechanics: m, ...rest } = solved
    expect(rest).toEqual(plain)
    expect(m!.error).toBeNull()
    expect(m!.samples).toHaveLength(solved.samples.length)
    // Supports at 815 and 812 m; the load path starts and ends on them.
    expect(m!.samples[0].loadPath).toBeCloseTo(815, 6)
    expect(m!.samples.at(-1)!.loadPath).toBeCloseTo(812, 6)
    const mid = m!.span!.midSpan
    expect(m!.span!.span).toEqual({ horizontalM: expect.closeTo(300, 6), verticalM: expect.closeTo(-3, 6) })
    expect(m!.span!.maxTension.tensionN).toBeCloseTo(424_000 / 3, -2)
    expect(m!.tensionOk).toBe(true)
    // On flat ground the tightest point is under the carriage near mid-span.
    expect(m!.minLoadClearance!).toBeCloseTo(813.5 - 800 - mid.sagBelowChordM, 0)
    expect(m!.complete).toBe(true)
    expect(m!.clearanceOk).toBe(m!.minLoadClearance! >= 2)
  })

  it('finds a knoll near the yarder that an assumed parabola with the same mid-span sag clears', () => {
    const midSag = analyzeCable(mechanics, flat).mechanics!.span!.midSpan.sagBelowChordM
    // A 40 m deep valley with a knoll 40 m out from the yarder: it pinches the load path, not the parabola.
    const knoll: TerrainSource = {
      elevationAt: (lng, lat) => {
        const d = along(lng, lat),
          t = d / 300
        return 800 - 160 * t * (1 - t) + 20 * Math.exp(-(((d - 40) / 8) ** 2))
      },
    }
    const parabola = analyzeCable({ ...assumed, deflectionPercent: (100 * midSag) / 300 }, knoll)
    const solved = analyzeCable(mechanics, knoll).mechanics!
    expect(parabola.minClearance!).toBeGreaterThan(solved.minLoadClearance! + 1.5)
    expect(solved.minLoadClearanceAt!).toBeGreaterThan(30)
    expect(solved.minLoadClearanceAt!).toBeLessThan(50)
  })

  it('keeps unknown ground unknown and refuses a skyline with an unknown support', () => {
    const hole: TerrainSource = {
      elevationAt: (lng, lat) => (Math.abs(along(lng, lat) - 150) < 5 ? NaN : 800),
    }
    const gap = analyzeCable(mechanics, hole).mechanics!
    expect(gap.error).toBeNull()
    expect(gap.complete).toBe(false)
    expect(gap.minLoadClearance).toBeNull()
    expect(gap.clearanceOk).toBeNull()
    expect(gap.samples.some((s) => s.loadPath !== null && s.loadClearance === null)).toBe(true)
    const noSupport: TerrainSource = { elevationAt: (lng, lat) => (along(lng, lat) < 1 ? NaN : 800) }
    const unsolved = analyzeCable(mechanics, noSupport).mechanics!
    expect(unsolved.error).toMatch(/support is unknown/)
    expect(unsolved.span).toBeNull()
    expect(unsolved.samples.every((s) => s.loadPath === null)).toBe(true)
    // Rigging that cannot carry the load is reported, not thrown.
    const weak = analyzeCable({ ...mechanics, rigging: { ...EXAMPLE_RIGGING, breakingForceKN: 50 } }, flat).mechanics!
    expect(weak.error).toMatch(/half the load/)
  })

  it('exports the load path and its assumptions, and refuses a stale rigging', () => {
    const solved = analyzeCable(mechanics, flat)
    const csv = cableProfileCsv(mechanics, solved, metadata)
    const [header, first] = csv.split('\r\n')
    const columns = header.split(',')
    expect(columns.slice(-28, -26)).toEqual(['sag_model', 'load_path_elevation_m'])
    expect(columns).toContain('load_clearance_m')
    expect(columns).toContain('max_tension_kn')
    expect(first).toContain('"mechanics"')
    expect(csv).toContain('Not a rigging, anchor or WorkSafeBC compliance check.')
    // The assumed-sag export keeps its columns exactly.
    const plainHeader = cableProfileCsv(assumed, analyzeCable(assumed, flat), metadata).split('\r\n')[0]
    expect(header.startsWith(plainHeader)).toBe(true)
    expect(plainHeader).not.toContain('sag_model')
    const html = cableProfileHtml(mechanics, solved, metadata)
    expect(html).toContain('<h2>Rope mechanics</h2>')
    expect(html).toContain('Loaded carriage (m)')
    expect(html).toContain('Allowable tension (kN)')
    expect(() =>
      cableProfileCsv({ ...mechanics, rigging: { ...mechanics.rigging!, payloadKg: 1000 } }, solved, metadata),
    ).toThrow(/rope mechanics do not match/)
    expect(() => cableProfileHtml(assumed, solved, metadata)).toThrow(/rope mechanics do not match/)
  })

  it('saves and reloads the sag model and rigging, and refuses out-of-range rigging', () => {
    const project = createDemoProject()
    const line = { ...project.cables[0], sagModel: 'mechanics' as const, rigging: EXAMPLE_RIGGING }
    const reloaded = parseProject(JSON.parse(JSON.stringify({ ...project, cables: [line] })))
    expect(reloaded.cables[0].sagModel).toBe('mechanics')
    expect(reloaded.cables[0].rigging).toEqual(EXAMPLE_RIGGING)
    // Old files without either field still load unchanged.
    expect(parseProject(JSON.parse(JSON.stringify(project))).cables[0].sagModel).toBeUndefined()
    const broken = (patch: object) =>
      parseProject(JSON.parse(JSON.stringify({ ...project, cables: [{ ...line, ...patch }] })))
    expect(() => broken({ rigging: { ...EXAMPLE_RIGGING, safetyFactor: 0 } })).toThrow(/Safety factor/)
    expect(() => broken({ rigging: undefined })).toThrow(/needs its rigging/)
    expect(() => broken({ sagModel: 'catenary' })).toThrow(/sag model/)
    // A combination that cannot carry the load still loads; the analysis reports it.
    expect(() => broken({ rigging: { ...EXAMPLE_RIGGING, breakingForceKN: 20 } })).not.toThrow()
  })
})
