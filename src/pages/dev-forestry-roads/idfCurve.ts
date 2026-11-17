/**
 * A rainfall intensity-duration-frequency (IDF) curve for one station and one return period, and
 * the intensity it gives at a duration (the drainage check reads it at each culvert's time of
 * concentration, see `timeOfConcentration.ts`).
 *
 * Source: Environment and Climate Change Canada's Engineering Climate Datasets, short-duration
 * rainfall IDF files (Open Government Licence – Canada). The data are the user's file, entered or
 * imported; nothing is bundled. ECCC publishes, per station, return-period rainfall rates (mm/h)
 * at 5, 10, 15, 30 and 60 minutes and 2, 6, 12 and 24 hours for 2, 5, 10, 25, 50 and 100 years
 * (Table 2b), and a fitted "interpolation equation" R = A·T^B with R in mm/h and T the duration in
 * hours (Table 3), per ECCC's "Notes on EC IDF" and the station files themselves.
 *
 * Between table durations the intensity is read linearly in log(intensity) against
 * log(duration): IDF curves plot near straight on log–log axes, which is why ECCC fits a power
 * law. Outside the curve's durations nothing is extrapolated: the nearest end is used and
 * flagged.
 *
 * Parsed by hand, no schema library. Pure: no DOM or network access.
 */

export interface IdfPoint {
  durationMin: number
  intensityMmPerHr: number
}
/** ECCC's interpolation equation: i (mm/h) = A · T^B with T the duration in hours. */
export interface IdfEquation {
  coefficientA: number
  exponentB: number
}
export interface IdfCurve {
  stationName: string
  /** ECCC climate station identifier, e.g. 1096450. */
  stationId?: string
  province?: string
  returnPeriodYears: number
  /** Where the numbers came from: the ECCC file name and release, or "Entered by hand". */
  source: string
  /** Which form the intensity is read from. */
  use: 'table' | 'equation'
  table?: IdfPoint[]
  equation?: IdfEquation
}

/** ECCC's shortest and longest published durations, minutes; its equation is fitted over these. */
export const ECCC_SHORTEST_DURATION_MIN = 5
export const ECCC_LONGEST_DURATION_MIN = 1440
/** ECCC's standard durations, minutes. */
export const ECCC_DURATIONS_MIN = [5, 10, 15, 30, 60, 120, 360, 720, 1440] as const
export const MAX_IDF_POINTS = 24
/** An imported IDF text file larger than this is refused (ECCC's are about 10 kB). */
export const MAX_IDF_FILE_BYTES = 1_000_000

/** The intensity was read at the curve's shortest or longest duration, not at the asked one. */
export type IdfFlag = 'below-idf' | 'above-idf'
export interface IdfReading {
  intensityMmPerHr: number
  /** The duration the curve was read at: the asked one, or the end of the curve it was held to. */
  readAtMin: number
  flag?: IdfFlag
}

/** Linear in log–log between the two table points either side of `durationMin`; held at the ends. */
export function logLogInterpolate(points: readonly IdfPoint[], durationMin: number): IdfReading {
  if (points.length < 1) throw Error('The IDF table has no points.')
  const first = points[0],
    last = points[points.length - 1]
  if (durationMin <= first.durationMin)
    return {
      intensityMmPerHr: first.intensityMmPerHr,
      readAtMin: first.durationMin,
      ...(durationMin < first.durationMin ? { flag: 'below-idf' as const } : {}),
    }
  if (durationMin >= last.durationMin)
    return {
      intensityMmPerHr: last.intensityMmPerHr,
      readAtMin: last.durationMin,
      ...(durationMin > last.durationMin ? { flag: 'above-idf' as const } : {}),
    }
  let k = 1
  while (points[k].durationMin < durationMin) k++
  const a = points[k - 1],
    b = points[k]
  const f = Math.log(durationMin / a.durationMin) / Math.log(b.durationMin / a.durationMin)
  return {
    intensityMmPerHr: Math.exp(
      Math.log(a.intensityMmPerHr) + f * (Math.log(b.intensityMmPerHr) - Math.log(a.intensityMmPerHr)),
    ),
    readAtMin: durationMin,
  }
}

/** ECCC's R = A·T^B (T hours), held to the 5 min – 24 h range it was fitted over. */
export function equationIntensity(equation: IdfEquation, durationMin: number): IdfReading {
  const readAtMin = Math.min(ECCC_LONGEST_DURATION_MIN, Math.max(ECCC_SHORTEST_DURATION_MIN, durationMin))
  const flag: IdfFlag | undefined =
    durationMin < ECCC_SHORTEST_DURATION_MIN
      ? 'below-idf'
      : durationMin > ECCC_LONGEST_DURATION_MIN
        ? 'above-idf'
        : undefined
  return {
    intensityMmPerHr: equation.coefficientA * (readAtMin / 60) ** equation.exponentB,
    readAtMin,
    ...(flag ? { flag } : {}),
  }
}

