import { readFileSync } from 'node:fs'
import { strFromU8, unzipSync } from 'fflate'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { beforeAll, describe, expect, it } from 'vitest'

import { blockAreaHa } from '@/lib/forestry/blockSheet/blockFacts'
import { hexColor, type Model3d } from '@/lib/model3d/model'
import { writeModel } from '@/lib/model3d/writeModel'

import { dbfSummary, glbPreview, readBackFor, readBackText, stlPreview, zipPreview } from './exportFilePreview'
import { MASK_COLORS } from './planMapStyle'
import { createEmptyScene, ROLE_COLORS, type ForestryScene } from './scene'
import { sceneGisLayers, sceneGisPlan, sceneGisUnavailable } from './sceneGis'
import { SCENE_GIS_LOOKS, sceneGisKmlStyle, sceneGisQml, writeSceneGis } from './sceneGisFiles'
import type { TargetPolygon } from './types'
import { focalForHfov } from './viewCamera'
import { readPlaceInput } from './viewCoordinates'
import type { ViewOfInterest } from './viewsOfInterest'

let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({
    wasmBinary: new Uint8Array(
      readFileSync(new URL('../../../node_modules/sql.js/dist/sql-wasm.wasm', import.meta.url)),
    ).buffer,
  })
})

/** A square of `size` degrees with its south-west corner at (lng, lat). */
function square(lng: number, lat: number, size = 0.004): GeoJSON.Polygon {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [lng, lat],
        [lng + size, lat],
        [lng + size, lat + size],
        [lng, lat + size],
        [lng, lat],
      ],
    ],
  }
}

function target(id: string, name: string, role: TargetPolygon['role'], geometry: GeoJSON.Polygon, extra = {}) {
  return {
    id,
    name,
    role,
    objectiveId: 'partial-retention',
    vac: null,
    harvestYear: null,
    clearcutPercent: null,
    geometry,
    source: 'Drawn',
    ...extra,
  } as TargetPolygon
}

/** A made-up scene: two blocks, two landforms, an opening, three masks, a tree-free area, a road and two views. */
function madeUpScene(): ForestryScene {
  const scene = createEmptyScene()
  const view = (id: string, extra: Partial<ViewOfInterest>): ViewOfInterest => ({
    id,
    name: `View ${id}`,
    source: { kind: 'map' },
    lng: -121.99,
    lat: 53.99,
    blockId: 'b1',
    facing: { kind: 'block' },
    focalMm: 50,
    framing: 'landform',
    ...extra,
  })
  return {
    ...scene,
    viewpoint: {
      id: 'road',
      name: 'Test Main',
      mode: 'corridor',
      coordinates: [
        [-122.01, 53.99],
        [-121.99, 53.99],
      ],
    },
    targets: [
      target('b1', 'Test block 1', 'block', square(-122.0, 54.01), {
        harvestSystem: 'retention',
        retentionPercent: 30,
        planning: { blockId: 'TB-1', licenceId: 'L-TEST' },
      }),
      target('b2', 'Test block 2', 'block', square(-121.98, 54.01), {
        harvestSystem: 'partial',
        volumeRemovedPercent: 40,
        residualHeightMeters: 18,
      }),
      target('lf1', 'Test face', 'landscape', square(-122.02, 54.0, 0.05), { objectiveId: 'retention', vac: 'low' }),
      target('lf2', 'Other face', 'landscape', square(-121.9, 54.0, 0.03)),
      target('o1', 'Old cut', 'harvested', square(-121.99, 54.02), { harvestYear: 2005, clearcutPercent: 90 }),
    ],
    activeLandformId: 'lf1',
    masks: [
      {
        id: 'm1',
        name: 'Rock bluff',
        kind: 'natural',
        mappedRock: true,
        landformId: 'lf1',
        geometry: square(-122.01, 54.03),
        source: 'VRI',
      },
      { id: 'm2', name: 'Patch A', kind: 'retained', geometry: square(-121.999, 54.011, 0.001), source: 'Drawn' },
      { id: 'm3', name: 'Patch B', kind: 'retained', geometry: square(-121.997, 54.012, 0.001), source: 'Drawn' },
    ],
    treeFreeAreas: [{ id: 't1', name: 'Pullout', geometry: square(-122.0, 53.99, 0.001) }],
    viewsOfInterest: [
      view('v1', {}),
      view('v2', { facing: { kind: 'bearing', degrees: 12.34 }, focalMm: 28, include: false, landformId: 'lf2' }),
      // Its block is gone and it faces the block: a point with no bearing and no wedge.
      view('v3', { blockId: 'gone' }),
    ],
  }
}

