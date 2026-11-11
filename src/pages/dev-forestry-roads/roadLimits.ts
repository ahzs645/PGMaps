/**
 * How many roads a project holds, and the limit on them, defined once. No DOM access.
 *
 * The hidden placeholder of a design with no road yet (`designPlaceholderId`) is never counted, so
 * every button and every tool agrees on when the project is full.
 */
import type { RoadProject } from './types'

/** At most this many roads per project, mapped roads included. */
export const MAX_PROJECT_ROADS = 20

/** Roads the user has, not counting the hidden placeholder of a design with none yet. */
export const roadCount = (p: Pick<RoadProject, 'alignments' | 'designPlaceholderId'>) =>
  p.alignments.filter((a) => a.id !== p.designPlaceholderId).length

export const roadLimitReached = (p: Pick<RoadProject, 'alignments' | 'designPlaceholderId'>) =>
  roadCount(p) >= MAX_PROJECT_ROADS

export const ROAD_LIMIT_MESSAGE = `The project already has ${MAX_PROJECT_ROADS} road alternatives.`
