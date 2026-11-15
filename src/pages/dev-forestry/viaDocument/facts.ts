/**
 * The facts a VIA document is filled from, read off what the page already holds: each saved view's figure (its
 * class pass, callouts, sightline figure, distance, lens and inventory unit) and, for the view standing at the
 * assessment station only, the reviewer's step 4 record and the handbook figures `assessVia` worked from it. A
 * judgement made at one station is never copied to another. No DOM or network access.
 */
import { countClasses } from '@/lib/forestry/viaFigure/composeFigure'

import type { SavedFigure } from '../FigureSheetPanel'
import type { AlterationBreakdown } from '../types'
import type { DesignElementId, ViaAssessment, ViaReview, Visibleness } from '../via'
import { otherPlannedName, type DocumentFacts, type DocumentViewpoint, type ViewpointReview } from './resolve'
import type { ClassCode } from './scales'

const VISIBILITY_TERM: Record<Visibleness, string> = {
  'not-easily-distinguishable': 'Not easily distinguishable',
  difficult: 'Difficult to see',
  easy: 'Easy to see',
  'very-easy': 'Very easy to see',
}

const DESIGN_TERM = { '-1': 'Good', '0': 'Moderate', '1': 'Poor' } as const

/** A 35 mm-equivalent focal length for a horizontal field of view (36 mm frame). */
export const lensMmForHfov = (hfovDeg: number) => 18 / Math.tan((hfovDeg * Math.PI) / 360)

export interface FactsView {
  name: string
  figure: SavedFigure
  /** Where the eye stood, [lng, lat], when known. */
  lngLat?: [number, number] | null
}

function reviewAt(review: ViaReview | null, assessment: ViaAssessment | null): ViewpointReview {
  const out: ViewpointReview = {}
  const visibleness = review?.ocular?.visibleness
  if (visibleness) out.visibility = VISIBILITY_TERM[visibleness]
  const rating = (id: DesignElementId) => {
    const value = assessment?.design[id]?.rating ?? review?.design?.[id] ?? null
    return value === null || value === undefined ? undefined : DESIGN_TERM[String(value) as '-1' | '0' | '1']
  }
  const forceLines = rating('force-lines')
  if (forceLines) out.forceLines = forceLines
  const borrow = rating('natural-character')
  if (borrow) out.borrow = borrow
  const edges = rating('edge-treatment')
  if (edges) out.edges = edges
  const position = rating('position')
  if (position) out.position = position
  if (review?.ocular?.shape) out.design = review.ocular.shape === 'natural' ? 'Natural' : review.ocular.shape
  if (assessment?.rating) out.extent = assessment.rating.label
  if (review?.rationale?.trim()) out.rationale = review.rationale.trim()
  return out
}

/** The handbook's a, b, c, X, Y and adjusted figure for the assessment station, once the run gives X. */
function appendix1At(assessment: ViaAssessment | null, breakdown: AlterationBreakdown | null) {
  if (!assessment || assessment.initialPercent === null || !breakdown) return null
  // 3.4.4: a partial cut's clearcut equivalent is entered on line (a), beside the proposed openings.
  const b = breakdown.disturbancePercent
  const c = breakdown.existingPercent
  return {
    a: assessment.initialPercent - b - c,
    b,
    c,
    x: assessment.initialPercent,
    y: assessment.y,
    adjusted: assessment.adjusted?.percent ?? null,
    rating: assessment.rating?.label ?? null,
  }
}

/**
 * The place a saved view's own line names, without the frame around it: "View of the block from Ruby Lake 2A" is
 * Ruby Lake 2A, so a sentence never reads "from the View of the block from ... viewpoint".
 */
export const viewpointPlace = (line: string | null | undefined) =>
  (line ?? '').replace(/^\s*view(?:\s+of\s+.+?)?\s+from\s+/i, '').trim()

