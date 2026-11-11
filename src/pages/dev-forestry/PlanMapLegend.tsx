import type { ReactNode } from 'react'

import { LegendItem, MapGradientLegendItem, MapLegendPanel, MapLegendSection } from '@/components/ui/map-panels'

import { MASK_LABELS } from './assessmentMasks'
import {
  ASSESSMENT_VIEWPOINT_COLOR,
  EXPOSURE_STOPS,
  FACE_CANDIDATE_COLOR,
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
import { VISUAL_QUALITY_CLASSES, type VisualQualityClassId } from './vqo'

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
  /** The objectives among the sensitivity units drawn (null: none established). */
  sensitivityUnits: ReadonlyArray<VisualQualityClassId | null>
  /** The terrain readings drawn: the ridge layer, the face, or both. */
  terrainCandidates: ReadonlyArray<'ridge-layer' | 'facing'>
  otherRidgeLayers: boolean
  landformClues: boolean
  inventory: { viewpoints: boolean; arrows: boolean; recSites: boolean; screenings: boolean } | null
  masks: ReadonlyArray<AssessmentMaskKind>
  /** The plan map's own switches for what the road view's *Show* also offers. */
  show?: { state: PlanShow; onToggle: (key: keyof PlanShow) => void }
  /** Folded to its heading; the page folds it while the map shares the screen with the road view. */
  collapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
}

/** What the plan map draws, switched from its legend; the road view keeps its own set. */
export type PlanShow = { analysis: boolean; imagery: boolean; evqo: boolean; landform: boolean }
export const DEFAULT_PLAN_SHOW: PlanShow = { analysis: true, imagery: false, evqo: false, landform: true }

const PLAN_SHOW_ROWS: ReadonlyArray<{ key: keyof PlanShow; label: string; color: string }> = [
  { key: 'analysis', label: 'Analysis points', color: VISIBLE_COLOR },
  { key: 'imagery', label: 'Satellite imagery', color: '#4b6b3c' },
  { key: 'evqo', label: 'EVQO polygons', color: '#a855f7' },
  { key: 'landform', label: 'Landform', color: ROLE_COLORS.landscape },
]

/**
 * The plan map's legend: one row for each layer on the map now, grouped by
 * where it came from. It reads the same colours as the layers (`planMapStyle.ts`).
 */
export function PlanMapLegend(props: PlanMapLegendProps) {
  const { blocks, landform, existingOpenings, road, run, reverseRoads, inventory, masks } = props
  const graded = run || reverseRoads
  const terrain = props.terrainCandidates.length > 0 || props.otherRidgeLayers || props.landformClues
  const bc =
    props.sensitivityUnits.length > 0 ||
    (inventory && (inventory.viewpoints || inventory.arrows || inventory.recSites || inventory.screenings))
  if (!blocks.count && !landform && !road && !graded && !terrain && !bc && !masks.length && !props.show) return null
  const showRows = PLAN_SHOW_ROWS.filter(({ key }) => (key === 'analysis' ? run : key === 'landform' ? landform : true))
  return (
    <MapLegendPanel
      title="Legend"
      collapsible
      defaultCollapsed="mobile"
      collapsed={props.collapsed}
      onCollapsedChange={props.onCollapsedChange}
      width="sm"
      data-testid="visual-quality-legend"
      contentClassName="max-h-72 overflow-y-auto overscroll-contain"
    >
      <div className="space-y-3">
        {props.show && (
          <MapLegendSection title="Show" data-legend-section="show">
            {showRows.map(({ key, label, color }) => (
              <LegendItem
                key={key}
                color={color}
                label={label}
                active={props.show!.state[key]}
                onClick={() => props.show!.onToggle(key)}
                data-plan-show={key}
              />
            ))}
          </MapLegendSection>
        )}
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
            {props.terrainCandidates.includes('ridge-layer') && (
              <Row
                color={TERRAIN_CANDIDATE_COLOR}
                swatch={<AreaSwatch color={TERRAIN_CANDIDATE_COLOR} dashed />}
                label="Landform candidate · ridge layer seen"
              />
            )}
            {props.terrainCandidates.includes('facing') && (
              <Row
                color={FACE_CANDIDATE_COLOR}
                swatch={<AreaSwatch color={FACE_CANDIDATE_COLOR} dashed />}
                label="Landform candidate · face turned to the view"
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
            {VISUAL_QUALITY_CLASSES.filter((entry) => props.sensitivityUnits.includes(entry.id)).map((entry) => (
              <Row
                key={entry.id}
                color={entry.color}
                swatch={<AreaSwatch color={entry.color} />}
                label={`Sensitivity unit · ${entry.label}`}
              />
            ))}
            {props.sensitivityUnits.includes(null) && (
              <Row
                color={SENSITIVITY_UNIT_COLORS.unrated}
                swatch={<AreaSwatch color={SENSITIVITY_UNIT_COLORS.unrated} />}
                label="Sensitivity unit · no objective"
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
