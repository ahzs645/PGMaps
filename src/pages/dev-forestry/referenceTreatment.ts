import clipping from 'polygon-clipping'
import type { TargetPolygon } from './types'
import type { PolygonGeometry } from './visibility'
import { amount, type ReferenceValues } from './referenceMeasurements'
type Clip = Parameters<typeof clipping.intersection>[0]
const multi = (g: PolygonGeometry) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates) as Clip
/** Replace only the part of this proposal inside the mapped unit; overlapping ground is counted once. */
export function treatmentTargets(parent: TargetPolygon, unit: TargetPolygon, v: ReferenceValues): TargetPolygon[] {
  const harvestSystem = v.harvestSystem
  if (harvestSystem !== 'partial' && harvestSystem !== 'retention' && harvestSystem !== 'clearcut')
    throw Error('Choose the harvest system for this treatment unit.')
  const intersection = clipping.intersection(multi(parent.geometry), multi(unit.geometry))
  if (!intersection.length) throw Error('The treatment polygon does not intersect the selected proposal.')
  const remainder = clipping.difference(multi(parent.geometry), multi(unit.geometry))
  const percent = amount(v.volumeRemoved)
  if (v.volumeRemoved && (percent === null || percent > 100))
    throw Error('Volume removed must be a percentage from 0 to 100.')
  const height = amount(v.residualHeight)
  if (v.residualHeight && height === null) throw Error('Residual height must be a non-negative height in metres.')
  const treated: TargetPolygon = {
    ...parent,
    id: remainder.length ? unit.id : parent.id,
    name: unit.name,
    geometry: { type: 'MultiPolygon', coordinates: intersection },
    source: unit.source,
    harvestSystem,
    volumeRemovedPercent: harvestSystem === 'partial' ? percent : null,
    residualHeightMeters: harvestSystem === 'partial' ? height : null,
    retentionPercent: null,
    prescription: null,
  }
  return [
    ...(remainder.length ? [{ ...parent, geometry: { type: 'MultiPolygon' as const, coordinates: remainder } }] : []),
    treated,
  ]
}