export function documentFacts(input: {
  project: string
  /** The landform's established objective, when the scene has one. */
  objective: ClassCode | null
  views: readonly FactsView[]
  /** The run's assessment station, whose view alone takes the reviewer's record. */
  assessmentStation: number | null
  review: ViaReview | null
  assessment: ViaAssessment | null
  breakdown: AlterationBreakdown | null
  /**
   * Blocks the scene marks as planned under another sale or permit, by id or name: counted in the figures, assessed
   * in their own VIA. A block whose name says so ("EGG5 (TA0333, other planned)") is read as one without this.
   */
  otherPlanned?: readonly string[]
  /** Whether the run counted standing timber as screening (`settings.screeningEnabled`). */
  screeningModelled?: boolean
}): DocumentFacts {
  const otherPlanned = new Set(input.otherPlanned ?? [])
  const placeOf = (view: FactsView) => view.figure.place || viewpointPlace(view.figure.viewpoint) || view.name
  const repeated = (view: FactsView) => input.views.filter((other) => placeOf(other) === placeOf(view)).length > 1
  const viewpoints = input.views.map((view, index): DocumentViewpoint => {
    const figure = view.figure
    const counts = countClasses(figure.classes)
    const atAssessment = input.assessmentStation !== null && figure.stationIndex === input.assessmentStation
    const objective = input.objective ?? ((figure.rating?.vqo as ClassCode | undefined) || null)
    return {
      // Several views on one road share its name: the sheet's "place, km along" line tells them apart.
      name: repeated(view)
        ? (figure.facts.find((fact) => fact.label === 'Viewpoint')?.value ?? `${placeOf(view)} (${index + 1})`)
        : placeOf(view),
      n: String(index + 1),
      landform: figure.area || 'the landform',
      objective,
      inventory: figure.rating ?? null,
      areas: {
        landform: counts.landform,
        proposed: counts.proposed,
        nonVeg: counts.nonVeg,
        privateLand: counts.privateLand,
        rock: counts.rock,
      },
      sightlinePercent: figure.sightlinePercent,
      distanceKm: figure.distanceKm,
      hfovDeg: figure.hfovDeg,
      // A panorama's lens is one frame's, never the whole span's (three 59 mm frames are not a 15 mm lens).
      lensMm: figure.camera?.focalMm ?? (figure.hfovDeg ? lensMmForHfov(figure.hfovDeg) : null),
      lngLat: view.lngLat ?? (figure.camera ? [figure.camera.lng, figure.camera.lat] : null),
      blocks: [...figure.callouts.filter((callout) => !callout.secondary), ...(figure.hidden ?? [])].map(
        (callout, _, list) => {
          // Each proposed block's part of the view's visible apparent size, when every block carries the run's figure.
          const proposed = list.filter(
            (entry) => !otherPlannedName(entry.title.replace(/^Block\s+/, '')) && !otherPlanned.has(entry.blockId),
          )
          const total = proposed.every((entry) => entry.apparent !== undefined)
            ? proposed.reduce((sum, entry) => sum + (entry.apparent ?? 0), 0)
            : 0
          // The name the sheet prints ("Block EGG1" is EGG1), never the scene's internal id.
          const name = callout.title.replace(/^Block\s+/, '') || callout.blockId
          const named = otherPlannedName(name)
          const other = !!named || otherPlanned.has(callout.blockId) || otherPlanned.has(name)
          return {
            id: named?.id ?? name,
            status: callout.status,
            visiblePercent: callout.visiblePercent,
            ...(other ? { proposed: false } : {}),
            ...(named?.plannedUnder ? { plannedUnder: named.plannedUnder } : {}),
            ...(!other && total > 0 && callout.apparent !== undefined ? { share: callout.apparent / total } : {}),
            ...(callout.screenedPercent !== undefined ? { screenedPercent: callout.screenedPercent } : {}),
          }
        },
      ),
      ...(atAssessment
        ? {
            review: reviewAt(input.review, input.assessment),
            appendix1: appendix1At(input.assessment, input.breakdown),
          }
        : {}),
    }
  })
  return {
    project: input.project,
    viewpoints,
    ...(input.screeningModelled !== undefined ? { screeningModelled: input.screeningModelled } : {}),
  }
}
