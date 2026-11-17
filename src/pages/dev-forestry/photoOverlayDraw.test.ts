import { describe, expect, it } from 'vitest'

import { catalogueEntry } from '@/lib/forestry/blockSheet/symbolCatalogue'
import type { DrawOp } from '@/lib/mapSheet/drawOps'

import type { PhotoFeaturePaths } from './photoOverlay'
import {
  partsFromPathData,
  photoDrawOps,
  photoDrawScale,
  photoOverlayFeatures,
  photoPickLayers,
  simplifyPart,
  type DrawnFeature,
} from './photoOverlayDraw'
import { photoLayerVisibility, photoStrokes, roleSymbol } from './photoLayers'

const paths = (layer: string, extra: Partial<PhotoFeaturePaths> = {}): PhotoFeaturePaths => ({
  layer,
  visible: [],
  hidden: [],
  visibleParts: [],
  hiddenParts: [],
  markers: [],
  labelAnchor: null,
  ...extra,
})

const strokesOf = (ops: DrawOp[]) => ops.flatMap((op) => (op.op === 'path' && op.stroke ? [op.stroke] : []))

describe('photoDrawOps', () => {
  const block: DrawnFeature = {
    paths: paths('proposedBlocks', {
      label: 'Block A',
      visibleParts: [
        [
          [100, 900],
          [700, 900],
        ],
      ],
      hiddenParts: [
        [
          [700, 900],
          [900, 950],
        ],
      ],
      labelAnchor: { x: 400, y: 900 },
    }),
  }
  const skyline = [{ x: 0, y: 400 }, { x: 900, y: 420 }, null, { x: 1000, y: 430 }, { x: 1800, y: 410 }]

  it('works in sheet points across the reference width', () => {
    const draw = photoDrawOps({ photoWidth: 1800, photoHeight: 1200, visibility: photoLayerVisibility() })
    expect(draw.width).toBe(900)
    expect(draw.height).toBe(600)
    expect(photoDrawScale(1800)).toBe(0.5)
  })

  it('draws a block from its symbol, its hidden part dotted, and the skyline in runs', () => {
    const draw = photoDrawOps({
      photoWidth: 1800,
      photoHeight: 1200,
      visibility: photoLayerVisibility(),
      features: [block],
      skyline,
      styleId: 'analysis-sheet-magenta',
    })
    const strokes = strokesOf(draw.ops)
    const symbol = roleSymbol('proposedBlock', 'analysis-sheet-magenta')
    expect(strokes).toContainEqual(photoStrokes(symbol, 1, true)[0])
    expect(strokes).toContainEqual(photoStrokes(symbol, 1)[0])
    const skylinePaths = draw.ops.filter(
      (op) => op.op === 'path' && op.stroke?.color === photoStrokes(catalogueEntry('photo-skyline').symbol, 1)[0].color,
    )
    expect(skylinePaths.length).toBeGreaterThan(0)
    const first = skylinePaths[0]
    if (first.op !== 'path') throw Error('expected a path')
    // Two runs, split at the gap, scaled by half.
    expect(first.parts).toEqual([
      [
        [0, 200],
        [450, 210],
      ],
      [
        [500, 215],
        [900, 205],
      ],
    ])
  })

  it('draws a layer’s features with one path a stroke', () => {
    const twice = photoDrawOps({
      photoWidth: 1800,
      photoHeight: 1200,
      visibility: { ...photoLayerVisibility(), skyline: false },
      features: [block, { paths: { ...block.paths, label: 'Block B' } }],
      styleId: 'analysis-sheet-magenta',
    })
    const once = photoDrawOps({
      photoWidth: 1800,
      photoHeight: 1200,
      visibility: { ...photoLayerVisibility(), skyline: false },
      features: [block],
      styleId: 'analysis-sheet-magenta',
    })
    const paths = (ops: DrawOp[]) => ops.filter((op) => op.op === 'path')
    expect(paths(twice.ops)).toHaveLength(paths(once.ops).length)
    const first = paths(twice.ops)[0]
    if (first.op !== 'path') throw Error('expected a path')
    expect(first.parts).toHaveLength(2)
  })

  it('leaves out what is turned off and names blocks only when asked', () => {
    const off = photoDrawOps({
      photoWidth: 1800,
      photoHeight: 1200,
      visibility: { ...photoLayerVisibility(), proposedBlocks: false, skyline: false },
      features: [block],
      skyline,
    })
    expect(off.ops).toEqual([])
    const named = photoDrawOps({
      photoWidth: 1800,
      photoHeight: 1200,
      visibility: photoLayerVisibility(),
      features: [block],
      labels: true,
    })
    expect(named.ops.some((op) => op.op === 'text' && op.text === 'Block A')).toBe(true)
  })

  it('draws reading aids only when turned on', () => {
    const aids = {
      horizon: 'M0 300L1800 310',
      contours: [
        {
          meters: 2000,
          d: '',
          parts: [[[0, 800] as [number, number], [1800, 820] as [number, number]]],
          labelAnchor: { x: 900, y: 810 },
        },
      ],
      ticks: [{ bearing: 90, label: 'E', x: 900, y: 305, up: [0, -1] as [number, number], onEdge: false }],
    }
    const hidden = photoDrawOps({ photoWidth: 1800, photoHeight: 1200, visibility: photoLayerVisibility(), aids })
    expect(hidden.ops).toEqual([])
    const shown = photoDrawOps({
      photoWidth: 1800,
      photoHeight: 1200,
      visibility: { ...photoLayerVisibility(), horizon: true, distanceContours: true, bearingTicks: true },
      aids,
    })
    const texts = shown.ops.flatMap((op) => (op.op === 'text' ? [op.text] : []))
    expect(texts).toContain('2 km')
    expect(texts).toContain('E')
  })
})

