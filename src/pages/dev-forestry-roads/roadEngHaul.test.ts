import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { haulUnitCost } from './engineering'
import { parseEngineering } from './engineeringProject'
import { createEngineeringDesign, type AlignmentEngineering, type HaulSite } from './engineeringTypes'
import { parseProject } from './project'
import { parseRoadEngSettings, roadEngMaterialsFor } from './roadEngDesignSettings'
import {
  applyRoadEngCostCarryover,
  parseRoadEngHaul,
  parseRoadEngCostCarryover,
  roadEngClassDistances,
  roadEngHaulFor,
  roadEngHaulRecords,
  type RoadEngHaulRecords,
} from './roadEngHaul'
import { createDemoProject } from './terrain'
import { validateEngineering, validateTemplate } from './templates'
import type { RoadTemplate } from './types'

// A metric design laid out as RoadEng 11 writes it: Softree's default ground table (haul pairs
// (0, 8), (0.6, 4), (2.6, 2)), one type with field 16 set, a costed design with two vertical
// options, pits on and off the road.
const GROUND = [
  '104,OB,Overburden (Default),100,400,1,1,12,4,0,8,0.6,4,2.6,2,0,0,0,0,',
  '104,GR,Gravel,66.6700007162,66.6700007162,1,0.9,12,4,0,8,0.6,4,2.6,2,2,0,0,0,',
  '104,HP,Hard Pan,66.6700007162,100,1,0.9,12,4,0,8,0.6,4,2.6,2,1,0,0,0,',
  '104,SR,Solid Rock,100,400.000013884,1,0.8,48,4,0,8,0.6,4,2.6,2,3,1,0,0,',
]
const DS2 = [
  '100,103,11,11.0.673.0, Softree Technical Systems Inc. - Location Line data file',
  '110,5,0,0,300,0,-1,0,0,,,0',
  '110,5,3000,0,310,3000,-1,0,0,,,0',
  ...GROUND,
  '118,1',
  '',
].join('\r\n')
const DSN = [
  '[design]',
  'MHcutItems=1,SG',
  'MHfillItems=0,SG',
  'MHlengths=150,1000,0',
  'ReCost=1',
  'units=10000',
  '[OptAlignCost-0]',
  'OptParms_Pit-0=500,0,99,0,10,1,Old,OB,0,0,1,0',
  'OptParmsNew=-,0,0,0,0,-10,10,0,0,0,3000,22,0,0,32,0,0,0,0,0,0,0,0,0,1091,0,-9999,-9999,100,0,0,Draft,1,0,-9999,1',
  'OptParmsRefAlign=Initial,Initial,Ground',
  '[OptAlignCost-1]',
  'OptParms_Pit-0=1000,7000,45,250,1000000,1,Borrow 1,SR,0,0,311.8,0',
  'OptParms_Pit-1=2000,500,0,0,3.40282346639e+38,0,Waste 1, ,0,0,322.9,0',
  'OptParms_Pit-2=5000,0,12,0,3200,1, ,OB,1,0,567.3,0',
  'OptParmsNew=-,0,0,0,0,-10,10,0,0,0,3000,22,0,0,32,0,0,0,0,0,0,0,0,0,1091,0,-9999,-9999,100,0,0,Initial,1,0,-9999,1',
  'OptParmsRefAlign=Initial,Initial,Ground',
  '[OptAlignCost]',
  'nOptCostParameters=2,1',
  '',
].join('\r\n')
const RANGE = { startStation: 0, endStation: 3000, stationScale: 1 }

const asParsed = (raw: unknown) => {
  validateTemplate(raw as RoadTemplate)
  return raw as RoadTemplate
}

/** The road's materials as the settings import makes them, with this module's haul and sites. */
function engineeringFor(dsn: string, ds2: string, range = RANGE, unitM = 1) {
  const settings = parseRoadEngSettings(dsn, ds2, unitM)
  const ground = roadEngMaterialsFor(settings, range)
  const mapped = roadEngHaulFor({ dsnText: dsn, ds2Text: ds2 }, { ...range, unitM, materials: ground.materials })
  const engineering: AlignmentEngineering = {
    ...createEngineeringDesign(),
    materials: mapped.materials,
    haul: mapped.haul,
    sites: mapped.sites,
  }
  return { engineering, mapped }
}

/** The design writer's job, done plainly: `104` lines replaced in place, `.dsn` keys set or removed. */
function applyRecords(dsn: string, ds2: string, records: RoadEngHaulRecords) {
  const rows = ds2.split('\r\n')
  const at = rows.findIndex((l) => l.startsWith('104,'))
  const kept = rows.filter((l) => !l.startsWith('104,'))
  kept.splice(at < 0 ? kept.length - 1 : at, 0, ...records.recordOverrides['104'])
  const lines = dsn.split('\r\n').filter((l) => l !== '')
  for (const [name, keys] of Object.entries(records.dsnOverrides)) {
    let head = lines.indexOf(`[${name}]`)
    if (head < 0) {
      lines.push(`[${name}]`)
      head = lines.length - 1
    }
    for (const [key, value] of Object.entries(keys)) {
      let end = head + 1
      while (end < lines.length && !lines[end].startsWith('[')) end++
      const at = lines.slice(head + 1, end).findIndex((l) => l.startsWith(`${key}=`))
      if (at >= 0) {
        if (value === null) lines.splice(head + 1 + at, 1)
        else lines[head + 1 + at] = `${key}=${value}`
      } else if (value !== null) lines.splice(end, 0, `${key}=${value}`)
    }
  }
  return { dsn: [...lines, ''].join('\r\n'), ds2: kept.join('\r\n') }
}

