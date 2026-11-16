/**
 * What a scene holds, as counts, and the four scenes step 1's *Start from* offers. The line a button's tooltip
 * prints is read from the scene the button loads, so it cannot drift from the sample. DOM-free.
 */

import { createRoadsideDriveScene } from './driveScenario'
import { createPurdenLakeScene } from './purdenLakeScenario'
import { createEmptyScene, createSampleScene, type ForestryScene } from './scene'
import { lineLengthMeters } from './visibility'

export type ScenarioSummary = {
  blocks: number
  landforms: number
  existingOpenings: number
  masks: number
  viewsOfInterest: number
  /** Where the scene is assessed from: a road of at least two points, one placed viewpoint, or nothing yet. */
  access: { kind: 'road'; lengthKm: number } | { kind: 'viewpoint' } | { kind: 'none' }
}

export function summariseScenario(scene: ForestryScene): ScenarioSummary {
  const count = (role: ForestryScene['targets'][number]['role']) =>
    scene.targets.filter((target) => target.role === role).length
  const { mode, coordinates } = scene.viewpoint
  return {
    blocks: count('block'),
    landforms: count('landscape'),
    existingOpenings: count('harvested'),
    masks: scene.masks?.length ?? 0,
    viewsOfInterest: scene.viewsOfInterest?.length ?? 0,
    access:
      mode === 'corridor' && coordinates.length >= 2
        ? { kind: 'road', lengthKm: lineLengthMeters(coordinates) / 1000 }
        : mode === 'spot' && coordinates.length >= 1
          ? { kind: 'viewpoint' }
          : { kind: 'none' },
  }
}

const counted = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

/**
 * One line naming what a scene holds, e.g. "1 block · 9.5 km road · 1 landform". A scene with blocks says so when
 * it has no road or viewpoint, or no landform; openings, masks and views of interest are named only when present.
 */
export function scenarioContents(scene: ForestryScene): string {
  const summary = summariseScenario(scene)
  const { blocks, landforms, existingOpenings, masks, viewsOfInterest, access } = summary
  if (!blocks && !landforms && !existingOpenings && !masks && !viewsOfInterest && access.kind === 'none')
    return 'Empty: nothing loaded'
  return [
    blocks ? counted(blocks, 'block') : 'no block',
    access.kind === 'road'
      ? `${access.lengthKm.toFixed(1)} km road`
      : access.kind === 'viewpoint'
        ? '1 viewpoint'
        : 'no road or viewpoint',
    landforms ? counted(landforms, 'landform') : 'no landform',
    existingOpenings ? counted(existingOpenings, 'existing opening') : null,
    masks ? counted(masks, 'mask') : null,
    viewsOfInterest ? counted(viewsOfInterest, 'view of interest', 'views of interest') : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

export type StartScenarioId = 'tabor' | 'purden' | 'roadside' | 'new'

/** Step 1's *Start from* buttons, in the order drawn: the label, a sentence on the scenario, and the scene it loads. */
export const START_SCENARIOS: ReadonlyArray<{
  id: StartScenarioId
  label: string
  description: string
  build: () => ForestryScene
}> = [
  {
    id: 'tabor',
    label: 'Tabor Mountain sample',
    description:
      'A valley road east of Prince George looking across at Tabor Mountain, with one sample block on the face the road sees and one over the height of land that it never does.',
    build: createSampleScene,
  },
  {
    id: 'purden',
    label: 'Hwy 16 · Purden Lake',
    description:
      "A hypothetical block on Purden Lake's north face, across the water from Hwy 16, under BC's Retention and Partial Retention EVQO. The road, landform, viewpoints and arrows are real records.",
    build: createPurdenLakeScene,
  },
  {
    id: 'roadside',
    label: 'Roadside demo drive',
    description:
      'A hypothetical opening beside a 1.2 km route, opened straight into the road view. It has no landform: its block stands on the valley floor.',
    build: createRoadsideDriveScene,
  },
  {
    id: 'new',
    label: 'New site',
    description: 'Starts empty. Add a block first, then a view or a road to assess it from.',
    build: createEmptyScene,
  },
]

let contents: Record<StartScenarioId, string> | null = null

/** Each *Start from* scenario's contents line, built from its own scene once. */
export function startScenarioContents(): Record<StartScenarioId, string> {
  contents ??= Object.fromEntries(
    START_SCENARIOS.map((scenario) => [scenario.id, scenarioContents(scenario.build())]),
  ) as Record<StartScenarioId, string>
  return contents
}
