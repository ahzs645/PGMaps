import { describe, expect, it } from 'vitest'
import { fetchSceneCover, parseVegetationStands, sceneCoverTiles, vegetationQueryUrl } from './bcVegetationInventory'
import { buildScenePackage, type ScenePackageInput } from './scenePackage'
import {
  coverOnGrid,
  coverSourceFromVri,
  ROCKY_GROUND_PERCENT,
  SCENE_COVER,
  sceneCoverFromBclcs,
  type SceneFire,
  sceneCoverFromGround,
  seaOnGrid,
  seaPolygons,
  slopeOnGrid,
  type CanopyGrid,
} from './sceneCover'
import type { ElevationSource } from '@/lib/forestry/terrain/terrain'
import { metersPerDegree } from './visibility'

const EYE = { lng: -123.9, lat: 49.6 }
const m = metersPerDegree(EYE.lat)
const toLngLat = (x: number, y: number): [number, number] => [EYE.lng + x / m.lng, EYE.lat + y / m.lat]
const square = (west: number, south: number, size: number): GeoJSON.Polygon => ({
  type: 'Polygon',
  coordinates: [
    [
      toLngLat(west, south),
      toLngLat(west + size, south),
      toLngLat(west + size, south + size),
      toLngLat(west, south + size),
      toLngLat(west, south),
    ],
  ],
})

/** A 41 × 41 grid at 20 m centred on the eye, heights from `z(x, y)`. */
function grid(z: (x: number, y: number) => number | null, spacing = 20, half = 20): CanopyGrid {
  const columns = half * 2 + 1
  const heights: Array<number | null> = []
  for (let row = 0; row < columns; row += 1)
    for (let column = 0; column < columns; column += 1)
      heights.push(z((column - half) * spacing, (row - half) * spacing))
  return { west: -half * spacing, south: -half * spacing, spacing, columns, rows: columns, heights }
}
const at = (g: CanopyGrid, values: ArrayLike<number | null>, x: number, y: number) =>
  values[Math.round((y - g.south) / g.spacing) * g.columns + Math.round((x - g.west) / g.spacing)]
const shoelace = (ring: Array<[number, number]>) => {
  let area = 0
  for (let i = 0; i < ring.length - 1; i += 1) area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
  return area / 2
}

describe('BCLCS read as scene cover', () => {
  it('reads treed, sparse, shrub, herb, rock and water', () => {
    expect(sceneCoverFromBclcs('V', 'T', 'TC', 'DE', 70)).toBe(SCENE_COVER.forest)
    expect(sceneCoverFromBclcs('V', 'T', 'TC', 'SP', null)).toBe(SCENE_COVER.sparse)
    expect(sceneCoverFromBclcs('V', 'T', 'TC', 'OP', 15)).toBe(SCENE_COVER.sparse)
    // A recorded 0 on treed ground is a gap in the record, not a bare stand.
    expect(sceneCoverFromBclcs('V', 'T', 'TC', null, 0)).toBe(SCENE_COVER.forest)
    expect(sceneCoverFromBclcs('V', 'N', 'SL', 'OP', null)).toBe(SCENE_COVER.shrub)
    expect(sceneCoverFromBclcs('V', 'N', 'ST', null, null)).toBe(SCENE_COVER.shrub)
    expect(sceneCoverFromBclcs('V', 'N', 'HE', 'OP', null)).toBe(SCENE_COVER.herb)
    expect(sceneCoverFromBclcs('V', 'N', 'BY', null, null)).toBe(SCENE_COVER.herb)
    expect(sceneCoverFromBclcs('N', 'L', 'RO', 'TA', null)).toBe(SCENE_COVER.rock)
    expect(sceneCoverFromBclcs('N', 'L', 'EL', 'ES', null)).toBe(SCENE_COVER.rock)
    expect(sceneCoverFromBclcs('N', 'W', null, 'LA', null)).toBe(SCENE_COVER.water)
    expect(sceneCoverFromBclcs('N', 'W', null, 'OC', null)).toBe(SCENE_COVER.water)
    expect(sceneCoverFromBclcs(null, null, null, null, null)).toBeNull()
    expect(sceneCoverFromGround('shrubTall')).toBe(SCENE_COVER.shrub)
    expect(sceneCoverFromGround('wetland')).toBe(SCENE_COVER.herb)
    expect(sceneCoverFromGround('other')).toBeNull()
  })

  it('keeps closed forest out of a whole read and in a cut-short one', () => {
    const stands = [
      { geometry: square(0, 0, 10), crownClosurePercent: 60, landCover: { level2: 'T', level4: 'TC', level5: 'DE' } },
      {
        geometry: square(0, 0, 10),
        crownClosurePercent: null,
        nonVegetated: true,
        landCover: { level2: 'L', level4: 'RO', level5: 'TA' },
      },
    ]
    expect(coverSourceFromVri(stands, []).polygons.map((p) => p.cover)).toEqual([SCENE_COVER.rock])
    expect(coverSourceFromVri(stands, [], { keepForest: true }).polygons.map((p) => p.cover)).toEqual([
      SCENE_COVER.forest,
      SCENE_COVER.rock,
    ])
  })
})

