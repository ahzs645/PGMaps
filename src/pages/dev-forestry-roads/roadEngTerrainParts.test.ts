import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  encodeRoadEngDLineChunks,
  encodeRoadEngLayout,
  readRoadEngDLine,
  readRoadEngLayout,
  roadEngDLineCable,
  roadEngDLineFor,
  ROADENG_DLINE_CHUNKS,
  type RoadEngChunk,
} from './roadEngDLines'
import {
  encodeRoadEngLoggingSystems,
  newRoadEngLoggingSystem,
  roadEngEquipmentEdits,
  roadEngLoggingSystemRigging,
  roadEngLoggingSystems,
} from './roadEngLoggingSystems'
import { encodeRoadEngMapNotes, newRoadEngMapNote, readRoadEngMapNotes } from './roadEngMapNotes'
import { classifyRoadEngFeature, parseRoadEngCoordSys, readRoadEngTerrainArchive } from './roadEngTerrain'
import { base64ToBytes, bytesToBase64, editRoadEngIni, formatG12, readRoadEngIni, roadEngIniValue } from './roadEngText'

const LB = 0.45359237
const FT = 0.3048
const LBF_KN = LB * 9.80665e-3

describe('roadEngText', () => {
  it('round-trips base64 of every length', () => {
    for (let n = 0; n < 40; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, k) => (k * 97 + n * 13) & 255)
      const text = bytesToBase64(bytes)
      expect(text).toBe(Buffer.from(bytes).toString('base64'))
      expect([...base64ToBytes(text)]).toEqual([...bytes])
    }
    expect(() => base64ToBytes('abc')).toThrow(/whole number/)
    expect(() => base64ToBytes('ab!d')).toThrow(/outside base64/)
  })
  it("prints numbers as C's %.12g", () => {
    expect(formatG12(570371.48732)).toBe('570371.48732')
    expect(formatG12(570054.751356)).toBe('570054.751356')
    expect(formatG12(5623705.13539)).toBe('5623705.13539')
    expect(formatG12(15.24)).toBe('15.24')
    expect(formatG12(172.4)).toBe('172.4')
    expect(formatG12(0)).toBe('0')
    expect(formatG12(-3)).toBe('-3')
    expect(formatG12(1e-5)).toBe('1e-05')
    expect(formatG12(1234567890123)).toBe('1.23456789012e+12')
    expect(formatG12(0.0001)).toBe('0.0001')
  })
  it('edits an INI text key by key and leaves every other line as it was', () => {
    const text =
      '[Software]\r\nVersion=9.099\r\n[main]\r\nCoordSys=1|-1|-1\r\nunits=10000\r\n[TerLayers]\r\nLayer0=CNTR*,Contours,\r\n'
    expect(editRoadEngIni(text, [])).toBe(text)
    expect(editRoadEngIni(text, [{ section: 'MAIN', set: [['units', '10000']] }])).toBe(text)
    const edited = editRoadEngIni(text, [
      {
        section: 'main',
        set: [
          ['coordsys', '1|51|10010'],
          ['digmode', '0'],
        ],
      },
      { section: 'TerLayers', set: [['Layer1', 'D-LINE*,D-Lines,']] },
      { section: 'EQUIP1', set: [['Desc', 'LC550']] },
    ])
    expect(edited).toBe(
      '[Software]\r\nVersion=9.099\r\n[main]\r\nCoordSys=1|51|10010\r\nunits=10000\r\ndigmode=0\r\n' +
        '[TerLayers]\r\nLayer0=CNTR*,Contours,\r\nLayer1=D-LINE*,D-Lines,\r\n[EQUIP1]\r\nDesc=LC550\r\n',
    )
    expect(editRoadEngIni(text, [{ section: 'main', replace: ['a=1'] }])).toBe(
      '[Software]\r\nVersion=9.099\r\n[main]\r\na=1\r\n[TerLayers]\r\nLayer0=CNTR*,Contours,\r\n',
    )
    expect(editRoadEngIni(text, [{ section: 'main', remove: true }])).toBe(
      '[Software]\r\nVersion=9.099\r\n[TerLayers]\r\nLayer0=CNTR*,Contours,\r\n',
    )
    expect(roadEngIniValue(edited, 'Main', 'COORDSYS')).toBe('1|51|10010')
    expect(readRoadEngIni(edited).map((s) => s.name)).toEqual(['Software', 'main', 'TerLayers', 'EQUIP1'])
  })
})