describe('scene for GIS: a view’s own place and camera', () => {
  it('writes the typed place while the view stands there, its lens as used and its surveyed eye', () => {
    const { entry } = readPlaceInput({
      system: 'utm',
      datum: 'NAD83',
      zone: 10,
      easting: '500000',
      northing: '5985000',
    })
    const scene = madeUpScene()
    const typed: ViewOfInterest = {
      ...scene.viewsOfInterest![0],
      id: 'v9',
      lng: entry!.lng,
      lat: entry!.lat,
      place: entry,
      lens: { kind: 'hfov', hfovDeg: 25.4 },
      focalMm: focalForHfov(25.4),
      eye: { reference: 'elevation', meters: 812.44 },
    }
    const moved = { ...typed, id: 'v10', lat: typed.lat + 0.001 }
    scene.viewsOfInterest = [typed, moved]
    const layer = sceneGisLayers(scene).find((entry) => entry.name === 'views_of_interest')!
    const [here, away] = layer.features.map((feature) => feature.attributes)
    expect(here).toMatchObject({
      coord_text: '10 500000 5985000',
      coord_crs: 'NAD83 / UTM zone 10N (EPSG:26910)',
      coord_prec: 0.5,
      hfov_deg: 25.4,
      lens_mm: 80,
      eye_ref: 'elevation',
      eye_m: 812.4,
    })
    // Dragged on the plan: the typed text describes another point, and is left out.
    expect(away).toMatchObject({ coord_text: null, coord_crs: null, coord_prec: null })
  })
})

