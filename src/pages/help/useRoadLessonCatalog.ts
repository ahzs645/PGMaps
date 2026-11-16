import { useEffect, useState } from 'react'
import { parseTutorialManifest, type TutorialManifest } from 'tourkit/core'
import { tourStoresFor } from '@/components/tours/tourStores'
import { ROAD_LESSONS, type RoadLesson } from '@/pages/dev-forestry-roads/tours/roadLessons'
import { ROAD_TOUR_NAMESPACE } from '@/pages/dev-forestry-roads/tours/roadTour'

export interface CatalogLesson {
  lesson: RoadLesson
  manifest: TutorialManifest
  /** 1-based place in the help's order. */
  number: number
}

/** Every lesson's manifest, parsed by Tourkit, in the help's order; null while loading. */
export function useRoadLessonCatalog() {
  const [lessons, setLessons] = useState<CatalogLesson[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let current = true
    Promise.all(
      ROAD_LESSONS.map(async (lesson, index) => ({
        lesson,
        manifest: parseTutorialManifest(await lesson.load()),
        number: index + 1,
      })),
    )
      .then((loaded) => current && setLessons(loaded))
      .catch((cause: unknown) => current && setError(cause instanceof Error ? cause.message : String(cause)))
    return () => {
      current = false
    }
  }, [])
  return { lessons, error }
}

/** The lessons this browser has finished, kept current as a lesson in another tab finishes. */
export function useLessonCompletions() {
  const { completions } = tourStoresFor(ROAD_TOUR_NAMESPACE)
  const [finished, setFinished] = useState(() => completions.read())
  useEffect(() => {
    const update = () => setFinished(completions.read())
    const stop = completions.subscribe(update)
    window.addEventListener('storage', update)
    return () => {
      stop()
      window.removeEventListener('storage', update)
    }
  }, [completions])
  return finished
}
