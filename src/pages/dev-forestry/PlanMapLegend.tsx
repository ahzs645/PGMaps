import { createContext, useContext, type ReactNode } from 'react'

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
  TREE_FREE_COLOR,
  SCREENED_COLOR,
  SENSITIVITY_UNIT_COLORS,
  TERRAIN_CANDIDATE_COLOR,
  UNKNOWN_COLOR,
  VISIBLE_COLOR,
} from './planMapStyle'
import type { PlanLegendKey } from './planLayers'
import { ROLE_COLORS } from './scene'
import type { AssessmentMaskKind } from './types'
import { EVQO_COLORS, EVQO_NAMES, type EvqoCode } from './visualsNarrative'
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

/** A gradient bar, for the share of the block each stretch of road sees. */
function RampSwatch() {
  return (
    <span
      className="h-2 w-5 rounded-sm"
      style={{
        background: `linear-gradient(to right, ${EXPOSURE_STOPS.map(([value, color]) => `${color} ${(value / 70) * 100}%`).join(', ')})`,
      }}
    />
  )
}

const LegendToggles = createContext<{
  hidden: ReadonlySet<PlanLegendKey>
  onToggle: (key: PlanLegendKey) => void
} | null>(null)

/** One row; clicking it hides or shows what it stands for on the plan map. */
function Row({
  id,
  color,
  label,
  swatch,
  shape,
}: {
  id: PlanLegendKey
  color: string
  label: ReactNode
  swatch?: ReactNode
  shape?: 'line'
}) {
  const toggles = useContext(LegendToggles)
  return (
    <LegendItem
      color={color}
      label={label}
      swatch={swatch}
      swatchShape={shape}
      active={!toggles?.hidden.has(id)}
      onClick={toggles ? () => toggles.onToggle(id) : undefined}
      title={toggles ? (toggles.hidden.has(id) ? 'Show on the map' : 'Hide from the map') : undefined}
      data-plan-layer={id}
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
  /** Tree-free areas drawn for the road view's timber. */
  treeFreeAreas?: boolean
  /** The established VQO classes drawn, when the Layers button has EVQO on. */
  evqo: ReadonlyArray<EvqoCode>
  /** Rows switched off; with `onToggle`, every row is a button that hides its layer. */
  hidden?: ReadonlySet<PlanLegendKey>
  onToggle?: (key: PlanLegendKey) => void
  /** Folded to its heading; the page folds it while the map shares the screen with the road view. */
  collapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
}

const EVQO_ORDER: ReadonlyArray<EvqoCode> = ['P', 'R', 'PR', 'M', 'MM']

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
  const evqo = EVQO_ORDER.filter((code) => props.evqo.includes(code))
  if (
    !blocks.count &&
    !landform &&
    !road &&
    !graded &&
    !terrain &&
    !bc &&
    !masks.length &&
    !evqo.length &&
    !props.treeFreeAreas
  )
    return null
  const toggles = props.onToggle ? { hidden: props.hidden ?? new Set<PlanLegendKey>(), onToggle: props.onToggle } : null
  const exposureShown = !toggles?.hidden.has('exposure')
  return (
    <LegendToggles.Provider value={toggles}>
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
          {(blocks.count > 0 || landform || existingOpenings || masks.length > 0 || props.treeFreeAreas) && (
            <MapLegendSection title="Proposal" data-legend-section="proposal">
              {blocks.count > 0 && (
                <Row
                  id="block"
                  color={ROLE_COLORS.block}
                  swatch={<AreaSwatch color={ROLE_COLORS.block} />}
                  label={blocks.customColors ? 'Cutblock (or its chosen colour)' : 'Cutblock'}
                />
              )}
              {landform && (
                <Row
                  id="landform"
                  color={ROLE_COLORS.landscape}
                  swatch={<AreaSwatch color={ROLE_COLORS.landscape} />}
                  label="Landform"
                />
              )}
              {existingOpenings && (
                <Row
                  id="opening"
                  color={ROLE_COLORS.harvested}
                  swatch={<AreaSwatch color={ROLE_COLORS.harvested} />}
                  label="Existing opening"
                />
              )}
              {props.treeFreeAreas && (
                <Row
                  id="tree-free"
                  color={TREE_FREE_COLOR}
                  swatch={<AreaSwatch color={TREE_FREE_COLOR} dashed />}
                  label="Tree-free area (road view)"
                />
              )}
              {masks.map((kind) => (
                <Row
                  key={kind}
                  id={`mask:${kind}`}
                  color={MASK_COLORS[kind]}
                  swatch={<AreaSwatch color={MASK_COLORS[kind]} line="#475569" />}
                  label={MASK_LABELS[kind]}
                />
              ))}
            </MapLegendSection>
          )}

          {(road || graded) && (
            <MapLegendSection title={run ? 'Seen from the road' : 'Road'} data-legend-section="road">
              {road && (
                <Row
                  id="road"
                  color={ROAD_COLOR}
                  shape={road === 'corridor' ? 'line' : undefined}
                  label={road === 'corridor' ? 'Road to assess' : 'Viewpoint'}
                />
              )}
              {run && (
                <>
                  <Row id="samples:visible" color={VISIBLE_COLOR} label="Visible ground" />
                  <Row id="samples:hidden" color={SCREENED_COLOR} label="Hidden, or past the analysis range" />
                  <Row id="samples:unknown" color={UNKNOWN_COLOR} label="Unknown (missing data)" />
                  <Row id="viewpoint" color={ASSESSMENT_VIEWPOINT_COLOR} label="Assessment viewpoint" />
                </>
              )}
              {graded && (
                <>
                  <Row
                    id="exposure"
                    color={EXPOSURE_STOPS[0][1]}
                    swatch={<RampSwatch />}
                    label="Share of the block in view"
                  />
                  {exposureShown && (
                    <MapGradientLegendItem
                      aria-label="Share of the block in view from each stretch of road"
                      colors={EXPOSURE_STOPS.map(([value, color]) => `${color} ${(value / 70) * 100}%`)}
                      minLabel="Road sees none"
                      maxLabel="70%+ in view"
                      labelClassName="text-2xs"
                    />
                  )}
                </>
              )}
            </MapLegendSection>
          )}

          {terrain && (
            <MapLegendSection title="Read from the terrain" data-legend-section="terrain">
              {props.terrainCandidates.includes('ridge-layer') && (
                <Row
                  id="candidate:ridge-layer"
                  color={TERRAIN_CANDIDATE_COLOR}
                  swatch={<AreaSwatch color={TERRAIN_CANDIDATE_COLOR} dashed />}
                  label="Landform candidate · ridge layer seen"
                />
              )}
              {props.terrainCandidates.includes('facing') && (
                <Row
                  id="candidate:facing"
                  color={FACE_CANDIDATE_COLOR}
                  swatch={<AreaSwatch color={FACE_CANDIDATE_COLOR} dashed />}
                  label="Landform candidate · face turned to the view"
                />
              )}
              {props.otherRidgeLayers && (
                <Row
                  id="other-ridge-layers"
                  color={OTHER_RIDGE_LAYER_COLOR}
                  shape="line"
                  label="Other ridge layers seen"
                />
              )}
              {props.landformClues && (
                <>
                  <Row id="clue:ridge" color={LANDFORM_CLUE_COLORS.ridge} label="Ridge" />
                  <Row id="clue:hollow" color={LANDFORM_CLUE_COLORS.hollow} label="Hollow" />
                  <Row id="clue:other" color={LANDFORM_CLUE_COLORS.other} label="Other landform clue" />
                </>
              )}
            </MapLegendSection>
          )}

          {bc && (
            <MapLegendSection title="BC inventories" data-legend-section="inventory">
              {VISUAL_QUALITY_CLASSES.filter((entry) => props.sensitivityUnits.includes(entry.id)).map((entry) => (
                <Row
                  key={entry.id}
                  id={`unit:${entry.id}`}
                  color={entry.color}
                  swatch={<AreaSwatch color={entry.color} />}
                  label={`Sensitivity unit · ${entry.label}`}
                />
              ))}
              {props.sensitivityUnits.includes(null) && (
                <Row
                  id="unit:none"
                  color={SENSITIVITY_UNIT_COLORS.unrated}
                  swatch={<AreaSwatch color={SENSITIVITY_UNIT_COLORS.unrated} />}
                  label="Sensitivity unit · no objective"
                />
              )}
              {inventory?.viewpoints && (
                <Row id="vli-viewpoint" color={INVENTORY_COLORS.viewpoint} label="VLI viewpoint" />
              )}
              {inventory?.arrows && (
                <Row id="arrow" color={INVENTORY_COLORS.viewpoint} swatch={<ArrowSwatch />} label="Viewing direction" />
              )}
              {inventory?.recSites && <Row id="rec-site" color={INVENTORY_COLORS.recSite} label="Recreation site" />}
              {inventory?.screenings && (
                <Row
                  id="screening"
                  color={INVENTORY_COLORS.screening}
                  swatch={<AreaSwatch color={INVENTORY_COLORS.screening} />}
                  label="Recorded screening"
                />
              )}
            </MapLegendSection>
          )}

          {evqo.length > 0 && (
            <MapLegendSection title="Established VQO" data-legend-section="evqo">
              {evqo.map((code) => (
                <Row
                  key={code}
                  id={`evqo:${code}`}
                  color={EVQO_COLORS[code]}
                  swatch={<AreaSwatch color={EVQO_COLORS[code]} />}
                  label={`${EVQO_NAMES[code]} (${code})`}
                />
              ))}
            </MapLegendSection>
          )}
        </div>
      </MapLegendPanel>
    </LegendToggles.Provider>
  )
}
