import { describe, expect, it } from 'vitest'
import { createSampleScene, parseScene, serializeScene } from '../scene'
import { buildSceneInput, sceneFingerprint } from '../sceneInput'
import { DEFAULT_PRESCRIPTION } from './prescription'

describe('a stand prescription in a saved scene', () => {
  const withPrescription = () => {
    const scene = createSampleScene()
    const index = scene.targets.findIndex((target) => target.role === 'block')
    expect(index).toBeGreaterThanOrEqual(0)
    const targets = scene.targets.map((target, i) =>
      i === index
        ? {
            ...target,
            harvestSystem: 'partial' as const,
            prescription: { ...DEFAULT_PRESCRIPTION, pattern: 'grouped' as const, protectedKeys: [123_456_789_012] },
          }
        : target,
    )
    return { scene: { ...scene, targets }, index }
  }

  it('is saved and read back', () => {
    const { scene, index } = withPrescription()
    const read = parseScene(JSON.parse(serializeScene(scene)))!
    expect(read.targets[index].prescription?.pattern).toBe('grouped')
    expect(read.targets[index].prescription).toEqual(scene.targets[index].prescription)
  })

  it('never stales the run or reaches its input', () => {
    const { scene, index } = withPrescription()
    const plain = {
      ...scene,
      targets: scene.targets.map((target, i) => (i === index ? { ...target, prescription: null } : target)),
    }
    expect(sceneFingerprint(scene)).toBe(sceneFingerprint(plain))
    expect(JSON.stringify(buildSceneInput(scene))).not.toContain('prescription')
  })
})
