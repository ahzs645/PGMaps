import { describe, expect, it } from 'vitest'
import { DXF_LAYERS } from './dxfExport'
import {
  bSplinePoints,
  decodeDxfBytes,
  describeDxfSkipped,
  DXF_ARC_SEGMENT_DEGREES,
  DXF_MAX_INSERT_DEPTH,
  DxfError,
  isBinaryDxf,
  isDxfText,
  joinDxfLines,
  pgmapsDxfEpsg,
  PGMAPS_DXF_FRAME_LAYERS,
  plainMText,
  plainText,
  readDxf,
  type DxfFeature,
  type XYZ,
} from './dxfImport'

/** One group-code pair; DXF files are built in the test from these. */
type P = [number, string | number]
const section = (name: string, body: P[]): P[] => [[0, 'SECTION'], [2, name], ...body, [0, 'ENDSEC']]
/** A DXF file with CRLF line ends and right-justified codes, as AutoCAD writes them. */
const dxf = (...sections: P[][]) =>
  [...sections.flat(), [0, 'EOF'] as P].map(([code, value]) => `${String(code).padStart(3)}\r\n${value}`).join('\r\n') +
  '\r\n'
const header = (insUnits?: number, version = 'AC1032'): P[] =>
  section('HEADER', [
    [9, '$ACADVER'],
    [1, version],
    ...(insUnits === undefined
      ? []
      : ([
          [9, '$INSUNITS'],
          [70, insUnits],
        ] as P[])),
    [9, '$EXTMIN'],
    [10, -1],
    [20, -2],
    [30, 0],
    [9, '$EXTMAX'],
    [10, 100],
    [20, 200],
    [30, 0],
  ])
const layerTable = (...layers: Array<{ name: string; colour: number; flags?: number }>): P[] =>
  section('TABLES', [
    [0, 'TABLE'],
    [2, 'LAYER'],
    [70, layers.length],
    ...layers.flatMap(({ name, colour, flags = 0 }): P[] => [
      [0, 'LAYER'],
      [2, name],
      [70, flags],
      [62, colour],
      [6, 'CONTINUOUS'],
    ]),
    [0, 'ENDTAB'],
  ])
const entities = (...items: P[][]) => section('ENTITIES', items.flat())
const xyz = (code: number, [x, y, z = 0]: number[]): P[] => [
  [code, x],
  [code + 10, y],
  [code + 20, z],
]

const point = (at: number[], layer = 'PTS'): P[] => [[0, 'POINT'], [8, layer], ...xyz(10, at)]
const line = (a: number[], b: number[], layer = 'LINES', extra: P[] = []): P[] => [
  [0, 'LINE'],
  [8, layer],
  ...extra,
  ...xyz(10, a),
  ...xyz(11, b),
]
const lwpolyline = (
  vertices: Array<[number, number, number?]>,
  closed = false,
  layer = 'POLY',
  extra: P[] = [],
): P[] => [
  [0, 'LWPOLYLINE'],
  [8, layer],
  [90, vertices.length],
  [70, closed ? 1 : 0],
  ...extra,
  ...vertices.flatMap(([x, y, bulge]): P[] => [[10, x], [20, y], ...(bulge ? ([[42, bulge]] as P[]) : [])]),
]
const polyline = (vertices: number[][], flags: number, layer = 'POLY', elevation = 0): P[] => [
  [0, 'POLYLINE'],
  [8, layer],
  [66, 1],
  ...xyz(10, [0, 0, elevation]),
  [70, flags],
  ...vertices.flatMap((v): P[] => [[0, 'VERTEX'], [8, layer], ...xyz(10, v), [70, flags & 8 ? 32 : 0]]),
  [0, 'SEQEND'],
  [8, layer],
]
const arc = (centre: number[], radius: number, from: number, to: number, layer = 'ARCS', extra: P[] = []): P[] => [
  [0, 'ARC'],
  [8, layer],
  ...xyz(10, centre),
  [40, radius],
  [50, from],
  [51, to],
  ...extra,
]
const text = (at: number[], value: string, layer = 'TEXT', extra: P[] = []): P[] => [
  [0, 'TEXT'],
  [8, layer],
  ...xyz(10, at),
  [40, 2],
  [1, value],
  ...extra,
]
const insert = (block: string, at: number[], layer: string, extra: P[] = []): P[] => [
  [0, 'INSERT'],
  [8, layer],
  [2, block],
  ...xyz(10, at),
  ...extra,
]
const block = (name: string, base: number[], body: P[][]): P[] => [
  [0, 'BLOCK'],
  [8, '0'],
  [2, name],
  [70, 0],
  ...xyz(10, base),
  [3, name],
  ...body.flat(),
  [0, 'ENDBLK'],
  [8, '0'],
]