/** The curve's intensity at `durationMin`, from the form it says to use. */
export function idfIntensity(curve: IdfCurve, durationMin: number): IdfReading {
  if (!(durationMin > 0)) throw Error('An IDF duration must be greater than zero.')
  if (curve.use === 'equation') {
    if (!curve.equation) throw Error('The IDF curve has no equation.')
    return equationIntensity(curve.equation, durationMin)
  }
  if (!curve.table?.length) throw Error('The IDF curve has no table.')
  return logLogInterpolate(curve.table, durationMin)
}

/** "PRINCE GEORGE A (1096450), 10-year, table; source" — the line every figure prints beside Tc. */
export function idfLabel(curve: IdfCurve): string {
  const station = curve.stationId ? `${curve.stationName} (${curve.stationId})` : curve.stationName
  const form =
    curve.use === 'equation' && curve.equation
      ? `i = ${curve.equation.coefficientA}·T^${curve.equation.exponentB} (T h)`
      : 'table, log–log between durations'
  return `${station}, ${curve.returnPeriodYears}-year, ${form}; ${curve.source}`
}

// ---- Parsing (by hand) --------------------------------------------------------------------

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(`${label} must be an object.`)
  return value as Record<string, unknown>
}
function finite(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw Error(`${label} must be between ${min} and ${max}.`)
  return value
}
function words(value: unknown, max: number, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw Error(`${label} is missing or too long.`)
  return value
}

/** Checks an IDF table: 2 to `MAX_IDF_POINTS` points, durations rising, intensities positive. */
export function parseIdfTable(value: unknown): IdfPoint[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > MAX_IDF_POINTS)
    throw Error(`An IDF table needs 2 to ${MAX_IDF_POINTS} durations.`)
  const points = value.map((entry) => {
    const p = record(entry, 'IDF point')
    return {
      durationMin: finite(p.durationMin, 1, 10_080, 'IDF duration (min)'),
      intensityMmPerHr: finite(p.intensityMmPerHr, 0.01, 2_000, 'IDF intensity (mm/h)'),
    }
  })
  for (let k = 1; k < points.length; k++)
    if (!(points[k].durationMin > points[k - 1].durationMin)) throw Error('IDF table durations must rise.')
  return points
}

export function parseIdfCurve(value: unknown): IdfCurve {
  const r = record(value, 'IDF curve')
  if (r.use !== 'table' && r.use !== 'equation') throw Error('Choose the IDF table or equation.')
  const table = r.table === undefined ? undefined : parseIdfTable(r.table)
  let equation: IdfEquation | undefined
  if (r.equation !== undefined) {
    const e = record(r.equation, 'IDF equation')
    equation = {
      coefficientA: finite(e.coefficientA, 0.001, 100_000, 'IDF coefficient A'),
      exponentB: finite(e.exponentB, -2, 0, 'IDF exponent B'),
    }
  }
  if (r.use === 'table' && !table) throw Error('The IDF curve uses its table but has none.')
  if (r.use === 'equation' && !equation) throw Error('The IDF curve uses its equation but has none.')
  return {
    stationName: words(r.stationName, 200, 'IDF station name'),
    ...(r.stationId === undefined ? {} : { stationId: words(r.stationId, 40, 'IDF station ID') }),
    ...(r.province === undefined ? {} : { province: words(r.province, 10, 'IDF province') }),
    returnPeriodYears: finite(r.returnPeriodYears, 1, 1_000, 'IDF return period (years)'),
    source: words(r.source, 500, 'IDF source'),
    use: r.use,
    ...(table ? { table } : {}),
    ...(equation ? { equation } : {}),
  }
}

// ---- ECCC station file --------------------------------------------------------------------

export interface EcccIdfStation {
  stationName: string
  stationId?: string
  province?: string
  /** The date line of the file (YYYY/MM/DD), when present. */
  producedOn?: string
  /** Release, from a file name such as `idf_v3-30_2022_10_31_…`. */
  version?: string
  returnPeriodsYears: number[]
  /** Table 2b: rate (mm/h) per return period, null where ECCC has fewer than 10 years (−99.9). */
  rates: { durationMin: number; mmPerHr: (number | null)[] }[]
  /** Table 3: A and B per return period, when the file states T in hours. */
  equations?: IdfEquation[]
}

const NUMBER = /^[-+]?\d+(?:\.\d+)?$/
const numbersIn = (text: string) =>
  text
    .trim()
    .split(/\s+/)
    .filter((t) => NUMBER.test(t))
    .map(Number)

/**
 * Reads one station's ECCC short-duration IDF text file (`idf_v…_<prov>_<id>_<name>.txt`):
 * the station line, Table 2b's rates and Table 3's equation. Refuses a file without Table 2b.
 */
