import type { ReactNode } from 'react'

import { LegendItem, MapGradientLegendItem, MapLegendPanel, MapLegendSection } from '@/components/ui/map-panels'

import { MASK_LABELS } from './assessmentMasks'
import {
  ASSESSMENT_VIEWPOINT_COLOR,
  EXPOSURE_STOPS,
  INVENTORY_COLORS,
  LANDFORM_CLUE_COLORS,
  MASK_COLORS,
  OTHER_RIDGE_LAYER_COLOR,
  ROAD_COLOR,
  SCREENED_COLOR,
  SENSITIVITY_UNIT_COLORS,
  TERRAIN_CANDIDATE_COLOR,
  UNKNOWN_COLOR,
  VISIBLE_COLOR,
} from './planMapStyle'
import { ROLE_COLORS } from './scene'
import type { AssessmentMaskKind } from './types'

/** An outlined area swatch: a light fill inside the layer's line colour. */
function AreaSwatch({ color, line = color, dashed = false }: { color: string; line?: string; dashed?: boolean }) {
  return (
    <span
      className={dashed ? 'h-3 w-4 rounded-sm border border-dashed' : 'h-3 w-4 rounded-sm border'}
      style={{ borderColor: line, backgroundColor: `${color}2e` }}
    />
  )
}

/** A filled arrowhead, as the inventory draws its viewing directions. */
function ArrowSwatch() {
  return (
    <svg viewBox="0 0 20 12" className="h-3 w-5" aria-hidden="true">
      <path
        d="M1 6h12M13 2l6 4-6 4z"
        stroke={INVENTORY_COLORS.arrowOutline}
        strokeWidth="1.5"
        fill={INVENTORY_COLORS.viewpoint}
        fillOpacity="0.45"
      />
    </svg>
  )
}

function Row({ color, label, swatch, shape }: { color: string; label: ReactNode; swatch?: ReactNode; shape?: 'line' }) {
  return (
    <LegendItem
      color={color}
      label={label}
      swatch={swatch}
      swatchShape={shape}
      className="[&>div>span:last-child]:whitespace-normal"
    />
  )
}

export type PlanMapLegendProps = {
  /** Blocks drawn; `customColors` when any carries its own colour. */
  blocks: { count: number; customColors: boolean }
  landform: boolean
  existingOpenings: boolean
  road: 'corridor' | 'spot' | null
  /** A visibility run is drawn: sample points, the graded road and the assessment viewpoint. */
  run: boolean
  /** "Which roads see the block" drew graded roads. */
  reverseRoads: boolean
  sensitivityUnits: boolean
  terrainCandidate: boolean
  otherRidgeLayers: boolean
  landformClues: boolean
  inventory: { viewpoints: boolean; arrows: boolean; recSites: boolean; screenings: boolean } | null
  masks: ReadonlyArray<AssessmentMaskKind>
}

/**
 * The plan map's legend: one row for each layer on the map now, grouped by
 * where it came from. It reads the same colours as the layers (`planMapStyle.ts`).
 */
