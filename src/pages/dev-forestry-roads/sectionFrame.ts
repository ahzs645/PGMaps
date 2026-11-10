/**
 * The cross-section chart's frame while stepping, and the faint outline of a pinned section. With
 * **Hold scale** on, the offset and elevation spans stay those of the section shown when it was
 * turned on, and the frame follows the formation, so the ground is seen to move under a still road
 * rather than the axes rescaling at every station. No DOM.
 */
import type { RoadStation } from './types'

/** [offset min, offset max, elevation min, elevation max]: the chart's own domain order. */
export type SectionDomain = [number, number, number, number]

export interface HeldSectionFrame {
  halfWidthM: number
  spanM: number
  /** Where the frame's vertical centre sat above the reference level when the scale was held. */
  centreAboveReferenceM: number
}

const finite = (value: number | null | undefined): value is number => value != null && Number.isFinite(value)

/**
 * The level a section is framed and aligned on: the formation at the centreline, or, on a terrain
 * transect or a section with no formation there, the ground at the centreline.
 */
export function sectionReferenceLevel(
  station: Pick<RoadStation, 'designElevation' | 'groundElevation'> | undefined,
): number | null {
  if (!station) return null
  if (finite(station.designElevation)) return station.designElevation
  return finite(station.groundElevation) ? station.groundElevation : null
}

/** The frame to hold, taken from the domain shown at `station`; null when the section has no level. */
export function holdSectionFrame(
  domain: SectionDomain,
  station: Pick<RoadStation, 'designElevation' | 'groundElevation'> | undefined,
): HeldSectionFrame | null {
  const reference = sectionReferenceLevel(station)
  if (reference === null || !domain.every(finite)) return null
  return {
    halfWidthM: Math.max(Math.abs(domain[0]), Math.abs(domain[1])),
    spanM: domain[3] - domain[2],
    centreAboveReferenceM: (domain[2] + domain[3]) / 2 - reference,
  }
}

/** The held frame placed at `station`, or null when this section has no level to follow. */
export function heldSectionDomain(
  held: HeldSectionFrame,
  station: Pick<RoadStation, 'designElevation' | 'groundElevation'> | undefined,
): SectionDomain | null {
  const reference = sectionReferenceLevel(station)
  if (reference === null) return null
  const centre = reference + held.centreAboveReferenceM
  return [-held.halfWidthM, held.halfWidthM, centre - held.spanM / 2, centre + held.spanM / 2]
}

/** True when any drawn point of the section lies outside the frame, so a held scale is cutting it off. */
export function sectionExceedsFrame(
  points: readonly { x: number; ground: number | null; design: number | null }[],
  domain: SectionDomain,
): boolean {
  const outside = (x: number, z: number | null) =>
    finite(z) && (x < domain[0] || x > domain[1] || z < domain[2] || z > domain[3])
  return points.some((p) => outside(p.x, p.ground) || outside(p.x, p.design))
}

export interface PinnedOutline {
  chainage: number
  points: { x: number; ground: number | null; design: number | null }[]
  /** Metres added to every pinned elevation so the two sections share a reference level. */
  shiftM: number
  /** 'none' when either section lacks a level: the outline is drawn where it was. */
  alignedOn: 'formation' | 'ground' | 'none'
}

/**
 * A pinned section to draw behind `current`, moved vertically so both sit on one level: the
 * formation at the centreline when both have one, otherwise the ground there. Two stations of a
 * climbing road are metres apart in elevation, so drawn where they are the pinned one would usually
 * fall out of the frame; aligned, the shapes compare directly. The offsets are not moved.
 */
export function pinnedSectionOutline(
  pinned: Pick<RoadStation, 'chainage' | 'section' | 'designElevation' | 'groundElevation'>,
  current: Pick<RoadStation, 'designElevation' | 'groundElevation'> | undefined,
  terrainOnly = false,
): PinnedOutline {
  const alignedOn =
    !terrainOnly && finite(pinned.designElevation) && finite(current?.designElevation)
      ? 'formation'
      : finite(pinned.groundElevation) && finite(current?.groundElevation)
        ? 'ground'
        : 'none'
  const shiftM =
    alignedOn === 'formation'
      ? current!.designElevation! - pinned.designElevation!
      : alignedOn === 'ground'
        ? current!.groundElevation! - pinned.groundElevation!
        : 0
  return {
    chainage: pinned.chainage,
    shiftM,
    alignedOn,
    points: pinned.section.map((p) => ({
      x: p.offset,
      ground: finite(p.ground) ? p.ground + shiftM : null,
      design: !terrainOnly && finite(p.design) ? p.design + shiftM : null,
    })),
  }
}
