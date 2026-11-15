/**
 * The landform's visual quality objective as a Castor cover constraint, for
 * `/dev/forestry/castor` and forestryCastor's `zoneConstraints`.
 *
 * Timber supply models carry a VQO as "no more than P% of the zone below H m", where H is the
 * visually effective green-up height and P the planimetric allowance. Castor's `le` constraint
 * on `height` is exactly that: cells at or below the threshold may not exceed the percentage of
 * the zone. Here H is the run's own area-weighted Table 6 height for the landform (the figure
 * green-up is tested on) and P the objective's planimetric figure as the Results panel resolves
 * it (`resolveThreshold`: the reviewer's override, else Table 4 by VAC, else the medium VAC
 * midpoint, each named). Nothing is re-derived.
 *
 * Castor divides by the zone's whole area, while the page's planimetric figure divides by the
 * landform's treed area; the file says so rather than converting the percentage. No DOM or
 * network access.
 */
import { resolveThreshold } from './integrity'
import type { ForestryScene } from './scene'
import { findSceneLandform } from './sceneInput'
import type { AnalysisResult } from './types'
import type { PolygonGeometry } from './visibility'
import { visualQualityClass } from './vqo'

/** The inventory column the zone goes in: Castor reads `zone:<name>` columns as zones. */
export const CASTOR_VQO_ZONE = 'vqo'

export type CastorVqoConstraint = {
  id: string
  zone: string
  zoneId: string
  type: 'le'
  variable: 'height'
  /** Green-up height, metres: the run's area-weighted Table 6 height for the landform. */
  threshold: number
  /** Planimetric allowance, percent of the zone. */
  percentage: number
  percentageNote: string
  landformName: string
  objective: string
  vac: string | null
  geometry: PolygonGeometry
}

const slug = (text: string) =>
  text
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60) || 'landform'

/** Why no constraint can be written yet, or null when it can. */
export function castorConstraintProblem(scene: ForestryScene, result: AnalysisResult | null): string | null {
  const landform = findSceneLandform(scene)
  if (!landform) return 'Delineate or adopt one active landform first: it is the constraint’s zone.'
  if (!result) return 'Run the visibility assessment first: the green-up height comes from the run.'
  if (result.activeLandformId !== landform.id) return 'The run measured another landform. Run it again.'
  const height = result.targets.find((t) => t.targetId === landform.id)?.vegHeightMeters
  if (height == null || !Number.isFinite(height))
    return 'The run has no green-up height for the landform (its slopes could not be read).'
  return null
}

export function castorVqoConstraint(scene: ForestryScene, result: AnalysisResult | null): CastorVqoConstraint | null {
  if (castorConstraintProblem(scene, result)) return null
  const landform = findSceneLandform(scene)!
  const height = result!.targets.find((t) => t.targetId === landform.id)!.vegHeightMeters!
  const allowance = resolveThreshold(landform.objectiveId, 'planimetric', scene.thresholds, landform.vac)
  const zoneId = slug(landform.inventoryUnitId ?? landform.name)
  return {
    id: `vqo-${zoneId}`,
    zone: CASTOR_VQO_ZONE,
    zoneId,
    type: 'le',
    variable: 'height',
    threshold: Math.round(height * 100) / 100,
    percentage: allowance.value,
    percentageNote: allowance.note,
    landformName: landform.name,
    objective: visualQualityClass(landform.objectiveId).label,
    vac: landform.vac ?? null,
    geometry: landform.geometry,
  }
}

export const CASTOR_DENOMINATOR_NOTE =
  "Castor divides by the zone's whole area; this page's planimetric figure divides by the landform's treed area (1998 procedure). The percentage is the page's allowance, unconverted: add a denominator condition in Castor, or confirm the zone's land base, before relying on the comparison."

const csvCell = (value: string | number) => {
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** `constraints.csv` as Castor imports it: `id,zone,zoneId,type,variable,threshold,percentage`. */
export function castorConstraintCsv(c: CastorVqoConstraint): string {
  const header = ['id', 'zone', 'zoneId', 'type', 'variable', 'threshold', 'percentage']
  const row = [c.id, c.zone, c.zoneId, c.type, c.variable, c.threshold, c.percentage]
  return `${header.join(',')}\n${row.map(csvCell).join(',')}\n`
}

/**
 * The landform as the constraint's zone: one WGS84 feature whose `zone:vqo` property is the zone
 * ID, to intersect with a Castor inventory, plus the constraint and where each figure came from.
 */
export function castorZoneGeoJson(c: CastorVqoConstraint, generatedAt: Date): string {
  return JSON.stringify(
    {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: c.geometry,
          properties: {
            [`zone:${c.zone}`]: c.zoneId,
            landform: c.landformName,
            objective: c.objective,
            vac: c.vac,
            constraint: {
              id: c.id,
              zone: c.zone,
              zoneId: c.zoneId,
              type: c.type,
              variable: c.variable,
              threshold: c.threshold,
              percentage: c.percentage,
            },
            thresholdSource: "Area-weighted Table 6 green-up height of the landform's slopes, from this run",
            percentageSource: c.percentageNote,
            denominator: CASTOR_DENOMINATOR_NOTE,
            generatedAt: generatedAt.toISOString(),
          },
        },
      ],
    },
    null,
    2,
  )
}