describe('cover on a terrain grid', () => {
  // Flat ground at 300 m with a cliff band: a 60 m step over one 20 m post spacing (about 56° at the posts beside it).
  const bluff = grid((x) => (x < 100 ? 300 : x < 120 ? 330 : 360))
  const rock = square(-300, -300, 160)
  const herb = square(-300, 100, 160)
  const treedOverBluff = square(60, -200, 120)
  const sparse = square(-60, 250, 100)
  const read = coverSourceFromVri(
    [
      {
        geometry: rock,
        crownClosurePercent: null,
        nonVegetated: true,
        landCover: { level2: 'L', level4: 'RO', level5: 'TA' },
      },
      { geometry: herb, crownClosurePercent: null, landCover: { level2: 'N', level4: 'HE', level5: 'OP' } },
      { geometry: treedOverBluff, crownClosurePercent: 65, landCover: { level2: 'T', level4: 'TC', level5: 'DE' } },
      { geometry: sparse, crownClosurePercent: 18, landCover: { level2: 'T', level4: 'TC', level5: 'SP' } },
    ],
    // The read reached the west two-thirds of the grid only.
    [[...toLngLat(-500, -500), ...toLngLat(200, 500)] as [number, number, number, number]],
  )

  it('reads slope from the grid itself', () => {
    const slope = slopeOnGrid(bluff)
    expect(at(bluff, slope, -200, 0)).toBeCloseTo(0, 5)
    expect(at(bluff, slope, 100, 0)).toBeGreaterThan(45)
    expect(at(bluff, slope, 300, 0)).toBeCloseTo(0, 5)
  })

  it('draws bluffs as rock under a treed polygon, and VRI rock, herb, sparse and forest as recorded', () => {
    const cut = square(-120, -320, 80)
    const { cover, treeless } = coverOnGrid(bluff, toLngLat, { sources: [read], openings: [cut] })
    expect(at(bluff, cover, 100, -140)).toBe(SCENE_COVER.rock) // the bluff in the treed polygon
    expect(at(bluff, cover, 100, 400)).toBe(SCENE_COVER.rock) // the bluff where nothing was read
    expect(at(bluff, treeless, 100, -140)).toBe(0) // the road view still grows stems on it
    expect(at(bluff, cover, 160, -140)).toBe(SCENE_COVER.forest) // the treed polygon off the bluff
    expect(at(bluff, cover, -220, -220)).toBe(SCENE_COVER.rock)
    expect(at(bluff, treeless, -220, -220)).toBe(1)
    expect(at(bluff, cover, -220, 180)).toBe(SCENE_COVER.herb)
    expect(at(bluff, cover, 0, 300)).toBe(SCENE_COVER.sparse)
    expect(at(bluff, cover, -80, -280)).toBe(SCENE_COVER.cut)
    expect(at(bluff, cover, 0, 0)).toBe(SCENE_COVER.forest) // read, no open polygon: closed forest
    expect(at(bluff, cover, 300, 0)).toBeNull() // never read: unknown, not forest
  })

  it('leaves the cover unknown where the grid has no ground, and forest-free without any read', () => {
    const holed = grid((x, y) => (x < -300 && y < -300 ? null : 300))
    const { cover } = coverOnGrid(holed, toLngLat, {})
    expect(at(holed, cover, -360, -360)).toBeNull()
    expect(at(holed, cover, 0, 0)).toBeNull()
  })
})