const byLayer = (features: DxfFeature[], layer: string) => features.filter((f) => f.layer === layer)
const near = (a: number[], b: number[], digits = 9) =>
  a.slice(0, b.length).forEach((value, i) => expect(value).toBeCloseTo(b[i], digits))
const radiusFrom = (centre: number[]) => (p: XYZ) => Math.hypot(p[0] - centre[0], p[1] - centre[1])

describe('reading DXF entities', () => {
  const drawing = readDxf(
    dxf(
      header(6),
      layerTable({ name: 'LINES', colour: 3 }, { name: 'POLY', colour: 5 }),
      entities(
        point([1, 2, 3]),
        line([0, 0, 0], [10, 5, 2]),
        // A semicircle bulge (tan 45° = 1) from (0,0) to (10,0), counter-clockwise: below the chord.
        lwpolyline(
          [
            [0, 0, 1],
            [10, 0],
          ],
          false,
          'BULGE',
          [[38, 7]],
        ),
        lwpolyline(
          [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
          ],
          true,
          'SQUARE',
        ),
        polyline(
          [
            [0, 0],
            [5, 0],
            [5, 5],
          ],
          1,
          'POLY2D',
          12,
        ),
        polyline(
          [
            [0, 0, 100],
            [5, 0, 101],
            [5, 5, 102],
          ],
          8,
          'POLY3D',
        ),
        polyline(
          [
            [0, 0, 0],
            [1, 0, 0],
            [1, 1, 0],
          ],
          64,
          'FACES',
        ),
        arc([0, 0, 0], 10, 0, 90),
        // Extrusion (0,0,-1) mirrors the object coordinate system's x axis.
        arc([5, 0, 0], 10, 0, 90, 'MIRRORED', [
          [210, 0],
          [220, 0],
          [230, -1],
        ]),
        [[0, 'CIRCLE'], [8, 'CIRCLES'], ...xyz(10, [50, 50]), [40, 4]],
        [[0, 'CIRCLE'], [8, 'DOT'], ...xyz(10, [50, 50]), [40, 0]],
        line([3, 3], [3, 3], 'DOT'),
        [
          [0, 'ELLIPSE'],
          [8, 'ELLIPSES'],
          ...xyz(10, [0, 0]),
          ...xyz(11, [10, 0]),
          [40, 0.5],
          [41, 0],
          [42, 2 * Math.PI],
        ],
        [[0, 'ELLIPSE'], [8, 'HALF'], ...xyz(10, [0, 0]), ...xyz(11, [10, 0]), [40, 0.5], [41, 0], [42, Math.PI]],
        [
          [0, 'SPLINE'],
          [8, 'FIT'],
          [70, 8],
          [71, 3],
          [74, 3],
          ...xyz(11, [0, 0, 1]),
          ...xyz(11, [5, 5, 2]),
          ...xyz(11, [10, 0, 3]),
        ],
        [
          [0, 'SPLINE'],
          [8, 'CONTROL'],
          [70, 8],
          [71, 2],
          [72, 6],
          [73, 3],
          ...([0, 0, 0, 1, 1, 1].map((k) => [40, k]) as P[]),
          ...xyz(10, [0, 0]),
          ...xyz(10, [10, 20]),
          ...xyz(10, [20, 0]),
        ],
        text([3, 4], 'Slope 30%%d'),
        text([0, 0], 'Centred', 'TEXT', [[72, 1], ...xyz(11, [8, 9])]),
        [[0, 'MTEXT'], [8, 'NOTES'], ...xyz(10, [7, 8]), [3, '{\\fArial|b1;Block}\\P'], [1, '\\H2.5;A\\~12 \\S1^2;']],
        [[0, '3DFACE'], [8, 'X'], ...xyz(10, [0, 0]), ...xyz(11, [1, 0]), ...xyz(12, [1, 1]), ...xyz(13, [0, 1])],
        [[0, 'SOLID'], [8, 'X'], ...xyz(10, [0, 0])],
        [[0, 'HATCH'], [8, 'X'], ...xyz(10, [0, 0])],
        [[0, 'HATCH'], [8, 'X'], ...xyz(10, [0, 0])],
        // Paper space: a title block, not the map.
        line([0, 0], [420, 297], 'TITLE', [[67, 1]]),
      ),
    ),
  )
  const features = drawing.features

  it('reads the header and the layer table', () => {
    expect(drawing.version).toBe('AC1032')
    expect(drawing.insUnits).toBe(6)
    expect(drawing.unitM).toBe(1)
    expect(drawing.unitName).toBe('metres')
    expect(drawing.extents).toEqual({ min: [-1, -2, 0], max: [100, 200, 0] })
    expect(drawing.layers).toEqual([
      { name: 'LINES', colour: 3, off: false, frozen: false },
      { name: 'POLY', colour: 5, off: false, frozen: false },
    ])
  })

  it('reads points and lines in the drawing’s own coordinates, keeping heights', () => {
    expect(byLayer(features, 'PTS')).toMatchObject([
      { shape: 'point', points: [[1, 2, 3]], entity: 'POINT', name: 'PTS' },
    ])
    // BYLAYER colour comes from the layer table.
    expect(byLayer(features, 'LINES')).toMatchObject([
      {
        shape: 'line',
        points: [
          [0, 0, 0],
          [10, 5, 2],
        ],
        entity: 'LINE',
        colour: 3,
      },
    ])
  })

  it('draws a bulge as its arc and closes a closed polyline as a polygon', () => {
    const [bulge] = byLayer(features, 'BULGE')
    expect(bulge.shape).toBe('line')
    near(bulge.points[0], [0, 0, 7])
    near(bulge.points[bulge.points.length - 1], [10, 0, 7])
    for (const p of bulge.points) expect(radiusFrom([5, 0])(p)).toBeCloseTo(5, 9)
    expect(Math.min(...bulge.points.map((p) => p[1]))).toBeCloseTo(-5, 9)
    expect(bulge.points.length).toBe(180 / DXF_ARC_SEGMENT_DEGREES + 1)
    const [square] = byLayer(features, 'SQUARE')
    expect(square.shape).toBe('polygon')
    expect(square.points).toEqual([
      [0, 0, 0],
      [10, 0, 0],
      [10, 10, 0],
      [0, 10, 0],
      [0, 0, 0],
    ])
  })

  it('reads 2D polylines at their elevation and 3D ones vertex by vertex, and skips polyface meshes', () => {
    const [flat] = byLayer(features, 'POLY2D')
    expect(flat.shape).toBe('polygon')
    expect(flat.points.every((p) => p[2] === 12)).toBe(true)
    expect(byLayer(features, 'POLY3D')[0]).toMatchObject({
      shape: 'line',
      points: [
        [0, 0, 100],
        [5, 0, 101],
        [5, 5, 102],
      ],
    })
    expect(byLayer(features, 'FACES')).toEqual([])
    expect(drawing.skipped.polyfaceMesh).toBe(1)
  })

  it('draws arcs counter-clockwise, through the entity’s own coordinate system', () => {
    const [quarter] = byLayer(features, 'ARCS')
    near(quarter.points[0], [10, 0, 0])
    near(quarter.points[quarter.points.length - 1], [0, 10, 0])
    expect(quarter.points.length).toBe(90 / DXF_ARC_SEGMENT_DEGREES + 1)
    const [mirrored] = byLayer(features, 'MIRRORED')
    // OCS centre (5, 0) is world (−5, 0); OCS angle 0 is world angle 180°, turning clockwise.
    near(mirrored.points[0], [-15, 0, 0])
    near(mirrored.points[mirrored.points.length - 1], [-5, 10, 0])
    for (const p of mirrored.points) expect(radiusFrom([-5, 0])(p)).toBeCloseTo(10, 9)
  })

  it('makes circles and full ellipses polygons, and a part ellipse a line', () => {
    const [circle] = byLayer(features, 'CIRCLES')
    expect(circle.shape).toBe('polygon')
    expect(circle.points[0]).toEqual(circle.points[circle.points.length - 1])
    for (const p of circle.points) expect(radiusFrom([50, 50])(p)).toBeCloseTo(4, 9)
    const [ellipse] = byLayer(features, 'ELLIPSES')
    expect(ellipse.shape).toBe('polygon')
    expect(Math.max(...ellipse.points.map((p) => p[1]))).toBeCloseTo(5, 9)
    expect(Math.max(...ellipse.points.map((p) => p[0]))).toBeCloseTo(10, 9)
    const [half] = byLayer(features, 'HALF')
    expect(half.shape).toBe('line')
    near(half.points[half.points.length - 1], [-10, 0, 0])
  })

  it('reads a spline by its fit points, else samples it from its control points and knots', () => {
    expect(byLayer(features, 'FIT')[0].points).toEqual([
      [0, 0, 1],
      [5, 5, 2],
      [10, 0, 3],
    ])
    const [control] = byLayer(features, 'CONTROL')
    // A clamped quadratic with three control points is a Bézier: its middle is ¼P0 + ½P1 + ¼P2.
    near(control.points[0], [0, 0, 0])
    near(control.points[control.points.length - 1], [20, 0, 0])
    expect(control.points.some((p) => Math.abs(p[0] - 10) < 1e-9 && Math.abs(p[1] - 10) < 1e-9)).toBe(true)
  })

  it('reads TEXT and MTEXT as labelled points with their codes removed', () => {
    const labels = byLayer(features, 'TEXT')
    expect(labels).toMatchObject([
      { shape: 'point', points: [[3, 4, 0]], name: 'Slope 30°', text: 'Slope 30°', entity: 'TEXT' },
      // Justified text sits at its alignment point.
      { points: [[8, 9, 0]], name: 'Centred' },
    ])
    expect(byLayer(features, 'NOTES')).toMatchObject([
      { shape: 'point', points: [[7, 8, 0]], text: 'Block\nA 12 1/2', name: 'Block A 12 1/2', entity: 'MTEXT' },
    ])
  })

  it('counts what it does not read, paper space included', () => {
    expect(drawing.skipped).toMatchObject({ '3DFACE': 1, SOLID: 1, HATCH: 2, paperSpace: 1, degenerate: 2 })
    expect(byLayer(features, 'DOT')).toEqual([])
    expect(byLayer(features, 'TITLE')).toEqual([])
    expect(describeDxfSkipped(drawing.skipped)).toBe(
      'Not read from the drawing: 2 zero-length entities, 2 hatches, 1 polyface or mesh, 1 3D face, 1 solid fill, 1 paper-space entity.',
    )
    expect(describeDxfSkipped({})).toBeNull()
  })
})

