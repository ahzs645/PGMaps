import type { TutorialSemanticAction } from 'tourkit/core'
import type { TourLaunch } from '@/lib/tours/tourLaunch'
import { tourLaunchSearch } from '@/lib/tours/tourLaunch'
import { ROAD_TOUR_ACTIONS, type RoadTourSnapshot } from './roadTour'

/**
 * Where a lesson starts, by the name its manifest gives in `launch.fixture`. Tourkit never reads that
 * name; the designer does: `matches` says whether the open project is the fixture, `params` open it,
 * and `setup` puts the view the lesson starts from on screen. Setup runs through Watch's executor
 * before the player mounts, in both modes and on every launch, so a lesson starts from the same
 * screen however it was opened. Keep this file free of DOM access.
 */
export interface RoadLessonFixture {
  /** Names the fixture on the card that offers to open it ("the Hillside access training project"). */
  label: string
  matches: (snapshot: RoadTourSnapshot) => boolean
  /** Address parameters that open the fixture, merged into the address the lesson was opened with. */
  params: Readonly<Record<string, string>>
  setup: readonly TutorialSemanticAction[]
}

const command = (id: string): TutorialSemanticAction => ({
  id: ROAD_TOUR_ACTIONS.command,
  args: { command: id },
  match: 'subset',
})

const TRAINING: RoadLessonFixture = {
  label: 'the Hillside access training project',
  matches: (snapshot) => snapshot.project.training,
  params: { example: 'training' },
  // Station 0+000 with the cross-section in the detail pane: the screen the training lessons are
  // written from, in every interface (the Ribbon's default layout hides the detail pane).
  setup: [{ id: ROAD_TOUR_ACTIONS.station, args: { chainage: 0 }, match: 'subset' }, command('crossSection')],
}

export const ROAD_LESSON_FIXTURES: Record<string, RoadLessonFixture> = {
  'hillside-training': TRAINING,
  // The training project with the plan on the road-free patch of the hillside (`lesson=sketch-road`
  // makes the plan's first view that patch, `PlanView.tsx`), so a stroke there makes a new road.
  'hillside-training-sketch': { ...TRAINING, params: { example: 'training', lesson: 'sketch-road' } },
}

/** The search string that opens `fixture` with the lesson still requested. */
export function fixtureLaunchSearch(search: string, fixture: RoadLessonFixture, launch: TourLaunch) {
  const params = new URLSearchParams(tourLaunchSearch(search, launch))
  for (const [key, value] of Object.entries(fixture.params)) params.set(key, value)
  return `?${params}`
}
