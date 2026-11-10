import type { StreamAssessment } from './streamClass'
import type { CrossingCostItem, CrossingEstimate, StreamCrossingRecord } from './crossingPlanTypes'
import type { ConstraintPolicy } from './constraints'
import type { ProvincialStreamData, ProvincialStreamSource } from './provincialStreamData'
import type { LocalRaster } from '../dev-forestry/types'
import type { ElevationSource } from '../dev-forestry/terrain'
import type { AlignmentEngineering, EngineeringAnalysis } from './engineeringTypes'
import type { VerticalCheck, VerticalControl, VerticalStandards } from './verticalStandards'
import type { RouteSearchOptions } from './routing'
import type { RoadNetworkEvidence } from './roadNetworkTypes'
import type { RoadConditionObservation, RoadConditionPolicy } from './roadCondition'
import type { TotalCostPlanning } from './fullCostPlanning'
import type { FullCostReviewRecord } from './fullCostRecord'
import type { DrainageProjectState } from './drainageEvidence'
import type { RoadReportSettings } from './reportSettings'
import type { InvalidInput } from './inputErrors'
import type { CableRigging, SkylineSpanResult } from './cableMechanics'
import type { CableSupportLayout } from './cableLayout/settings'
export type { GradeRange, VerticalCheck, VerticalControl, VerticalStandards } from './verticalStandards'
export type * from './engineeringTypes'

export type Coordinate = [number, number]
export interface RoadPoint {
  id: string
  coordinate: Coordinate
  radiusM: number
  /** Clothoid transition length on each side of the circular curve; omitted or 0 is a simple curve. */
  spiralM?: number
}
export interface VerticalPoint {
  id: string
  chainage: number
  elevation: number
  curveLength: number
}
export interface SectionComponent {
  id: string
  name: string
  side: 'left' | 'right'
  kind: 'bench' | 'slope' | 'wall' | 'key'
  condition: 'always' | 'cut' | 'fill'
  widthM: number
  /** Metres rising away from the road; key uses depthM instead. */
  riseM: number
  depthM?: number
  /** Key starts this far outside the formation edge. */
  offsetM?: number
  materialId?: string
  code?: string
  /** A named context line/polygon intersects the section to anchor the component endpoint. */
  referenceFeatureId?: string
  /** original-ground, prepared-ground, or a named retained analytical surface. */
  referenceSurfaceId?: string
  referenceOffsetM?: number
  referenceElevationM?: number
}
export interface SectionLayer {
  id: string
  name: string
  side: 'left' | 'right' | 'both'
  depthM: number
  materialId?: string
}
export interface RoadTemplate {
  leftWidth: number
  rightWidth: number
  crossfallPercent: number
  cutSlope: number
  fillSlope: number
  ditchWidth: number
  ditchDepth: number
  surfaceDepth: number
  /** Flat ditch bottom inside the ditch width: 0 (or omitted) is a V ditch, up to the width is a U / box ditch. */
  ditchBottomWidth?: number
  /** Optional side-specific values; omitted values inherit the symmetric base setting. */
  leftCrossfallPercent?: number
  rightCrossfallPercent?: number
  leftCutSlope?: number
  rightCutSlope?: number
  leftFillSlope?: number
  rightFillSlope?: number
  leftDitchWidth?: number
  rightDitchWidth?: number
  leftDitchDepth?: number
  rightDitchDepth?: number
  leftDitchBottomWidth?: number
  rightDitchBottomWidth?: number
  leftSurfaceDepth?: number
  rightSurfaceDepth?: number
  /** Ordered additions between ditch/formation and the daylight batter. */
  components?: SectionComponent[]
  /** Explicit surface course stack replaces legacy surfaceDepth when present. */
  layers?: SectionLayer[]
  /**
   * Rock cut in ground horizons whose material is marked rock (`rockExcavation.ts`). Omitted: rock
   * is classified only, cut at its material's or the template's batter. `leftRockCut` and
   * `rightRockCut` replace it on one side, as the side values above do.
   */
  rockCut?: RockCutTemplate
  leftRockCut?: RockCutTemplate
  rightRockCut?: RockCutTemplate
}
/**
 * How a template cuts rock. Every field is optional and an omitted one is off, so a template without
 * it builds and prices the section exactly as before.
 */