describe('the sea from terrain at or below 0 m', () => {
  // Land at +40 m in the north half, the sea floor falling to −60 m in the south; an inland hollow at −2 m, 60 m
  // across, in the land; an island rising out of the sea.
  const coast = grid((x, y) => {
    if (Math.hypot(x + 200, y + 220) < 70) return 15 // island
    if (Math.hypot(x - 200, y - 200) < 35) return -2 // hollow
    return y >= 0 ? 40 : Math.max(-60, y * 0.3 - 1)
  })

  it('keeps sea reaching the edge or large, and drops small hollows', () => {
    const sea = seaOnGrid(coast)
    expect(at(coast, sea, 0, -300)).toBe(1)
    expect(at(coast, sea, 200, 200)).toBe(0)
    expect(at(coast, sea, -200, -220)).toBe(0) // the island
    expect(at(coast, sea, 0, 100)).toBe(0)
    // A big enough hollow is sea on its own.
    expect(at(coast, seaOnGrid(coast, 1000), 200, 200)).toBe(1)
  })

  it('outlines the sea counter-clockwise along the 0 m shore, with the island as a hole', () => {
    const polygons = seaPolygons(coast, seaOnGrid(coast))
    expect(polygons).toHaveLength(1)
    const [outer, ...holes] = polygons[0]
    expect(outer[0]).toEqual(outer[outer.length - 1])
    expect(shoelace(outer)).toBeGreaterThan(0)
    // The shore runs where the ground crosses 0 m, between y −20 and 0; the outline stays on the grid.
    const shore = outer.filter(([, y]) => y > -300 && y < 50 && y > -50)
    expect(shore.length).toBeGreaterThan(1)
    for (const [x, y] of outer) {
      expect(Math.abs(x)).toBeLessThanOrEqual(400)
      expect(y).toBeGreaterThanOrEqual(-400)
      expect(y).toBeLessThanOrEqual(0)
    }
    // About half the grid's 800 m × 800 m.
    expect(shoelace(outer)).toBeGreaterThan(800 * 380)
    expect(shoelace(outer)).toBeLessThan(800 * 410)
    expect(holes).toHaveLength(1)
    expect(shoelace(holes[0])).toBeLessThan(0)
    expect(Math.abs(shoelace(holes[0]))).toBeGreaterThan(Math.PI * 60 * 60)
    expect(Math.abs(shoelace(holes[0]))).toBeLessThan(Math.PI * 80 * 80)
    // Simplified: a straight shore is a handful of points, not one per post.
    expect(outer.length).toBeLessThan(20)
  })

  it('puts the sea in the package as water at 0 m, and its posts at cover 5 with no canopy', () => {
    const ground: ElevationSource = {
      elevationAt: (_lng, lat) => {
        const y = (lat - EYE.lat) * m.lat
        return y >= -100 ? 40 : Math.max(-80, (y + 100) * 0.2 - 1)
      },
    }
    const input: ScenePackageInput = {
      eye: EYE,
      eyeHeightMeters: 1.5,
      bearingDegrees: 180,
      pitchDegrees: 0,
      verticalFovDegrees: 40,
      forest: { anchorLatitude: EYE.lat, stands: [], clearings: [], openings: [], standHeightMeters: 25 },
      elevation: ground,
      treeRadiusMeters: 100,
      terrainRadiusMeters: 600,
      terrainSpacingMeters: 20,
      farTerrainRadiusMeters: 2000,
      farTerrainSpacingMeters: 100,
      includeModels: false,
      createdAt: new Date('2026-11-13T00:00:00Z'),
    }
    const scene = buildScenePackage(input)
    const sea = (scene.water ?? []).filter((entry) => entry.sea)
    expect(sea.length).toBeGreaterThanOrEqual(2) // the terrain's, and the far grid's past it
    for (const entry of sea) expect(entry.elevationMeters).toBe(0)
    const near = sea.filter((entry) => entry.rings[0].every(([x, y]) => Math.abs(x) <= 600 && Math.abs(y) <= 600))
    expect(near).toHaveLength(1)
    // The far grid's sea stops at the terrain's square.
    for (const entry of sea.filter((e) => !near.includes(e)))
      for (const [x, y] of entry.rings[0]) expect(Math.abs(x) >= 599.9 || Math.abs(y) >= 599.9).toBe(true)
    const t = scene.terrain
    expect(at(t, t.cover!, 0, -400)).toBe(SCENE_COVER.water)
    expect(at(t, t.canopy!, 0, -400)).toBe(0)
    expect(at(t, t.cover!, 0, 200)).toBeNull() // no inventory read
    expect(at(scene.farTerrain!, scene.farTerrain!.cover!, 0, -1500)).toBe(SCENE_COVER.water)
    expect(scene.notes.some((note) => note.startsWith('Sea:'))).toBe(true)
  })
})