describe('DXF blocks and layers', () => {
  const blocks = section('BLOCKS', [
    ...block('TREE', [1, 1], [line([1, 1], [2, 1], '0', [[62, 0]]), text([1, 2], 'Fir', 'LBL')]),
    ...block('PAIR', [0, 0], [insert('TREE', [0, 0], '0'), insert('TREE', [10, 0], '0')]),
    ...block('LOOP', [0, 0], [line([0, 0], [1, 0], '0'), insert('LOOP', [1, 0], '0')]),
  ])
  const read = (...items: P[][]) =>
    readDxf(
      dxf(
        header(),
        layerTable(
          { name: 'SYMBOLS', colour: 2 },
          { name: 'LBL', colour: 4 },
          { name: 'HIDDEN', colour: -1 },
          { name: 'ICE', colour: 1, flags: 1 },
        ),
        blocks,
        entities(...items),
      ),
    )

  it('places a block by its insertion point, scale and rotation, on the INSERT’s layer and colour', () => {
    const { features } = read(
      insert('TREE', [100, 200], 'SYMBOLS', [
        [62, 3],
        [41, 2],
        [42, 2],
        [50, 90],
      ]),
    )
    const [stem] = byLayer(features, 'SYMBOLS')
    // Block (1,1)–(2,1) about base (1,1), doubled and turned a quarter: (100,200)–(100,202).
    near(stem.points[0], [100, 200, 0])
    near(stem.points[1], [100, 202, 0])
    expect(stem).toMatchObject({ entity: 'LINE', name: 'TREE', block: 'TREE', colour: 3 })
    // Text on its own layer keeps it, and its text names it.
    const [label] = byLayer(features, 'LBL')
    near(label.points[0], [98, 200, 0])
    expect(label).toMatchObject({ name: 'Fir', text: 'Fir', block: 'TREE', colour: 4 })
  })

  it('expands nested blocks and arrays, and stops a block that inserts itself', () => {
    const nested = read(insert('PAIR', [0, 0], 'SYMBOLS'))
    expect(byLayer(nested.features, 'SYMBOLS').map((f) => f.points[0][0])).toEqual([0, 10])
    expect(nested.features.every((f) => f.block === 'PAIR')).toBe(true)
    const array = read(
      insert('TREE', [0, 0], 'SYMBOLS', [
        [70, 3],
        [71, 2],
        [44, 10],
        [45, 50],
      ]),
    )
    expect(byLayer(array.features, 'SYMBOLS')).toHaveLength(6)
    const loop = read(insert('LOOP', [0, 0], 'SYMBOLS'))
    expect(byLayer(loop.features, 'SYMBOLS')).toHaveLength(DXF_MAX_INSERT_DEPTH)
    expect(loop.skipped.insertDepth).toBe(1)
    expect(read(insert('NOPE', [0, 0], 'SYMBOLS')).skipped.missingBlock).toBe(1)
  })

  it('leaves out off and frozen layers and names them', () => {
    const drawing = read(line([0, 0], [1, 1], 'HIDDEN'), line([0, 0], [1, 1], 'ICE'), line([0, 0], [1, 1], 'SYMBOLS'))
    expect(drawing.features.map((f) => f.layer)).toEqual(['SYMBOLS'])
    expect(drawing.hiddenLayers).toEqual(['HIDDEN', 'ICE'])
    expect(drawing.skipped.hiddenLayer).toBe(2)
  })
})

