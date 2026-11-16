/**
 * The survey field book's traverse files: which Softree format a file is, reading one into the field
 * book, and writing the field book back out. A thin layer over `softreeTraverse.ts`, which holds
 * every format rule; this module only picks the reader or writer and says which.
 *
 * - **Formats.** Softree ASCII (`.ASC`) and IPD, Polycorder Roads, unit survey (`.pol`), Laser
 *   Technology raw (`$PLTIT`, read only) and RoadEng's own traverse (`.tr1`, read only,
 *   `softreeNativeTraverse.ts`). The content decides the format
 *   ({@link detectTraverseFile}), never the file's name.
 * - **Units.** No format states its units (the raw format's unit letter aside), so the caller always
 *   passes `unitM`; a raw file whose own letter disagrees with it is read in the caller's unit and
 *   the notes say so. A `.tr1` that states its unit (`116`) is read in it (`fileUnitM`).
 * - **Start.** A file that gives no absolute start throws `SoftreeTraverseStartQuestion`; the caller
 *   asks and reads again with `start`.
 * - **The panel's text.** The field book is edited as two CSV texts (legs, side shots);
 *   {@link traverseLegsText} and {@link sideShotsText} write them as the panel reads them.
 * - **Details.** What a file holds beyond legs and side shots (labels, ground layers, culverts,
 *   HI/HT, side-shot depths, slopes beyond the last shot, located points) and the file as written
 *   are kept with the field book ({@link traverseFileDetails}); every writer writes the details its
 *   format has a field for and names the rest in its notes. Written back in the format and unit it
 *   was read in, an unedited field book gives the file's own bytes.
 *
 * Checked by `traverseFiles.test.ts`: detection of each format, field book → file → field book for
 * every writable format, and the kept details through every writer. Pure: no DOM or network access.
 */
import {
  isLaserRawSurvey,
  isPolycorderTraverse,
  isSoftreeAscTraverse,
  isUnitSurvey,
  laserRawAsUnitSurvey,
  parseLaserRawSurvey,
  parsePolycorderTraverse,
  parseSoftreeAscTraverse,
  parseUnitSurvey,
  polycorderToTraverse,
  softreeAscToTraverse,
  traverseToPolycorder,
  traverseToSoftreeAsc,
  traverseToUnitSurvey,
  unitSurveyToTraverse,
  writePolycorderTraverse,
  writeSoftreeAscTraverse,
  writeUnitSurvey,
  textLayout,
  type SoftreeTraverseDetails,
  type SoftreeTraverseImport,
  type StationEquation,
  type UnitSurveyDistance,
  type UnitSurveyVertical,
} from './softreeTraverse'
import { isNativeTraverse, nativeTraverseToFieldBook, parseNativeTraverse } from './softreeNativeTraverse'
import { MAX_SURVEY_SOFTREE_CHARS, type SurveyBookSoftree, type TraverseInput } from './surveyInterchange'

export type TraverseFileFormat = 'asc' | 'ipd' | 'polycorder' | 'unit-survey' | 'laser-raw' | 'tr1'
/**
 * The formats a field book is written in (the raw format is a field instrument's own; a `.tr1` goes
 * back as read with the RoadEng design that names it).
 */
export type WritableTraverseFormat = Exclude<TraverseFileFormat, 'laser-raw' | 'tr1'>

export const TRAVERSE_FILE_FORMATS: Record<TraverseFileFormat, { label: string; extension: string }> = {
  asc: { label: 'Softree ASCII traverse', extension: '.asc' },
  ipd: { label: 'Softree IPD traverse', extension: '.ipd' },
  polycorder: { label: 'Polycorder Roads traverse', extension: '.txt' },
  'unit-survey': { label: 'Unit survey', extension: '.pol' },
  'laser-raw': { label: 'Laser Technology raw survey', extension: '.raw' },
  tr1: { label: 'RoadEng traverse', extension: '.tr1' },
}
/** Decimals a Polycorder file is written with (the help's examples use one; a field book holds millimetres). */
export const POLYCORDER_EXPORT_DECIMALS = 3
/** Largest traverse file read, bytes. */
export const MAX_TRAVERSE_FILE_BYTES = 50_000_000

/** The format of a traverse file, from its content; null when it is none of them. */
export function detectTraverseFile(text: string): TraverseFileFormat | null {
  if (isLaserRawSurvey(text)) return 'laser-raw'
  if (isNativeTraverse(text)) return 'tr1'
  if (isSoftreeAscTraverse(text)) return parseSoftreeAscTraverse(text.slice(0, 16_000)).format
  if (isUnitSurvey(text)) return 'unit-survey'
  if (isPolycorderTraverse(text)) return 'polycorder'
  return null
}

/** Whether a format needs the vertical and distance kinds, which the file does not hold. */
export const needsShotKinds = (format: TraverseFileFormat) => format === 'unit-survey'

export interface TraverseFileReadOptions {
  /** Metres per file unit, as the person stated it. */
  unitM: number
  /** The first station's grid easting, northing and elevation, metres, when the file gives none. */
  start?: [number, number, number]
  /** Unit survey only. */
  vertical?: UnitSurveyVertical
  distance?: UnitSurveyDistance
}