describe('scene for GIS: layers', () => {
  it('plans one layer per kind the scene holds, with counts, and names the kinds it holds none of', () => {
    const plan = sceneGisPlan(madeUpScene())
    expect(plan.layers.map((layer) => [layer.name, layer.count])).toEqual([
      ['landforms', 2],
      ['existing_openings', 1],
      ['masks_natural', 1],
      ['masks_retained', 2],
      ['tree_free_areas', 1],
      ['blocks', 2],
      ['road', 1],
      ['view_wedges', 2],
      ['views_of_interest', 3],
    ])
    expect(plan.absent).toEqual(['Mask: Private land', 'Mask: Permanent non-forestry disturbance'])
    // The layers built are the plan's, feature for feature.
    const layers = sceneGisLayers(madeUpScene())
    expect(layers.map((layer) => [layer.name, layer.features.length])).toEqual(
      plan.layers.map((layer) => [layer.name, layer.count]),
    )
  })

  it('gives an empty scene no layer and says why', () => {
    const plan = sceneGisPlan(createEmptyScene())
    expect(plan.layers).toEqual([])
    expect(plan.absent).toContain('Viewpoint')
    expect(sceneGisUnavailable(plan)).toMatch(/Draw or import a block, a landform or the road/)
    expect(sceneGisLayers(createEmptyScene())).toEqual([])
  })

  it('writes the attributes the scene records, the stored values beside their wording, areas in BC Albers', () => {
    const scene = madeUpScene()
    const layers = sceneGisLayers(scene)
    const attributes = (name: string) => layers.find((layer) => layer.name === name)!.features.map((f) => f.attributes)
    const [b1, b2] = attributes('blocks')
    expect(b1).toMatchObject({
      name: 'Test block 1',
      system: 'retention',
      system_txt: 'dispersed retention',
      retain_pct: 30,
      remove_pct: null,
      block_code: 'TB-1',
      licence: 'L-TEST',
      source: 'Drawn',
    })
    expect(b1.area_ha).toBeCloseTo(blockAreaHa(scene.targets[0].geometry), 4)
    expect(b2).toMatchObject({ system: 'partial', system_txt: 'partial cut', remove_pct: 40, residual_m: 18 })
    const [lf1, lf2] = attributes('landforms')
    expect(lf1).toMatchObject({ assessed: true, objective: 'R', obj_name: 'Retention', vac: 'low' })
    expect(lf2).toMatchObject({ assessed: false, objective: 'PR' })
    expect(attributes('existing_openings')[0]).toMatchObject({ harv_year: 2005, cc_pct: 90 })
    // `retained` stays as stored; the page's wording sits beside it.
    expect(attributes('masks_retained')[0]).toMatchObject({
      kind: 'retained',
      kind_label: 'Wildlife tree patch / retention',
    })
    expect(attributes('masks_natural')[0]).toMatchObject({ mappedrock: true, landform: 'Test face' })
    expect(attributes('road')[0].length_km).toBeGreaterThan(1.3)
    const views = attributes('views_of_interest')
    expect(views.map((view) => view.number)).toEqual([1, 2, 3])
    expect(views[1]).toMatchObject({
      facing: 'bearing',
      bearing: 12.3,
      lens_mm: 28,
      included: false,
      landform: 'Other face',
    })
    expect(views[0].bearing).toBeGreaterThan(0)
    expect(views[0].included).toBe(true)
    expect(views[2]).toMatchObject({ block: null, bearing: null })
    expect(views[0]).toMatchObject({ coord_text: null, coord_crs: null, coord_prec: null, eye_ref: null, eye_m: null })
    // Every field a feature carries is one of its layer's fields, and every name fits a dBase column.
    for (const layer of layers) {
      const names = new Set(layer.fields.map((field) => field.name))
      for (const feature of layer.features)
        for (const key of Object.keys(feature.attributes)) expect(names).toContain(key)
      for (const name of names) expect(name.length).toBeLessThanOrEqual(10)
    }
    // Nothing from a run: no visibility, alteration or percent-seen field anywhere.
    expect(layers.flatMap((layer) => layer.fields.map((field) => field.name)).join(' ')).not.toMatch(/visib|alter|seen/)
  })

  it('writes a spot viewpoint as a point', () => {
    const scene = {
      ...madeUpScene(),
      viewpoint: {
        id: 'spot',
        name: 'Lookout',
        mode: 'spot' as const,
        coordinates: [[-122, 53.99]] as [number, number][],
      },
    }
    const plan = sceneGisPlan(scene)
    expect(plan.layers.find((layer) => layer.name === 'viewpoint')?.count).toBe(1)
    expect(plan.layers.some((layer) => layer.name === 'road')).toBe(false)
    expect(plan.absent).not.toContain('Viewpoint')
  })
})