const lc550 = () =>
  newRoadEngLoggingSystem({
    id: '5',
    name: 'LC550 w T-MAR 86" Grapple',
    configuration: 'Running Skyline - grapple',
    carriageKg: 2435 * LB,
    equipment: {
      name: 'LC550',
      sparHeightM: 50 * FT,
      skyline: { maxTensionKN: 70000 * LBF_KN, weightKgPerM: (1.32 * LB) / FT, maxLengthM: 1500 * FT },
      mainline: { maxTensionKN: 70000 * LBF_KN, weightKgPerM: (1.32 * LB) / FT, maxLengthM: 1500 * FT },
      haulback: { maxTensionKN: 67000 * LBF_KN, weightKgPerM: (1.32 * LB) / FT, maxLengthM: 3100 * FT },
      fourth: { maxTensionKN: 0, weightKgPerM: 0, maxLengthM: 0 },
      machineCode: 3,
    },
  })

describe('RoadEng logging systems', () => {
  it('writes a system in pounds and feet and reads it back in SI', () => {
    const bytes = encodeRoadEngLoggingSystems([lc550()])
    expect(bytes.length).toBe(312)
    const view = new DataView(bytes.buffer)
    expect(view.getFloat64(136, true)).toBe(2435)
    expect(view.getFloat64(200, true)).toBe(50)
    expect([216, 224, 232].map((o) => view.getFloat64(o, true))).toEqual([70000, 70000, 67000])
    expect([248, 256, 264].map((o) => view.getFloat64(o, true))).toEqual([1.32, 1.32, 1.32])
    expect([280, 288, 296].map((o) => view.getFloat64(o, true))).toEqual([1500, 1500, 3100])
    expect(view.getUint16(114, true)).toBe(3)
    const [back] = roadEngLoggingSystems(bytes)
    expect(back).toMatchObject({ id: '5', name: 'LC550 w T-MAR 86" Grapple', configurationCode: 3 })
    expect(back.carriageKg).toBeCloseTo(1104.5, 1)
    expect(back.equipment.skyline.maxTensionKN).toBeCloseTo(311.4, 1)
    expect(encodeRoadEngLoggingSystems(roadEngLoggingSystems(bytes))).toEqual(bytes)
  })
  it('keeps stale bytes and changes only the edited field', () => {
    const bytes = encodeRoadEngLoggingSystems([lc550()])
    bytes.set([0x41, 0x42], 60) // stale text after the name's NUL
    const [system] = roadEngLoggingSystems(bytes)
    const edited = encodeRoadEngLoggingSystems([{ ...system, carriageKg: 3000 * LB }])
    const differ = [...edited].flatMap((b, i) => (b === bytes[i] ? [] : [i]))
    expect(differ.every((i) => i >= 136 && i < 144)).toBe(true)
    expect(new DataView(edited.buffer).getFloat64(136, true)).toBe(3000)
    expect(edited[60]).toBe(0x41)
  })
  it('refuses a section that is not whole records, and writes none as an empty section', () => {
    expect(() => roadEngLoggingSystems(new Uint8Array(100))).toThrow(/whole number/)
    expect(encodeRoadEngLoggingSystems([]).length).toBe(0)
  })
  it('gives the rigging a system implies', () => {
    const r = roadEngLoggingSystemRigging(lc550())
    expect(r.ropeMassKgPerM).toBeCloseTo(1.964, 3)
    expect(r.runningLinesKgPerM).toBeCloseTo(3.929, 3)
    expect(r.breakingForceKN / r.safetyFactor).toBeCloseTo(70000 * LBF_KN, 9)
  })
  it('keeps the .tlt equipment library in step', () => {
    const sections = readRoadEngIni('[EQUIP1]\r\nDesc=LC550\r\nMachine=40.0,3\r\n[EQUIP2]\r\nDesc=Old\r\n')
    const edits = roadEngEquipmentEdits(sections, [
      lc550(),
      { ...lc550(), equipment: { ...lc550().equipment, name: 'New' } },
    ])
    expect(edits.map((e) => e.section)).toEqual(['EQUIP1', 'EQUIP3'])
    expect(edits[0].set).toEqual([
      ['Desc', 'LC550'],
      ['Lengths', '1500.000000,1500.000000,3100.000000,0.000000'],
      ['Machine', '50.0,3'],
      ['Tensions', '70000.000000,70000.000000,67000.000000,0.000000'],
      ['UnitWts', '1.320000,1.320000,1.320000,0.000000'],
    ])
  })
})

