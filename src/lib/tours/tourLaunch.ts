/**
 * A lesson is launched by its address: `?tour=<lesson id>&tourMode=practice|watch`. The address
 * says "watch" where Tourkit says "autoplay", because the address and the help pages are read by
 * people.
 */
export type TourLaunchMode = 'practice' | 'watch'
export interface TourLaunch {
  id: string
  mode: TourLaunchMode
}

export const TOUR_PARAM = 'tour'
export const TOUR_MODE_PARAM = 'tourMode'

/** The lesson the address asks for, or null when it names none or one this page does not have. */
export function readTourLaunch(search: string, lessonIds: readonly string[]): TourLaunch | null {
  const params = new URLSearchParams(search)
  const id = params.get(TOUR_PARAM)
  if (!id || !lessonIds.includes(id)) return null
  return { id, mode: params.get(TOUR_MODE_PARAM) === 'watch' ? 'watch' : 'practice' }
}

/** The search string with the lesson set, or removed when `launch` is null; other parameters kept. */
export function tourLaunchSearch(search: string, launch: TourLaunch | null): string {
  const params = new URLSearchParams(search)
  params.delete(TOUR_PARAM)
  params.delete(TOUR_MODE_PARAM)
  if (launch) {
    params.set(TOUR_PARAM, launch.id)
    params.set(TOUR_MODE_PARAM, launch.mode)
  }
  const next = params.toString()
  return next ? `?${next}` : ''
}

export const tourkitMode = (mode: TourLaunchMode) => (mode === 'watch' ? 'autoplay' : 'practice')
