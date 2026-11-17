/**
 * The culvert rules of BC's Engineering Manual (resource roads) and Fish-stream Crossing Guidebook,
 * and FHWA HDS-5's inlet-control coefficients, as data with the place each was read from.
 * `culvertChecks.ts`, `culvertClass.ts` and `culvertHydraulics.ts` apply them; change a value here
 * with its row in `docs/forestry-road-design/culverts.md`.
 *
 * Read on 16 November 2026 from the Engineering Manual (25 May 2026 edition), the Guidebook (2012)
 * and HDS-5, third edition (FHWA-HIF-12-026, 2012).
 *
 * Free of DOM and network access.
 */

export const ENGINEERING_MANUAL_URL =
  'https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/natural-resource-use/resource-roads/engineering-manual/engineering_manual.pdf'
export const FISH_STREAM_GUIDEBOOK_URL =
  'https://www2.gov.bc.ca/assets/gov/environment/plants-animals-and-ecosystems/fish-fish-habitat/fish-passage/fish-stream20crossing20web.pdf'

export type CulvertMaterial = 'csp' | 'smooth-plastic' | 'concrete'
export type CulvertInletEdge = 'projecting' | 'mitered' | 'headwall'

/** Manning n by pipe material (EM 3.5.5.7, p. 183). The ids are saved in project files: rename a label, never an id. */
export const CULVERT_MATERIALS: ReadonlyArray<{ value: CulvertMaterial; label: string; manningN: number }> = [
  { value: 'csp', label: 'Corrugated steel', manningN: 0.024 },
  { value: 'smooth-plastic', label: 'Smooth-wall plastic', manningN: 0.01 },
  { value: 'concrete', label: 'Concrete', manningN: 0.012 },
]
export const CULVERT_MATERIALS_LOCATOR = 'EM 3.5.5.7, p. 183'

export const CULVERT_INLET_EDGES: ReadonlyArray<{ value: CulvertInletEdge; label: string }> = [
  { value: 'projecting', label: 'Projecting from the fill' },
  { value: 'mitered', label: 'Mitered to the slope' },
  { value: 'headwall', label: 'Headwall' },
]

/**
 * Least cover over the pipe: the greater of a floor and a share of its rise. The stream rule is
 * measured from the top of the pipe to the road subgrade, which is what the engine's cover is.
 */
export const COVER_RULES = {
  stream: { minimumM: 0.6, riseFraction: 0.5, locator: 'EM 3.5.5.2, p. 171' },
  'cross-drain': { minimumM: 0.3, riseFraction: 0.5, locator: 'EM 5.8.6, p. 244' },
} as const

export const GRADIENT_RULES = {
  streamMaxPercent: 10,
  streamLocator: 'EM 3.5.5.2, p. 171',
  crossDrainMinPercent: 1,
  /** Above this fall the manual asks for outlet protection to be considered. */
  outletProtectionAbovePercent: 3,
  crossDrainLocator: 'EM 5.8.6, p. 244',
} as const

export const CROSS_DRAIN_SKEW = {
  degreesPerPercent: 3,
  aboveGradePercent: 3,
  maxDegrees: 45,
  locator: 'EM 3.5.5.6, p. 181',
} as const

export type DitchErosionHazard = 'slight' | 'moderate' | 'high'

/**
 * Maximum cross-drain spacing between established watercourses, m, by the road gradient at the
 * cross-drain and the erosion hazard of the ditch soil (more than half of it by type). The table is
 * printed as Table 3-14; the text around it calls it Table 3-15. The manual's classes share their
 * boundaries (3, 6, 9, 12%) without saying which class a boundary takes; `crossDrainSpacingM` gives
 * a gradient on a boundary the shorter spacing of the two classes.
 */
export const CROSS_DRAIN_SPACING = {
  /** Upper road gradient of each row, %; the last row is 12% and over. */
  gradeUpToPercent: [3, 6, 9, 12, Infinity],
  hazards: [
    { value: 'slight', label: 'Slight', soils: 'hardpan, rock, coarse gravels' },
    { value: 'moderate', label: 'Moderate', soils: 'fine gravels' },
    { value: 'high', label: 'High', soils: 'sands, silts, clays' },
  ] as ReadonlyArray<{ value: DitchErosionHazard; label: string; soils: string }>,
  /** `spacingM[gradeRow][hazard]`. */
  spacingM: [
    [350, 300, 200],
    [300, 200, 150],
    [250, 150, 100],
    [200, 100, 75],
    [150, 100, 100],
  ],
  /** Over 12% on high-hazard soil the manual also asks for a rock-lined ditch. */
  rockLineDitchAbovePercent: 12,
  locator: 'EM 3.5.5.6, Table 3-14, p. 180',
} as const

