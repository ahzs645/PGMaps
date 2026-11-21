import { describe, expect, it } from 'vitest'

import {
  huntsForHuntArea,
  huntsForUnit,
  normalizeUnitId,
  lehCsvUrlFromPackage,
  LEH_DRAW_CSV_URL,
  LEH_DRAW_PACKAGE_URL,
  loadLehDraws,
  oddsText,
  parseLehDraws,
  regulationLinks,
  seasonText,
  unitFromHuntArea,
} from './leh'

const HEADER =
  'Draw Year,Draw Type,Species Code,Species,Hunt Code,Area,Region,LEH Hunt Area,Season One Open,Season One Close,Season Two Open,Season Two Close,Licence Description,Available Authorizations,First Choice Odds,First Choice Applicants,Second Choice Applicants,Authorized Animals,Issued Authorizations,Over or Under Subscribed,Over or Under Subscribed Authorizations,First Pass Winners,Second Pass Winners,Third Pass Winners,Fourth Pass Winners,Youth Hunt,Shared Hunt'

// Rows as the province's report holds them for MU 7-25, plus one older year and one Haida Gwaii hunt.
const REPORT = [
  HEADER,
  '2025,FALL,MOOS,MOOSE,4377,Prince George,7A,725A,09/10/2025,10/05/2025,,,Bull Only,13,6.7,87,40,13,13,,,13,0,0,0,,yes',
  '2025,FALL,MOOS,MOOSE,4380,Prince George,7A,725B,10/06/2025,10/31/2025,11/01/2025,11/15/2025,BULL ONLY,5,12,60,20,5,5,,,5,0,0,0,,',
  '2025,FALL,ELK,ELK,2213,Prince George Y,7A,725,10/15/2025,11/14/2025,,,Antlerless Only,3,0.3,1,7,3,3,,,1,0,2,0,yes,',
  '2025,FALL,BEAR,BLACK BEAR,1001,"Haida Gwaii, north",6,612,09/01/2025,11/30/2025,,,,10,,,,10,10,,,10,0,0,0,,',
  '2024,FALL,MOOS,MOOSE,4377,Prince George,7A,725A,09/10/2024,10/05/2024,,,Bull Only,13,9.9,128,40,13,13,,,13,0,0,0,,yes',
  '2025,FALL,MOOS,MOOSE,9999,Nowhere,9,ZZZ,09/10/2025,10/05/2025,,,Bull Only,1,1,1,1,1,1,,,1,0,0,0,,',
].join('\r\n')

describe('reading the draw report', () => {
  it('reads a report that starts with a byte order mark', () => {
    const { drawYear, hunts } = parseLehDraws(`\uFEFF${REPORT}`)
    expect(drawYear).toBe(2025)
    expect(hunts.some((hunt) => hunt.huntCode === '4377')).toBe(true)
  })

  it('finds the current CSV in the catalogue record, never the field definitions', () => {
    const current =
      'https://catalogue.data.gov.bc.ca/dataset/x/resource/y/download/leh-draw-hunt-code-report-2002-to-fall-2026.csv'
    expect(
      lehCsvUrlFromPackage({
        result: {
          resources: [
            {
              format: 'csv',
              name: 'Field Definitions - LEH Draw Hunt Code Report',
              url: 'https://catalogue.data.gov.bc.ca/f.csv',
            },
            { format: 'xlsx', name: 'LEH Draw Hunt Code Report', url: 'https://catalogue.data.gov.bc.ca/r.xlsx' },
            { format: 'csv', name: 'LEH Draw Hunt Code Report 2002 to fall 2026', url: current },
          ],
        },
      }),
    ).toBe(current)
    expect(lehCsvUrlFromPackage({ result: { resources: [] } })).toBeNull()
    expect(
      lehCsvUrlFromPackage({
        result: { resources: [{ format: 'csv', name: 'Report', url: 'https://elsewhere.example/r.csv' }] },
      }),
    ).toBeNull()
    expect(lehCsvUrlFromPackage(null)).toBeNull()
  })

  it('falls back to the address last checked when the catalogue cannot be read', async () => {
    const asked: string[] = []
    const fetcher = (async (input: RequestInfo | URL) => {
      const url = String(input)
      asked.push(url)
      if (url === LEH_DRAW_PACKAGE_URL) return new Response('unavailable', { status: 503 })
      return new Response(REPORT)
    }) as typeof fetch
    const { drawYear } = await loadLehDraws(fetcher)
    expect(drawYear).toBe(2025)
    expect(asked).toEqual([LEH_DRAW_PACKAGE_URL, LEH_DRAW_CSV_URL])
  })
})

describe('unit ids', () => {
  it('reads a hunt area as region, unit and zone', () => {
    expect(unitFromHuntArea('725A')).toEqual({ unitId: '7-25', zone: 'A' })
    expect(unitFromHuntArea('605')).toEqual({ unitId: '6-5', zone: null })
    expect(unitFromHuntArea('612')).toEqual({ unitId: '6-12', zone: null })
    expect(unitFromHuntArea('ZZZ')).toBeNull()
    expect(unitFromHuntArea('')).toBeNull()
  })

  it('compares padded and unpadded unit ids alike', () => {
    expect(normalizeUnitId('6-05')).toBe('6-5')
    expect(normalizeUnitId(' 7-25 ')).toBe('7-25')
  })
})

