import { MAX_DITCH_DIP_DEPTH } from './engine'
import { sideValue } from './templates'
import type { ResolvedTemplate, RoadStation, RoadTemplate, SectionSample } from './types'

export interface SectionCodePoint extends SectionSample {
  code: string
  side: 'left' | 'right' | 'centre'
}
const finite = (value: number | null | undefined): value is number => value != null && Number.isFinite(value)
const EPS = 1e-7
const templateValue = (value: RoadTemplate | ResolvedTemplate): RoadTemplate =>
  'template' in value ? value.template : value

/** Interpolation never fills a missing ground/design value across a source gap. */
export function sectionSampleAt(station: RoadStation, offset: number): SectionSample {
  if (!Number.isFinite(offset)) return { offset, ground: null, design: null }
  const exact = station.section.find((point) => Math.abs(point.offset - offset) < EPS)
  if (exact)
    return {
      offset,
      ground: finite(exact.ground) ? exact.ground : null,
      design: finite(exact.design) ? exact.design : null,
      ...(exact.preparedGround !== undefined
        ? { preparedGround: finite(exact.preparedGround) ? exact.preparedGround : null }
        : {}),
    }
  for (let i = 1; i < station.section.length; i++) {
    const a = station.section[i - 1],
      b = station.section[i]
    if (offset < a.offset || offset > b.offset) continue
    const fraction = (offset - a.offset) / (b.offset - a.offset)
    return {
      offset,
      ground: finite(a.ground) && finite(b.ground) ? a.ground + (b.ground - a.ground) * fraction : null,
      design: finite(a.design) && finite(b.design) ? a.design + (b.design - a.design) * fraction : null,
      ...(a.preparedGround !== undefined || b.preparedGround !== undefined
        ? {
            preparedGround:
              finite(a.preparedGround) && finite(b.preparedGround)
                ? a.preparedGround + (b.preparedGround - a.preparedGround) * fraction
                : null,
          }
        : {}),
    }
  }
  return { offset, ground: null, design: null }
}

/** Named geometry from engine samples. A requested ditch is not a constructed ditch on a fill side. */
export function sectionCodePoints(
  station: RoadStation,
  resolvedTemplate: RoadTemplate | ResolvedTemplate,
): SectionCodePoint[] {
  const template = templateValue(resolvedTemplate)
  const points: SectionCodePoint[] = [{ code: 'centreline', side: 'centre', ...sectionSampleAt(station, 0) }]
  for (const p of station.componentPoints ?? [])
    if (!/formation-edge|ditch-bottom|daylight/.test(p.code))
      points.push({ code: p.code, side: p.offset < 0 ? 'left' : 'right', ...sectionSampleAt(station, p.offset) })
  for (const side of ['left', 'right'] as const) {
    const sign = side === 'left' ? -1 : 1
    const width = side === 'left' ? station.leftWidth : station.rightWidth
    const edge = sectionSampleAt(station, sign * width)
    points.push({ code: `${side}-formation-edge`, side, ...edge })
    const ditchWidth = sideValue(template, side, 'DitchWidth'),
      ditchDepth = sideValue(template, side, 'DitchDepth')
    const bottomOffset = sign * (width + ditchWidth / 2)
    const bottom = station.section.find((sample) => Math.abs(sample.offset - bottomOffset) < EPS)
    // Both the edge condition and an actual matching bottom sample are required.
    // The engine may still know design geometry where the sampled bottom ground is missing.
    // A culvert dip deepens the ditch from the template depth to at most MAX_DITCH_DIP_DEPTH.
    const depth = finite(edge.design) && bottom && finite(bottom.design) ? edge.design - bottom.design : NaN
    if (
      ditchWidth > 0 &&
      ditchDepth > 0 &&
      finite(edge.ground) &&
      finite(edge.design) &&
      (edge.preparedGround ?? edge.ground) > edge.design + EPS &&
      depth > ditchDepth - 1e-5 &&
      depth < Math.max(ditchDepth, MAX_DITCH_DIP_DEPTH) + 1e-5
    )
      points.push({ code: `${side}-ditch-bottom`, side, ...sectionSampleAt(station, bottomOffset) })
    const daylight = side === 'left' ? station.leftDaylightM : station.rightDaylightM
    if (finite(daylight))
      points.push({ code: `${side}-daylight`, side, ...sectionSampleAt(station, sign * Math.abs(daylight)) })
  }
  return points.sort((a, b) => a.offset - b.offset)
}

/** The same named points and intervals used by section views and exported section rows. */
export function classifySectionOffset(
  station: RoadStation,
  resolvedTemplate: RoadTemplate | ResolvedTemplate,
  offset: number,
): string {
  const points = sectionCodePoints(station, resolvedTemplate)
  const event = points.find((point) => Math.abs(point.offset - offset) < EPS)
  if (event) return event.code
  const sample = sectionSampleAt(station, offset)
  if (!finite(sample.design)) return finite(station.designElevation) ? 'outside-designed-section' : 'unknown-design'
  const side = offset < 0 ? 'left' : 'right'
  const width = side === 'left' ? station.leftWidth : station.rightWidth
  if (Math.abs(offset) < width) return `${side}-formation`
  const template = templateValue(resolvedTemplate)
  if (
    points.some((point) => point.code === `${side}-ditch-bottom`) &&
    Math.abs(offset) < width + sideValue(template, side, 'DitchWidth')
  )
    return `${side}-ditch`
  return `${side}-batter`
}