describe('simplifyPart', () => {
  it('keeps a line within about a pixel and drops segments shorter than one', () => {
    // A wavy line traced every 0.1 point: far finer than a screen shows.
    const dense = Array.from({ length: 2001 }, (_, i) => [i * 0.1, 50 + 20 * Math.sin(i / 200)] as [number, number])
    const kept = simplifyPart(dense, 1)
    expect(kept.length).toBeLessThan(dense.length / 20)
    expect(kept[0]).toEqual(dense[0])
    expect(kept[kept.length - 1]).toEqual(dense[dense.length - 1])
    // Every dropped point lies within about half a point of the kept line.
    for (const [x, y] of dense) {
      const i = kept.findIndex(([kx]) => kx >= x)
      const [x0, y0] = kept[Math.max(0, i - 1)],
        [x1, y1] = kept[Math.max(0, i)]
      const along = x1 === x0 ? y0 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0)
      expect(Math.abs(along - y)).toBeLessThan(1)
    }
    // A corner is kept.
    expect(
      simplifyPart(
        [
          [0, 0],
          [10, 0],
          [10, 10],
        ],
        1,
      ),
    ).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
    ])
  })
})

describe('partsFromPathData', () => {
  it('reads move and line commands into parts', () => {
    expect(partsFromPathData('M0 1L2 3L4 5M6 7L8 9M10 11')).toEqual([
      [
        [0, 1],
        [2, 3],
        [4, 5],
      ],
      [
        [6, 7],
        [8, 9],
      ],
    ])
  })
})

describe('photoOverlayFeatures', () => {
  const square = (x: number): GeoJSON.Polygon => ({
    type: 'Polygon',
    coordinates: [
      [
        [x, 0],
        [x + 1, 0],
        [x + 1, 1],
        [x, 1],
        [x, 0],
      ],
    ],
  })
  const scene = {
    targets: [
      { id: 'b', name: 'Block', role: 'block' as const, geometry: square(0) },
      { id: 'o', name: 'Opening', role: 'harvested' as const, geometry: square(2) },
      { id: 'l', name: 'Landform', role: 'landscape' as const, geometry: square(4) },
    ],
    masks: [{ id: 'm', name: 'Lot', kind: 'private' as const, geometry: square(6), source: 'test' }],
    viewsOfInterest: [],
  } as unknown as Parameters<typeof photoOverlayFeatures>[0]

  it('puts the scene, the reads and the page’s extras on their layers', () => {
    const features = photoOverlayFeatures(
      scene,
      {
        wetlands: {
          status: 'ready',
          truncated: false,
          collection: {
            type: 'FeatureCollection',
            features: [{ type: 'Feature', id: 'w', properties: {}, geometry: square(8) }],
          },
        },
        lakes: { status: 'error', error: 'down' },
      },
      { vri: [{ layer: 'ignored', id: 'v', geometry: square(10) }] },
    )
    expect(features.map((feature) => [feature.layer, feature.id])).toEqual([
      ['proposedBlocks', 'b'],
      ['openings', 'o'],
      ['landform', 'l'],
      ['privateLand', 'm'],
      ['lakes', 'w'],
      ['vri', 'v'],
    ])
    expect(features[4].properties?.kind).toBe('wetland')
  })

  it('names the polygon a pixel lies in for pickable area layers only', () => {
    const features = photoOverlayFeatures(scene, null, {
      subLandforms: [{ layer: 'subLandforms', geometry: square(12) }],
    })
    const layers = photoPickLayers(features)
    expect(layers.map((layer) => layer.id).sort()).toEqual(['landform', 'openings', 'privateLand', 'proposedBlocks'])
    const blocks = layers.find((layer) => layer.id === 'proposedBlocks')!
    expect(blocks.prepared.indexAt(0.5, 0.5)).toBe(0)
    expect(blocks.features[0].label).toBe('Block')
  })
})