describe('RoadEng ground types, haul and pits', () => {
  it('reads every field of the ground types and the pits of the active vertical option', () => {
    const read = parseRoadEngHaul(DSN, DS2)
    expect(read.unitM).toBe(1)
    expect(read.groundTypes.map((t) => [t.code, t.qualityClass, t.bedrock])).toEqual([
      ['OB', 0, false],
      ['GR', 2, false],
      ['HP', 1, false],
      ['SR', 3, true],
    ])
    expect(read.groundTypes[3]).toMatchObject({
      fillSlopePercent: 100,
      cutExpansion: 1,
      fillExpansion: 0.8,
      excavationCost: 48,
      embankmentCost: 4,
      haul: {
        freehaul: { loading: 0, hauling: 8 },
        overhaul: { loading: 0.6, hauling: 4 },
        endhaul: { loading: 2.6, hauling: 2 },
      },
    })
    expect(read.massHaulLengths).toEqual([150, 1000])
    expect(read.reCost).toBe(true)
    expect(read.costSection).toEqual({ section: 'OptAlignCost-1', name: 'Initial' })
    expect(read.otherOptionsWithPits).toEqual(['Draft'])
    expect(read.pits.map((p) => [p.kind, p.station, p.volume, p.identifier, p.materialCode])).toEqual([
      ['borrow', 1000, 1000000, 'Borrow 1', 'SR'],
      ['waste', 2000, null, 'Waste 1', null],
      ['borrow', 5000, 3200, '', 'OB'],
    ])
  })

  it('finds the class changes where the cost lines cross', () => {
    const softree = {
      freehaul: { loading: 0, hauling: 8 },
      overhaul: { loading: 0.6, hauling: 4 },
      endhaul: { loading: 2.6, hauling: 2 },
    }
    const d = roadEngClassDistances(softree)
    expect(d.freeHaul).toBeCloseTo(0.15, 12)
    expect(d.overhaul).toBeCloseTo(1, 12)
    expect(d.ordered).toBe(true)
    // The Optimal API's example cost model.
    const api = roadEngClassDistances({
      freehaul: { loading: 0, hauling: 4 },
      overhaul: { loading: 0.5, hauling: 2 },
      endhaul: { loading: 2.5, hauling: 1 },
    })
    expect([api.freeHaul, api.overhaul]).toEqual([0.25, 2])
    // An overhaul line that is never cheapest: freehaul runs straight to endhaul.
    const two = roadEngClassDistances({ ...softree, overhaul: { loading: 5, hauling: 4 } })
    expect(two.freeHaul).toBeCloseTo(2.6 / 6, 12)
    expect(two.overhaul).toBeCloseTo(two.freeHaul, 12)
    // Free haul cheapest at every distance.
    expect(roadEngClassDistances({ ...softree, freehaul: { loading: 0, hauling: 1 } }).freeHaul).toBe(Infinity)
  })

  it("maps RoadEng's haul so every haul costs what RoadEng charges", () => {
    const { mapped } = engineeringFor(DSN, DS2)
    expect(mapped.haul).toMatchObject({
      enabled: true,
      freeHaulDistanceM: 150,
      overhaulDistanceM: 1000,
      freeHaulRate: 8,
      freeHaulLoadingRate: 0,
      overhaulRate: 4,
      overhaulLoadingRate: 1.2,
      endHaulRate: 2,
      endHaulLoadingRate: 2.9,
      borrowRate: 0,
      wasteRate: 0,
    })
    for (let d = 0; d <= 5000; d += 7.5) {
      const km = d / 1000
      const roadEng = Math.min(0 + 8 * km, 0.6 + 4 * km, 2.6 + 2 * km)
      expect(haulUnitCost(mapped.haul, d)).toBeCloseTo(roadEng, 9)
    }
    expect(mapped.fillRate).toBe(4)
    expect(mapped.quality).toEqual({
      'roadeng-OB': 0,
      'roadeng-GR': 66.666667,
      'roadeng-HP': 33.333333,
      'roadeng-SR': 100,
    })
    expect(mapped.materials.find((m) => m.id === 'roadeng-SR')).toMatchObject({ quality: 100 })
    expect(mapped.materials.some((m) => m.rock)).toBe(false)
    expect(mapped.bedrockCandidates).toEqual(['roadeng-SR'])
    expect(mapped.unmapped.some((u) => u.includes('mass-haul graphic'))).toBe(false)
    expect(mapped.notes.join(' ')).toContain('not converted')
  })

  it('turns the pits into sites, per compacted m³ for borrow, one off the road at its end', () => {
    const { mapped } = engineeringFor(DSN, DS2)
    expect(mapped.sites).toEqual<HaulSite[]>([
      {
        id: 'roadeng-pit-0',
        name: 'Borrow 1',
        kind: 'borrow',
        chainage: 1000,
        accessDistanceM: 7000,
        // 1,000,000 bank m³ of SR (compacted/bank 1 ÷ 0.8 = 1.25) at 45 per bank m³.
        capacityM3: 1250000,
        unitRate: 36,
        fixedCost: 250,
        materialId: 'roadeng-SR',
      },
      {
        id: 'roadeng-pit-1',
        name: 'Waste 1',
        kind: 'waste',
        chainage: 2000,
        accessDistanceM: 500,
        capacityM3: null,
        unitRate: 0,
        fixedCost: 0,
      },
      {
        // Its access station is 2,000 m past the road's end: a site at the end, that far further away.
        id: 'roadeng-pit-2',
        name: 'Borrow pit at 5,000',
        kind: 'borrow',
        chainage: 3000,
        accessDistanceM: 2000,
        pastRoadEndM: 2000,
        capacityM3: 3200,
        unitRate: 12,
        fixedCost: 0,
        materialId: 'roadeng-OB',
      },
    ])
    expect(
      mapped.notes.find((n) =>
        n.includes("Pits off the road: Borrow pit at 5,000 (access station 5,000 m, 2,000 m past the road's end)"),
      ),
    ).toBeTruthy()
    expect(mapped.unmapped.some((u) => u.includes('off this road'))).toBe(false)
    expect(mapped.unmapped.find((u) => u.includes('other vertical options (Draft)'))).toBeTruthy()
  })

  it("passes PGMaps' own parsers", () => {
    const { engineering, mapped } = engineeringFor(DSN, DS2)
    validateEngineering(engineering)
    expect(parseEngineering(JSON.parse(JSON.stringify(engineering)), asParsed)).toEqual(engineering)
    const project = createDemoProject()
    const [first, ...rest] = project.alignments
    const read = parseProject(
      JSON.parse(
        JSON.stringify({
          ...project,
          settings: { ...project.settings, fillRate: mapped.fillRate },
          alignments: [{ ...first, engineering }, ...rest],
        }),
      ),
    )
    expect(read.alignments[0].engineering?.haul).toEqual(engineering.haul)
    expect(read.alignments[0].engineering?.sites).toEqual(engineering.sites)
    expect(read.settings.fillRate).toBe(4)
  })

  it('writes an unedited road back as the lines it was read from', () => {
    const { engineering, mapped } = engineeringFor(DSN, DS2)
    const records = roadEngHaulRecords(
      { engineering, fillRate: mapped.fillRate! },
      { original: { dsnText: DSN, ds2Text: DS2 }, ...RANGE },
    )
    expect(records.recordOverrides['104']).toEqual(GROUND)
    expect(records.dsnOverrides).toEqual({})
    expect(records.notes).toEqual([])
  })

  it('reads back what it writes after edits', () => {
    const { engineering } = engineeringFor(DSN, DS2)
    const edited: AlignmentEngineering = {
      ...engineering,
      materials: [
        ...engineering.materials.map((m) => (m.id === 'roadeng-GR' ? { ...m, cutRate: 15, quality: 100 } : m)),
        {
          id: 'mat-clay',
          name: 'Clay silt',
          color: '#336699',
          cutRate: 10,
          reusableFraction: 1,
          compactionFactor: 0.9,
          cutSlope: 1,
          fillSlope: 3,
          quality: 33.333333,
        },
      ],
      // RoadEng-shaped rates: each class's cost meets the next one's at 200 m and 1,500 m.
      haul: {
        ...engineering.haul,
        freeHaulDistanceM: 200,
        overhaulDistanceM: 1500,
        freeHaulRate: 10,
        freeHaulLoadingRate: 0,
        overhaulRate: 5,
        overhaulLoadingRate: 2,
        endHaulRate: 2,
        endHaulLoadingRate: 5.9,
      },
      sites: [
        { ...engineering.sites[0], chainage: 1200.5, capacityM3: null, name: 'North pit' },
        engineering.sites[2],
        {
          id: 'site-new',
          name: 'Spoil',
          kind: 'waste',
          chainage: 2500,
          accessDistanceM: 120,
          capacityM3: 4000,
          unitRate: 0,
          fixedCost: 900,
        },
      ],
    }
    const records = roadEngHaulRecords(
      { engineering: edited, fillRate: 6 },
      { original: { dsnText: DSN, ds2Text: DS2 }, ...RANGE, levelAt: () => 305.25 },
    )
    expect(records.notes).toEqual([])
    const written = applyRecords(DSN, DS2, records)
    // The off-road pit goes back at its own station; the deleted waste pit is gone; the other option is untouched.
    expect(written.dsn).toContain('OptParms_Pit-1=5000,0,12,0,3200,1, ,OB,1,0,567.3,0')
    expect(written.dsn).toContain('OptParms_Pit-2=2500,120,0,900,4000,0,Spoil, ,0,0,305.25,0')
    expect(written.dsn).toContain('OptParms_Pit-0=500,0,99,0,10,1,Old,OB,0,0,1,0')
    expect(written.dsn).toContain('MHlengths=200,1500,0')
    const again = engineeringFor(written.dsn, written.ds2)
    const clay = again.mapped.materials.find((m) => m.id === 'roadeng-CS')!
    expect(clay).toMatchObject({ name: 'CS · Clay silt', cutRate: 10, cutSlope: 1, fillSlope: 3, quality: 33.333333 })
    expect(clay.compactionFactor).toBeCloseTo(0.9, 9)
    const gravel = again.mapped.materials.find((m) => m.id === 'roadeng-GR')!
    expect(gravel).toMatchObject({ cutRate: 15, quality: 100 })
    expect(again.mapped.haul).toEqual(edited.haul)
    expect(again.mapped.fillRate).toBe(6)
    const [north, offRoad, spoil] = again.mapped.sites
    expect(north).toEqual({ ...edited.sites[0], id: 'roadeng-pit-0' })
    expect(offRoad).toEqual({ ...edited.sites[1], id: 'roadeng-pit-1' })
    expect(spoil).toEqual({ ...edited.sites[2], id: 'roadeng-pit-2' })
    // And written again, nothing moves.
    const second = roadEngHaulRecords(
      { engineering: again.engineering, fillRate: 6 },
      { original: { dsnText: written.dsn, ds2Text: written.ds2 }, ...RANGE },
    )
    expect(second.recordOverrides['104']).toEqual(written.ds2.split('\r\n').filter((l) => l.startsWith('104,')))
    expect(second.dsnOverrides).toEqual({})
  })

  it('writes a road with no RoadEng original and reads it back', () => {
    const engineering: AlignmentEngineering = {
      ...createEngineeringDesign(),
      materials: [
        { id: 'm1', name: 'Sandy gravel', color: '#aa8844', cutRate: 9, reusableFraction: 1, compactionFactor: 0.95 },
      ],
      haul: {
        ...createEngineeringDesign().haul,
        enabled: true,
        freeHaulDistanceM: 100,
        overhaulDistanceM: 600,
        freeHaulRate: 6,
        overhaulRate: 3,
        overhaulLoadingRate: 0.6,
        endHaulRate: 1,
        endHaulLoadingRate: 1.6,
      },
      sites: [
        {
          id: 's1',
          name: 'Quarry',
          kind: 'borrow',
          chainage: 40,
          accessDistanceM: 300,
          capacityM3: 950,
          unitRate: 20,
          fixedCost: 0,
          materialId: 'm1',
        },
      ],
    }
    const records = roadEngHaulRecords({ engineering, fillRate: 5 }, {})
    const lines = records.recordOverrides['104']
    expect(lines[0].startsWith('104,OB,Overburden (Default),')).toBe(true)
    expect(lines[1].startsWith('104,SG,Sandy gravel,')).toBe(true)
    expect(records.dsnOverrides.design).toEqual({ MHlengths: '100,600,0', MHcutItems: '1,SG', MHfillItems: '0,SG' })
    expect(records.dsnOverrides['OptAlignCost-0']).toEqual({ 'OptParms_Pit-0': '40,300,19,0,1000,1,Quarry,SG,0,0,0,0' })
    expect(records.notes).toContain("1 material with no quality is written in RoadEng's lowest quality class.")
    const dsn = ['[design]', 'units=10000', ''].join('\r\n')
    const written = applyRecords(dsn, ['100,103,11', '110,5,0,0,0,0', '110,5,9,0,0,1000', ''].join('\r\n'), records)
    const again = roadEngHaulFor(
      { dsnText: written.dsn, ds2Text: written.ds2 },
      { startStation: 0, endStation: 1000, materials: [{ ...engineering.materials[0], id: 'roadeng-SG' }] },
    )
    expect(again.haul).toMatchObject({ ...engineering.haul, enabled: true })
    expect(again.sites[0]).toMatchObject({
      chainage: 40,
      accessDistanceM: 300,
      capacityM3: 950,
      unitRate: 20,
      materialId: 'roadeng-SG',
    })
    expect(again.fillRate).toBe(5)
  })

  it('says where RoadEng would put class changes it cannot hold, and what it leaves out', () => {
    const { engineering } = engineeringFor(DSN, DS2)
    const records = roadEngHaulRecords(
      {
        engineering: {
          ...engineering,
          materials: engineering.materials.map((m) => (m.id === 'roadeng-SR' ? { ...m, rock: true } : m)),
          haul: { ...engineering.haul, overhaulLoadingRate: 5, wasteRate: 3, mobilizationCost: 100 },
          sites: engineering.sites.map((s) => ({ ...s, enabled: false })),
        },
      },
      { original: { dsnText: DSN, ds2Text: DS2 }, ...RANGE },
    )
    const notes = records.notes.join(' ')
    expect(notes).toContain('where its cost lines cross')
    expect(notes).toContain('not marked Bedrock')
    expect(notes).toContain('3 switched-off sites are left out')
    expect(notes).toContain('Waste disposal rates')
    expect(notes).toContain(
      "Waste disposal rates, mobilization and contingency, switched-off sites: RoadEng has no field for these, so they travel in the design's [PGMaps] section and come back when it is opened here.",
    )
    // Every pit gone, the one off the road too.
    expect(records.dsnOverrides['OptAlignCost-1']).toEqual({
      'OptParms_Pit-0': null,
      'OptParms_Pit-1': null,
      'OptParms_Pit-2': null,
    })
  })

  it("hauls to a pit off the road past the road's end, and writes it back at its own station", () => {
    // Stations 1,000–3,000 m, chainage half a station: one pit before the start, one past the end.
    const dsn = DSN.replace(
      'OptParms_Pit-2=5000,0,12,0,3200,1, ,OB,1,0,567.3,0',
      'OptParms_Pit-2=5000,250,12,0,3200,1,Far,OB,1,0,567.3,0\r\nOptParms_Pit-3=400,100,0,0,1000,0,Early, ,0,0,300,0',
    )
    const range = { startStation: 1000, endStation: 3000, stationScale: 0.5 }
    const { engineering, mapped } = engineeringFor(dsn, DS2, range)
    const far = mapped.sites.find((s) => s.name === 'Far')!
    const early = mapped.sites.find((s) => s.name === 'Early')!
    expect(far).toMatchObject({ chainage: 1000, accessDistanceM: 1250, pastRoadEndM: 1000 })
    expect(early).toMatchObject({ chainage: 0, accessDistanceM: 400, pastRoadEndM: 300 })
    // The haul runs the station gap plus RoadEng's access: from chainage 600, 400 m + 1,250 m.
    validateEngineering(engineering)
    expect(parseEngineering(JSON.parse(JSON.stringify(engineering)), asParsed)).toEqual(engineering)
    const unedited = roadEngHaulRecords(
      { engineering, fillRate: mapped.fillRate! },
      { original: { dsnText: dsn, ds2Text: DS2 }, ...range },
    )
    expect(unedited.dsnOverrides).toEqual({})
    // Moved onto the road, the stretch past the end is written as access distance.
    const moved = roadEngHaulRecords(
      {
        engineering: { ...engineering, sites: engineering.sites.map((s) => (s === far ? { ...s, chainage: 800 } : s)) },
        fillRate: mapped.fillRate!,
      },
      { original: { dsnText: dsn, ds2Text: DS2 }, ...range },
    )
    expect(moved.dsnOverrides['OptAlignCost-1']).toEqual({
      'OptParms_Pit-2': '2600,1250,12,0,3200,1,Far,OB,1,0,567.3,0',
    })
    expect(moved.notes.join(' ')).toContain(
      "Far: no longer at the road's end, so its access along the road's line past the end is written as access distance",
    )
    // A pit too far off the road for this workspace's haul stays in the file and is said.
    const tooFar = engineeringFor(DSN.replace('OptParms_Pit-2=5000,', 'OptParms_Pit-2=250000,'), DS2).mapped
    expect(tooFar.sites.map((s) => s.id)).toEqual(['roadeng-pit-0', 'roadeng-pit-1'])
    expect(tooFar.unmapped.join(' ')).toContain('247,000 m off this road')
  })

  it('converts a foot design from yd³ and miles: 792 ft and 5,280 ft', () => {
    const dsn = DSN.replace('units=10000', 'units=3048').replace('MHlengths=150,1000,0', 'MHlengths=100,500,0')
    const range = { startStation: 0, endStation: 3000 * 0.3048, stationScale: 1 }
    const { engineering, mapped } = engineeringFor(dsn, DS2, range, 0.3048)
    expect(mapped.haul.freeHaulDistanceM).toBeCloseTo(792 * 0.3048, 6)
    expect(mapped.haul.overhaulDistanceM).toBeCloseTo(5280 * 0.3048, 6)
    expect(mapped.haul.freeHaulRate).toBeCloseTo(8 / 0.764554857984 / 1.609344, 6)
    for (let ft = 0; ft <= 12000; ft += 37) {
      const mi = ft / 5280
      const perYd3 = Math.min(8 * mi, 0.6 + 4 * mi, 2.6 + 2 * mi)
      expect(haulUnitCost(mapped.haul, ft * 0.3048) * 0.764554857984).toBeCloseTo(perYd3, 6)
    }
    expect(mapped.fillRate).toBeCloseTo(4 / 0.764554857984, 9)
    expect(mapped.sites[0]).toMatchObject({ chainage: 1000 * 0.3048, accessDistanceM: 7000 * 0.3048 })
    expect(mapped.unmapped.some((u) => u.includes('mass-haul graphic'))).toBe(true)
    const records = roadEngHaulRecords(
      { engineering, fillRate: mapped.fillRate! },
      { original: { dsnText: dsn, ds2Text: DS2 }, ...range },
    )
    expect(records.recordOverrides['104']).toEqual(GROUND)
    expect(records.dsnOverrides).toEqual({})
  })
})

