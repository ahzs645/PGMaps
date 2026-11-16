import { describe, expect, it } from 'vitest'

import { TREE_DRAWING_IDS, type ForestMesh } from './forest'
import { BILLBOARD_ASPECT, CLUMP_ASPECT } from './impostor'
import {
  BAKED_AZIMUTHS,
  BAKED_CELL_HEIGHT,
  BAKED_VARIANTS,
  bakeClumpAtlas,
  bakeImpostorAtlas,
  bakeImpostorAtlasInSteps,
  bakeTreeView,
  bakedTreeMesh,
  viewCoverage,
} from './impostorBake'

const WIDTH = Math.round(BAKED_CELL_HEIGHT * BILLBOARD_ASPECT)
const alphaAt = (view: { width: number; colour: Uint8ClampedArray }, column: number, row: number) =>
  view.colour[(row * view.width + column) * 4 + 3]

describe('bakeTreeView', () => {
  const mesh = bakedTreeMesh('spruce', 0)
  const view = bakeTreeView(mesh, 'spruce', 0, WIDTH, BAKED_CELL_HEIGHT)

  it('pictures the tree standing on the bottom of its cell and reaching the top', () => {
    const rowCovered = (row: number) =>
      Array.from({ length: WIDTH }, (_, column) => alphaAt(view, column, row)).some((a) => a > 0)
    // The leader's tip is finer than a pixel: the top few rows hold it.
    expect([0, 1, 2, 3].some(rowCovered)).toBe(true)
    expect(rowCovered(BAKED_CELL_HEIGHT - 1)).toBe(true)
    // The stem is in the middle of the cell at the ground.
    expect(alphaAt(view, Math.floor(WIDTH / 2), BAKED_CELL_HEIGHT - 2)).toBeGreaterThan(0)
    expect(alphaAt(view, 1, BAKED_CELL_HEIGHT - 2)).toBe(0)
  })

  it('is the same bytes every time, and a different picture from another side', () => {
    const again = bakeTreeView(mesh, 'spruce', 0, WIDTH, BAKED_CELL_HEIGHT)
    expect(again.colour).toEqual(view.colour)
    expect(again.surface).toEqual(view.surface)
    const quarter = bakeTreeView(mesh, 'spruce', Math.PI / 2, WIDTH, BAKED_CELL_HEIGHT)
    expect(quarter.colour).not.toEqual(view.colour)
    // Another side of the same tree: about the same cover.
    expect(Math.abs(viewCoverage(quarter, 0.45) / viewCoverage(view, 0.45) - 1)).toBeLessThan(0.15)
  })

  it('says where the card is foliage and where it is bark, and leaves empty pixels facing the camera', () => {
    // A lodgepole's lower half is bare stem; its crown is foliage.
    const pine = bakeTreeView(bakedTreeMesh('pine', 0), 'pine', 0, WIDTH, BAKED_CELL_HEIGHT)
    const centre = Math.floor(WIDTH / 2)
    const stemRow = Math.round(BAKED_CELL_HEIGHT * 0.8)
    expect(alphaAt(pine, centre, stemRow)).toBeGreaterThan(0)
    expect(pine.surface[(stemRow * WIDTH + centre) * 4 + 2]).toBeLessThan(64)
    let foliage = 0
    for (let row = 0; row < BAKED_CELL_HEIGHT * 0.4; row += 1)
      for (let column = 0; column < WIDTH; column += 1)
        if (alphaAt(pine, column, row) > 200 && pine.surface[(row * WIDTH + column) * 4 + 2] > 200) foliage += 1
    expect(foliage).toBeGreaterThan(100)
    // A corner no tree reaches: no cover, and a normal that leans nowhere.
    expect(alphaAt(pine, 0, 0)).toBe(0)
    expect([pine.surface[0], pine.surface[1]]).toEqual([128, 128])
  })

  it('runs across the cell to the left of the camera, as the layer lays a card out', () => {
    // One triangle on the +y side of the stem, seen from the +x axis: +y is on that camera's right,
    // and a card's corners run from right to left, so it lands in the left half of the cell.
    const marker: ForestMesh = {
      attributes: {
        positions: { size: 3, value: new Float32Array([0, 0.2, 0.4, 0, 0.4, 0.4, 0, 0.3, 0.6]) },
        normals: { size: 3, value: new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0]) },
        bark: { size: 1, value: new Float32Array([1, 1, 1]) },
      },
      indices: { size: 1, value: new Uint16Array([0, 1, 2]) },
    }
    const seen = bakeTreeView(marker, 'spruce', 0, WIDTH, BAKED_CELL_HEIGHT)
    let left = 0
    let right = 0
    for (let row = 0; row < BAKED_CELL_HEIGHT; row += 1)
      for (let column = 0; column < WIDTH; column += 1)
        if (alphaAt(seen, column, row) > 0) {
          if (column < WIDTH / 2) left += 1
          else right += 1
        }
    expect(left).toBeGreaterThan(0)
    expect(right).toBe(0)
    // From the other side of the stem it is on the camera's left, the right half of the cell.
    const behind = bakeTreeView(marker, 'spruce', Math.PI, WIDTH, BAKED_CELL_HEIGHT)
    let other = 0
    for (let row = 0; row < BAKED_CELL_HEIGHT; row += 1)
      for (let column = Math.ceil(WIDTH / 2); column < WIDTH; column += 1)
        if (alphaAt(behind, column, row) > 0) other += 1
    expect(other).toBeGreaterThan(0)
  })
})