export function parseEcccIdfText(text: string, fileName = ''): EcccIdfStation {
  if (text.length > MAX_IDF_FILE_BYTES) throw Error('The IDF file is larger than 1 MB; choose one station’s file.')
  const lines = text.split(/\r?\n/)
  // The station line is the first one after the first rule of '='.
  let stationName = '',
    stationId: string | undefined,
    province: string | undefined
  const rule = lines.findIndex((l) => /^\s*={10,}\s*$/.test(l))
  if (rule >= 0) {
    const line =
      lines
        .slice(rule + 1)
        .find((l) => l.trim() && !/^\s*={10,}/.test(l))
        ?.trim() ?? ''
    const tokens = line.split(/\s+/)
    if (
      tokens.length >= 3 &&
      /^[0-9A-Z]{7}$/.test(tokens[tokens.length - 1]) &&
      /^[A-Z]{2}$/.test(tokens[tokens.length - 2])
    ) {
      stationId = tokens[tokens.length - 1]
      province = tokens[tokens.length - 2]
      stationName = tokens.slice(0, -2).join(' ')
    } else stationName = line
  }
  const producedOn = lines.map((l) => l.trim()).find((l) => /^\d{4}\/\d{2}\/\d{2}$/.test(l))

  const table2b = lines.findIndex((l) => /Table\s*2b/i.test(l))
  if (table2b < 0) throw Error('Not an ECCC IDF station file: Table 2b (rainfall rates, mm/h) was not found.')
  const header = lines.findIndex((l, k) => k > table2b && /^\s*Duration\s*\/\s*Dur/i.test(l))
  if (header < 0) throw Error('The IDF file’s Table 2b has no Duration header.')
  const returnPeriodsYears = numbersIn(lines[header].replace(/^\s*Duration\s*\/\s*Dur\S*/i, '').split('#')[0])
  if (!returnPeriodsYears.length || returnPeriodsYears.some((t) => !(t >= 1 && t <= 1_000)))
    throw Error('The IDF file’s Table 2b header lists no return periods.')
  const table3 = lines.findIndex((l, k) => k > header && /Table\s*3/i.test(l))
  const rates: EcccIdfStation['rates'] = []
  for (let k = header + 1; k < (table3 < 0 ? lines.length : table3); k++) {
    const m = /^\s*(\d+(?:\.\d+)?)\s*(min|h)\s+(.*)$/i.exec(lines[k])
    if (!m) continue
    const values = numbersIn(m[3])
    if (values.length < returnPeriodsYears.length) continue
    rates.push({
      durationMin: Number(m[1]) * (m[2].toLowerCase() === 'h' ? 60 : 1),
      mmPerHr: values.slice(0, returnPeriodsYears.length).map((v) => (v > 0 ? v : null)),
    })
  }
  rates.sort((a, b) => a.durationMin - b.durationMin)
  if (rates.length < 2) throw Error('The IDF file’s Table 2b has fewer than two durations.')

  let equations: IdfEquation[] | undefined
  if (table3 >= 0) {
    const rest = lines.slice(table3)
    // Take the equation only when the file states T in hours, as ECCC's does.
    const hours = rest.some((l) => /T\s*=\s*Rainfall duration\s*\(h\)/i.test(l))
    const a = rest.find((l) => /^\s*Coefficient\s*\(A\)/i.test(l)),
      b = rest.find((l) => /^\s*Exponent\S*\s*\(B\)/i.test(l))
    if (hours && a && b) {
      const as = numbersIn(a.replace(/^\s*Coefficient\s*\(A\)/i, '')),
        bs = numbersIn(b.replace(/^\s*Exponent\S*\s*\(B\)/i, ''))
      if (as.length === returnPeriodsYears.length && bs.length === returnPeriodsYears.length)
        equations = as.map((coefficientA, k) => ({ coefficientA, exponentB: bs[k] }))
    }
  }
  const version = /idf_v-?(\d+)[.-](\d+)/i.exec(fileName)
  return {
    stationName: stationName || fileName || 'ECCC station',
    ...(stationId ? { stationId } : {}),
    ...(province ? { province } : {}),
    ...(producedOn ? { producedOn } : {}),
    ...(version ? { version: `${version[1]}.${version[2]}` } : {}),
    returnPeriodsYears,
    rates,
    ...(equations ? { equations } : {}),
  }
}

/** One return period of an imported station file, as the curve the drainage check reads. */
export function idfCurveFromEccc(station: EcccIdfStation, returnPeriodYears: number, fileName: string): IdfCurve {
  const column = station.returnPeriodsYears.indexOf(returnPeriodYears)
  if (column < 0) throw Error(`The IDF file has no ${returnPeriodYears}-year column.`)
  const table = station.rates
    .filter((r) => r.mmPerHr[column] !== null)
    .map((r) => ({ durationMin: r.durationMin, intensityMmPerHr: r.mmPerHr[column]! }))
  if (table.length < 2) throw Error(`The IDF file has fewer than two ${returnPeriodYears}-year rates.`)
  const equation = station.equations?.[column]
  const release = [station.version && `v${station.version}`, station.producedOn].filter(Boolean).join(', ')
  return parseIdfCurve({
    stationName: station.stationName,
    ...(station.stationId ? { stationId: station.stationId } : {}),
    ...(station.province ? { province: station.province } : {}),
    returnPeriodYears,
    source:
      `ECCC Engineering Climate Datasets IDF${release ? ` (${release})` : ''}, Table 2b${equation ? ' and 3' : ''}: ${fileName || 'station file'}`.slice(
        0,
        500,
      ),
    use: 'table',
    table: table.slice(0, MAX_IDF_POINTS),
    ...(equation ? { equation } : {}),
  })
}
