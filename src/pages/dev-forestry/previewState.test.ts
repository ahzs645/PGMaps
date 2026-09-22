import { describe, expect, it } from 'vitest'
import { parseScene, serializeScene } from './scene'
import { createRoadsideDriveScene } from './driveScenario'
import { buildSceneInput, sceneFingerprint } from './sceneInput'
import {
  candidateDriveViews,
  parsePreview,
  PreviewFrameBudget,
  previewInputError,
  serializePreview,
  type SavedDriveView,
} from './previewState'
import type { AnalysisResult } from './types'

const view: SavedDriveView = {
  id: 'saved',
  name: 'Road opening',
  positionMeters: 600,
  lookAtTargetId: 'roadside-harvest-demo-block',
  yaw: 12,
  tilt: -3,
  treeHeightMeters: 28,
  roadClearWidthMeters: 20,
  harvestPhase: 'before',
}
describe('driving preview workflow', () => {
  it('round-trips the numerical scenario and replay pose without confirming assumptions', () => {
    const scene = parseScene(JSON.parse(serializeScene(createRoadsideDriveScene())))!
    const restored = parsePreview(JSON.parse(serializePreview(scene, [view])))!
    expect(buildSceneInput(restored.scene)).toEqual(buildSceneInput(scene))
    expect(sceneFingerprint(restored.scene)).toBe(sceneFingerprint(scene))
    expect(restored.views[0]).toEqual({ ...view, id: 'view-0' })
    expect(restored.scene.settings.greenAreaConfirmed).toBe(false)
  })
  it('rejects malformed replay poses and identifies missing geometry', () => {
    const scene = createRoadsideDriveScene()
    const raw = JSON.parse(
      serializePreview(scene, [view, { ...view, positionMeters: -1 }, { ...view, tilt: Infinity }]),
    )
    expect(parsePreview(raw)?.views).toHaveLength(1)
    raw.scene.targets[0].geometry.coordinates = [[1, 2]]
    expect(() => parsePreview(raw)).toThrow('valid road and cutblock')
    expect(parsePreview({ type: 'other', scene })).toBeNull()
    expect(previewInputError({ ...scene, targets: [] })).toContain('cutblock')
    expect(previewInputError({ ...scene, viewpoint: { ...scene.viewpoint, coordinates: [] } })).toContain('road')
  })
  it('chooses separated visible terrain candidates and excludes unknown/occluded stations', () => {
    const result = {
      corridorLengthMeters: 1200,
      targets: [
        {
          targetId: 'block',
          role: 'block',
          stations: [0, 25, 200, 500, 900].map((d, i) => ({
            distanceAlongMeters: d,
            visiblePercent: i === 4 ? 0 : 70,
          })),
          visibleApparentSolidAngleByStation: new Float64Array([9, 10, 8, 7, 100]),
        },
      ],
    } as unknown as AnalysisResult
    expect(candidateDriveViews(result, 'block').map((s) => s.positionMeters)).toEqual([25, 200, 500])
  })
  it('reduces quality only after sustained slow visible frame windows', () => {
    const budget = new PreviewFrameBudget()
    for (let i = 0; i < 270; i++) expect(budget.push(16.7)).toBe(false)
    expect(budget.push(2000)).toBe(false)
    for (let i = 0; i < 269; i++) expect(budget.push(45)).toBe(false)
    expect(budget.push(45)).toBe(true)
    const intermittent = new PreviewFrameBudget()
    for (let i = 0; i < 900; i++) expect(intermittent.push(i % 10 ? 16 : 70)).toBe(false)
  })
})