describe('the baked atlases', () => {
  const atlas = bakeImpostorAtlas()

  it('holds every drawing: a row each, its trees across, each tree its views side by side', () => {
    expect(atlas.azimuths).toBe(BAKED_AZIMUTHS)
    expect(atlas.columns).toBe(BAKED_VARIANTS * BAKED_AZIMUTHS)
    expect(atlas.rows).toBe(TREE_DRAWING_IDS.length)
    expect(atlas.image!.width).toBe(atlas.cellWidth * atlas.columns)
    expect(atlas.image!.height).toBe(atlas.cellHeight * atlas.rows)
    expect(atlas.surface!.data.length).toBe(atlas.image!.data.length)
    // Inside what any device this page runs on can hold as one texture.
    expect(Math.max(atlas.image!.width, atlas.image!.height)).toBeLessThanOrEqual(4096)
    TREE_DRAWING_IDS.forEach((drawing, row) => expect(atlas.speciesRow[drawing]).toBe(row))
  })

  it('leaves no cell empty', () => {
    const image = atlas.image!
    for (let row = 0; row < atlas.rows; row += 1) {
      for (let column = 0; column < atlas.columns; column += 1) {
        let covered = 0
        for (let y = 0; y < atlas.cellHeight; y += 4)
          for (let x = 0; x < atlas.cellWidth; x += 2)
            if (image.data[((row * atlas.cellHeight + y) * image.width + column * atlas.cellWidth + x) * 4 + 3] > 115)
              covered += 1
        expect(covered).toBeGreaterThan(20)
      }
    }
  })

  it('is made once, whether asked for whole or in steps', async () => {
    let pauses = 0
    const stepped = await bakeImpostorAtlasInSteps(async () => {
      pauses += 1
    })
    expect(stepped).toBe(atlas)
    expect(pauses).toBe(0)
  })

  it('builds the far clump cards of the same trees: several across, one of them full height', () => {
    const clumps = bakeClumpAtlas()
    expect(clumps.azimuths).toBeUndefined()
    expect(clumps.rows).toBe(TREE_DRAWING_IDS.length)
    expect(clumps.cellWidth).toBe(Math.round(clumps.cellHeight * CLUMP_ASPECT))
    const image = clumps.image!
    const covered = (row: number, column: number, x: number, y: number) =>
      image.data[((row * clumps.cellHeight + y) * image.width + column * clumps.cellWidth + x) * 4 + 3] > 115
    for (let row = 0; row < clumps.rows; row += 1) {
      const thirds = [0, 0, 0]
      let top = false
      for (let y = 0; y < clumps.cellHeight; y += 1)
        for (let x = 0; x < clumps.cellWidth; x += 1)
          if (covered(row, 0, x, y)) {
            thirds[Math.floor((x / clumps.cellWidth) * 3)] += 1
            // A leader is finer than a pixel at this size: the top few rows hold the tallest tree.
            if (y < 10) top = true
          }
      expect(thirds.every((count) => count > 50)).toBe(true)
      expect(top).toBe(true)
    }
  })
})