describe('scene for GIS: files', () => {
  it('draws each layer in the plan map’s colours', () => {
    expect(SCENE_GIS_LOOKS.blocks.color).toBe(ROLE_COLORS.block)
    expect(SCENE_GIS_LOOKS.masks_retained.color).toBe(MASK_COLORS.retained)
    expect(sceneGisKmlStyle('landforms')).toMatchObject({
      fillColor: ROLE_COLORS.landscape,
      lineColor: ROLE_COLORS.landscape,
    })
    const { styles } = sceneGisQml(sceneGisLayers(madeUpScene()))
    expect(styles.blocks).toMatch(/renderer-v2 type="singleSymbol"/)
    expect(styles.blocks).toContain('220,38,38')
  })

  it('writes a GeoPackage that reopens with its layers, counts, columns and QGIS styles', () => {
    const layers = sceneGisLayers(madeUpScene())
    const file = writeSceneGis(layers, 'gpkg', { title: 'Test', SQL, now: new Date('2026-11-18T00:00:00Z') })
    expect(file.fileName).toBe('forestry-visual-quality-scene.gpkg')
    expect(file.mime).toBe('application/geopackage+sqlite3')
    const db = new SQL.Database(file.bytes)
    const tables = db.exec("SELECT table_name, identifier FROM gpkg_contents WHERE data_type = 'features'")[0].values
    expect(tables.map((row) => row[0])).toEqual(layers.map((layer) => layer.name))
    expect(db.exec('SELECT count(*) FROM blocks')[0].values[0][0]).toBe(2)
    expect(db.exec('SELECT name, system, system_txt FROM blocks ORDER BY fid')[0].values[0]).toEqual([
      'Test block 1',
      'retention',
      'dispersed retention',
    ])
    expect(db.exec('SELECT count(*) FROM layer_styles WHERE useAsDefault')[0].values[0][0]).toBe(layers.length)
    db.close()
    // The preview reads the same bytes back.
    const preview = readBackText('geopackage', file.bytes, SQL)
    expect(preview).toMatch(/9 layers/)
    expect(preview).toMatch(/Proposed blocks \(table blocks\): 2 polygon features, EPSG:4326, QGIS default style/)
    expect(preview).toContain('name=Test block 1')
  })

  it('writes a KMZ with a folder per layer and one style each', () => {
    const file = writeSceneGis(sceneGisLayers(madeUpScene()), 'kmz', { title: 'Test scene' })
    const kml = strFromU8(unzipSync(file.bytes)['doc.kml'])
    expect(kml.match(/<Folder/g)?.length).toBe(9)
    expect(kml).toContain('<name>Mask: Wildlife tree patch / retention</name>')
    expect(kml).toContain('<name>Test scene</name>')
    expect(readBackFor(file.mime)).toBe('kmz')
    expect(readBackText('kmz', file.bytes)).toContain('<Folder')
  })

  it('writes a shapefile per layer, with its QGIS style and a README, and passes the writer’s warnings on', () => {
    const scene = madeUpScene()
    // A name longer than a dBase text field holds is cut, and the writer says so.
    scene.targets[0] = { ...scene.targets[0], name: 'A'.repeat(300) }
    const file = writeSceneGis(sceneGisLayers(scene), 'shp', { title: 'Test scene' })
    const files = unzipSync(file.bytes)
    for (const ext of ['shp', 'shx', 'dbf', 'prj', 'cpg', 'qml']) expect(files[`blocks.${ext}`]).toBeDefined()
    expect(files['masks_retained.dbf']).toBeDefined()
    expect(dbfSummary(files['blocks.dbf'])).toMatch(/^2 records; fields ID C\(\d+\), NAME C/)
    // Upper-casing a name is said once in the README, not once per field.
    expect(file.notes.some((note) => /written as [A-Z_]+; a dBase field name/.test(note))).toBe(false)
    expect(file.notes.join(' ')).toMatch(/254/)
    const readme = strFromU8(files['README.txt'])
    expect(readme).toContain('blocks: Proposed blocks, 2 feature(s)')
    expect(readme).toContain('Not written as given:')
    expect(zipPreview(file.bytes)).toMatch(/blocks\.dbf: 2 records/)
  })

  it('writes one GeoJSON whose features name their layer', () => {
    const file = writeSceneGis(sceneGisLayers(madeUpScene()), 'geojson', { title: 'Test scene' })
    const collection = JSON.parse(strFromU8(file.bytes))
    expect(collection.name).toBe('Test scene')
    expect(collection.features).toHaveLength(15)
    expect(collection.features.find((f: GeoJSON.Feature) => f.properties?.layer === 'blocks').properties).toMatchObject(
      {
        layer_title: 'Proposed blocks',
        name: 'Test block 1',
      },
    )
  })
})

describe('reading a written file back for the preview', () => {
  const model: Model3d = {
    name: 'Test model',
    parts: [{ name: 'Ground', positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2], color: hexColor('#7d8a5a') }],
    origin: { kind: 'lonlat', longitude: -122, latitude: 54, elevation: 700 },
    notes: ['Display only.'],
  }

  it('reads a glTF binary’s parts and an STL’s triangles', () => {
    const glb = writeModel(model, 'glb').files[0]
    expect(readBackFor(glb.mime)).toBe('glb')
    expect(glbPreview(glb.bytes)).toMatch(/^glTF 2 binary, .*1 part, 1 triangles, written by PGMaps/)
    expect(glbPreview(glb.bytes)).toContain('Ground: 1 triangles')
    const stl = writeModel(model, 'stl').files[0]
    expect(stlPreview(stl.bytes)).toMatch(/^Binary STL, 134 B, 1 triangles\nHeader: PGMaps Test model/)
  })

  it('says when bytes are not what their type claims', () => {
    expect(glbPreview(new Uint8Array(40))).toMatch(/Not a glTF binary/)
    expect(stlPreview(new Uint8Array(10))).toMatch(/Not a binary STL/)
  })
})