export interface RockCutTemplate {
  /** Batter H:V in a rock material that has no cut batter of its own. Omitted: the side's cut batter. */
  cutSlope?: number
  /** Horizontal width of the bench where the cut batter rises out of rock into the soil above, m. */
  ledgeWidthM?: number
  /** Blasting (overbreak) level below the subgrade at the centreline, m. Omitted: no overbreak. */
  blastDepthM?: number
  /** Fall of the blasting level outward from the centreline, %. Omitted with a depth: 10 %. */
  blastCrossfallPercent?: number
  /**
   * Slope of the drainage surface from the ditch's inner bottom edge to the rock face, %; negative
   * rises outward, so the blasting level's low point lies under the ditch. Omitted with a depth: −25 %.
   */
  drainageCrossfallPercent?: number
  /** Rock cut whose thickness down to the blasting level is at most this is shallow, m. Omitted: no split. */
  shallowDepthM?: number
}
export interface WidthOverride {
  id: string
  name: string
  kind: 'landing' | 'turnout'
  start: number
  end: number
  taper: number
  side: 'left' | 'right' | 'both'
  extraWidth: number
  entryTaperM?: number
  exitTaperM?: number
}
/**
 * Design-speed curve rules: superelevation e = V²/(127 R) − f, held between the normal crown and
 * the maximum, rotated about the centreline, plus inside widening L²/(2R) for a vehicle of length L.
 * Both run in linearly over the runoff length before each curve and out after it.
 */
export interface CurveDesign {
  /** User-entered criteria identity and source; never implies a certified road standard. */
  criteriaName?: string
  criteriaSource?: string
  designSpeedKmh: number
  maxSuperelevationPercent: number
  sideFrictionFactor: number
  runoffLengthM: number
  /** Null for no curve widening. */
  wideningVehicleLengthM: number | null
  /** Optional rectangular radius/deflection table, interpolated independently on the two sides. */
  wideningTable?: { radiusM: number; deflectionDegrees: number; insideM: number; outsideM: number }[]
  /** Added to the table/formula width on its named side. */
  insideWideningM?: number
  outsideWideningM?: number
}
/**
 * One rigid unit of a design vehicle. The front pivot is the steer axle for the first unit and the
 * hitch (kingpin, bunk or pin) for trailing units; the rear axle is the axle-group centre.
 */
export interface VehicleUnit {
  name: string
  /** Front pivot to rear axle-group centre. */
  wheelbaseM: number
  /** Body or load ahead of the front pivot. */
  frontOverhangM: number
  /** Body or load behind the rear axle-group centre. */
  rearOverhangM: number
  /** Rear axle-group centre to the next unit's hitch; positive is behind the axles. */
  hitchOffsetM: number
}
export interface DesignVehicle {
  name: string
  /** Where the dimensions came from; presets are examples, not certified design vehicles. */
  source?: string
  /** Out-to-out width of body and tyres. */
  widthM: number
  units: VehicleUnit[]
  /** Largest steering angle of the first unit's steer axle, degrees. Absent: the lock is not checked. */
  steeringLockDeg?: number
  /** Loads carried on bunks of two different units, such as logs spanning a truck and its trailer. */
  loads?: LoadSpan[]
}
/**
 * A rigid load lying from a bunk on one unit to a bunk on a later unit. It is drawn along the line
 * between the two bunks and adds to the body envelope; it does not steer the units.
 */
