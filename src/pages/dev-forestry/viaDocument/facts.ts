/**
 * The facts a VIA document is filled from, read off what the page already holds: each saved view's figure (its
 * class pass, callouts, sightline figure, distance, lens and inventory unit), each view's Table 3 entry (significance,
 * why it was chosen, the viewing experience and duration) and, for the view standing at the assessment station only,
 * the reviewer's step 4 record and the handbook figures `assessVia` worked from it. A judgement made at one station is
 * never copied to another. The reviewer's key viewpoints are carried by view. No DOM or network access.
 */
import { countClasses, type FigureCounts } from '@/lib/forestry/viaFigure/composeFigure'
import { TIMBER_ABSENT, type TimberMeasure } from '@/lib/forestry/viaFigure/timberScreen'

import type { SavedFigure } from '../FigureSheetPanel'
import { terrainDetailNote } from '../figureFraming'
import type { AlterationBreakdown } from '../types'
import {
  assessAtCapture,
  hasStep4,
  reviewAtStation,
  type DesignElementId,
  type ViaAssessment,
  type ViaReview,
  type ViewpointRecord,
  type Visibleness,
} from '../via'
import type { VisualQualityClassId } from '../vqo'
import {
  otherPlannedName,
  type DocumentFacts,
  type DocumentViewpoint,
  type KeyViewpointPicks,
  type ViewpointReview,
} from './resolve'
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
  /**
   * PGMaps' with-timber measure (`timberMeasureFor`), or why it has none. Absent for PGMaps' own figure, the
   * viewpoint says no before-harvest render was taken; an engine's figure takes its screened pass instead.
   */
  timber?: TimberMeasure | null
}

/** A class pass's areas; a partial cut's are stated apart from the proposed (cleared-ground) ones, never in them. */
const areasOf = (counts: FigureCounts) => ({
  landform: counts.landform,
  proposed: counts.proposed,
  nonVeg: counts.nonVeg,
  privateLand: counts.privateLand,
  rock: counts.rock,
  ...(counts.partialCut ? { partialCut: counts.partialCut } : {}),
})

/** A bearing in [0, 360): a framed panorama's centre line is its first frame's bearing plus half the span. */
const wrapBearing = (degrees: number) => ((degrees % 360) + 360) % 360

/**
 * The view's pixel areas with the drawn timber in front: an engine's screened pass, else PGMaps' before/after
 * measure; when PGMaps' was not measured, why. Never zero for a measure that was not made.
 */
function withTimberOf(view: FactsView): DocumentViewpoint['withTimber'] {
  if (view.figure.screened) return { areas: areasOf(countClasses(view.figure.screened)), source: 'engine' }
  if (view.timber?.kind === 'measured') return { areas: areasOf(countClasses(view.timber.classes)), source: 'pgmaps' }
  return { absent: view.timber?.kind === 'absent' ? view.timber.reason : TIMBER_ABSENT.noBefore }
}