describe("a capture's VRI open-ground read", () => {
  it('asks only for open ground, longitude first in the CQL box', () => {
    const url = new URL(vegetationQueryUrl([-123.95, 49.55, -123.8, 49.65], { openGroundOnly: true }))
    const filter = url.searchParams.get('CQL_FILTER')!
    expect(filter).toContain("BBOX(GEOMETRY,-123.95,49.55,-123.8,49.65,'EPSG:4326')")
    expect(filter).toContain("BCLCS_LEVEL_2 <> 'T'")
    expect(filter).toContain("BCLCS_LEVEL_5 = 'SP'")
    // Stands with bedrock, talus or blockfield among their non-vegetated components, for rock under a stand.
    expect(filter).toContain(
      "(COAST_INTERIOR_CD = 'C' AND (NON_VEG_COVER_TYPE_1 IN ('BR','TA','BI') OR NON_VEG_COVER_TYPE_2 IN ('BR','TA','BI')))",
    )
    expect(url.searchParams.get('propertyName')).toBe(
      'FEATURE_ID,BCLCS_LEVEL_1,BCLCS_LEVEL_2,BCLCS_LEVEL_3,BCLCS_LEVEL_4,BCLCS_LEVEL_5,CROWN_CLOSURE,' +
        'COAST_INTERIOR_CD,NON_VEG_COVER_TYPE_1,NON_VEG_COVER_PCT_1,NON_VEG_COVER_TYPE_2,NON_VEG_COVER_PCT_2,' +
        'EARLIEST_NONLOGGING_DIST_TYPE,EARLIEST_NONLOGGING_DIST_DATE,GEOMETRY',
    )
    // And stands the inventory records a burn on, closed or not.
    expect(filter).toContain("EARLIEST_NONLOGGING_DIST_TYPE LIKE 'B%'")
    expect(url.searchParams.has('bbox')).toBe(false)
  })

  it('tiles the box nearest first', () => {
    const tiles = sceneCoverTiles([-124, 49.5, -123.7, 49.7], 0.12)
    expect(tiles).toHaveLength(3 * 2)
    const middle = (t: number[]) => [(t[0] + t[2]) / 2, (t[1] + t[3]) / 2]
    expect(Math.abs(middle(tiles[0])[0] + 123.85)).toBeLessThan(0.01)
  })

  it('keeps whole tiles as complete boxes, leaves failed ones unknown, and drops repeated polygons', async () => {
    let call = 0
    const rock = square(-100, -100, 200)
    const fetchImpl = (async (url: string) => {
      // Fire perimeters are read beside the inventory; this read finds none.
      if (url.includes('FIRE_POLYS')) return new Response(JSON.stringify({ features: [], numberMatched: 0 }))
      call += 1
      if (call === 2) return new Response('down', { status: 503 })
      return new Response(
        JSON.stringify({
          features: [
            {
              type: 'Feature',
              geometry: rock,
              properties: {
                FEATURE_ID: 7,
                BCLCS_LEVEL_1: 'N',
                BCLCS_LEVEL_2: 'L',
                BCLCS_LEVEL_4: 'RO',
                BCLCS_LEVEL_5: 'TA',
              },
            },
          ],
          numberMatched: 1,
        }),
        { status: 200 },
      )
    }) as typeof fetch
    const source = await fetchSceneCover(EYE, 9000, { fetchImpl, tileDegrees: 0.12 })
    const tiles = sceneCoverTiles(
      [EYE.lng - 9000 / m.lng, EYE.lat - 9000 / m.lat, EYE.lng + 9000 / m.lng, EYE.lat + 9000 / m.lat],
      0.12,
    )
    expect(call).toBe(tiles.length)
    expect(source.complete).toHaveLength(tiles.length - 1)
    expect(source.polygons).toHaveLength(1)
    expect(source.polygons[0].cover).toBe(SCENE_COVER.rock)
    expect(source.note).toContain('1 failed')
    expect(source.note).toContain('none found')
    expect(source.fires).toEqual([])
  })
})

