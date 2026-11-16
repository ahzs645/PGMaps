import { useEffect, useRef, useState, type ReactNode } from 'react'
import { parseTutorialManifest, type TutorialManifest, type TutorialSemanticAction } from 'tourkit/core'
import { Button } from '@/components/ui/button'
import TourPlayerHost from '@/components/tours/TourPlayerHost'
import { withBase } from '@/lib/dataUrl'
import type { TourActionStream } from '@/lib/tours/tourActions'
import type { TourLaunch } from '@/lib/tours/tourLaunch'
import { roadLesson } from './roadLessons'
import { ROAD_LESSON_FIXTURES, fixtureLaunchSearch } from './roadLessonFixtures'
import {
  ROAD_TOUR_NAMESPACE,
  roadTourContextActions,
  roadTourReturnAction,
  roadTourStepExpectsDialog,
  type RoadTourSnapshot,
} from './roadTour'

export interface RoadLessonPlayerProps {
  launch: TourLaunch
  snapshot: RoadTourSnapshot
  execute: (action: TutorialSemanticAction) => void
  actions: TourActionStream
  onEnd: () => void
}

const CARD = 'fixed bottom-4 right-4 z-[8200] w-[min(22rem,calc(100vw-2rem))] rounded-lg border bg-card p-4 shadow-xl'
const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))
/** Lets the page render what the setup actions changed before the player reads its snapshot. */
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))

/**
 * A live lesson over the road designer (guide `docs/forestry-road-design/live-lessons.md`). The page
 * loads this module only when the address asks for a lesson, so Tourkit stays out of the designer's
 * own bundle. It opens the lesson's fixture (`roadLessonFixtures.ts`), runs the fixture's setup, then
 * hands over to the player.
 */
export default function RoadLessonPlayer({ launch, snapshot, execute, actions, onEnd }: RoadLessonPlayerProps) {
  // `readTourLaunch` admits only listed lessons, so this lesson exists.
  const lesson = roadLesson(launch.id)!
  const [manifest, setManifest] = useState<TutorialManifest | null>(null)
  const [error, setError] = useState('')
  const [setUp, setSetUp] = useState(false)
  const settingUp = useRef(false)
  useEffect(() => {
    let current = true
    lesson
      .load()
      .then((raw) => current && setManifest(parseTutorialManifest(raw)))
      .catch((cause: unknown) => current && setError(message(cause)))
    return () => {
      current = false
    }
  }, [lesson])

  const fixture = manifest ? ROAD_LESSON_FIXTURES[manifest.launch.fixture] : undefined
  const onFixture = !!fixture && fixture.matches(snapshot)
  useEffect(() => {
    if (!fixture || !onFixture || settingUp.current) return
    settingUp.current = true
    void (async () => {
      try {
        for (const action of fixture.setup) {
          await execute(action)
          await nextFrame()
        }
        setSetUp(true)
      } catch (cause) {
        setError(`The lesson's starting screen could not be set up: ${message(cause)}`)
      }
    })()
  }, [fixture, onFixture, execute])

  const card = (title: string, body: string, actionsRow: ReactNode, role: 'alert' | 'alertdialog') => (
    <div role={role} aria-labelledby="road-lesson-card-title" className={CARD}>
      <p id="road-lesson-card-title" className="text-sm font-medium">
        {title}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{body}</p>
      <div className="mt-3 flex justify-end gap-2">{actionsRow}</div>
    </div>
  )
  const close = (label: string) => (
    <Button size="sm" variant="outline" onClick={onEnd}>
      {label}
    </Button>
  )

  if (error) return card('The lesson could not be opened.', error, close('Close'), 'alert')
  if (!manifest) return null
  if (!fixture)
    return card(
      'The lesson could not be opened.',
      `It starts from "${manifest.launch.fixture}", which the road designer does not have.`,
      close('Close'),
      'alert',
    )
  // A lesson's readings are its fixture's; on another project they would be wrong. Once its setup
  // has run the lesson keeps going whatever it opens: importing or reopening a file leaves the
  // training session, and that is part of the lesson.
  if (!onFixture && !setUp)
    return card(
      manifest.title,
      `This lesson uses ${fixture.label}. Opening it leaves your own project saved in this browser.`,
      <>
        {close('Not now')}
        <Button
          size="sm"
          onClick={() =>
            window.location.assign(
              `${window.location.pathname}${fixtureLaunchSearch(window.location.search, fixture, launch)}${window.location.hash}`,
            )
          }
        >
          Open {fixture.label}
        </Button>
      </>,
      'alertdialog',
    )
  if (!setUp) return null
  const guide = withBase(`/help/${lesson.id}`)
  return (
    <TourPlayerHost
      namespace={ROAD_TOUR_NAMESPACE}
      manifest={manifest}
      mode={launch.mode}
      state={snapshot}
      execute={execute}
      actions={actions}
      returnAction={(step) => roadTourReturnAction(step.anchor?.id)}
      contextActions={roadTourContextActions}
      stepExpectsDialog={roadTourStepExpectsDialog}
      completionActions={[
        {
          label: 'Read the illustrated guide',
          onSelect: () => {
            window.open(guide, '_blank', 'noopener')
            onEnd()
          },
        },
        { label: 'Keep working here', primary: true, onSelect: onEnd },
      ]}
      onEnd={onEnd}
    />
  )
}