/** The grade rows' labels as the table prints them. */
export const CROSS_DRAIN_GRADE_ROWS = ['0–3%', '3–6%', '6–9%', '9–12%', '12%+'] as const

export interface CrossDrainPlacementItem {
  id: string
  label: string
  /** The workspace finds these on the road; the rest are the designer's to check on the ground. */
  detected?: boolean
}

/**
 * Where §3.5.5.6 asks for more than the table: the spacing it asks to be reduced, the places a
 * cross-drain goes whatever the spacing, and the line between a cross-drain and a stream crossing.
 * `detected` names what the workspace can find on the road itself; the rest is the designer's to
 * check on the ground.
 */
export const CROSS_DRAIN_PLACEMENT = {
  /** "The designer must reduce spacing below the table value where any of the following conditions apply." */
  reduceSpacingAt: [
    { id: 'junction', label: 'Road junctions, where flow from intersecting ditches accumulates' },
    { id: 'steep-uphill', label: 'Steep uphill side slopes, where seepage and runoff are elevated' },
    { id: 'seepage-in-cut', label: 'Seepage or piping in cuts' },
    { id: 'switchback', label: 'Switchbacks: spacing by site, not the table', detected: true },
  ] as ReadonlyArray<CrossDrainPlacementItem>,
  reduceLocator: 'EM 3.5.5.6, p. 180',
  /** "Cross drain culverts must be located at the following positions regardless of the calculated spacing interval." */
  requiredAt: [
    { id: 'top-of-steep', label: 'The top of steep sections of road' },
    { id: 'seepage', label: 'Seepage zones' },
    { id: 'low-point', label: 'Low points in the road profile', detected: true },
    { id: 'bedrock', label: 'Where ditchline bedrock approaches finished grade' },
    { id: 'cut-instability', label: 'Immediately before cut slope instability' },
    { id: 'through-cut', label: 'Before large through cuts' },
  ] as ReadonlyArray<CrossDrainPlacementItem>,
  requiredLocator: 'EM 3.5.5.6, pp. 180-181',
  /** Cross drains relieve the ditch; a defined watercourse is a stream crossing (EM 3.5.5.2 to 3.5.5.5). */
  watercourses: 'Cross drains do not substitute for a stream crossing structure where a defined channel meets the road',
  watercoursesLocator: 'EM 3.5.5.6, pp. 179-180',
} as const

/** The table row of a road gradient: a gradient on a class boundary takes the steeper row. */
export function crossDrainGradeRow(roadGradePercent: number): number {
  const grade = Math.abs(roadGradePercent)
  const row = CROSS_DRAIN_SPACING.gradeUpToPercent.findIndex((upper) => grade < upper)
  return row < 0 ? CROSS_DRAIN_SPACING.gradeUpToPercent.length - 1 : row
}

/**
 * The manual's maximum cross-drain spacing for a road gradient, m, for each erosion hazard class. On
 * a class boundary each class takes the shorter spacing of the two rows: at 12% on high-hazard soil
 * that is the 9–12% row's 75 m, not the 12%+ row's 100 m.
 */
export function crossDrainSpacingM(roadGradePercent: number): Record<DitchErosionHazard, number> {
  const row = crossDrainGradeRow(roadGradePercent)
  const grade = Math.abs(roadGradePercent)
  const boundary = row > 0 && Math.abs(grade - CROSS_DRAIN_SPACING.gradeUpToPercent[row - 1]) < 1e-9
  const [slight, moderate, high] = CROSS_DRAIN_SPACING.spacingM[row].map((value, i) =>
    boundary ? Math.min(value, CROSS_DRAIN_SPACING.spacingM[row - 1][i]) : value,
  )
  return { slight, moderate, high }
}

/** Round pipe diameters the manual tabulates opening areas for, m (EM Table 3-13, p. 166). */
export const STOCK_DIAMETERS_M: readonly number[] = [0.4, 0.5, 0.6, 0.8, 0.9, 1.0, 1.2, 1.4, 1.6, 1.8]