export interface LoadSpan {
  name: string
  /** Bunk on the leading unit, measured behind that unit's front pivot. */
  front: { unit: number; behindPivotM: number }
  /** Bunk on a later unit, measured behind that unit's front pivot. */
  rear: { unit: number; behindPivotM: number }
  /** Load ahead of the front bunk. */
  aheadOfFrontBunkM: number
  /** Load behind the rear bunk. */
  behindRearBunkM: number
  /** Load width; the vehicle width when absent. */
  widthM?: number
  /**
   * How the load's length behaves as the bunks move apart or together in a turn. `from-bunks`
   * (the default when absent) keeps both overhangs, so the load stretches with the bunk spacing.
   * `rigid` keeps the length it has travelling straight: the load rides the front bunk, slides over
   * the rear one, and the tail behind the rear bunk changes by the change in spacing.
   */
  lengthMode?: 'from-bunks' | 'rigid'
}
/** User-entered swept-path check for one road; never inferred from a road class. */
export interface VehicleCheck {
  vehicle: DesignVehicle
  /** Direction travelled with the design vehicle. */
  direction: 'up' | 'down' | 'both'
  /** Wheel-path clearance required inside each formation edge. */
  clearanceM: number
}
export interface Alignment {
  id: string
  name: string
  color: string
  points: RoadPoint[]
  vertical: VerticalPoint[]
  /** Named profiles share this road's horizontal geometry. `vertical` is the active editable profile. */
  verticalAlternatives?: VerticalAlternative[]
  activeVerticalAlternativeId?: string
  /** Shared engineering inputs, or a separately saved engineering design for each profile. */
  verticalAlternativeCostMode?: 'shared' | 'independent'
  template: RoadTemplate
  overrides: WidthOverride[]
  engineering?: AlignmentEngineering
  /** Per-physical-crossing planning choices and entered price evidence, including retired records. */
  crossingRecords?: StreamCrossingRecord[]
  /** Optional vertical standards and control points; unset values are not checked. */
  verticalStandards?: VerticalStandards
  verticalControls?: VerticalControl[]
  curveDesign?: CurveDesign
  /** Stopping sight distance inputs (`sightDistance.ts`); omitted values take the defaults there. */
  sightDistance?: Partial<import('./sightDistance').SightDistanceSettings>
  vehicleCheck?: VehicleCheck
  fullCostRecord?: FullCostReviewRecord
  /** Reviewed road section at the connector's end, including permit/user roads and ambiguous levels. */
  networkEntryRoadId?: string
  /**
   * Set when this road is a mapped road loaded from context: its line is the record's, held
   * read-only, and its formation follows the ground. It is the road as mapped, not a proposal.
   */
  mappedRoad?: MappedRoadOrigin
  /** Set on a road a terrain-cost route search made: the search's own figures for it. */
  routeSearch?: RouteSearchRecord
  /** Recorded origin and destination of a generated FSR connector; later edits may change the junction. */
  fsrConnection?: {
    targetFeatureId: string
    targetName: string
    targetCoordinate: Coordinate
    originCoordinate: Coordinate
    originAlignmentId: string
    endpoint: 'start' | 'end'
    preference: 'nearest' | 'lowest-cost' | 'chosen'
    networkScope: string
    straightLineDistanceM: number
    routeLengthM: number
    searchCost: number
  }
}
/**
 * What a route search reported for one of the roads it made. The score is the search's own ranking
 * figure under its cost model (road $/m scaled by ground grade, plus crossings and zones), not an
 * estimate of the road. `name` and `pointsKey` are the road as made, to tell whether it has been
 * changed since.
 */
