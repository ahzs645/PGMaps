import { describe, expect, it } from 'vitest'

import type { BcSensitivityUnit } from './bcVisualInventory'
import type { VriStand } from './bcVegetationInventory'
import type { Box } from './photoFeatures'
import {
  candidateLineFeatures,
  featuresSeen,
  geometryBox,
  photoInventoryWanted,
  photoReadBox,
  resolvePhotoExtras,
  visualInventoryFeatures,
  vriFeatures,
  type PhotoPageFeatures,
} from './photoPageFeatures'
import type { PhotoFeature } from './photoOverlay'

const square = (west: number, south: number, size = 0.01): GeoJSON.Polygon => ({
  type: 'Polygon',
  coordinates: [
    [
      [west, south],
      [west + size, south],
      [west + size, south + size],
      [west, south + size],
      [west, south],
    ],
  ],
})

const unit = (id: string, west: number, objectiveId: BcSensitivityUnit['objectiveId']): BcSensitivityUnit =>
  ({
    id,
    polygonNumber: id,
    name: `Unit ${id}`,
    objectiveId,
    recommendedId: null,
    vac: null,
    vsc: '3',
    geometry: square(west, west),
  }) as BcSensitivityUnit

const SCENE: Box = [0, 0, 0.1, 0.1]
const INSIDE: Box = [0.02, 0.02, 0.05, 0.05]
const OUTSIDE: Box = [0.3, 0.3, 0.6, 0.5]

const pageWithUnits = (): PhotoPageFeatures => {
  const units = visualInventoryFeatures([unit('a', 0.03, 'retention'), unit('b', 0.4, null)])
  return {
    sensitivityUnits: { status: 'ready', features: units.sensitivityUnits, covers: SCENE },
    evqo: { status: 'ready', features: units.evqo, covers: SCENE },
  }
}

describe('visualInventoryFeatures', () => {
  it('names every unit and gives an objective only to units that have one', () => {
    const { sensitivityUnits, evqo } = visualInventoryFeatures([unit('a', 0, 'retention'), unit('b', 1, null)])
    expect(sensitivityUnits.map((f) => f.label)).toEqual(['Unit a', 'Unit b'])
    expect(evqo).toHaveLength(1)
    expect(evqo[0].properties).toEqual({ code: 'R' })
  })
})

describe('vriFeatures', () => {
  it('outlines every stand and takes non-vegetated land as rock', () => {
    const stands = [
      { featureId: 1, nonVegetatedLand: false, speciesCode: 'PL', heightMeters: 21.4, geometry: square(0, 0) },
      { featureId: 2, nonVegetatedLand: true, speciesCode: null, heightMeters: null, geometry: square(1, 0) },
    ] as unknown as VriStand[]
    const { vri, rock } = vriFeatures(stands)
    expect(vri.map((f) => f.label)).toEqual(['PL · 21 m', undefined])
    expect(rock.map((f) => f.id)).toEqual([2])
  })
})

describe('candidateLineFeatures', () => {
  it('splits dividers from lines of force and keeps each line of force its kind', () => {
    const lines = candidateLineFeatures([
      {
        role: 'subLandform',
        points: [
          [0, 0],
          [1, 1],
        ],
      },
      {
        role: 'forceConcave',
        points: [
          [0, 0],
          [1, 0],
        ],
      },
      {
        role: 'forceConvex',
        points: [
          [0, 1],
          [1, 1],
        ],
      },
    ])
    expect(lines.subLandforms).toHaveLength(1)
    expect(lines.linesOfForce.map((f) => f.properties?.kind)).toEqual(['concave', 'convex'])
  })
})

describe('boxes', () => {
  it('widens the read box outwards, so a nudged camera asks for the same box', () => {
    expect(photoReadBox([0.031, 0.012, 0.049, 0.058])).toEqual([0.02, 0, 0.06, 0.06])
    expect(photoReadBox([0.032, 0.013, 0.048, 0.057])).toEqual([0.02, 0, 0.06, 0.06])
  })

  it('reads a geometry box and keeps only features meeting the ground seen', () => {
    expect(geometryBox(square(1, 2))).toEqual([1, 2, 1.01, 2.01])
    // A collection takes in every part whole, not each part's south-west corner.
    expect(
      geometryBox({ type: 'GeometryCollection', geometries: [square(1, 2), { type: 'Point', coordinates: [3, 1] }] }),
    ).toEqual([1, 1, 3, 2.01])
    const features: PhotoFeature[] = [
      { layer: 'vri', geometry: square(0.03, 0.03) },
      { layer: 'vri', geometry: square(0.5, 0.5) },
    ]
    expect(featuresSeen(features, INSIDE)).toHaveLength(1)
  })
})