describe('RoadEng map notes', () => {
  it('writes and reads notes, keeping the tail header and each format', () => {
    const header = new Uint8Array(24)
    header.set([0xb9, 0x8a, 0x01, 0x57], 16)
    const notes = [
      { ...newRoadEngMapNote('Access Road', 570371.48732, 5624114.92207), textSize: -42 },
      newRoadEngMapNote('Potential Deflection', 570054.751356, 5623705.13539),
    ]
    const tail = encodeRoadEngMapNotes(notes, header)
    expect(tail.length).toBe(24 + 2 + 46 + 60 + 2 + 56 + 60)
    expect([...tail.subarray(16, 20)]).toEqual([0xb9, 0x8a, 0x01, 0x57])
    const read = readRoadEngMapNotes(tail)
    expect(read.problem).toBeNull()
    expect(read.notes.map((n) => [n.text, n.x, n.y, n.anchor, n.textSize, n.labelType])).toEqual([
      ['Access Road', 570371.48732, 5624114.92207, [2, -1], -42, 23],
      ['Potential Deflection', 570054.751356, 5623705.13539, [2, -1], -30, 23],
    ])
    expect(encodeRoadEngMapNotes(read.notes, tail)).toEqual(tail)
    const moved = encodeRoadEngMapNotes([{ ...read.notes[0], x: 1, offset: [-90, 250] }], tail)
    expect(readRoadEngMapNotes(moved).notes[0]).toMatchObject({ x: 1, offset: [-90, 250], text: 'Access Road' })
  })
  it('reads the bare tail as no notes and reports a damaged one', () => {
    expect(readRoadEngMapNotes(encodeRoadEngMapNotes([]))).toEqual({ notes: [], problem: null })
    const tail = encodeRoadEngMapNotes([newRoadEngMapNote('x', 1, 2)])
    new DataView(tail.buffer).setUint16(24, 500, true)
    expect(readRoadEngMapNotes(tail).problem).toMatch(/runs past the end/)
  })
})

const settings = (text: string) => {
  const b = new TextEncoder().encode(text + '\0')
  return b
}
const dLineText =
  '[DLINE0]\r\nComment=DLine1\r\nDeflection=10\r\nDisplay=1\r\nSegments=3\r\nSetupID=5\r\n' +
  'Spar0=0,15.24,1,MidSpar1\r\nSpar1=172.4,10,4,MidSpar2\r\nSparCount=2\r\n[DLINES]\r\nDLineCount=1\r\n'
function dLineChunks(): RoadEngChunk[] {
  const spars = new Uint8Array(64)
  const v = new DataView(spars.buffer)
  ;[0, 172.4, 0, 172.4, 15.24, 10, 15.24, 10].forEach((x, k) => v.setFloat64(8 * k, x, true))
  const system = new Uint8Array(10)
  system[0] = 0x35
  const analysis = new Uint8Array(72)
  const a = new DataView(analysis.buffer)
  a.setUint32(0, 4, true)
  a.setFloat64(8, 0.75, true)
  a.setFloat64(16, 20000, true)
  a.setFloat64(24, 6.561679790026246, true)
  return [
    { type: 63, tag: -1, payload: settings(dLineText) },
    { type: 12, tag: -1, payload: spars },
    { type: 6, tag: -1, payload: system },
    { type: 69, tag: -1, payload: analysis },
  ]
}
const joined = (chunks: RoadEngChunk[]) => {
  const parts = chunks.map((c) => {
    const out = new Uint8Array(16 + c.payload.length)
    const v = new DataView(out.buffer)
    v.setUint32(0, out.length, true)
    v.setUint32(4, 2, true)
    v.setUint32(8, c.type, true)
    v.setInt32(12, c.tag, true)
    out.set(c.payload, 16)
    return [...out]
  })
  return new Uint8Array(parts.flat())
}