export interface RouteSearchRecord {
  kind: 'terrain-cost'
  /** 1 is the lowest search score of the routes that search returned. */
  rank: number
  of: number
  searchScore: number
  /** Length of the route as searched, before curves were fitted, m. */
  lengthM: number
  crossings: number
  name: string
  pointsKey: string
  /** Fingerprint of the section template the search gave the road. Absent on older records. */
  templateKey?: string
}
/** Where a loaded mapped road came from and how its line was prepared. */
export interface MappedRoadOrigin {
  source: ExistingRoadEvidence['source']
  roadName: string
  /** Context features joined into the line, in order. */
  contextIds: string[]
  /** Retained source identities of those features (FTEN OBJECTIDs for BC records). */
  sourceIds: string[]
  forestFileId?: string
  roadSectionId?: string
  /** Vertices on the record before thinning. */
  sourceVertexCount: number
  /** Ramer–Douglas–Peucker tolerance used to thin the record's vertices. */
  thinningToleranceM: number
  /** Straight joins added between parts that did not touch, metres. */
  joinGapsM: number[]
  /** Parts of the same section left out because no end came near the joined line. */
  partsLeftOut: number
}
export interface VerticalAlternative {
  id: string
  name: string
  vertical: VerticalPoint[]
  verticalStandards?: VerticalStandards
  verticalControls?: VerticalControl[]
  /** Used only with independent engineering inputs. Horizontal template/width ranges remain shared. */
  engineering?: AlignmentEngineering
  /** Historical/current comparison evidence belongs to its vertical design and is retained on switches. */
  fullCostRecord?: FullCostReviewRecord
}
export interface ContextFeature {
  id: string
  name: string
  kind: 'stream' | 'avoid' | 'existing-road' | 'harvest'
  geometry: GeoJSON.LineString | GeoJSON.Polygon
  /** Required before source Z can anchor an engineering section; must match project terrain. */
  referenceVerticalDatum?: string
  /** On an avoid polygon: route search may cross it at this extra CAD per metre instead of being blocked. */
  routeCostPerM?: number
  /** Explicit route treatment. If absent, the legacy routeCostPerM convention still applies. */
  constraint?: ConstraintPolicy
  /** Treatment of the preliminary horizontal riparian area; defaults to conditional, pending review. */
  riparianPolicy?: ConstraintPolicy
  /** A feature price overrides its group's price, which overrides the route-search default. */
  crossingCost?: number
  /** A named price group for route search. Not a riparian class: that is on `streamAssessment`. */
  crossingGroup?: string
  /** Evidence and class for a stream reach. Absent means unassessed, never a class. */
  streamAssessment?: StreamAssessment
  /** Raw provincial identity and retrieval scope; never substitutes for the stream assessment. */
  streamSource?: ProvincialStreamSource
  /** Catalogue facts and separately entered planning assumptions; tenure dates are not road age. */
  roadEvidence?: ExistingRoadEvidence
  /** Reported or estimated harvest timing and provenance; never stand age or road condition. */
  harvestEvidence?: import('./harvestHistory').HarvestEvidence
}
export interface ExistingRoadEvidence {
  source: 'bc-ften' | 'user' | 'scenario'
  /** FSR identity comes from the source file-type code, never the name or file ID. */
  roadClass?: 'fsr' | 'permit' | 'user'
  fileTypeCode?: string
  lifecycleStatus?: string
  /** Source business identifiers remain strings, including leading zeroes. */
  forestFileId?: string
  roadSectionId?: string
  segmentStartStation?: number
  segmentEndStation?: number
  timberMark?: string
  clientNumber?: string
  sourceId?: string
  sourceUrl?: string
  retrievedAt?: string
  status?: string
  awardDate?: string
  retirementDate?: string
  constructionYear?: number
  /** Physical event evidence. Never derived from administrative award/retirement dates. */
  deactivation?: import('./roadHistory').RoadDeactivationEvidence
  condition: 'unknown' | 'serviceable' | 'rehabilitation' | 'closed'
  conditionBasis: 'unreviewed' | 'assumed' | 'field-verified'
  /** Explicit planning opt-in, never inferred from a permit status or a record date. */
  reuseAllowed: boolean
  /** A refreshed line changed geometry; retained evidence/restrictions require explicit scope review. */
  geometryReviewRequired?: boolean
  network?: RoadNetworkEvidence
  observations?: RoadConditionObservation[]
  conditionPolicy?: RoadConditionPolicy
  /** A line the user traced or adopted from a terrain search: how it was made. Never a survey. */
  lineOrigin?: RoadLineOrigin
}
/** How a user road line was made: traced by clicks, or adopted from a terrain search. */
export interface RoadLineOrigin {
  method: 'terrain-relocation' | 'terrain-trace' | 'clicks'
  /** The record or road the line was derived from. */
  fromName?: string
  createdAt: string
  /** The terrain's own cell size when the line was made, m. */
  terrainCellM?: number
  /** Share of the line where the terrain showed a road bench (relocation) or of segments that followed one (trace), %. */
  foundPercent?: number
  /** Relocation: distance from the source line, over the found stretches, m. */
  medianShiftM?: number
  p90ShiftM?: number
  /** Relocation: median bench width between batter breaks, m. Not the drivable width. */
  benchWidthM?: number
  /** Trace: segments between clicks, and how many followed the terrain. */
  segments?: number
  snappedSegments?: number
  /** Relocation: what the ground was scored with, and the settings the search ran with. */
  scoredWith?: 'terrain' | 'terrain+vegetation'
  corridorM?: number
  confidence?: number
  flatToleranceM?: number
  /** Relocation with a point cloud: mean drivable width (m), vegetation over the bed (%), state. */
  drivableWidthM?: number
  vegetationPercent?: number
  stateScore?: number
  stateClass?: number
}
export interface CableLine {
  id: string
  name: string
  start: Coordinate
  end: Coordinate
  startHeight: number
  endHeight: number
  deflectionPercent: number
  /** Positive offsets inset each original endpoint; negative offsets extend it. */
  startOffsetM?: number
  endOffsetM?: number
  /** startHeight is the yarder height; endHeight is the tailhold height. */
  yarderAt?: 'start' | 'end'
  /**
   * Where the profile's sag comes from. Absent or `assumed`: the entered percentage of span
   * (unchanged behaviour). `mechanics`: also solve the skyline from `rigging` (`cableMechanics.ts`).
   */
  sagModel?: 'assumed' | 'mechanics'
  /** Rope, load and tensioning for the `mechanics` sag model; kept when switching back to `assumed`. */
  rigging?: CableRigging
  /** Intermediate-support search settings and the last layout found (`cableLayout/settings.ts`). */
  supportLayout?: CableSupportLayout
}
export interface RoadSettings {
  stationInterval: number
  crossSectionHalfWidth: number
  maxGradePercent: number
  minRadius: number
  cutRate: number
  fillRate: number
  surfacingRate: number
  clearingRate: number
  shrinkFactor: number
  /**
   * Whether cut and fill corrected for plan curvature (Pappus, `curvedVolume.ts`) are only reported
   * beside the average-end-area volumes (`report`, the default when absent) or replace them in every
   * total, cost, mass and haul figure (`apply`).
   */
  curvatureCorrection?: 'report' | 'apply'
}
export interface TerrainMetadata {
  kind: 'demo' | 'geotiff' | 'regional'
  name: string
  resolutionM: number
  verticalReference: string
  epsg?: number
  sourceUrl?: string
  sha256?: string
  raster?: LocalRaster
  /** Explicit reproducible source preparation; retained TIN is optional and bounded. */
  preparation?: import('./terrainPreparation').TerrainPreparationRecord
  /** Independent imagery/canopy display stack; never analytical ground. */
  backgrounds?: import('./terrainPreparation').TerrainBackgroundLayer[]
  /** Reviewed analytical grid snapshots, kept separate from display-only canopy/imagery. */
  referenceSurfaces?: Array<{ id: string; name: string; raster: LocalRaster }>
  /** Regional DEMs only: the extent loaded, [west, south, east, north], so reopening loads it again. */
  bounds?: [number, number, number, number]
}
export interface RoadProject {
  schema: 'pgmaps-road-project-v1'
  name: string
  /** Investigation workspaces expose source records, never the schema's internal design placeholder. */
  workspaceMode?: 'design' | 'access-investigation'
  investigation?: { openingId: string; draftAlignmentId: string }
  /**
   * A design started from an investigation before any road was added. The schema needs one
   * alignment, so this placeholder stays hidden and unanalysed; the first road added replaces it.
   */
  designPlaceholderId?: string
  /** Persistent library loading/coverage evidence, retained when a scenario is saved. */
  scenario?: { id: string; contextWarnings: string[]; terrainCoveragePercent: number }
  /** Calendar year for reproducible harvest-age displays; absent uses the current year. */
  harvestHistoryYear?: number
  /** Evidence-led block access reconstruction, independent of present-day reuse permission. */
  accessHistory?: import('./accessHistoryTypes').HistoricalAccessState
  activeAlignmentId: string
  alignments: Alignment[]
  terrain: TerrainMetadata
  settings: RoadSettings
  /** What the roads are designed to. Grade and radius limits themselves stay in `settings`. */
  standards?: import('./designStandards').DesignStandards
  /** Printed on the report and every plot-book sheet: author, organisation, revision and date. */
  issue?: import('./projectIssue').ProjectIssue
  /** The project's own design vehicles (a contractor's fleet), reused by every road's vehicle check. */
  vehicleLibrary?: DesignVehicle[]
  /** Portable drawing settings; report intervals never alter analytical station spacing. */
  reportSettings?: RoadReportSettings
  /** Optional saved route-search assumptions; older projects retain the current defaults. */
  routeSearch?: RouteSearchOptions
  /** Where the wood goes, the haul speeds and terminal times, and the junction-turn rule. */
  haulDestination?: import('./haulReview').HaulDestinationSettings
  /** Browser road-network projection inputs; independent of reviewed haul-network evidence. */
  networkPlanning?: import('./roads/planning').NetworkPlanning
  /** Explicit vehicle, network, evidence, supply and final-check inputs for complete route comparisons. */
  totalCostPlanning?: TotalCostPlanning
  /** Portable inputs and compact, fingerprinted drainage evidence; full grids are recomputed. */
  drainage?: DrainageProjectState
  /** Scoped provincial fish/watershed evidence; FWA arcs are retained in context. */
  provincialStreamData?: ProvincialStreamData
  /** Charged once in each alternative's estimate, never once per stream. */
  sharedCrossingCosts?: CrossingCostItem[]
  context: ContextFeature[]
  cables: CableLine[]
  profiles?: { id: string; name: string; points: Coordinate[] }[]
  surveyBooks?: import('./surveyInterchange').SurveyBookRecord[]
  /** Sketches, pins, lines and areas drawn on the plan. Kept apart from design data; nothing reads them. */
  notes?: import('./mapNotes').MapNote[]
  /** Imported points, lines and areas kept as reference: drawn and listed, read by no calculation. */
  reference?: import('./referenceFeatures').ReferenceFeature[]
}
export interface SectionSample {
  offset: number
  ground: number | null
  design: number | null
  /** Ground after site preparation; ground above retains the source measurement. */
  preparedGround?: number | null
  /** Top of rock: ground less the depth of the shallowest rock horizon. Present only where rock is entered. */
  rockTop?: number | null
  /** Blasting (overbreak) level where it lies below the design line; null outside the blasted region. */
  blastLevel?: number | null
}
/** One rock material's part of a section (`rockExcavation.ts`). Areas are m², moments ∫ offset dA in m³. */
export interface RockSectionArea {
  materialId: string
  /** Rock cut above the design line: part of the section's cut area. */
  cutAreaM2: number
  /** The part of that cut where rock is at most the shallow depth thick down to the blasting level. */
  shallowAreaM2: number
  /** Rock blasted below the design line down to the blasting level: not part of the cut area. */
  deepAreaM2: number
  deepMomentM3: number
}
export interface StationRock {
  areas: RockSectionArea[]
  /** Horizontal width of shallow rock cut, m. */
  shallowWidthM: number
}
export interface RoadStation {
  index: number
  chainage: number
  coordinate: Coordinate
  bearing: number
  groundElevation: number | null
  designElevation: number | null
  gradePercent: number | null
  groundGradePercent: number | null
  curveRadiusM: number | null
  leftWidth: number
  rightWidth: number
  section: SectionSample[]
  preparationAreas?: { materialId?: string; purpose: 'stripping' | 'earthwork'; areaM2: number }[]
  layerAreas?: { id: string; name: string; materialId?: string; areaM2: number }[]
  componentAreas?: { id: string; name: string; materialId?: string; areaM2: number }[]
  componentPoints?: { code: string; offset: number; design: number }[]
  /** Rock cut, shallow rock and overbreak of a complete section with rock horizons; absent otherwise. */
  rock?: StationRock
  /** Includes preparation margins beyond the constructed catches. */
  clearingWidthM?: number
  leftClearingM?: number
  rightClearingM?: number
  cutAreaM2: number | null
  fillAreaM2: number | null
  /** Since the previous station; null when the section at either end is incomplete. */
  cutVolumeM3: number | null
  fillVolumeM3: number | null
  /** Surfacing since the previous station, on the same terms. The stations' values add up to the road's. */
  surfaceVolumeM3?: number | null
  /**
   * Cut and fill since the previous station corrected for plan curvature (Pappus); equal to the
   * average-end-area volumes on tangents, null where those are. Costs, mass and haul use
   * `cutVolumeM3`/`fillVolumeM3`, which equal these when `settings.curvatureCorrection` is `apply`.
   */
  curvedCutVolumeM3?: number | null
  curvedFillVolumeM3?: number | null
  /**
   * Cumulative usable cut minus fill of the known earthwork up to this station. An interval with
   * unknown volumes adds nothing, so the ordinate is carried across it rather than cut off.
   */
  massM3: number | null
  leftDaylightM: number | null
  rightDaylightM: number | null
  complete: boolean
  flags: string[]
  /** Why this section is incomplete, in the section builder's words; absent when it is complete. */
  incompleteReasons?: string[]
}
export interface Crossing {
  id: string
  featureId: string
  name: string
  kind: ContextFeature['kind']
  chainage: number
  coordinate: Coordinate
}
export interface RoadAnalysis {
  stations: RoadStation[]
  centerline: Coordinate[]
  crossings: Crossing[]
  length: number
  cutVolumeM3: number
  fillVolumeM3: number
  balanceM3: number
  surfaceVolumeM3: number
  clearingAreaM2: number
  estimatedCost: number
  maxGradePercent: number
  completeLength: number
  coveragePercent: number
  warnings: string[]
  engineering?: EngineeringAnalysis
  crossingEstimate?: CrossingEstimate
  /** Failed vertical standard / control checks, each also flagged on its nearest station. */
  verticalChecks?: VerticalCheck[]
  /**
   * Covered cut and fill corrected for plan curvature (Pappus), beside the uncorrected totals above.
   * Reported only; `curvedLengthM` is the covered length on curves and spirals, and
   * `uncorrectedIntervals` counts intervals left uncorrected because a centroid lies past the
   * centre of curvature.
   */
  curvatureCorrection?: {
    cutVolumeM3: number
    fillVolumeM3: number
    curvedLengthM: number
    uncorrectedIntervals: number
    /**
     * Set when `settings.curvatureCorrection` is `apply`: the totals above them, the stations'
     * volumes, cost, mass and haul are the corrected ones, and these are the average end areas.
     */
    applied?: true
    averageEndCutVolumeM3?: number
    averageEndFillVolumeM3?: number
  }
  /**
   * Set when the current section or engineering inputs could not be calculated. With stations, the
   * results leave the invalid input out and use its last valid value; without, nothing calculated.
   */
  invalidInput?: InvalidInput
  /**
   * The section and engineering inputs the results were calculated from, when `invalidInput` is set
   * and they differ from the road's current ones. Show and print these beside the results.
   */
  calculatedInputs?: DesignInputs
}
/**
 * The section and engineering inputs of a road, as distinct from its line and grade. An analysis
 * that fails on these is recalculated with the invalid ones at their last valid values.
 */