// Softree's published sample projects (support.softree.com), read from a local copy and never
// committed: set ROADENG_SAMPLES to the folder holding the extracted archives.
const samples = process.env.ROADENG_SAMPLES
function parts(path: string) {
  const entries = unzipSync(new Uint8Array(readFileSync(join(samples!, path))))
  const text = (name: string) => (entries[name] ? strFromU8(entries[name], true) : undefined)
  return (n: number) => ({ dsn: text(`Location${n}.dsn`)!, ds2: text(`Location${n}.ds2`)! })
}
/** First and last calculated stations (`110`), m. */
function stations(ds2: string, unitM: number) {
  const s = ds2
    .split(/\r?\n/)
    .filter((l) => l.startsWith('110,'))
    .map((l) => Number(l.split(',')[5]) * unitM)
  return { startStation: s[0], endStation: s[s.length - 1], stationScale: 1 }
}
describe.skipIf(!samples || !existsSync(samples))('Softree sample designs', () => {
  it("reads LongRoad's haul: class changes at 150 m and 1,000 m, six pits, written back unchanged", () => {
    const { dsn, ds2 } = parts('LongRoad_1/LongRoad 1.dsnx')(1)
    const range = stations(ds2, 1)
    const { engineering, mapped } = engineeringFor(dsn, ds2, range)
    expect(mapped.haul).toMatchObject({ enabled: true, freeHaulDistanceM: 150, overhaulDistanceM: 1000 })
    expect(mapped.read.massHaulLengths).toEqual([150, 1000])
    expect(mapped.unmapped.some((u) => u.includes('mass-haul graphic'))).toBe(false)
    expect(mapped.sites.map((s) => [s.name, s.kind, s.chainage, s.accessDistanceM, s.materialId ?? null])).toEqual([
      ['Borrow 1', 'borrow', 2000 - range.startStation, 7000, 'roadeng-SR'],
      ['Waste 1', 'waste', 4200 - range.startStation, 7000, null],
      ['Waste 2', 'waste', 18500 - range.startStation, 7000, null],
      ['Borrow 2', 'borrow', 19800 - range.startStation, 7000, 'roadeng-SR'],
      ['Waste 3', 'waste', 23700 - range.startStation, 7000, null],
      ['Borrow 3', 'borrow', 25500 - range.startStation, 7000, 'roadeng-SR'],
    ])
    expect(mapped.sites[0]).toMatchObject({ unitRate: 36, capacityM3: 1250000 })
    expect(mapped.fillRate).toBe(4)
    validateEngineering(engineering)
    expect(parseEngineering(JSON.parse(JSON.stringify(engineering)), asParsed)).toEqual(engineering)
    const records = roadEngHaulRecords(
      { engineering, fillRate: mapped.fillRate! },
      { original: { dsnText: dsn, ds2Text: ds2 }, ...range },
    )
    expect(records.recordOverrides['104']).toEqual(ds2.split(/\r?\n/).filter((l) => l.startsWith('104,')))
    expect(records.dsnOverrides).toEqual({})
  })

  it("reads the cul-de-sac: its pit off the road is a site at the road's end, written back unchanged", () => {
    const location = parts('Cul-de-sac-design/CulDeSacExample/CulDeSacExampleComplete.dsnx')
    const { dsn, ds2 } = location(1)
    const range = stations(ds2, 1)
    const { engineering, mapped } = engineeringFor(dsn, ds2, range)
    expect(mapped.read.costSection).toEqual({ section: 'OptAlignCost-1', name: 'opt 3' })
    // Access station 3,224.871 m on a road ending at 2,448.898 m: 775.97 m past its end.
    const length = (range.endStation - range.startStation) * range.stationScale
    expect(mapped.sites).toHaveLength(1)
    expect(mapped.sites[0]).toMatchObject({
      id: 'roadeng-pit-0',
      kind: 'borrow',
      materialId: 'roadeng-OB',
      fixedCost: 0,
    })
    expect(mapped.sites[0].chainage).toBeCloseTo(length, 5)
    expect(mapped.sites[0].pastRoadEndM).toBeCloseTo(3224.87074544 - 2448.89837736, 5)
    expect(mapped.sites[0].accessDistanceM).toBe(mapped.sites[0].pastRoadEndM)
    // OB swells 1 → 1.25: 3,200 bank m³ at 12 is 2,560 compacted m³ at 15.
    expect(mapped.sites[0].capacityM3).toBeCloseTo(2560, 6)
    expect(mapped.sites[0].unitRate).toBeCloseTo(15, 6)
    expect(mapped.haul).toMatchObject({ enabled: true, freeHaulDistanceM: 150, overhaulDistanceM: 1000 })
    expect(mapped.unmapped.some((u) => u.includes('250 m and 1,500 m'))).toBe(true)
    expect(mapped.unmapped.some((u) => u.includes('off this road'))).toBe(false)
    expect(mapped.notes.some((n) => n.includes("775.97 m past the road's end"))).toBe(true)
    expect(mapped.unmapped.some((u) => u.includes('V-align 1'))).toBe(true)
    const records = roadEngHaulRecords(
      { engineering, fillRate: mapped.fillRate! },
      { original: { dsnText: dsn, ds2Text: ds2 }, ...range },
    )
    expect(records.recordOverrides['104']).toEqual(ds2.split(/\r?\n/).filter((l) => l.startsWith('104,')))
    expect(records.dsnOverrides).toEqual({})
    // The second alignment states no units of its own.
    const second = location(2)
    const read = parseRoadEngHaul(second.dsn, second.ds2, { projectDsnText: dsn })
    expect(read.unitM).toBe(1)
    expect(read.warnings).toEqual([])
    expect(read.pits).toEqual([])
  })
})