function reviewAt(
  review: ViaReview | null,
  assessment: Pick<ViaAssessment, 'design' | 'rating'> | null,
): ViewpointReview {
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

/** A view's Table 3 entry as the documents read it: facts the reviewer gives for every viewpoint, not only one. */
function tableThree(record: ViewpointRecord | undefined): ViewpointReview {
  const out: ViewpointReview = {}
  if (record?.significance) out.importance = record.significance
  if (record?.reason?.trim()) out.selectionReason = record.reason.trim()
  if (record?.experience?.trim()) out.viewingExperience = record.experience.trim()
  if (record?.duration?.trim()) out.duration = record.duration.trim()
  if (record?.type) out.viewpointType = record.type
  return out
}

/**
 * Whether a viewpoint stands at the assessment station, the one view the step 4 judgements belong to. Facts from
 * `documentFacts` say so; hand-built facts without the flag are read the old way, by which view carries a review.
 */
export const atAssessmentStation = (vp: DocumentViewpoint) => vp.judged ?? vp.atAssessment ?? !!vp.review

/**
 * The step 4 terms by eye a part prints for a viewpoint: the view's own (its group's), else, for hand-built facts,
 * the review's and the assessment's at the station. Null where step 4 does not apply.
 */
export function judgedOcular(
  vp: DocumentViewpoint,
  fallback: { review?: ViaReview | null; assessment?: ViaAssessment | null },
): NonNullable<DocumentViewpoint['ocular']> | null {
  if (vp.ocular) return vp.ocular
  if (!atAssessmentStation(vp)) return null
  return { ...fallback.review?.ocular, classId: fallback.assessment?.ocular?.classId ?? null }
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
 * How far a point at column `x` of a framed picture lies off the view's centre line, degrees (negative to the left):
 * the picture is `frames` rectilinear frames side by side, each an equal share of the horizontal field.
 */
export function offAxisDegrees(x: number, width: number, hfovDeg: number, frames = 1): number | null {
  if (!(width > 0) || !(hfovDeg > 0) || !Number.isFinite(x)) return null
  const count = Math.max(1, Math.round(frames))
  const frameWidth = width / count
  const frameField = hfovDeg / count
  const i = Math.min(count - 1, Math.max(0, Math.floor(x / frameWidth)))
  const centre = -hfovDeg / 2 + (i + 0.5) * frameField
  const local = (x - (i + 0.5) * frameWidth) / (frameWidth / 2)
  return centre + (Math.atan(local * Math.tan((frameField * Math.PI) / 360)) * 180) / Math.PI
}

/** A seen block's `offAxisDeg`, from where its callout's anchor falls in the figure's own frame. */
function offAxisOf(x: number, figure: SavedFigure): { offAxisDeg?: number } {
  const deg = offAxisDegrees(x, figure.classes.width, figure.hfovDeg, figure.camera?.frames ?? 1)
  return deg === null ? {} : { offAxisDeg: Math.round(deg * 10) / 10 }
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
  /** What the run's existing openings' green-up rests on (`runGreenUpBasis(result).label`), when there is a run. */
  greenUp?: string | null
  /**
   * The group of views of interest a saved view's step 4 is kept under (`groupIdForName`, by the view's name), so
   * each group's judgements reach its own views; absent, or null for a view, reads the review's top-level step 4.
   */
  groupOf?: (viewName: string) => string | null
  /** The landform's objective id, for rating a group on its own captured figure (`assessAtCapture`). */
  objectiveId?: VisualQualityClassId | null
}): DocumentFacts {
  const otherPlanned = new Set(input.otherPlanned ?? [])
  const placeOf = (view: FactsView) => view.figure.place || viewpointPlace(view.figure.viewpoint) || view.name
  const repeated = (view: FactsView) => input.views.filter((other) => placeOf(other) === placeOf(view)).length > 1
  const viewpoints = input.views.map((view, index): DocumentViewpoint => {
    const figure = view.figure
    const counts = countClasses(figure.classes)
    // Partial cuts take no share of the proposed (cleared-ground) figure: their pixels are counted apart.
    const partialCuts = new Set((figure.partialCuts ?? []).map((cut) => cut.id))
    const atAssessment = input.assessmentStation !== null && figure.stationIndex === input.assessmentStation
    const objective = input.objective ?? ((figure.rating?.vqo as ClassCode | undefined) || null)
    // Why the picture's pixel figure and the run's sightline figure can part (the map drew the blocks coarser).
    const terrainNote = terrainDetailNote(figure.terrainDetail ?? null)
    // Table 3 is given per view. Step 4 is its group's: at the run's station with the run's assessment, elsewhere
    // rated on the view's own captured figure; a view in no group reads the review's own at the station only.
    const groupId = input.groupOf?.(view.name) ?? null
    const stepReview = groupId ? reviewAtStation(input.review, groupId) : input.review
    const groupRecord = groupId ? input.review?.stations?.[groupId] : undefined
    const objectiveId = input.objectiveId ?? input.assessment?.objective.id ?? null
    const elsewhere =
      !atAssessment && groupId && hasStep4(groupRecord) && objectiveId
        ? assessAtCapture({
            objectiveId,
            review: groupRecord,
            xPercent: figure.sightlinePercent,
            distanceMeters: figure.distanceKm === null ? null : figure.distanceKm * 1000,
            seesPartialCut: (figure.partialCuts ?? []).length > 0,
          })
        : null
    const judged = atAssessment || !!elsewhere
    const review: ViewpointReview = {
      ...tableThree(input.review?.viewpointRecords?.[view.name]),
      ...(atAssessment
        ? reviewAt(stepReview ?? null, input.assessment)
        : elsewhere
          ? reviewAt(stepReview ?? null, elsewhere)
          : {}),
    }
    const ocularClassId = atAssessment ? input.assessment?.ocular?.classId : elsewhere?.ocular?.classId
    const ocular = judged
      ? {
          visibleness: stepReview?.ocular?.visibleness ?? null,
          scale: stepReview?.ocular?.scale ?? null,
          shape: stepReview?.ocular?.shape ?? null,
          classId: ocularClassId ?? null,
        }
      : null
    // A block id as `blocks` names it: the name the sheet prints, an other planned block's without its note.
    const blockName = (id: string) => {
      const title =
        [...figure.callouts, ...(figure.hidden ?? [])]
          .find((callout) => callout.blockId === id)
          ?.title.replace(/^Block\s+/, '') || id
      return otherPlannedName(title)?.id ?? title
    }
    return {
      // Several views on one road share its name: the sheet's "place, km along" line tells them apart.
      name: repeated(view)
        ? (figure.facts.find((fact) => fact.label === 'Viewpoint')?.value ?? `${placeOf(view)} (${index + 1})`)
        : placeOf(view),
      n: String(index + 1),
      landform: figure.area || 'the landform',
      objective,
      inventory: figure.rating ?? null,
      areas: areasOf(counts),
      // The scene's other landforms the view sees, each from its own class pass; blocks by the names the sheet prints.
      ...(figure.landforms?.length
        ? {
            // In name order ("Landform 1" before "Landform 1b"), whatever order the scene holds them in.
            otherLandforms: [...figure.landforms]
              .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
              .map((entry) => ({
                landform: entry.name,
                objective: (entry.objective as ClassCode | null) ?? null,
                areas: areasOf(entry.counts),
                blocks: entry.blocks.map(blockName),
              })),
          }
        : {}),
      // The blocks with ground in the view's own landform; absent on views saved before it was recorded.
      ...(figure.landformBlocks ? { landformBlocks: figure.landformBlocks.map(blockName) } : {}),
      withTimber: withTimberOf(view),
      sightlinePercent: figure.sightlinePercent,
      ...(terrainNote ? { terrainNote } : {}),
      // The scene's green-up readings decide which openings the class pass paints, so every view names the same basis.
      ...(input.greenUp ? { greenUp: input.greenUp } : {}),
      distanceKm: figure.distanceKm,
      hfovDeg: figure.hfovDeg,
      // A panorama's lens is one frame's, never the whole span's (three 59 mm frames are not a 15 mm lens).
      lensMm: figure.camera?.focalMm ?? (figure.hfovDeg ? lensMmForHfov(figure.hfovDeg) : null),
      lngLat: view.lngLat ?? (figure.camera ? [figure.camera.lng, figure.camera.lat] : null),
      // The eye's elevation is known only when the view was framed at the drive's pose (an unframed view's camera
      // prints 0); the view's centre line is the camera's azimuth either way.
      elevationM: figure.camera && figure.frameImage ? figure.camera.elevationM : null,
      bearingDeg: figure.camera ? wrapBearing(figure.camera.azimuthDeg) : null,
      blocks: [...figure.callouts.filter((callout) => !callout.secondary), ...(figure.hidden ?? [])].map(
        (callout, _, list) => {
          // Each proposed block's part of the view's visible apparent size, when every block carries the run's figure.
          const proposed = list.filter(
            (entry) =>
              !otherPlannedName(entry.title.replace(/^Block\s+/, '')) &&
              !otherPlanned.has(entry.blockId) &&
              !partialCuts.has(entry.blockId),
          )
          const total = proposed.every((entry) => entry.apparent !== undefined)
            ? proposed.reduce((sum, entry) => sum + (entry.apparent ?? 0), 0)
            : 0
          // The name the sheet prints ("Block EGG1" is EGG1), never the scene's internal id.
          const name = callout.title.replace(/^Block\s+/, '') || callout.blockId
          const named = otherPlannedName(name)
          const other = !!named || otherPlanned.has(callout.blockId) || otherPlanned.has(name)
          const partial = partialCuts.has(callout.blockId)
          return {
            id: named?.id ?? name,
            status: callout.status,
            visiblePercent: callout.visiblePercent,
            ...(other ? { proposed: false } : {}),
            ...(named?.plannedUnder ? { plannedUnder: named.plannedUnder } : {}),
            ...(partial ? { partialCut: true as const } : {}),
            ...(!other && !partial && total > 0 && callout.apparent !== undefined
              ? { share: callout.apparent / total }
              : {}),
            ...(callout.screenedPercent !== undefined ? { screenedPercent: callout.screenedPercent } : {}),
            ...(callout.distanceKm !== undefined ? { distanceKm: callout.distanceKm } : {}),
            ...(callout.status === 'visible' || callout.status === 'possible glimpses'
              ? offAxisOf(callout.anchor[0], figure)
              : {}),
          }
        },
      ),
      ...(judged || Object.keys(review).length ? { review } : {}),
      atAssessment,
      ...(groupId || elsewhere ? { judged } : {}),
      ...(ocular ? { ocular } : {}),
      ...(atAssessment ? { appendix1: appendix1At(input.assessment, input.breakdown) } : {}),
    }
  })
  const keyViewpoints = keyViewpointPicks(input.review, input.views, viewpoints)
  return {
    project: input.project,
    viewpoints,
    ...(input.screeningModelled !== undefined ? { screeningModelled: input.screeningModelled } : {}),
    ...(keyViewpoints ? { keyViewpoints } : {}),
  }
}

/**
 * The reviewer's key viewpoints, from saved-view names to the names these facts give the views. A choice naming a
 * view the document does not hold is dropped: the run chooses there.
 */
function keyViewpointPicks(
  review: ViaReview | null,
  views: readonly FactsView[],
  viewpoints: readonly DocumentViewpoint[],
): KeyViewpointPicks | null {
  const record = review?.keyViewpoints
  if (!record) return null
  const nameOf = (view: string) => {
    const index = views.findIndex((entry) => entry.name === view)
    return index < 0 ? null : viewpoints[index].name
  }
  const pick = (entry: { view: string; reason?: string } | null | undefined) => {
    const viewpoint = entry ? nameOf(entry.view) : null
    return viewpoint ? { viewpoint, ...(entry?.reason?.trim() ? { reason: entry.reason.trim() } : {}) } : null
  }
  const blocks = Object.fromEntries(
    Object.entries(record.blocks ?? {}).flatMap(([block, entry]) => {
      const chosen = pick(entry)
      return chosen ? [[block, chosen]] : []
    }),
  )
  const group = pick(record.group)
  if (!Object.keys(blocks).length && !group) return null
  return { ...(Object.keys(blocks).length ? { blocks } : {}), ...(group ? { group } : {}) }
}