/** A traverse file read into the field book; throws `SoftreeTraverseStartQuestion` when it needs a start. */
export function readTraverseFile(
  text: string,
  format: TraverseFileFormat,
  options: TraverseFileReadOptions,
): SoftreeTraverseImport & { format: TraverseFileFormat; fileUnitM?: number } {
  if (text.length > MAX_TRAVERSE_FILE_BYTES)
    throw Error(`The traverse file is over ${MAX_TRAVERSE_FILE_BYTES / 1e6} MB.`)
  const { unitM, start } = options
  if (!(unitM > 0 && Number.isFinite(unitM))) throw Error('Choose the unit the traverse was measured in.')
  const read = { unitM, ...(start ? { start } : {}) }
  let result: SoftreeTraverseImport
  if (format === 'tr1') return { ...nativeTraverseToFieldBook(parseNativeTraverse(text), { unitM }), format }
  if (format === 'asc' || format === 'ipd')
    result = softreeAscToTraverse(parseSoftreeAscTraverse(text, { format }), read)
  else if (format === 'polycorder') {
    const file = parsePolycorderTraverse(text)
    result = polycorderToTraverse(file.records, { ...read, layout: file.layout })
  } else if (format === 'unit-survey') {
    if (!options.vertical || !options.distance)
      throw Error('Choose what the vertical readings and the distances in the unit survey are.')
    result = unitSurveyToTraverse(parseUnitSurvey(text).records, {
      ...read,
      vertical: options.vertical,
      distance: options.distance,
      layout: textLayout(text),
    })
  } else {
    const raw = parseLaserRawSurvey(text)
    // The instrument writes inclinations and slope distances.
    result = unitSurveyToTraverse(laserRawAsUnitSurvey(raw.records), {
      ...read,
      vertical: 'inclination',
      distance: 'slope',
    })
    if (raw.unitM !== null && Math.abs(raw.unitM - unitM) > 1e-9)
      result = {
        ...result,
        notes: [
          ...result.notes,
          `The file's own unit letter says ${raw.unitM === 1 ? 'metres' : 'feet'}; it was read in the unit you chose.`,
        ],
      }
  }
  return { ...result, format }
}

export interface TraverseFileWriteOptions {
  unitM: number
  /** First station, metres. */
  startStation?: number
  equations?: readonly StationEquation[]
  /** The survey name a unit survey writes. */
  name?: string
  /** What the field book's traverse file held beyond legs and side shots ({@link traverseFileDetails}). */
  details?: SoftreeTraverseDetails
}

/**
 * The details a field book keeps from the traverse file it was read from. The file as written is
 * kept when it fits a field book's limit; without it the writers still carry every detail but write
 * the records afresh, and `notes` says so.
 */
export function traverseFileDetails(
  read: SoftreeTraverseImport & { format: TraverseFileFormat; fileUnitM?: number },
  unitM: number,
): { details: SurveyBookSoftree; notes: string[] } {
  const details: SurveyBookSoftree = {
    // A `.tr1`'s CREEK and ground-layer fields follow the ASCII format's conventions.
    sourceFormat: read.format === 'tr1' ? 'asc' : read.format,
    unitM: read.fileUnitM ?? unitM,
    extras: read.extras,
    points: read.points,
    ...(read.source ? { source: read.source } : {}),
  }
  if (JSON.stringify(details).length <= MAX_SURVEY_SOFTREE_CHARS) return { details, notes: [] }
  const { source: _dropped, ...rest } = details
  void _dropped
  return {
    details: rest,
    notes: [
      `The file is too large to keep as written in the project (over ${(MAX_SURVEY_SOFTREE_CHARS / 1e6).toLocaleString('en-CA')} million characters): its details are kept, and a traverse file written from it is written afresh.`,
    ],
  }
}

/** The field book written in a traverse format; notes say what the format cannot carry. */
export function writeTraverseFile(
  input: TraverseInput,
  format: WritableTraverseFormat,
  options: TraverseFileWriteOptions,
): { text: string; notes: string[]; extension: string } {
  const { unitM, details } = options
  const common = {
    unitM,
    startStation: options.startStation ?? 0,
    equations: options.equations ?? [],
    ...(details ? { details } : {}),
  }
  const extension = TRAVERSE_FILE_FORMATS[format].extension
  if (format === 'asc' || format === 'ipd') {
    const { traverse, notes } = traverseToSoftreeAsc(input, { ...common, format })
    return { text: writeSoftreeAscTraverse(traverse), notes, extension }
  }
  if (format === 'polycorder') {
    const { records, layout, notes } = traverseToPolycorder(input, common)
    // The help's rows carry one decimal; three keep a field book's millimetres. Fields read from a
    // file keep their own while unchanged.
    return {
      text: writePolycorderTraverse(records, { decimals: POLYCORDER_EXPORT_DECIMALS, ...(layout ? { layout } : {}) }),
      notes,
      extension,
    }
  }
  const { records, layout, notes } = traverseToUnitSurvey(input, {
    unitM,
    survey: options.name,
    ...(details ? { details } : {}),
  })
  if (options.startStation || options.equations?.length)
    notes.push('A unit survey has no stations, so the start station and station equations were not written.')
  return { text: writeUnitSurvey(records, layout ? { layout } : {}), notes, extension }
}

/** The field book's legs as the panel's traverse CSV. */
export function traverseLegsText(input: Pick<TraverseInput, 'legs'>): string {
  return (
    'station,bearing_deg,horizontal_m,grade_pct\n' +
    input.legs.map((l) => [l.id, l.bearingDegrees, l.horizontalDistanceM, l.gradePercent].join(',')).join('\n')
  )
}

/** The field book's side shots as the panel's side-shot CSV. */
export function sideShotsText(input: Pick<TraverseInput, 'sideShots'>): string {
  return (input.sideShots ?? []).map((s) => [s.id, s.station, s.offsetM, s.heightDifferenceM].join(',')).join('\n')
}
