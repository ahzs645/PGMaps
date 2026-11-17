/**
 * What *Accept camera* would record, and whether the gate lets it, worked out before the click so the window can say
 * why the button is off. It chooses the method and evidence exactly as `useFieldPhoto`'s `acceptCamera` does: the
 * options row last used when the camera is still that row's, else any row that is this camera, else the heading's
 * source. The record itself is only ever written by `acceptCamera`.
 *
 * Free of DOM and network access.
 */
import type { PoseSource } from './exifPose'
import {
  acceptGate,
  sameCamera,
  type AcceptanceEvidence,
  type AcceptancePose,
  type AcceptGateResult,
  type PhotoCameraMethod,
} from './photoAcceptance'
import type { PhotoOption, PhotoOptionKind } from './photoOptions'
import { methodForOption, methodForSource } from './photoQueue'

export interface AcceptPreviewInput {
  pose: AcceptancePose | null
  chosen: { rowId: string; kind: PhotoOptionKind; pose: AcceptancePose; evidence: AcceptanceEvidence } | null
  headingSource: PoseSource
  rows: readonly PhotoOption[]
  checkedPose: AcceptancePose | null
  initials: string
  note: string
  photoWidth: number
}

export type AcceptPreview = {
  gate: AcceptGateResult
  method: PhotoCameraMethod
  evidence: AcceptanceEvidence
  /** The options row the camera is, when one is. */
  row: PhotoOption | null
}

/**
 * The options row the camera is, the method and the evidence an acceptance records: the row last used while the camera
 * is still its camera, else any row that is this camera, else the heading's source with no evidence. The last row's
 * evidence is never carried to a camera that has moved off it: it was measured for a different camera.
 */
export function acceptanceSource({
  pose,
  chosen,
  rows,
  headingSource,
}: Pick<AcceptPreviewInput, 'pose' | 'chosen' | 'rows' | 'headingSource'>): Omit<AcceptPreview, 'gate'> {
  const stillChosen = !!pose && !!chosen && sameCamera(chosen.pose, pose)
  const row =
    (stillChosen ? rows.find((option) => option.id === chosen!.rowId) : undefined) ??
    (pose ? rows.find((option) => sameCamera(option.pose, pose)) : undefined) ??
    null
  const method = row ? methodForOption(row.kind) : methodForSource(headingSource)
  const evidence = row?.evidence ?? (stillChosen ? chosen!.evidence : {})
  return { method, evidence, row }
}

export function acceptPreview(input: AcceptPreviewInput): AcceptPreview {
  const { pose } = input
  const { method, evidence, row } = acceptanceSource(input)
  if (!pose) return { gate: { ok: false, reason: 'Set where the photo was taken first.' }, method, evidence, row }
  const gate = acceptGate({
    pose,
    checkedPose: input.checkedPose,
    method,
    evidence,
    note: input.note,
    initials: input.initials,
    photoWidth: input.photoWidth,
  })
  return { gate, method, evidence, row }
}

/** How a method reads in the acceptance's summary. */
export const METHOD_TEXT: Record<PhotoCameraMethod, string> = {
  skyline: 'fitted to the skyline',
  points: 'solved from paired points',
  matched: 'from a matched camera',
  neighbour: 'from a neighbouring frame’s camera',
  phone: 'the phone’s own heading',
  typed: 'typed or set by hand',
}