describe('costs RoadEng has no field for, in the [PGMaps] section', () => {
  /** Write `engineering` back, read it as RoadEng holds it, then put the carryover back over that. */
  const roundTrip = (engineering: AlignmentEngineering) => {
    const records = roadEngHaulRecords({ engineering }, { original: { dsnText: DSN, ds2Text: DS2 }, ...RANGE })
    const { dsn, ds2 } = applyRecords(DSN, DS2, records)
    const native = engineeringFor(dsn, ds2).engineering
    const back = applyRoadEngCostCarryover(native, records.pgmaps.Costs, {
      lengthM: 3000,
      validate: validateEngineering,
    })
    return { records, native, back, dsn, ds2 }
  }

  it('writes nothing for a road as RoadEng gives it', () => {
    const { engineering } = engineeringFor(DSN, DS2)
    const { records } = roundTrip(engineering)
    expect(records.pgmaps).toEqual({})
    expect(records.notes.join(' ')).not.toMatch(/\[PGMaps\]/)
  })

  it('brings back waste, borrow, mobilization, contingency, allocation, ranges, notes, sites and materials', () => {
    const { engineering } = engineeringFor(DSN, DS2)
    const edited: AlignmentEngineering = {
      ...engineering,
      haul: {
        ...engineering.haul,
        wasteRate: 3.5,
        borrowRate: 14,
        mobilizationCost: 25_000,
        contingencyPercent: 12,
        allocation: 'economic',
        siteSelection: 'delivered-cost',
        directionRanges: [{ id: 'd', start: 100, end: 900, direction: 'forward' }],
        sidecastRanges: [{ id: 's', start: 1200, end: 1400, capacityBankM3PerM: 2, unitRate: 1.5 }],
      },
      sites: [
        ...engineering.sites.map((site) =>
          site.kind === 'waste' ? { ...site, unitRate: 2.25, sourceNotes: 'Old landing, fill to 2 m' } : site,
        ),
        {
          id: 'spare',
          name: 'Spare pit',
          kind: 'borrow',
          enabled: false,
          chainage: 2500,
          accessDistanceM: 100,
          capacityM3: 5000,
          unitRate: 9,
          fixedCost: 0,
        } satisfies HaulSite,
      ],
      materials: engineering.materials.map((m) =>
        m.id === 'roadeng-SR'
          ? { ...m, rock: true, reusableFraction: 0.6, shallowCutRate: 30, overbreakRate: 55, color: '#123456' }
          : m,
      ),
      surfacingSupply: {
        enabled: true,
        name: 'Km 12 gravel pit',
        acquisitionRate: 2,
        processingRate: 3,
        loadingRate: 1,
        haulDistanceKm: 12,
        haulRate: 0.5,
        placementRate: 2,
        capacityM3: null,
        sourceNotes: '',
      },
    }
    validateEngineering(edited)
    const { records, native, back } = roundTrip(edited)
    expect(records.notes).toContain(
      "Waste disposal rates, the default borrow rate, mobilization and contingency, delivered-cost site selection, haul directions and sidecast ranges, site notes, switched-off sites, reusable fractions and stripping materials, shallow-rock and overbreak rates, the gravel source: RoadEng has no field for these, so they travel in the design's [PGMaps] section and come back when it is opened here.",
    )
    // RoadEng's own records give none of it.
    expect(native.haul).toMatchObject({ wasteRate: 0, borrowRate: 0, mobilizationCost: 0, contingencyPercent: 0 })
    expect(native.materials.find((m) => m.id === 'roadeng-SR')!.rock).toBeUndefined()
    // The carryover gives all of it back.
    const strip = (e: AlignmentEngineering) => ({
      haul: e.haul,
      sites: e.sites.map(({ id: _id, ...site }) => site).sort((a, b) => a.chainage - b.chainage),
      materials: e.materials,
      surfacingSupply: e.surfacingSupply,
    })
    expect(strip(back.engineering)).toEqual(strip(edited))
    expect(back.notes).toEqual(["Costs RoadEng has no field for came back from the design's [PGMaps] section."])
    expect(parseEngineering(JSON.parse(JSON.stringify(back.engineering)), asParsed)).toEqual(back.engineering)
    // Written again from what came back: the same carryover, and no RoadEng field changes.
    const again = roadEngHaulRecords(
      { engineering: back.engineering },
      { original: { dsnText: roundTrip(edited).dsn, ds2Text: roundTrip(edited).ds2 }, ...RANGE },
    )
    expect(parseRoadEngCostCarryover(again.pgmaps.Costs)).toEqual(parseRoadEngCostCarryover(records.pgmaps.Costs))
    expect(again.dsnOverrides).toEqual({})
  })

  it('leaves out what no longer fits the road, and says so', () => {
    const { engineering } = engineeringFor(DSN, DS2)
    const carry = {
      version: 1,
      haul: { wasteRate: 4, sidecastRanges: [{ id: 's', start: 2900, end: 3500, capacityBankM3PerM: 1, unitRate: 1 }] },
      pits: { '7': { sourceNotes: 'gone' } },
      materials: { ZZ: { rock: true } },
    }
    const { engineering: back, notes } = applyRoadEngCostCarryover(engineering, JSON.stringify(carry), {
      lengthM: 3000,
      validate: validateEngineering,
    })
    expect(back.haul).toMatchObject({ wasteRate: 4, sidecastRanges: [] })
    expect(notes).toEqual([
      "1 haul sidecast range(s) past the road's end are left out.",
      '1 pit with saved costs or notes are no longer in the design.',
      '1 ground type with saved values are no longer in the design.',
      "Costs RoadEng has no field for came back from the design's [PGMaps] section.",
    ])
    expect(applyRoadEngCostCarryover(engineering, '{not json', { lengthM: 3000 }).notes).toEqual([
      "The design's [PGMaps] cost settings could not be read; RoadEng's own are used.",
    ])
    // A carryover the project's checks refuse is not applied.
    const refused = applyRoadEngCostCarryover(engineering, JSON.stringify({ version: 1, haul: { wasteRate: -5 } }), {
      lengthM: 3000,
      validate: validateEngineering,
    })
    expect(refused.engineering).toBe(engineering)
    expect(refused.notes[0]).toMatch(/no longer fit the road/)
  })
})