describe('RoadEng D-lines', () => {
  it('reads the settings, spars, system and analysis', () => {
    const { dLine, problem } = readRoadEngDLine(dLineChunks())
    expect(problem).toBeNull()
    expect(dLine).toMatchObject({
      comment: 'DLine1',
      deflectionPercent: 10,
      systemId: '5',
      spars: [
        { station: 0, height: 15.24, kind: 1, name: 'MidSpar1' },
        { station: 172.4, height: 10, kind: 4, name: 'MidSpar2' },
      ],
    })
    expect(dLine!.analysis!.method).toBe(4)
    expect(dLine!.analysis!.clearanceM).toBeCloseTo(2, 9)
    expect(dLine!.analysis!.payloadKg).toBeCloseTo(9071.8, 1)
  })
  it('writes an unedited D-line back byte for byte and an edited one key by key', () => {
    const chunks = dLineChunks()
    const dLine = readRoadEngDLine(chunks).dLine!
    expect(encodeRoadEngDLineChunks(dLine)).toEqual(joined(chunks))
    const edited = { ...dLine, spars: [dLine.spars[0], { ...dLine.spars[1], station: 180 }] }
    const out = encodeRoadEngDLineChunks(edited)
    const view = new DataView(out.buffer)
    const back: RoadEngChunk[] = []
    for (let o = 0; o < out.length; o += view.getUint32(o, true))
      back.push({
        type: view.getUint32(o + 8, true),
        tag: -1,
        payload: out.subarray(o + 16, o + view.getUint32(o, true)),
      })
    expect(back.map((c) => c.type)).toEqual([63, 12, 6, 69])
    const text = new TextDecoder().decode(back[0].payload)
    expect(text).toBe(dLineText.replace('Spar1=172.4', 'Spar1=180') + '\0')
    expect(readRoadEngDLine(back).dLine!.spars[1].station).toBe(180)
    expect(new DataView(back[1].payload.buffer, back[1].payload.byteOffset).getFloat64(8, true)).toBe(180)
  })
  it('makes a new D-line with every chunk RoadEng writes', () => {
    const made = roadEngDLineFor({
      lengthM: 250,
      yarderHeight: 15,
      tailholdHeight: 5,
      deflectionPercent: 8,
      systemId: '2',
    })
    const out = encodeRoadEngDLineChunks(made)
    const view = new DataView(out.buffer)
    const back: RoadEngChunk[] = []
    for (let o = 0; o < out.length; o += view.getUint32(o, true))
      back.push({
        type: view.getUint32(o + 8, true),
        tag: -1,
        payload: out.subarray(o + 16, o + view.getUint32(o, true)),
      })
    expect(back.map((c) => c.type)).toEqual([...ROADENG_DLINE_CHUNKS])
    expect(readRoadEngDLine(back).dLine).toMatchObject({
      deflectionPercent: 8,
      systemId: '2',
      spars: [
        { station: 0, height: 15, kind: 1 },
        { station: 250, height: 5, kind: 4 },
      ],
    })
  })
  it('places the PG Maps D-line at the first and last spars along the feature', () => {
    const dLine = readRoadEngDLine(dLineChunks()).dLine!
    const points = new Float64Array([1000, 2000, 400, 1000, 2100, 390, 1000, 2300, 380])
    const cable = roadEngDLineCable({ name: 'Proposed', points, stationOrigin: 0, dLine })!
    expect(cable.start).toEqual([1000, 2000])
    expect(cable.end[0]).toBe(1000)
    expect(cable.end[1]).toBeCloseTo(2172.4, 9)
    expect(cable).toMatchObject({
      startHeight: 15.24,
      endHeight: 10,
      deflectionPercent: 10,
      yarderAt: 'start',
      systemId: '5',
    })
    expect(cable.clearanceM).toBeCloseTo(2, 9)
  })
})

describe('RoadEng layouts (.ilt)', () => {
  it('lists the D-line chart windows and multi-plot titles and keeps the text', () => {
    const text =
      '[dlinedefl]\r\nparameters=1,1,1,1\r\nscale=5.3\r\n[dlineload2]\r\nparameters=1,1,1,1\r\nscale=52910.1\r\n' +
      '[multi]\r\nSubView0=12240,-960,1216\r\nSubView7=12245,-960\r\nSubView7Extra1=DL 1\r\n[Plan]\r\nCableDisplay=1,10,65280\r\n'
    const layout = readRoadEngLayout(text)
    expect(layout.dLineCharts).toEqual([
      { section: 'dlinedefl', chart: 'defl', index: null, parameters: [1, 1, 1, 1], scale: 5.3 },
      { section: 'dlineload2', chart: 'load', index: 2, parameters: [1, 1, 1, 1], scale: 52910.1 },
    ])
    expect(layout.panels).toEqual([
      { key: 'SubView0', view: 12240, title: null },
      { key: 'SubView7', view: 12245, title: 'DL 1' },
    ])
    expect(layout.planCableDisplay).toEqual([1, 10, 65280])
    expect(new TextDecoder().decode(encodeRoadEngLayout(layout))).toBe(text)
  })
})

