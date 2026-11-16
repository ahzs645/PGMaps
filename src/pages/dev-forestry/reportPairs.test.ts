import { describe, expect, it } from 'vitest'

import { pairPictures, simulationPicture, type BeforePicture } from './reportPairs'

const picture = (dataUrl: string) => ({ dataUrl, width: 200, height: 100 })
const pgmapsBefore: BeforePicture = { view: 'VP1', caption: 'Before', ...picture('pgmaps-before'), source: 'render' }
const photo: BeforePicture = { view: 'VP1', caption: 'Photo', ...picture('photo'), source: 'photo' }
const engineAfter = { view: 'VP1', caption: 'VP1: simulation', ...picture('engine-after') }
const ownAfter = { view: 'VP1', caption: 'VP1: simulation', ...picture('pgmaps-after') }

describe('VIA report before/after pairs', () => {
  it('pair an engine’s simulation with the same engine’s render before harvest', () => {
    const pair = pairPictures({
      name: 'VP1',
      after: engineAfter,
      afterRenderer: 'Nanite Forest',
      ownAfter,
      before: pgmapsBefore,
      engineBefore: picture('engine-before'),
    })
    expect(pair.before).toMatchObject({ dataUrl: 'engine-before', source: 'render', renderer: 'Nanite Forest' })
    expect(pair.after).toMatchObject({ dataUrl: 'engine-after', renderer: 'Nanite Forest' })
  })

  it('never pair PGMaps’ before with an engine’s after: without the engine’s before, PGMaps draws both and says why', () => {
    const pair = pairPictures({
      name: 'VP1',
      after: engineAfter,
      afterRenderer: 'threejs-worldgen',
      ownAfter,
      before: pgmapsBefore,
      engineBefore: null,
      engineBeforeMissing: 'its render failed: lost the GPU',
    })
    expect(pair.before).toMatchObject({ dataUrl: 'pgmaps-before', renderer: 'PGMaps' })
    expect(pair.after).toMatchObject({ dataUrl: 'pgmaps-after', renderer: 'PGMaps' })
    expect(pair.after.note).toBe(
      'Drawn by PGMaps, as the picture before it: threejs-worldgen drew no before picture of this view (its render failed: lost the GPU).',
    )
    // With no PGMaps after to fall back on, the engine's after stands alone.
    const alone = pairPictures({
      ...{ name: 'VP1', after: engineAfter, afterRenderer: 'threejs-worldgen' },
      ownAfter: null,
      before: pgmapsBefore,
      engineBefore: null,
    })
    expect(alone.before).toBeNull()
    expect(alone.after.dataUrl).toBe('engine-after')
  })

  it('keep a lined-up field photograph whoever drew the simulation, and PGMaps’ pair as it was', () => {
    const withPhoto = pairPictures({
      name: 'VP1',
      after: engineAfter,
      afterRenderer: 'Nanite Forest',
      ownAfter,
      before: photo,
      engineBefore: picture('engine-before'),
    })
    expect(withPhoto.before).toBe(photo)
    expect(withPhoto.after.dataUrl).toBe('engine-after')
    const own = pairPictures({
      name: 'VP1',
      after: ownAfter,
      afterRenderer: null,
      ownAfter,
      before: pgmapsBefore,
      engineBefore: null,
    })
    expect(own.before).toMatchObject({ dataUrl: 'pgmaps-before', renderer: 'PGMaps' })
    expect(own.after).toMatchObject({ dataUrl: 'pgmaps-after', renderer: 'PGMaps' })
    expect(own.after.note).toBeUndefined()
  })

  it('mark each block where its callout anchors it, in shares of the picture', () => {
    const sim = simulationPicture(
      'VP1',
      {
        frameImage: picture('frame'),
        callouts: [
          { anchor: [50, 25], title: 'Block A', status: 'visible' },
          { anchor: [10, 10], title: 'Opening', status: 'visible', secondary: true },
          { anchor: [-1, 5], title: 'Block B', status: 'visible' },
        ],
        hidden: [{ anchor: [100, 50], title: 'Block C', status: 'not visible' }],
      },
      picture('screenshot'),
    )
    expect(sim.dataUrl).toBe('frame')
    expect(sim.marks).toEqual([
      { x: 0.25, y: 0.25, label: 'Block A', status: 'visible' },
      { x: 0.5, y: 0.5, label: 'Block C', status: 'not visible' },
    ])
  })
})