describe("RoadEng's embankment cost per ground type and its optimal haul", () => {
  it("gives each material its ground type's embankment cost per bank m³, and writes an edit to that type alone", () => {
    const { engineering, mapped } = engineeringFor(DSN, DS2)
    expect(engineering.materials.map((m) => [m.id, m.fillRate])).toEqual([
      ['roadeng-OB', 4],
      ['roadeng-GR', 4],
      ['roadeng-HP', 4],
      ['roadeng-SR', 4],
    ])
    expect(mapped.fillRate).toBe(4)
    // A foot design's embankment cost is per yd³.
    const feet = engineeringFor(DSN.replace('units=10000', 'units=3048'), DS2, RANGE, 0.3048)
    expect(feet.engineering.materials[0].fillRate).toBeCloseTo(4 / 0.764554857984, 6)
    const edited = {
      ...engineering,
      materials: engineering.materials.map((m) => (m.id === 'roadeng-SR' ? { ...m, fillRate: 5.5 } : m)),
    }
    const records = roadEngHaulRecords({ engineering: edited }, { original: { dsnText: DSN, ds2Text: DS2 }, ...RANGE })
    const lines = records.recordOverrides['104']
    expect(lines.map((l) => l.split(',')[8])).toEqual(['4', '4', '4', '5.5'])
    // Every other field of every type is as read.
    expect(lines.slice(0, 3)).toEqual(GROUND.slice(0, 3))
    expect(lines[3].split(',').filter((_, i) => i !== 8)).toEqual(GROUND[3].split(',').filter((_, i) => i !== 8))
    // Different costs per type are read as they are, with no project-wide rate.
    const mixed = engineeringFor(
      DSN,
      DS2.replace(
        '104,SR,Solid Rock,100,400.000013884,1,0.8,48,4,',
        '104,SR,Solid Rock,100,400.000013884,1,0.8,48,1.8,',
      ),
    )
    expect(mixed.mapped.fillRate).toBeNull()
    expect(mixed.engineering.materials.find((m) => m.id === 'roadeng-SR')!.fillRate).toBe(1.8)
  })

  it('reads a design with the economic plan and the pit of last resort, and carries a road taken off them', () => {
    const { engineering, mapped } = engineeringFor(DSN, DS2)
    expect(engineering.haul).toMatchObject({ allocation: 'economic', lastResort: true, enabled: true })
    expect(mapped.notes.join(' ')).toMatch(/economic plan/)
    const edited = {
      ...engineering,
      haul: { ...engineering.haul, allocation: 'nearest' as const, lastResort: undefined },
    }
    const records = roadEngHaulRecords({ engineering: edited }, { original: { dsnText: DSN, ds2Text: DS2 }, ...RANGE })
    expect(parseRoadEngCostCarryover(records.pgmaps.Costs)?.haul).toEqual({ allocation: 'nearest', lastResort: false })
    expect(records.notes.join(' ')).toMatch(/Nearest-site allocation, the pit of last resort switched off/)
    const { dsn, ds2 } = applyRecords(DSN, DS2, records)
    const back = applyRoadEngCostCarryover(engineeringFor(dsn, ds2).engineering, records.pgmaps.Costs, {
      lengthM: 3000,
      validate: validateEngineering,
    })
    expect(back.engineering.haul.allocation).toBe('nearest')
    expect(back.engineering.haul.lastResort).toBeFalsy()
    // A design that stores a solved costing has its haul on, with or without ReCost.
    const costed = roadEngHaulFor(
      { dsnText: DSN.replace('ReCost=1\r\n', '').replace(/OptParms_Pit-\d=[^\r]*\r\n/g, ''), ds2Text: DS2 },
      { ...RANGE, costed: true },
    )
    expect(costed.haul.enabled).toBe(true)
  })
})