describe('photoInventoryWanted', () => {
  it('reads nothing while every layer that needs a read is off', () => {
    expect(photoInventoryWanted({}, {}, OUTSIDE)).toEqual({ visual: false, vri: false })
  })

  it('takes the page read for ground it covers and reads for ground past it', () => {
    const page = pageWithUnits()
    expect(photoInventoryWanted({ sensitivityUnits: true }, page, INSIDE).visual).toBe(false)
    expect(photoInventoryWanted({ sensitivityUnits: true }, page, OUTSIDE).visual).toBe(true)
    // VRI is never held by the page: a switched-on VRI layer reads for the ground seen.
    expect(photoInventoryWanted({ rock: true }, page, INSIDE).vri).toBe(true)
  })

  it('waits for the ground the camera sees before reading', () => {
    expect(photoInventoryWanted({ vri: true }, {}, null)).toEqual({ visual: false, vri: false })
  })
})

describe('resolvePhotoExtras', () => {
  it("draws the page's units for ground it covers, cut to what the camera sees", () => {
    const extras = resolvePhotoExtras(pageWithUnits(), {}, INSIDE)
    expect(extras.features.sensitivityUnits?.map((f) => f.id)).toEqual(['a'])
    expect(extras.features.evqo?.map((f) => f.id)).toEqual(['a'])
    expect(extras.unavailable.sensitivityUnits).toBeUndefined()
  })

  it('says a failed page read is not read for ground it covers, and never reads instead', () => {
    const page: PhotoPageFeatures = {
      sensitivityUnits: { status: 'failed', covers: SCENE, message: 'DataBC answered 503' },
    }
    expect(photoInventoryWanted({ sensitivityUnits: true }, page, INSIDE).visual).toBe(false)
    const extras = resolvePhotoExtras(page, {}, INSIDE)
    expect(extras.notes.sensitivityUnits).toBe('Not read: DataBC answered 503')
    expect(extras.features.sensitivityUnits).toBeUndefined()
  })

  it("draws the photo's own read for ground past the page's, and says when it failed or is partial", () => {
    const own = visualInventoryFeatures([unit('c', 0.45, 'retention')])
    const ready = resolvePhotoExtras(
      pageWithUnits(),
      { visual: { status: 'ready', box: [0.2, 0.2, 0.6, 0.6], features: own, partial: 'Cut short' } },
      OUTSIDE,
    )
    expect(ready.features.sensitivityUnits?.map((f) => f.id)).toEqual(['c'])
    expect(ready.notes.sensitivityUnits).toBe('Cut short')
    const failed = resolvePhotoExtras(
      pageWithUnits(),
      { visual: { status: 'failed', box: [0.2, 0.2, 0.6, 0.6], message: 'timed out' } },
      OUTSIDE,
    )
    expect(failed.features.sensitivityUnits).toBeUndefined()
    expect(failed.notes.sensitivityUnits).toBe('Not read: timed out')
  })

  it('keeps a layer switchable before its read, and marks a candidate the page has not found unavailable', () => {
    const extras = resolvePhotoExtras({}, {}, OUTSIDE)
    expect(extras.unavailable.vri).toBeUndefined()
    expect(extras.notes.vri).toMatch(/when switched on/)
    expect(extras.unavailable.subLandforms).toBe('Not read for this photo')
    expect(extras.unavailable.inventoryViewpoints).toBe('Not read for this photo')
  })

  it("draws candidates from the page wherever the photo looks, with the page's note", () => {
    const lines = candidateLineFeatures([
      {
        role: 'subLandform',
        points: [
          [0.4, 0.4],
          [0.5, 0.45],
        ],
      },
    ])
    const extras = resolvePhotoExtras(
      { subLandforms: { status: 'ready', features: lines.subLandforms, covers: null, note: 'Landform only' } },
      {},
      OUTSIDE,
    )
    expect(extras.features.subLandforms).toHaveLength(1)
    expect(extras.notes.subLandforms).toBe('Landform only')
  })
})
