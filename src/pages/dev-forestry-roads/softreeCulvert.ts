/**
 * Culverts of the traverse formats (`softreeTraverse.ts`): the Softree ASCII and IPD CREEK field and
 * Polycorder's culvert width, and how a culvert moves between formats and units. Kept apart from the
 * format readers so the survey field book shows and edits culverts without loading them.
 *
 * Sizes follow each format's help: Softree ASCII gives a pipe's diameter or a box's height and width
 * in thousandths of a project unit (millimetres in metres); IPD a pipe's diameter in millimetres
 * (inches in a feet file) and a box's height and width in units. Polycorder's culvert width has no
 * stated unit; it is read as the ASCII format's size (the help's 450 and 900 read as millimetres).
 *
 * Checked by `softreeTraverse.test.ts`. Pure: no DOM or network access.
 */

/** The formats a culvert is read from (the unit-survey formats hold none). */
export type CulvertFormat = 'asc' | 'ipd' | 'polycorder' | 'unit-survey' | 'laser-raw'

/**
 * A culvert as the file wrote it (the ASCII formats' CREEK field; Polycorder's width is `sizeY`).
 * Sizes are in the file's own convention ({@link culvertInMetres} reads them): thousandths of a unit
 * in Softree ASCII and Polycorder; in IPD a pipe in millimetres (inches in feet) and a box in units.
 */
export interface SoftreeCulvert {
  /** Pipe diameter or box height. */
  sizeY: number | null
  /** Box width; null for a pipe. */
  sizeX: number | null
  gradientPercent: number | null
  /** Downstream azimuth, degrees. */
  azimuth: number | null
  /** 0 explicit, 1 perpendicular right, 3 perpendicular left, 5 from side shots (others kept). */
  flag: number | null
  /** Slope distance the gradient was measured over (elevation-difference entry), file units. */
  sd: number | null
  /** The field as written; written back while the numbers above still say the same. */
  raw?: string
}

/** A culvert in metres: what moves between formats and units. */
export interface CulvertMetres {
  /** Pipe diameter or box height, m. */
  sizeYM: number | null
  /** Box width, m; null for a pipe. */
  sizeXM: number | null
  gradientPercent: number | null
  azimuth: number | null
  flag: number | null
  sdM: number | null
}
/** A file's culvert in metres. IPD writes a pipe in mm (inches in a feet file) and a box in units. */
export function culvertInMetres(c: SoftreeCulvert, format: CulvertFormat, unitM: number): CulvertMetres {
  const thousandths = (v: number | null) => (v === null ? null : (v * unitM) / 1000)
  const pipe = c.sizeX === null
  const ipdY = (v: number | null) =>
    v === null ? null : pipe ? v * (Math.abs(unitM - 1) < 1e-12 ? 0.001 : 0.0254) : v * unitM
  return {
    sizeYM: format === 'ipd' ? ipdY(c.sizeY) : thousandths(c.sizeY),
    sizeXM: format === 'ipd' ? (c.sizeX === null ? null : c.sizeX * unitM) : thousandths(c.sizeX),
    gradientPercent: c.gradientPercent,
    azimuth: c.azimuth,
    flag: c.flag,
    sdM: c.sd === null ? null : c.sd * unitM,
  }
}
/** A culvert in metres as a file of `format` and `unitM` writes it. */
export function culvertFromMetres(m: CulvertMetres, format: CulvertFormat, unitM: number): SoftreeCulvert {
  const pipe = m.sizeXM === null
  const thousandths = (v: number | null) => (v === null ? null : (v / unitM) * 1000)
  const ipdY = (v: number | null) =>
    v === null ? null : pipe ? v / (Math.abs(unitM - 1) < 1e-12 ? 0.001 : 0.0254) : v / unitM
  return {
    sizeY: format === 'ipd' ? ipdY(m.sizeYM) : thousandths(m.sizeYM),
    sizeX: format === 'ipd' ? (m.sizeXM === null ? null : m.sizeXM / unitM) : thousandths(m.sizeXM),
    gradientPercent: m.gradientPercent,
    azimuth: m.azimuth,
    flag: m.flag,
    sd: m.sdM === null ? null : m.sdM / unitM,
  }
}