describe('parseLehDraws', () => {
  const { drawYear, hunts } = parseLehDraws(REPORT)

  it('keeps only the most recent draw year and rows it can place', () => {
    expect(drawYear).toBe(2025)
    expect(hunts.map((hunt) => hunt.huntCode)).toEqual(['4377', '4380', '2213', '1001'])
  })

  it('reads a hunt', () => {
    expect(hunts[0]).toEqual({
      drawYear: 2025,
      huntCode: '4377',
      species: 'Moose',
      unitId: '7-25',
      zone: 'A',
      areaName: 'Prince George',
      animalClass: 'Bull Only',
      seasons: [{ open: '2025-09-10', close: '2025-10-05' }],
      authorizations: 13,
      odds: 6.7,
      applicants: 87,
      youth: false,
      shared: true,
    })
  })

  it('reads a second season, evens out capitals and leaves blanks unknown', () => {
    expect(hunts[1].seasons).toHaveLength(2)
    expect(hunts[1].animalClass).toBe('Bull Only')
    expect(hunts[2].youth).toBe(true)
    expect(hunts[3]).toMatchObject({ unitId: '6-12', areaName: 'Haida Gwaii, north', odds: null, animalClass: null })
  })

  it('answers an empty report with nothing', () => {
    expect(parseLehDraws('')).toEqual({ drawYear: null, hunts: [] })
    expect(parseLehDraws(HEADER)).toEqual({ drawYear: null, hunts: [] })
  })
})

describe('huntsForUnit', () => {
  const { hunts } = parseLehDraws(REPORT)

  it('groups a unit’s hunts by species, zones in order', () => {
    const groups = huntsForUnit(hunts, '7-25')
    expect(groups.map((group) => group.species)).toEqual(['Elk', 'Moose'])
    expect(groups[1].hunts.map((hunt) => hunt.zone)).toEqual(['A', 'B'])
  })

  it('matches a padded unit id and returns nothing for a unit with no draw', () => {
    expect(huntsForUnit(hunts, '6-12')).toHaveLength(1)
    expect(huntsForUnit(hunts, '6-13')).toEqual([])
  })
})

describe('wording', () => {
  const { hunts } = parseLehDraws(REPORT)

  it('prints seasons without the year', () => {
    expect(seasonText(hunts[0])).toBe('Sep 10 – Oct 5')
    expect(seasonText(hunts[1])).toBe('Oct 6 – Oct 31, Nov 1 – Nov 15')
    expect(seasonText({ seasons: [] })).toBe('Season not listed')
  })

  it('prints odds as the synopsis does, and says when a hunt was undersubscribed', () => {
    expect(oddsText(hunts[0])).toBe('6.7 to 1')
    expect(oddsText(hunts[1])).toBe('12 to 1')
    expect(oddsText(hunts[2])).toBe('Undersubscribed')
    expect(oddsText(hunts[3])).toBe('Odds not listed')
  })
})

describe('regulationLinks', () => {
  it('points Omineca and Skeena units at their own tables', () => {
    expect(regulationLinks('7-25')[0]).toMatchObject({ label: 'Open seasons: Omineca region tables (PDF)' })
    expect(regulationLinks('7-25')[0].url).toMatch(/region-7a-omineca\.pdf#page=3$/)
    expect(regulationLinks('7-1')[0].label).toContain('Omineca')
    expect(regulationLinks('6-13')[0]).toMatchObject({ label: 'Open seasons: Skeena region tables (PDF)' })
  })

  it('sends Peace units and other regions to the full synopsis', () => {
    expect(regulationLinks('7-42')[0].label).toBe('Open seasons: Hunting & Trapping Synopsis (PDF)')
    expect(regulationLinks('7-19')[0].label).toBe('Open seasons: Hunting & Trapping Synopsis (PDF)')
    expect(regulationLinks('3-12')[0].label).toBe('Open seasons: Hunting & Trapping Synopsis (PDF)')
  })

  it('always offers the limited entry synopsis and the corrections page', () => {
    expect(regulationLinks('1-5')).toHaveLength(3)
  })
})

describe('huntsForHuntArea', () => {
  const { hunts } = parseLehDraws(REPORT)

  it('finds the hunts of one zone and one species', () => {
    expect(huntsForHuntArea(hunts, '725A', 'Moose').map((hunt) => hunt.huntCode)).toEqual(['4377'])
    expect(huntsForHuntArea(hunts, '725', 'ELK').map((hunt) => hunt.huntCode)).toEqual(['2213'])
  })

  it('keeps zones and species apart', () => {
    // Elk are drawn for the whole unit; there is no elk hunt in moose zone A.
    expect(huntsForHuntArea(hunts, '725A', 'Elk')).toEqual([])
    expect(huntsForHuntArea(hunts, '725', 'Moose')).toEqual([])
    expect(huntsForHuntArea(hunts, 'nonsense', 'Moose')).toEqual([])
  })
})