describe('rock under a stand', () => {
  it('reads bedrock, talus and blockfield from the first two VRI components, and the coast code', () => {
    const { stands } = parseVegetationStands({
      features: [
        {
          geometry: square(0, 0, 100),
          properties: {
            FEATURE_ID: 1,
            BCLCS_LEVEL_1: 'V',
            BCLCS_LEVEL_2: 'T',
            NON_VEG_COVER_TYPE_1: 'BR',
            NON_VEG_COVER_PCT_1: 8,
            NON_VEG_COVER_TYPE_2: 'RZ', // road surface: not rock
            NON_VEG_COVER_PCT_2: 5,
            NON_VEG_COVER_TYPE_3: 'TA', // only the first two components are read
            NON_VEG_COVER_PCT_3: 4,
            COAST_INTERIOR_CD: 'C',
          },
        },
        { geometry: square(0, 0, 100), properties: { FEATURE_ID: 2, BCLCS_LEVEL_2: 'T' } },
      ],
    })
    expect(stands[0].rockyPercent).toBe(8)
    expect(stands[0].coastInterior).toBe('C')
    expect(stands[1].rockyPercent).toBeUndefined()
  })

  it('draws a coastal treed polygon with enough rock as rock, keeping its stand; less rock or interior stays forest', () => {
    const flat = grid(() => 300)
    const rocky = square(-300, -300, 200)
    const little = square(100, 100, 200)
    const interior = square(100, -300, 200)
    const read = coverSourceFromVri(
      [
        {
          geometry: rocky,
          crownClosurePercent: 55,
          rockyPercent: ROCKY_GROUND_PERCENT,
          coastInterior: 'C',
          landCover: { level2: 'T', level4: 'TC', level5: 'OP' },
        },
        {
          geometry: little,
          crownClosurePercent: 55,
          rockyPercent: ROCKY_GROUND_PERCENT - 1,
          coastInterior: 'C',
          landCover: { level2: 'T', level4: 'TC', level5: 'OP' },
        },
        {
          geometry: interior,
          crownClosurePercent: 55,
          rockyPercent: 40,
          coastInterior: 'I',
          landCover: { level2: 'T', level4: 'TC', level5: 'OP' },
        },
      ],
      [[...toLngLat(-500, -500), ...toLngLat(500, 500)] as [number, number, number, number]],
    )
    expect(read.polygons).toEqual([{ geometry: rocky, cover: SCENE_COVER.rock, underStand: true }])
    const { cover, treeless } = coverOnGrid(flat, toLngLat, { sources: [read] })
    expect(at(flat, cover, -200, -200)).toBe(SCENE_COVER.rock)
    expect(at(flat, treeless, -200, -200)).toBe(0) // the stand stands on it
    expect(at(flat, cover, 200, 200)).toBe(SCENE_COVER.forest)
    expect(at(flat, cover, 200, -200)).toBe(SCENE_COVER.forest)
  })
})