// Softree's cable tutorial terrains (softree.com/anonyftp/support/Terrain_cables.zip), read from a
// local copy and never committed: set ROADENG_SAMPLES to the folder holding Terrain_cables/.
const samples = process.env.ROADENG_SAMPLES
const cables = samples ? join(samples, 'Terrain_cables') : ''
const CABLE_FILES = [
  'CableAnalysis.terx',
  'CableAnalysis - 1.terx',
  'CableAnalysis - 2.terx',
  'CableAnalysis - 3.terx',
  'CableAnalysis - 4.terx',
]
/** A `.ter`'s section 8 and tail, located as the reader frames them. */
function terParts(archive: Uint8Array) {
  const ter = unzipSync(archive, { filter: (f) => f.name === 'Terrain1.ter' })['Terrain1.ter']
  const view = new DataView(ter.buffer, ter.byteOffset, ter.byteLength)
  const sizes = Array.from({ length: 9 }, (_, i) => view.getUint32(2 + 4 * i, true))
  const end = 38 + sizes.reduce((s, x) => s + x, 0)
  return { ter, view, sizes, section8: ter.subarray(end - sizes[8], end), tail: ter.subarray(end) }
}

describe.skipIf(!samples || !existsSync(cables))('Softree cable tutorial terrains', { timeout: 120_000 }, () => {
  const read = (name: string) => {
    const bytes = new Uint8Array(readFileSync(join(cables, name)))
    return { bytes, archive: readRoadEngTerrainArchive(bytes) }
  }
  let cache: ReturnType<typeof read>[] | null = null
  /** Read once, on first use: the describe body runs even when the samples are absent. */
  const files = () => (cache ??= CABLE_FILES.map(read))

  it('reads their coordinate system: code 10000|51|10009 and its WKT agree on NAD83 / UTM zone 9N', () => {
    for (const { archive } of files()) {
      expect(archive.coordSys).toMatchObject({ epsg: 26909, source: 'wkt' })
      expect(archive.coordSys.raw.startsWith('10000|51|10009|PROJCS["NAD83 / UTM zone 9N"')).toBe(true)
      // Without its WKT, the code alone gives the same system.
      expect(parseRoadEngCoordSys('10000|51|10009').epsg).toBe(26909)
      expect(archive.warnings.join(' ')).not.toMatch(/code says EPSG/)
    }
  })

  it('reads their map notes and writes the tail back byte for byte', () => {
    expect(files().map(({ archive }) => archive.terrain.mapNotes!.map((n) => n.text))).toEqual([
      ['Access Road', 'Potential Deflection'],
      ['Access Road', 'Potential Deflection'],
      ['Access Road', 'Potential Deflection'],
      ['Access Road', 'Potential Deflection'],
      ['Access Road'],
    ])
    const [first] = files()[0].archive.terrain.mapNotes!
    expect(first).toMatchObject({ x: 570371.48732, y: 5624114.92207, anchor: [2, -1], labelType: 23, textSize: -42 })
    for (const { bytes, archive } of files()) {
      const { tail } = terParts(bytes)
      expect(encodeRoadEngMapNotes(archive.terrain.mapNotes!, tail)).toEqual(tail)
    }
  })

  it('reads their logging systems as Softree’s dialogs show them and writes them back byte for byte', () => {
    expect(files().map(({ archive }) => archive.terrain.loggingSystems!.length)).toEqual([4, 5, 5, 5, 5])
    const systems = files()[1].archive.terrain.loggingSystems!
    expect(systems.map((s) => `${s.id} ${s.name}`)).toEqual([
      '1 Highlead',
      '2 Shotgun',
      '3 Slackline',
      '4 Grapple',
      '5 LC550 w T-MAR 86" Grapple',
    ])
    const lc = systems[4]
    expect(lc).toMatchObject({ configuration: 'Running Skyline - grapple', configurationCode: 3 })
    expect(lc.equipment.name).toBe('LC550')
    expect(lc.carriageKg / LB).toBeCloseTo(2435, 9)
    expect(lc.equipment.sparHeightM / FT).toBeCloseTo(50, 9)
    expect(
      [lc.equipment.skyline, lc.equipment.mainline, lc.equipment.haulback].map((l) => [
        Math.round(l.maxTensionKN / LBF_KN),
        Number(((l.weightKgPerM * FT) / LB).toFixed(6)),
        Math.round(l.maxLengthM / FT),
      ]),
    ).toEqual([
      [70000, 1.32, 1500],
      [70000, 1.32, 1500],
      [67000, 1.32, 3100],
    ])
    expect(systems[1].equipment.fourth.maxTensionKN / LBF_KN).toBeCloseTo(8000, 6)
    for (const { bytes, archive } of files()) {
      const { section8 } = terParts(bytes)
      expect(encodeRoadEngLoggingSystems(archive.terrain.loggingSystems!)).toEqual(section8)
    }
  })

  it('reads their D-lines, reads them as D-lines, and writes their chunks back byte for byte', () => {
    const dLines = files().map(({ archive }) => archive.terrain.features.filter((f) => f.dLine))
    expect(dLines.map((d) => d.length)).toEqual([0, 0, 12, 1, 1])
    const proposed = dLines[4][0]
    expect(proposed.name).toBe('Proposed_Multispan_DLine')
    expect(proposed.dLine).toMatchObject({
      comment: 'DLine1',
      deflectionPercent: 10,
      systemId: '5',
      spars: [
        { station: 0, height: 15.24, kind: 1 },
        { station: 172.4, height: 10, kind: 4 },
      ],
      analysis: { method: 4 },
    })
    expect(dLines[2].map((f) => f.name)).toEqual(Array(12).fill('DL_Explore'))
    expect(dLines[3][0].dLine!.analysis!.clearanceM).toBeCloseTo(2, 6)
    for (const [k, list] of dLines.entries())
      for (const f of list) {
        expect(classifyRoadEngFeature(f, files()[k].archive.layers)).toBe('d-line')
        const chunks = f.dLine!.chunks!.map((c) => ({ type: c.type, tag: c.tag, payload: base64ToBytes(c.payload) }))
        expect(encodeRoadEngDLineChunks(f.dLine!)).toEqual(joined(chunks))
      }
    const cable = roadEngDLineCable(proposed)!
    expect(cable).toMatchObject({ startHeight: 15.24, endHeight: 10, yarderAt: 'start', systemId: '5' })
    expect(cable.start).toEqual([proposed.points[0], proposed.points[1]])
    expect(Math.hypot(cable.end[0] - cable.start[0], cable.end[1] - cable.start[1])).toBeLessThanOrEqual(172.4 + 1e-6)
  })

  it('reads the .ilt cable layouts and keeps their text', () => {
    for (const name of ['Training Single DLine MP.ilt', 'Training Multiple DLine MP.ilt.ilt']) {
      const bytes = new Uint8Array(readFileSync(join(cables, name)))
      const layout = readRoadEngLayout(bytes)
      expect(layout.dLineCharts.map((c) => c.chart)).toEqual(
        expect.arrayContaining(['defl', 'load', 'slen', 'tension']),
      )
      expect(encodeRoadEngLayout(layout)).toEqual(bytes)
    }
    const multi = readRoadEngLayout(new Uint8Array(readFileSync(join(cables, 'Training Multiple DLine MP.ilt.ilt'))))
    expect(multi.panels.flatMap((p) => (p.title ? [p.title] : []))).toEqual(
      expect.arrayContaining(['DL 1', 'DL 2', 'DL 3', 'DL 4']),
    )
  })

  it('keeps each sample’s .tlt, .te1 and RoadEng parts in its source record', () => {
    for (const { bytes, archive } of files()) {
      const entries = unzipSync(bytes)
      expect(archive.source.tlt).toBe(new TextDecoder('latin1').decode(entries['Terrain1.tlt']))
      expect(base64ToBytes(archive.source.te1!)).toEqual(entries['Terrain1.te1'])
      expect(archive.source.omitted).toBeUndefined()
      expect(archive.source.attributeChunkCount).toBe(1)
    }
  })
})