/** Any one criterion makes a culvert major. */
export const MAJOR_CULVERT = {
  /** A round pipe of this diameter or more. */
  roundDiameterM: 2,
  /** A pipe arch or open-bottom arch with a span over this. */
  archSpanM: 2.13,
  /** An opening area over this. */
  openingAreaM2: 3,
  /** A design discharge of this or more. */
  designDischargeM3s: 6,
  // The glossary's operators. Table 3-10 prints the arch span as "≥ 2,130 mm"; the glossary and the
  // Bridge Standards Manual print "over", which is used here.
  locator: 'EM glossary, p. xxv, and Table 3-10; Bridge Standards Manual',
  triggers:
    'A professional engineer’s design, record drawings and construction records, and inspections at most three years apart',
} as const

export const EMBEDMENT_RULES = {
  roundFraction: 0.4,
  roundMinimumM: 0.6,
  archBoxRiseFraction: 0.2,
  locator: 'Fish-stream Crossing Guidebook (2012), 4.2.1.3',
} as const

export const DESIGN_FLOOD = {
  permanent: 'Q100',
  temporary: 'Q10',
  temporaryYears: 3,
  locator: 'FPPR s. 74; EM 3.5.4.3.2',
} as const

export const HEADWATER_LIMIT = { hwOverD: 1, locator: 'EM 3.5.5.1.3, pp. 167-169' } as const

export interface InletCoefficients {
  K: number
  M: number
  c: number
  Y: number
}

/**
 * FHWA HDS-5's inlet-control design equations for round pipes (Appendix A, Table A.1), which are the
 * equations behind the nomographs the Engineering Manual names:
 *
 * - unsubmerged, up to `unsubmergedLimit`: HW/D = Hc/D + K·X^M + Ks·S
 * - submerged, from `submergedLimit`: HW/D = c·X² + Y + Ks·S
 *
 * with X = Ku·Q/(A·D^0.5), Hc the specific head at critical depth, and Ks −0.5 (0.7 for a mitered
 * inlet). Between the limits HDS-5 draws a transition, taken here as a straight line.
 *
 * Provenance: HDS-5's own file (49 MB) could not be read on 16 November 2026. Ku is from FHWA's
 * HRT-06-138; the coefficients are from a secondary listing of Table A.1 (LMNO Engineering, citing
 * Normann 1985) and only the rows that listing and this workspace's reading agree on are held. They
 * reproduce the Engineering Manual's round-culvert training example: 4.04 m³/s through an 1800 mm
 * projecting corrugated pipe reads HW/D 0.85 on the nomograph and 0.87 here
 * (`culvertHydraulics.test.ts`). Confirm against HDS-5 before relying on another row.
 *
 * The slope term is held at the nomographs' 2% (`nomographSlope`), so the figure is the one a
 * designer reads from the nomograph; by the equation a steeper pipe's headwater is a little lower.
 */
export const INLET_CONTROL = {
  /** Converts Q/(A·D^0.5) in m, m² and m³/s to the equations' units (FHWA-HRT-06-138, ch. 3). */
  kuSI: 1.811,
  unsubmergedLimit: 3.5,
  submergedLimit: 4,
  slopeTerm: -0.5,
  slopeTermMitered: 0.7,
  nomographSlope: 0.02,
  /** Null: no agreed coefficients for that inlet, which is then not assessed. */
  coefficients: {
    // Chart 2, circular corrugated metal; read for every thin-wall pipe (steel and plastic).
    'thin-wall': {
      headwall: { K: 0.0078, M: 2, c: 0.0379, Y: 0.69 },
      mitered: { K: 0.021, M: 1.33, c: 0.0463, Y: 0.75 },
      projecting: { K: 0.034, M: 1.5, c: 0.0553, Y: 0.54 },
    },
    // Chart 1, circular concrete: square edge with headwall, and groove end projecting.
    concrete: {
      headwall: { K: 0.0098, M: 2, c: 0.0398, Y: 0.67 },
      mitered: null,
      projecting: { K: 0.0045, M: 2, c: 0.0317, Y: 0.69 },
    },
  } satisfies Record<'thin-wall' | 'concrete', Record<CulvertInletEdge, InletCoefficients | null>>,
  locator: 'FHWA HDS-5, 3rd edition (2012), Appendix A, Table A.1',
} as const