describe('DXF units', () => {
  const units = (code?: number) => readDxf(dxf(header(code), entities(point([0, 0]))))
  it('reads $INSUNITS as metres per drawing unit, and an unstated unit as null', () => {
    expect(units(1)).toMatchObject({ unitM: 0.0254, unitName: 'inches' })
    expect(units(2)).toMatchObject({ unitM: 0.3048, unitName: 'feet' })
    expect(units(4)).toMatchObject({ unitM: 0.001, unitName: 'millimetres' })
    expect(units(5)).toMatchObject({ unitM: 0.01, unitName: 'centimetres' })
    expect(units(6)).toMatchObject({ unitM: 1, unitName: 'metres' })
    expect(units(0)).toMatchObject({ insUnits: 0, unitM: null, unitName: null })
    expect(units()).toMatchObject({ insUnits: null, unitM: null })
    // A code that is not a length (18: astronomical units) states nothing usable.
    expect(units(18)).toMatchObject({ insUnits: 18, unitM: null })
  })
})

describe('recognising and refusing DXF files', () => {
  it('knows a DXF by its first group pairs, past comments and blank lines', () => {
    expect(isDxfText('  0\r\nSECTION\r\n  2\r\nHEADER\r\n')).toBe(true)
    expect(isDxfText('\n\n999\nwritten by hand\n0\nSECTION\n')).toBe(true)
    expect(isDxfText('station,offset\n0,1')).toBe(false)
    expect(isDxfText('0\nLINE\n')).toBe(false)
    expect(isDxfText('{"type":"FeatureCollection"}')).toBe(false)
  })

  it('refuses binary DXF', () => {
    const binary = new TextEncoder().encode('AutoCAD Binary DXF\r\n\x1a\x00\x00\x00')
    expect(isBinaryDxf(binary)).toBe(true)
    expect(isBinaryDxf(new TextEncoder().encode('  0\nSECTION'))).toBe(false)
    expect(() => readDxf('AutoCAD Binary DXF\r\n\x1a\x00')).toThrow(/binary DXF/)
  })

  it('refuses malformed and truncated files with a reason', () => {
    expect(() => readDxf('0\nSECTION\n2\nENTITIES\n0\nLINE\n8\nA\n')).toThrow(/ends inside its ENTITIES section/)
    expect(() => readDxf('0\nSECTION\n2\nENTITIES\nLINE\n8\n')).toThrow(/line 5 should hold a group code/)
    expect(() => readDxf('0\nSECTION\n2\n')).toThrow(/middle of a group code pair/)
    expect(() => readDxf('0\nLINE\n')).toThrow(/a SECTION was expected/)
    expect(() => readDxf('999\nonly a comment\n')).toThrow(/no DXF sections/)
    expect(() => readDxf('0\nLINE\n')).toThrow(DxfError)
  })

  it('reads a pre-2007 drawing in its ANSI code page', () => {
    const bytes = new Uint8Array([
      ...new TextEncoder().encode(dxf(header(undefined, 'AC1015'), entities(text([0, 0], 'SLOPE_')))),
    ])
    const at = bytes.indexOf('_'.charCodeAt(0))
    bytes[at] = 0xb0 // ° in Windows-1252
    expect(readDxf(decodeDxfBytes(bytes)).features[0].text).toBe('SLOPE°')
  })
})