export type DesignInputs = Pick<Alignment, 'template' | 'engineering' | 'overrides' | 'curveDesign'>
export interface CableSample {
  distance: number
  ground: number | null
  cable: number | null
  clearance: number | null
}
export interface CableAnalysis {
  samples: CableSample[]
  length: number
  minClearance: number | null
  complete: boolean
  /** Present only for a line with `sagModel: 'mechanics'`; the fields above stay the assumed-sag screen. */
  mechanics?: CableMechanicsProfile
}
/** The solved skyline drawn on the D-line's own samples. */
export interface CableMechanicsProfile {
  rigging: CableRigging
  /** Why the skyline could not be solved (unknown support ground, rigging, or a span the rope cannot carry). */
  error: string | null
  span: SkylineSpanResult | null
  /** Aligned with `CableAnalysis.samples`. Elevations in the terrain's vertical reference. */
  samples: { loadPath: number | null; emptyRope: number | null; loadClearance: number | null }[]
  /** Smallest load-path clearance and where; null while any sample's ground is unknown. */
  minLoadClearance: number | null
  minLoadClearanceAt: number | null
  /** Every sample's load clearance is known. */
  complete: boolean
  /** Load clearance ≥ `rigging.minClearanceM` at every sample; null when unknown. */
  clearanceOk: boolean | null
  /** Largest support tension over every load position ≤ allowable; null when unsolved. */
  tensionOk: boolean | null
}
export type TerrainSource = ElevationSource