describe('burnt ground', () => {
  const flat = grid(() => 300)
  const complete = [[...toLngLat(-500, -500), ...toLngLat(500, 500)] as [number, number, number, number]]
  const herb = square(-400, -150, 150)
  const read = coverSourceFromVri(
    [
      { geometry: herb, crownClosurePercent: null, landCover: { level2: 'N', level4: 'HE', level5: 'OP' } },
      {
        geometry: square(200, -400, 150),
        crownClosurePercent: 15,
        landCover: { level2: 'T', level4: 'TC', level5: 'SP' },
      },
    ],
    complete,
  )
  const fire = (west: number, south: number, size: number, year: number): SceneFire => ({
    geometry: square(west, south, size),
    year,
    fireNumber: `K${year}`,
    sizeHectares: (size * size) / 1e4,
  })
  // A 2023 fire over the south-west, a 2010 one inside it, a 2020 one over the sparse stand, a 1999 one in the
  // north-east (greened up by 2025), a 2026 one after the assessment.
  const fires = [
    fire(-420, -420, 520, 2023),
    fire(-100, -100, 100, 2010),
    fire(200, -420, 200, 2020),
    fire(100, 100, 200, 1999),
    fire(-60, 200, 100, 2026),
  ]

  it('burns treed ground inside a recent perimeter, latest fire first, and nothing else', () => {
    const cut = square(-300, -300, 80)
    const { cover, burntYear, burntFires, treeless } = coverOnGrid(flat, toLngLat, {
      sources: [{ ...read, fires }],
      openings: [cut],
      assessmentYear: 2025,
    })
    expect(burntYear).not.toBeNull()
    expect(at(flat, cover, 0, 0)).toBe(SCENE_COVER.burnt) // forest in the 2023 fire
    expect(at(flat, burntYear!, 0, 0)).toBe(2023)
    expect(at(flat, cover, -60, -60)).toBe(SCENE_COVER.burnt) // inside both: the later fire
    expect(at(flat, burntYear!, -60, -60)).toBe(2023)
    expect(at(flat, cover, 260, -340)).toBe(SCENE_COVER.burnt) // sparse forest burns too
    expect(at(flat, burntYear!, 260, -340)).toBe(2020)
    expect(at(flat, treeless, 0, 0)).toBe(0)
    expect(at(flat, cover, -260, -260)).toBe(SCENE_COVER.cut) // an opening stays cut
    expect(at(flat, cover, -340, -80)).toBe(SCENE_COVER.herb) // non-treed ground is not a burnt stand
    expect(at(flat, cover, 200, 200)).toBe(SCENE_COVER.forest) // the 1999 fire has greened up
    expect(at(flat, burntYear!, 200, 200)).toBeNull()
    expect(at(flat, cover, -20, 260)).toBe(SCENE_COVER.forest) // the 2026 fire is after the assessment
    // The 2010 fire lies wholly under the 2023 one, so only the 2023 fire burnt a post.
    expect(burntFires.map((f) => f.year)).toEqual([2023, 2020])
  })

  it('burns shrub and herb ground the inventory records a recent burn on, perimeter or not', () => {
    // An inventory updated for a 2023 burn: the dead stand now reads shrub (Gun Lake, fire K71649), and a 1990
    // burn long since grown over.
    const updated = coverSourceFromVri(
      [
        {
          geometry: square(-400, -150, 150),
          crownClosurePercent: null,
          landCover: { level2: 'N', level4: 'SL', level5: 'OP' },
          burnYear: 2023,
        },
        {
          geometry: square(200, 200, 150),
          crownClosurePercent: null,
          landCover: { level2: 'N', level4: 'HE', level5: 'OP' },
          burnYear: 1990,
        },
        {
          geometry: square(-100, 200, 150),
          crownClosurePercent: 60,
          landCover: { level2: 'T', level4: 'TC', level5: 'DE' },
          burnYear: 2021,
        },
      ],
      complete,
    )
    const { cover, burntYear, treeless } = coverOnGrid(flat, toLngLat, { sources: [updated], assessmentYear: 2025 })
    expect(at(flat, cover, -340, -80)).toBe(SCENE_COVER.burnt)
    expect(at(flat, burntYear!, -340, -80)).toBe(2023)
    expect(at(flat, treeless, -340, -80)).toBe(0) // its snags stand
    expect(at(flat, cover, 260, 260)).toBe(SCENE_COVER.herb) // 35 years on, the record's herb
    // A closed stand kept for its recorded burn burns too.
    expect(at(flat, cover, -40, 260)).toBe(SCENE_COVER.burnt)
    expect(at(flat, burntYear!, -40, 260)).toBe(2021)
  })

  it('reads the window from the assessment year, and leaves unknown ground unknown', () => {
    const in2012 = coverOnGrid(flat, toLngLat, { sources: [{ ...read, fires }], assessmentYear: 2012 })
    expect(at(flat, in2012.cover, -60, -60)).toBe(SCENE_COVER.burnt)
    expect(at(flat, in2012.burntYear!, -60, -60)).toBe(2010)
    expect(at(flat, in2012.cover, 200, 200)).toBe(SCENE_COVER.burnt) // 1999 was 13 years before
    const unread = coverOnGrid(flat, toLngLat, { fires, assessmentYear: 2025 })
    expect(at(flat, unread.cover, 0, 0)).toBeNull()
    expect(unread.burntYear).toBeNull()
    expect(unread.burntFires).toEqual([])
  })

  it('carries the burn into the package: cover 7, the year per post and the fire list', () => {
    const ground: ElevationSource = { elevationAt: () => 300 }
    const scene = buildScenePackage({
      eye: EYE,
      eyeHeightMeters: 1.5,
      bearingDegrees: 0,
      pitchDegrees: 0,
      verticalFovDegrees: 40,
      forest: { anchorLatitude: EYE.lat, stands: [], clearings: [], openings: [], standHeightMeters: 25 },
      elevation: ground,
      treeRadiusMeters: 50,
      terrainRadiusMeters: 400,
      terrainSpacingMeters: 20,
      includeModels: false,
      cover: [{ ...read, fires }],
      assessmentYear: 2025,
      createdAt: new Date('2026-11-13T00:00:00Z'),
    })
    const t = scene.terrain
    expect(at(t, t.cover!, 0, 0)).toBe(SCENE_COVER.burnt)
    expect(at(t, t.burntYear!, 0, 0)).toBe(2023)
    expect(at(t, t.burntYear!, 200, 200)).toBeNull()
    expect(scene.fires).toEqual([
      { fireNumber: 'K2023', year: 2023, yearsSinceFire: 2, sizeHectares: 27.04 },
      { fireNumber: 'K2020', year: 2020, yearsSinceFire: 5, sizeHectares: 4 },
    ])
    const unburnt = buildScenePackage({
      eye: EYE,
      eyeHeightMeters: 1.5,
      bearingDegrees: 0,
      pitchDegrees: 0,
      verticalFovDegrees: 40,
      forest: { anchorLatitude: EYE.lat, stands: [], clearings: [], openings: [], standHeightMeters: 25 },
      elevation: ground,
      treeRadiusMeters: 50,
      terrainRadiusMeters: 400,
      terrainSpacingMeters: 20,
      includeModels: false,
      cover: [read],
    })
    expect(unburnt.terrain.burntYear).toBeUndefined()
    expect(unburnt.fires).toBeUndefined()
  })
})