export function PlanMapLegend(props: PlanMapLegendProps) {
  const { blocks, landform, existingOpenings, road, run, reverseRoads, inventory, masks } = props
  const graded = run || reverseRoads
  const terrain = props.terrainCandidate || props.otherRidgeLayers || props.landformClues
  const bc =
    props.sensitivityUnits ||
    (inventory && (inventory.viewpoints || inventory.arrows || inventory.recSites || inventory.screenings))
  if (!blocks.count && !landform && !road && !graded && !terrain && !bc && !masks.length) return null
  return (
    <MapLegendPanel
      title="Legend"
      collapsible
      defaultCollapsed="mobile"
      width="sm"
      data-testid="visual-quality-legend"
      contentClassName="max-h-72 overflow-y-auto overscroll-contain"
    >
      <div className="space-y-3">
        {(blocks.count > 0 || landform || existingOpenings || masks.length > 0) && (
          <MapLegendSection title="Proposal" data-legend-section="proposal">
            {blocks.count > 0 && (
              <Row
                color={ROLE_COLORS.block}
                swatch={<AreaSwatch color={ROLE_COLORS.block} />}
                label={blocks.customColors ? 'Cutblock (or its chosen colour)' : 'Cutblock'}
              />
            )}
            {landform && (
              <Row
                color={ROLE_COLORS.landscape}
                swatch={<AreaSwatch color={ROLE_COLORS.landscape} />}
                label="Landform"
              />
            )}
            {existingOpenings && (
              <Row
                color={ROLE_COLORS.harvested}
                swatch={<AreaSwatch color={ROLE_COLORS.harvested} />}
                label="Existing opening"
              />
            )}
            {masks.map((kind) => (
              <Row
                key={kind}
                color={MASK_COLORS[kind]}
                swatch={<AreaSwatch color={MASK_COLORS[kind]} line="#475569" />}
                label={MASK_LABELS[kind]}
              />
            ))}
          </MapLegendSection>
        )}

        {(road || graded) && (
          <MapLegendSection title={run ? 'Seen from the road' : 'Road'} data-legend-section="road">
            {road && !run && (
              <Row
                color={ROAD_COLOR}
                shape={road === 'corridor' ? 'line' : undefined}
                label={road === 'corridor' ? 'Road to assess' : 'Viewpoint'}
              />
            )}
            {run && (
              <>
                <Row color={VISIBLE_COLOR} label="Visible ground" />
                <Row color={SCREENED_COLOR} label="Hidden, or past the analysis range" />
                <Row color={UNKNOWN_COLOR} label="Unknown (missing data)" />
                <Row color={ASSESSMENT_VIEWPOINT_COLOR} label="Assessment viewpoint" />
              </>
            )}
            {graded && (
              <MapGradientLegendItem
                aria-label="Share of the block in view from each stretch of road"
                colors={EXPOSURE_STOPS.map(([value, color]) => `${color} ${(value / 70) * 100}%`)}
                minLabel="Road sees none"
                maxLabel="70%+ in view"
                labelClassName="text-2xs"
              />
            )}
          </MapLegendSection>
        )}

        {terrain && (
          <MapLegendSection title="Read from the terrain" data-legend-section="terrain">
            {props.terrainCandidate && (
              <Row
                color={TERRAIN_CANDIDATE_COLOR}
                swatch={<AreaSwatch color={TERRAIN_CANDIDATE_COLOR} dashed />}
                label="Landform candidate"
              />
            )}
            {props.otherRidgeLayers && (
              <Row color={OTHER_RIDGE_LAYER_COLOR} shape="line" label="Other ridge layers seen" />
            )}
            {props.landformClues && (
              <>
                <Row color={LANDFORM_CLUE_COLORS.ridge} label="Ridge" />
                <Row color={LANDFORM_CLUE_COLORS.hollow} label="Hollow" />
                <Row color={LANDFORM_CLUE_COLORS.other} label="Other landform clue" />
              </>
            )}
          </MapLegendSection>
        )}

        {bc && (
          <MapLegendSection title="BC inventories" data-legend-section="inventory">
            {props.sensitivityUnits && (
              <Row
                color={SENSITIVITY_UNIT_COLORS.fill}
                swatch={<AreaSwatch color={SENSITIVITY_UNIT_COLORS.fill} line={SENSITIVITY_UNIT_COLORS.rated} />}
                label="Visual sensitivity unit"
              />
            )}
            {inventory?.viewpoints && <Row color={INVENTORY_COLORS.viewpoint} label="VLI viewpoint" />}
            {inventory?.arrows && (
              <Row color={INVENTORY_COLORS.viewpoint} swatch={<ArrowSwatch />} label="Viewing direction" />
            )}
            {inventory?.recSites && <Row color={INVENTORY_COLORS.recSite} label="Recreation site" />}
            {inventory?.screenings && (
              <Row
                color={INVENTORY_COLORS.screening}
                swatch={<AreaSwatch color={INVENTORY_COLORS.screening} />}
                label="Recorded screening"
              />
            )}
          </MapLegendSection>
        )}
      </div>
    </MapLegendPanel>
  )
}
