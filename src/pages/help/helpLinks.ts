import { tourLaunchSearch, type TourLaunchMode } from '@/lib/tours/tourLaunch'

/**
 * Addresses for the help (`/help`, `/help/<lesson>`): the designer address that runs a lesson, and
 * where each address of the old static help now goes. Keep this file free of DOM access.
 */
export const ROAD_DESIGNER_PATH = '/dev/forestry/road-design'

/** The interface the help's links open the designer in: the address's, else none (the designer's own choice). */
export function helpInterface(search: string, known: readonly string[]): string | null {
  const params = new URLSearchParams(search)
  for (const key of ['interface', 'ribbonInterface']) {
    const id = params.get(key)
    if (id && known.includes(id)) return id
  }
  return null
}

/**
 * The designer address that runs `lesson` in `mode`, on its fixture's parameters (`example=training`
 * for the training project) and in `interfaceId` when one is chosen.
 */
export function lessonLaunchHref(
  lesson: string,
  mode: TourLaunchMode,
  fixtureParams: Readonly<Record<string, string>>,
  interfaceId: string | null,
) {
  const params = new URLSearchParams(fixtureParams)
  if (interfaceId) params.set('interface', interfaceId)
  return `${ROAD_DESIGNER_PATH}${tourLaunchSearch(`?${params}`, { id: lesson, mode })}`
}

/** A help address keeping only the interface choice. */
export function helpHref(path: string, interfaceId: string | null) {
  return interfaceId ? `${path}?${new URLSearchParams({ interface: interfaceId })}` : path
}

/**
 * Where an address of the old static help goes now, or null when `rest` (the part after `/help/`)
 * is not one. The old help had `index.html` (with `layout=ribbon` for the Ribbon catalog), a guide
 * at `<lesson>/index.html`, a recorded player at `<lesson>/tour.html`, and `ribbon.html?lesson=…`.
 * Every one now opens the hub or the lesson's page, keeping the interface it named.
 */
export function legacyHelpTarget(rest: string, search: string, lessonIds: readonly string[]): string | null {
  const params = new URLSearchParams(search)
  const interfaceId = params.get('interface') ?? params.get('ribbonInterface')
  const parts = rest.replace(/\/+$/, '').split('/').filter(Boolean)
  const known = (id: string | undefined) => (id && lessonIds.includes(id) ? id : null)
  if (parts.length === 1 && parts[0] === 'index.html') return helpHref('/help', interfaceId)
  if (parts.length === 1 && parts[0] === 'ribbon.html') {
    const lesson = known(params.get('lesson') ?? undefined)
    return helpHref(lesson ? `/help/${lesson}` : '/help', interfaceId)
  }
  if (parts.length === 2 && ['index.html', 'tour.html'].includes(parts[1])) {
    const lesson = known(parts[0])
    return helpHref(lesson ? `/help/${lesson}` : '/help', interfaceId)
  }
  return null
}
