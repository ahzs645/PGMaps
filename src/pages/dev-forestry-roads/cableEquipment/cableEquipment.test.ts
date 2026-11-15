import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { analyzeSkylineSpan, EXAMPLE_RIGGING, STANDARD_GRAVITY } from '../cableMechanics'
import { applyRiggingSetToLine, parseRiggingSets, saveRiggingSet } from '../dline/riggingSets'
import type { CableLine } from '../types'
import raw from './skylineXl.generated.json'
import {
  applyRoadEngSystemToDecoded,
  CABLE_EQUIPMENT_LIMITS,
  CABLE_LINE_ROLES,
  carriageById,
  EIPS_KG_PER_M_PER_MM2,
  equipmentCompatibility,
  equipmentProvenanceText,
  equipmentRiggingEdits,
  loadSkylineXlLibrary,
  parseCableEquipmentLibrary,
  parseRiggingSetEquipment,
  riggingSetFromEquipment,
  riggingSetToRoadEngLoggingSystem,
  roadEngLoggingSystemToRiggingSet,
  ropeFor,
  ropeById,
  skylineRopesFor,
  roadEngSystemFromDecoded,
  yarderById,
  type EquipmentRiggingResult,
  type RoadEngLoggingSystem,
} from './cableEquipment'

const lib = parseCableEquipmentLibrary(raw)
const g = STANDARD_GRAVITY
const IN = 25.4
const FT = 0.3048
const LBF = 4.4482216152605
const LBFT = 0.45359237 / 0.3048
const ok = (result: EquipmentRiggingResult) => {
  if (!result.ok) throw Error(result.error)
  return result
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

describe('SkylineXL equipment library', () => {
  it('holds the sheet’s 25 yarders, 23 carriages and 24 ropes, each with its source', async () => {
    expect(lib.source).toMatchObject({ id: 'skylinexl-25', version: '25.0', databaseUpdated: '2024-11-01' })
    expect(lib.source.licence).toMatch(/public domain/i)
    expect([lib.yarders.length, lib.carriages.length, lib.ropes.length]).toEqual([25, 23, 24])
    expect(lib.yarders.filter((y) => y.kind === 'class-average')).toHaveLength(4)
    for (const record of [...lib.yarders, ...lib.carriages, ...lib.ropes]) {
      expect(record.source).toEqual({
        dataset: 'skylinexl-25',
        version: '25.0',
        databaseUpdated: '2024-11-01',
        retrieved: '2026-11-14',
        cells: expect.stringMatching(/^Database!/),
      })
      expect(Object.keys(record.sheet).length).toBeGreaterThan(0)
    }
    expect(await loadSkylineXlLibrary()).toEqual(lib)
  })

  it('converts every value from the sheet’s English units with exact factors', () => {
    for (const rope of lib.ropes) {
      expect(rope.diameterMm).toBeCloseTo(rope.sheet.diameterIn * IN, 2)
      expect(rope.massKgPerM).toBeCloseTo(rope.sheet.weightLbPerFt * LBFT, 3)
      expect(rope.breakingForceN).toBeCloseTo(rope.sheet.breakingStrengthLbf * LBF, -1)
      expect(rope.safeWorkingLoadN).toBeCloseTo(rope.sheet.safeWorkingLoadLbf * LBF, -1)
      expect(Math.round(rope.sheet.breakingStrengthLbf / 3)).toBe(rope.sheet.safeWorkingLoadLbf)
    }
    const prefix = { skyline: 'Sky', mainline: 'ML', haulback: 'HB', slackpulling: 'SP' } as const
    for (const yarder of lib.yarders) {
      expect(yarder.towerHeightM).toBeCloseTo((yarder.sheet.Twr_ht as number) * FT, 2)
      for (const role of CABLE_LINE_ROLES) {
        const line = yarder.lines[role]
        const p = prefix[role]
        if (!line) {
          expect(yarder.sheet[`${p}_dia`]).toBe(0)
          continue
        }
        expect(line.diameterMm).toBeCloseTo((yarder.sheet[`${p}_dia`] as number) * IN, 2)
        expect(line.lengthM).toBeCloseTo((yarder.sheet[`${p}_len`] as number) * FT, 2)
        expect(line.massKgPerM).toBeCloseTo((yarder.sheet[`${p}_wt`] as number) * LBFT, 3)
        // Every yarder line is a rope-table entry, with its weight and design tension.
        const rope = ropeById(lib, line.ropeId!)!
        expect(rope).toMatchObject({ type: line.ropeType, diameterMm: line.diameterMm, massKgPerM: line.massKgPerM })
        expect(line.designTensionN).toBe(rope.safeWorkingLoadN)
      }
    }
    for (const carriage of lib.carriages) {
      expect(carriage.massKg).toBeCloseTo((carriage.sheet.Weight as number) * 0.45359237, 2)
      expect(carriage.skylineDiameterMm[0]).toBeCloseTo((carriage.sheet.Sky_min as number) * IN, 2)
    }
  })

  it('stays inside the stated ranges', () => {
    const within = (value: number, [low, high]: readonly [number, number]) => value >= low && value <= high
    const L = CABLE_EQUIPMENT_LIMITS
    for (const y of lib.yarders) {
      expect(within(y.towerHeightM, L.towerHeightM) && y.towerHeightM > 0).toBe(true)
      for (const line of Object.values(y.lines)) {
        expect(within(line.diameterMm, L.diameterMm)).toBe(true)
        expect(within(line.lengthM, L.lengthM) && line.lengthM > 0).toBe(true)
        expect(within(line.massKgPerM, L.massKgPerM)).toBe(true)
        expect(within(line.designTensionN, L.forceN)).toBe(true)
      }
    }
    for (const c of lib.carriages) expect(within(c.massKg, L.carriageKg) && c.massKg > 0).toBe(true)
    // Tower heights run from 29 ft (Koller K301) to 72 ft (Madill 172).
    expect(Math.min(...lib.yarders.map((y) => y.towerHeightM))).toBeCloseTo(29 * FT, 3)
    expect(Math.max(...lib.yarders.map((y) => y.towerHeightM))).toBeCloseTo(72 * FT, 3)
    // The EIPS mass-per-diameter ratio RoadEng skylines are read with matches the table.
    for (const rope of lib.ropes.filter((r) => r.type === 'eips')) {
      const ratio = rope.massKgPerM / rope.diameterMm ** 2 / EIPS_KG_PER_M_PER_MM2
      expect(ratio).toBeGreaterThan(0.98)
      expect(ratio).toBeLessThan(1.06)
    }
  })

  it('matches cells read by hand from the Database sheet', () => {
    // Row 9: Christy HD 3-drum, 49 ft, 3/4" swaged skyline 2,000 ft at 1.38 lb/ft and 23,333 lb.
    const christy = yarderById(lib, 'christy-hd-3-drum')!
    expect(christy.source.cells).toBe('Database!A9:AE9')
    expect(christy.towerHeightM).toBeCloseTo(14.935, 3)
    expect(christy.lines.skyline).toMatchObject({ diameterMm: 19.05, ropeType: 'swaged', lengthM: 609.6 })
    expect(christy.lines.skyline!.designTensionN).toBe(Math.round(23333 * LBF))
    expect(christy.lines.haulback).toMatchObject({ diameterMm: 11.112, ropeType: 'eips', lengthM: 1219.2 })
    // Row 24: Madill 172, 72 ft, 1-1/8" swaged 2,600 ft (3.09 lb/ft, 51,000 lb); 1/2" EIPS slackpulling 2,300 ft.
    const madill = yarderById(lib, 'madill-172-tower')!
    expect(madill.sizeClass).toBe('large')
    expect(madill.lines.skyline).toMatchObject({ diameterMm: 28.575, lengthM: 792.48, massKgPerM: 4.5984 })
    expect(madill.lines.slackpulling).toMatchObject({ diameterMm: 12.7, ropeType: 'eips', lengthM: 701.04 })
    expect(madill.notes.join(' ')).toMatch(/Database!F129/)
    // Row 25: Skagit GT3, running skyline: no skyline, drums 31 in × 28 in with 31,000 ft·lb brakes.
    const skagit = yarderById(lib, 'skagit-gt3-run')!
    expect(skagit.sizeClass).toBe('running')
    expect(skagit.lines.skyline).toBeUndefined()
    expect(skagit.drums!.haulback).toEqual({ widthMm: 787.4, diameterMm: 711.2, brakeTorqueNm: 42030.4 })
    // Row 61: Acme-228, 1,900 lb, 28 hp, slackpulls itself, skyline 3/4"–1-3/8".
    const acme = carriageById(lib, 'acme-228')!
    expect(acme).toMatchObject({
      sheetId: 5,
      massKg: 861.83,
      slackpulling: 'carriage',
      skylineClamp: true,
      multispan: true,
    })
    expect(acme.skylineDiameterMm).toEqual([19.05, 34.925])
    // Row 78: Madill MSP: yarder slackpulling, 3 drums, 125 ft dropline of 7/8".
    expect(carriageById(lib, 'madill-msp')).toMatchObject({
      slackpulling: 'yarder',
      yarderDrumsRequired: 3,
      dropline: { lengthM: 38.1, diameterMm: 22.225 },
    })
    // Rows 7 and 19 of the rope table.
    expect(ropeById(lib, 'eips-0.25in')).toMatchObject({
      diameterLabel: '1/4"',
      sheet: { breakingStrengthLbf: 6880, safeWorkingLoadLbf: 2293, weightLbPerFt: 0.12 },
    })
    expect(ropeById(lib, 'swaged-0.25in')).toBeNull()
    expect(ropeById(lib, 'swaged-1.375in')).toMatchObject({
      diameterLabel: '1-3/8"',
      breakingForceN: Math.round(222000 * LBF),
    })
    expect(ropeFor(lib, 'swaged', 25.5)!.id).toBe('swaged-1in')
  })

  it('refuses a record without a source or out of range', () => {
    const noSource = clone(raw) as { yarders: Record<string, unknown>[] }
    delete noSource.yarders[3].source
    expect(() => parseCableEquipmentLibrary(noSource)).toThrow(/source/)
    const tall = clone(raw) as { yarders: { towerHeightM: number }[] }
    tall.yarders[0].towerHeightM = 300
    expect(() => parseCableEquipmentLibrary(tall)).toThrow(/tower height/)
    const twice = clone(raw) as { carriages: unknown[] }
    twice.carriages.push(twice.carriages[0])
    expect(() => parseCableEquipmentLibrary(twice)).toThrow(/share the id/)
  })
})

describe('rigging sets from SkylineXL equipment', () => {
  it('turns every yarder with a skyline and every carriage into a set the project accepts', () => {
    let next = 0
    let sets = parseRiggingSets([])
    let count = 0
    for (const yarder of lib.yarders.filter((y) => y.lines.skyline))
      for (const carriage of lib.carriages) {
        const result = ok(riggingSetFromEquipment(lib, { yarderId: yarder.id, carriageId: carriage.id }))
        expect(parseRiggingSets([result.set])).toEqual([result.set])
        expect(parseRiggingSetEquipment(clone(result.equipment))).toEqual(result.equipment)
        if (sets.length < 50)
          sets = saveRiggingSet(sets, result.set.name, result.set.rigging, undefined, () => `s${++next}`)
        count++
      }
    expect(count).toBe(21 * 23)
    expect(sets).toHaveLength(50)
  })

  it('takes the rope table’s rope and SkylineXL’s factor, and lists what SkylineXL does not give', () => {
    const result = ok(
      riggingSetFromEquipment(lib, {
        yarderId: 'madill-071-tower',
        carriageId: 'acme-228',
        entered: { payloadKg: 4000 },
      }),
    )
    const rope = ropeById(lib, 'swaged-1in')!
    expect(result.set).toMatchObject({
      id: 'skylinexl--madill-071-tower--acme-228',
      name: 'Madill 071, tower + Acme-228',
    })
    expect(result.set.rigging).toEqual({
      ...EXAMPLE_RIGGING,
      tensionMode: 'allowable',
      ropeMassKgPerM: rope.massKgPerM,
      ropeDiameterMm: 25.4,
      breakingForceKN: rope.breakingForceN / 1000,
      safetyFactor: 3,
      payloadKg: 4000,
      carriageKg: carriageById(lib, 'acme-228')!.massKg,
      runningLinesKgPerM: 2.0537 + 1.0715,
    })
    // The allowable working tension is the yarder's design tension.
    expect((result.set.rigging.breakingForceKN * 1000) / 3).toBeCloseTo(
      yarderById(lib, 'madill-071-tower')!.lines.skyline!.designTensionN,
      -1,
    )
    expect(result.toConfirm.sort()).toEqual(['elasticModulusKNPerMm2', 'metallicFillFactor', 'minClearanceM'])
    expect(result.origin).toMatchObject({ payloadKg: 'entered', ropeMassKgPerM: 'source', minClearanceM: 'example' })
    expect(result.equipment.provenance).toMatch(
      /SkylineXL 25\.0 \(database updated 2024-11-01, public domain, retrieved 2026-11-14\)/,
    )
    expect(result.equipment.sparHeightM).toBeCloseTo(47 * FT, 3)
    expect(result.issues).toEqual([])
    // Base tension and rope beyond the span are confirmed only when they are used.
    const base = ok(
      riggingSetFromEquipment(lib, {
        yarderId: 'madill-071-tower',
        carriageId: 'acme-228',
        entered: { tensionMode: 'base' },
      }),
    )
    expect(base.toConfirm).toContain('baseTensionKN')
  })

  it('solves a span with a set and gives the D-line its rigging', () => {
    const { set, equipment } = ok(
      riggingSetFromEquipment(lib, { yarderId: 'thunderbird-tmy-50', carriageId: 'eagle-vi' }),
    )
    const solved = analyzeSkylineSpan({ horizontalM: 400, verticalM: -60 }, set.rigging)
    expect(solved.ok).toBe(true)
    const line: CableLine = {
      id: 'd',
      name: 'D',
      start: [-122, 54],
      end: [-121.99, 54],
      startHeight: equipment.sparHeightM,
      endHeight: 3,
      deflectionPercent: 6,
    }
    expect(applyRiggingSetToLine(line, set)).toMatchObject({
      sagModel: 'mechanics',
      rigging: set.rigging,
      startHeight: 50 * FT,
    })
  })

  it('reports SkylineXL’s compatibility checks without refusing the set', () => {
    const small = yarderById(lib, 'clearwater-3-drum')!
    const big = carriageById(lib, 'eagle-v-drum-sky-car')!
    expect(equipmentCompatibility(small, big)).toEqual([
      'The 12.7 mm skyline is outside Eagle-V drum sky car’s 25.4 mm–38.1 mm.'.replace('’', "'"),
      "The 9.5 mm mainline is outside Eagle-V drum sky car's 14.3 mm–15.9 mm.",
    ])
    expect(
      equipmentCompatibility(yarderById(lib, 'koller-k301-2-drum')!, carriageById(lib, 'madill-msp')!).at(-1),
    ).toMatch(/needs 3 yarder drums; Koller K301 2-drum has 2/)
    const result = ok(riggingSetFromEquipment(lib, { yarderId: small.id, carriageId: big.id }))
    expect(result.issues.length).toBeGreaterThanOrEqual(2)
    expect(
      ok(riggingSetFromEquipment(lib, { yarderId: 'avg-small-yarder-2-drum', carriageKg: 300 })).issues[0],
    ).toMatch(/average of its size class/)
  })

  it('needs a skyline rope for a running yarder, and a carriage or its mass', () => {
    const refused = riggingSetFromEquipment(lib, { yarderId: 'madill-120-swing-run', carriageId: 'acme-g23-grpl' })
    expect(refused).toEqual({ ok: false, error: expect.stringMatching(/running skyline yarder/) })
    const chosen = ok(
      riggingSetFromEquipment(lib, {
        yarderId: 'madill-120-swing-run',
        carriageId: 'acme-g23-grpl',
        skylineRopeId: 'swaged-0.75in',
      }),
    )
    expect(chosen.set.id).toBe('skylinexl--madill-120-swing-run--acme-g23-grpl--swaged-0.75in')
    expect(chosen.equipment.lines.skyline).toMatchObject({ maxLengthM: null, ropeType: 'swaged' })
    expect(chosen.equipment.configuration).toBe('Running Skyline - grapple')
    expect(riggingSetFromEquipment(lib, { yarderId: 'madill-071-tower' })).toEqual({
      ok: false,
      error: 'Choose a carriage or enter its mass.',
    })
    expect(riggingSetFromEquipment(lib, { yarderId: 'nope', carriageKg: 1 }).ok).toBe(false)
  })
})

/** Softree's cable tutorial system as its dialogs show it (lbs, ft), in SI. */
const lc550: RoadEngLoggingSystem = {
  name: 'LC550 w T-MAR 86" Grapple',
  configuration: 'Running Skyline - grapple',
  carriageWeightN: 2435 * LBF,
  equipmentName: 'LC550',
  sparHeightM: 50 * FT,
  tensionsN: { skyline: 70000 * LBF, mainline: 70000 * LBF, haulback: 67000 * LBF },
  ropeWeightNPerM: { skyline: 1.32 * LBFT * g, mainline: 1.32 * LBFT * g, haulback: 1.32 * LBFT * g },
  maxLengthM: { skyline: 1500 * FT, mainline: 1500 * FT, haulback: 3100 * FT },
}
const ty90: RoadEngLoggingSystem = {
  name: 'Shotgun',
  configuration: 'Skyline - motorized dropline car - ML',
  carriageWeightN: 5000 * LBF,
  equipmentName: 'Thunderbird TY-90',
  sparHeightM: 100 * FT,
  tensionsN: { skyline: 68200 * LBF, mainline: 31900 * LBF, haulback: 31900 * LBF, slackpulling: 8000 * LBF },
  ropeWeightNPerM: {
    skyline: 4.05 * LBFT * g,
    mainline: 1.92 * LBFT * g,
    haulback: 1.92 * LBFT * g,
    slackpulling: 0.5 * LBFT * g,
  },
  maxLengthM: { skyline: 2000 * FT, mainline: 3100 * FT, haulback: 4800 * FT, slackpulling: 500 * FT },
}

describe('RoadEng logging systems', () => {
  it('reads a system into a set whose allowable tension is RoadEng’s, and writes it back exactly', () => {
    for (const system of [lc550, ty90]) {
      const read = ok(roadEngLoggingSystemToRiggingSet(system))
      expect(parseRiggingSets([read.set])).toEqual([read.set])
      const r = read.set.rigging
      expect((r.breakingForceKN * 1000) / r.safetyFactor).toBeCloseTo(system.tensionsN.skyline, 6)
      expect(r.ropeMassKgPerM * g).toBeCloseTo(system.ropeWeightNPerM.skyline, 9)
      expect(r.runningLinesKgPerM * g).toBeCloseTo(system.ropeWeightNPerM.mainline + system.ropeWeightNPerM.haulback, 9)
      expect(r.carriageKg * g).toBeCloseTo(system.carriageWeightN, 9)
      expect(read.derived).toEqual(['ropeDiameterMm', 'breakingForceKN', 'safetyFactor'])
      // Through the project file and back to RoadEng, nothing changes.
      const [set] = parseRiggingSets(clone([read.set]))
      const equipment = parseRiggingSetEquipment(clone(read.equipment))
      const written = riggingSetToRoadEngLoggingSystem(set, equipment)
      expect(written).toEqual({ ok: true, system, notes: [] })
    }
    const read = ok(roadEngLoggingSystemToRiggingSet(lc550))
    expect(read.set).toMatchObject({ id: 'roadeng-lc550-w-t-mar-86-grapple', name: 'LC550 w T-MAR 86" Grapple' })
    // 1.32 lb/ft read as an EIPS rope: about 21.5 mm.
    expect(read.set.rigging.ropeDiameterMm).toBeCloseTo(21.47, 2)
    expect(read.equipment.provenance).toMatch(
      /^From RoadEng logging system "LC550 w T-MAR 86" Grapple" \(equipment LC550\)/,
    )
    expect(read.issues[0]).toMatch(/rigs "LC550 w T-MAR 86" Grapple" as Running Skyline - grapple/)
    expect(ok(roadEngLoggingSystemToRiggingSet(ty90)).issues).toEqual([])
  })

  it('writes an edited set’s rope, tension and carriage, sharing changed running lines as the yarder did', () => {
    const read = ok(roadEngLoggingSystemToRiggingSet(ty90))
    const edited = {
      ...read.set,
      rigging: { ...read.set.rigging, breakingForceKN: 900, runningLinesKgPerM: 10, carriageKg: 1000 },
    }
    const written = riggingSetToRoadEngLoggingSystem(edited, read.equipment)
    if (!written.ok) throw Error(written.error)
    expect(written.system.tensionsN).toEqual({ ...ty90.tensionsN, skyline: 300_000 })
    expect(written.system.carriageWeightN).toBeCloseTo(1000 * g, 9)
    expect(written.system.ropeWeightNPerM.mainline).toBeCloseTo(5 * g, 9)
    expect(written.system.ropeWeightNPerM.haulback).toBeCloseTo(5 * g, 9)
    expect(written.notes[0]).toMatch(/shared between mainline and haulback/)
  })

  it('writes a SkylineXL set as a RoadEng system and reads the same rope back', () => {
    const made = ok(riggingSetFromEquipment(lib, { yarderId: 'madill-172-tower', carriageId: 'eagle-vi' }))
    const written = riggingSetToRoadEngLoggingSystem(made.set, made.equipment)
    if (!written.ok) throw Error(written.error)
    expect(written.system).toMatchObject({
      equipmentName: 'Madill 172, tower',
      name: 'Madill 172, tower + Eagle VI',
      configuration: 'Skyline - motorized dropline car - ML',
    })
    expect(written.system.maxLengthM).toEqual({
      skyline: 792.48,
      mainline: 883.92,
      haulback: 1676.4,
      slackpulling: 701.04,
    })
    expect(written.notes[0]).toMatch(/closest RoadEng configuration/)
    const back = ok(roadEngLoggingSystemToRiggingSet(written.system))
    for (const key of ['ropeMassKgPerM', 'carriageKg', 'runningLinesKgPerM'] as const)
      expect(back.set.rigging[key]).toBeCloseTo(made.set.rigging[key], 9)
    expect((back.set.rigging.breakingForceKN * 1000) / back.set.rigging.safetyFactor).toBeCloseTo(
      (made.set.rigging.breakingForceKN * 1000) / made.set.rigging.safetyFactor,
      6,
    )
  })

  it('round trips the section-8 reader’s own record, keeping the fields it does not know', () => {
    const line = (lbf: number, lbft: number, ft: number) => ({
      maxTensionKN: (lbf * LBF) / 1000,
      weightKgPerM: lbft * LBFT,
      maxLengthM: ft * FT,
    })
    const decoded = {
      id: '2',
      name: 'Shotgun',
      configuration: 'Skyline - motorized dropline car - ML',
      configurationCode: 2,
      options: [1, 0, 0, 0, 1, 1, 0, 1],
      carriageKg: 5000 * 0.45359237,
      equipment: {
        name: 'Thunderbird TY-90',
        sparHeightM: 100 * FT,
        skyline: line(68200, 4.05, 2000),
        mainline: line(31900, 1.92, 3100),
        haulback: line(31900, 1.92, 4800),
        fourth: line(8000, 0.5, 500),
        machineCode: 3,
      },
      raw: 'AAAA',
    }
    const system = roadEngSystemFromDecoded(decoded)
    expect(system.tensionsN.skyline).toBeCloseTo(ty90.tensionsN.skyline, 6)
    const read = ok(roadEngLoggingSystemToRiggingSet(system))
    const written = riggingSetToRoadEngLoggingSystem(read.set, read.equipment)
    if (!written.ok) throw Error(written.error)
    expect(applyRoadEngSystemToDecoded(decoded, written.system)).toEqual(decoded)
    // An edit reaches the decoded record in its own units.
    const heavier = { ...read.set, rigging: { ...read.set.rigging, carriageKg: 3000 } }
    const edited = riggingSetToRoadEngLoggingSystem(heavier, read.equipment)
    if (!edited.ok) throw Error(edited.error)
    expect(applyRoadEngSystemToDecoded(decoded, edited.system).carriageKg).toBeCloseTo(3000, 9)
  })

  it('refuses a system without a skyline, and a set without its yarder record or line lengths', () => {
    expect(roadEngLoggingSystemToRiggingSet({ ...lc550, tensionsN: { ...lc550.tensionsN, skyline: 0 } })).toEqual({
      ok: false,
      error: expect.stringMatching(/no skyline tension or weight/),
    })
    const read = ok(roadEngLoggingSystemToRiggingSet(lc550))
    expect(riggingSetToRoadEngLoggingSystem(read.set)).toEqual({
      ok: false,
      error: expect.stringMatching(/no yarder record/),
    })
    const running = ok(
      riggingSetFromEquipment(lib, { yarderId: 'skagit-gt3-run', carriageKg: 500, skylineRopeId: 'swaged-0.875in' }),
    )
    expect(riggingSetToRoadEngLoggingSystem(running.set, running.equipment)).toEqual({
      ok: false,
      error: expect.stringMatching(/no skyline length/),
    })
  })
})

describe('values changed since a set was made from its equipment', () => {
  it('reads every SkylineXL and RoadEng set as unchanged, and names each value changed after', () => {
    for (const yarder of lib.yarders)
      for (const carriage of lib.carriages) {
        const result = riggingSetFromEquipment(lib, {
          yarderId: yarder.id,
          carriageId: carriage.id,
          ...(yarder.lines.skyline ? {} : { skylineRopeId: skylineRopesFor(lib, carriage)[0].id }),
        })
        if (!result.ok) throw Error(`${yarder.id} + ${carriage.id}: ${result.error}`)
        const equipment = parseRiggingSetEquipment(clone(result.equipment))
        expect(equipmentRiggingEdits(result.set.rigging, equipment)).toEqual([])
        expect(equipmentProvenanceText(result.set.rigging, equipment)).toBe(equipment.provenance)
      }
    for (const system of [lc550, ty90]) {
      const read = ok(roadEngLoggingSystemToRiggingSet(system, { entered: { payloadKg: 1200, minClearanceM: 3 } }))
      expect(equipmentRiggingEdits(read.set.rigging, read.equipment)).toEqual([])
    }
    const read = ok(roadEngLoggingSystemToRiggingSet(ty90))
    const r = read.set.rigging
    // Payload and clearance come from no equipment source, so changing them is not an edit of it.
    expect(equipmentRiggingEdits({ ...r, payloadKg: r.payloadKg + 1, minClearanceM: 9 }, read.equipment)).toEqual([])
    const edited = { ...r, ropeMassKgPerM: r.ropeMassKgPerM * 1.01, safetyFactor: 2.5, runningLinesKgPerM: 3 }
    expect(equipmentRiggingEdits(edited, read.equipment)).toEqual([
      'ropeMassKgPerM',
      'safetyFactor',
      'runningLinesKgPerM',
    ])
    expect(equipmentProvenanceText(edited, read.equipment)).toBe(
      `${read.equipment.provenance} Changed in this project since: skyline mass, safety factor and running lines.`,
    )
    // A record without a skyline cannot vouch for any value.
    const others = { ...read.equipment.lines }
    delete others.skyline
    expect(equipmentRiggingEdits(r, { ...read.equipment, lines: others })).toHaveLength(6)
  })
})

// Softree's cable tutorial terrains (`Terrain_cables/*.terx`), read with section 8's 312-byte record
// layout (roadeng-prior-art §2.4). The decoder here is only enough to feed the round trip.
const samples = process.env.ROADENG_SAMPLES
const cableDir = samples ? join(samples, 'Terrain_cables') : ''
describe.skipIf(!samples || !existsSync(cableDir))('RoadEng tutorial logging systems', () => {
  const RECORD = 312
  const text = (bytes: Uint8Array, at: number, max: number) => {
    let end = at
    while (end < at + max && bytes[end] !== 0) end++
    return new TextDecoder('latin1').decode(bytes.subarray(at, end))
  }
  function systems(ter: Uint8Array): RoadEngLoggingSystem[] {
    const view = new DataView(ter.buffer, ter.byteOffset, ter.byteLength)
    const sizes = Array.from({ length: 9 }, (_, i) => view.getUint32(2 + 4 * i, true))
    const start = 0x26 + sizes.slice(0, 8).reduce((a, b) => a + b, 0)
    const out: RoadEngLoggingSystem[] = []
    for (let at = start; at + RECORD <= start + sizes[8]; at += RECORD) {
      const f = (o: number) => view.getFloat64(at + o, true)
      const lines = (o: number, unit: number) => ({
        skyline: f(o) * unit,
        mainline: f(o + 8) * unit,
        haulback: f(o + 16) * unit,
        slackpulling: f(o + 24) * unit,
      })
      out.push({
        name: text(ter, at + 10, 54),
        configuration: text(ter, at + 64, 72),
        carriageWeightN: f(136) * LBF,
        equipmentName: text(ter, at + 144, 56),
        sparHeightM: f(200) * FT,
        tensionsN: lines(216, LBF),
        ropeWeightNPerM: lines(248, LBFT * g),
        maxLengthM: lines(280, FT),
      })
    }
    return out
  }
  const files = existsSync(cableDir) ? readdirSync(cableDir).filter((f) => f.endsWith('.terx')) : []

  it.each(files)('%s: every system with a skyline round trips through a rigging set', (file) => {
    const zip = unzipSync(readFileSync(join(cableDir, file)), { filter: (entry) => entry.name.endsWith('.ter') })
    const ter = Object.values(zip)[0]
    const found = systems(ter)
    expect(found.length).toBeGreaterThanOrEqual(4)
    let converted = 0
    for (const system of found) {
      const read = roadEngLoggingSystemToRiggingSet(system)
      if (!read.ok) {
        expect(read.error).toMatch(/no skyline/)
        continue
      }
      converted++
      expect(parseRiggingSets([read.set])).toHaveLength(1)
      expect(equipmentRiggingEdits(read.set.rigging, read.equipment)).toEqual([])
      expect(riggingSetToRoadEngLoggingSystem(read.set, parseRiggingSetEquipment(clone(read.equipment)))).toEqual({
        ok: true,
        system,
        notes: [],
      })
    }
    expect(converted).toBeGreaterThan(0)
  })
})