describe('DXF helpers', () => {
  it('strips TEXT and MTEXT codes', () => {
    expect(plainText('%%c150 %%p0.5 %%uUnder%%u 100%%% \\U+00B0')).toBe('⌀150 ±0.5 Under 100% °')
    expect(plainMText('{\\C1;Red} \\Ltext\\l\\Pline two\\\\ \\{x\\}')).toBe('Red text\nline two\\ {x}')
  })

  it('samples a B-spline through its end points and the rational weights', () => {
    const control: XYZ[] = [
      [0, 0, 0],
      [10, 10, 0],
      [20, 0, 0],
    ]
    // Heavier middle weight pulls the curve toward it.
    const light = bSplinePoints(control, 2, [0, 0, 0, 1, 1, 1], [1, 1, 1])
    const heavy = bSplinePoints(control, 2, [0, 0, 0, 1, 1, 1], [1, 4, 1])
    const peak = (points: XYZ[]) => Math.max(...points.map((p) => p[1]))
    expect(peak(light)).toBeCloseTo(5, 9)
    expect(peak(heavy)).toBeGreaterThan(7)
    // Bad knots fall back to clamped uniform ones.
    near(bSplinePoints(control, 2, [1, 0])[0], [0, 0, 0])
  })

  it('joins line pieces that meet on one layer, through two-way meetings only', () => {
    const piece = (points: number[][], layer = 'CL', entity = 'LINE'): DxfFeature => ({
      shape: 'line',
      points: points.map(([x, y]) => [x, y, 0]),
      layer,
      entity,
      name: layer,
      colour: null,
    })
    const joined = joinDxfLines(
      [
        piece([
          [0, 0],
          [10, 0],
        ]),
        // Drawn backwards, and its end 2 mm off.
        piece(
          [
            [20, 5],
            [15, 1],
            [10.002, 0],
          ],
          'CL',
          'ARC',
        ),
        piece([
          [20, 5],
          [30, 5],
        ]),
        piece(
          [
            [10, 0],
            [10, -10],
          ],
          'OTHER',
        ),
      ],
      0.005,
    )
    expect(joined).toHaveLength(2)
    expect(joined[0]).toMatchObject({ layer: 'CL', entity: 'LINE+ARC' })
    expect(joined[0].points.map(([x, y]) => [x, y])).toEqual([
      [0, 0],
      [10, 0],
      [15, 1],
      [20, 5],
      [30, 5],
    ])
    // A junction of three is a junction, not a road to run through.
    const tee = joinDxfLines(
      [
        piece([
          [0, 0],
          [10, 0],
        ]),
        piece([
          [10, 0],
          [20, 0],
        ]),
        piece([
          [10, 0],
          [10, 10],
        ]),
      ],
      0.005,
    )
    expect(tee).toHaveLength(3)
  })

  it('names the EPSG code PGMaps’ own export writes, and its profile and section layers', () => {
    expect(
      pgmapsDxfEpsg([
        'PG Maps forest road design: Spur. Plan in EPSG:3157 grid metres; preliminary planning geometry, not a construction design.',
      ]),
    ).toBe(3157)
    expect(pgmapsDxfEpsg(['Plan in EPSG:3157 grid metres'])).toBeNull()
    expect([...PGMAPS_DXF_FRAME_LAYERS].sort()).toEqual(
      Object.keys(DXF_LAYERS)
        .filter((layer) => /^(PROF|SECT)_/.test(layer))
        .sort(),
    )
  })
})
