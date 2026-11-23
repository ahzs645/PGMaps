/**
 * A view of interest placed by typed coordinates (backlog VQ-12): a historical VIA's station, a surveyed point or a
 * GPS reading, entered as latitude and longitude (decimal degrees, or degrees, minutes and seconds) or as UTM easting
 * and northing in one of BC's zones (7 to 11, northern hemisphere). A plan click lands metres from a recorded
 * station; a typed point lands where it says.
 *
 * What is kept is the text as typed, the system and datum it was given in, its zone, and the precision its digits
 * state (half the last digit given, in metres: "53.9123" is good to about ±6 m, an easting to the metre ±0.5 m). That
 * is precision, not accuracy: it says what the number can resolve, not how well it was measured.
 *
 * NAD83 and WGS84 are taken as the same: no datum shift is applied (`DATUM_ASSUMPTION`). The two can differ by a metre
 * or so in BC today; PGMaps states that rather than apply a transformation it does not have the parameters for.
 *
 * Pure: no DOM or network access (proj4 is pure).
 */
import proj4 from 'proj4'

import { haversineMeters } from './visibility'

/** BC lies in UTM zones 7 to 11, all in the northern hemisphere. */
export const BC_UTM_ZONES = [7, 8, 9, 10, 11] as const
export type BcUtmZone = (typeof BC_UTM_ZONES)[number]

export type CoordinateSystem = 'latlon' | 'utm'
export type CoordinateDatum = 'NAD83' | 'WGS84'

/** What the page says about the datum, wherever a typed point is shown or written. */
export const DATUM_ASSUMPTION =
  'NAD83 and WGS84 are taken as the same: no datum shift is applied. In BC today they can differ by about a metre, which is not corrected.'

/** A typed place still holds while the view stands within this of where it put it; a drag on the plan ends it. */
export const PLACE_ENTRY_MATCH_METERS = 0.05

/** How long the text as typed may be. */
const MAX_TEXT = 120

/** Metres along a meridian per degree of latitude (mean), for the precision of a typed digit. */
const METRES_PER_DEGREE = 111_320

/** BC's extent, west, south, east, north: a point outside it is accepted with a warning. */
const BC_BOUNDS = [-139.1, 48.2, -114.0, 60.0] as const

/** A view's typed place, as kept on the view (`ViewOfInterest.place`). */
export type ViewPlaceEntry = {
  /** The text as typed: "53.91234, -122.71234", or for UTM "10 512345.6 5973210.4" (zone, easting, northing). */
  text: string
  system: CoordinateSystem
  datum: CoordinateDatum
  /** The UTM zone the easting and northing were given in. */
  zone?: number
  /** Half the last digit given, metres (the larger of the two axes). */
  precisionMeters: number
  /** Where it resolved, WGS84 degrees: the view's place when the entry was applied. */
  lng: number
  lat: number
}

export type ParsedPlace =
  | {
      ok: true
      lng: number
      lat: number
      precisionMeters: number
      /** Accepted, but worth a look: outside BC, outside the zone's own band. */
      warnings: string[]
    }
  | { ok: false; error: string }

const fail = (error: string): ParsedPlace => ({ ok: false, error })

/** The decimals a number was written with: "512345.60" has 2. */
function decimalsOf(text: string): number {
  const match = /\.(\d+)$/.exec(text.trim())
  return match ? match[1].length : 0
}

/** Half a unit of the last digit given: 2 decimals of 1 → 0.005. */
const halfLastDigit = (decimals: number) => 0.5 * 10 ** -decimals

type Part = { value: number; hemisphere: 'N' | 'S' | 'E' | 'W' | null; precisionDegrees: number }

/**
 * One coordinate: decimal degrees ("-122.71234", "122.71234W"), degrees and decimal minutes ("122 42.74 W") or
 * degrees, minutes and seconds ("122°42'44.4\"W"). A hemisphere letter may lead or trail.
 */
function parsePart(raw: string): Part | string {
  let text = raw.trim()
  let hemisphere: Part['hemisphere'] = null
  const lead = /^([NSEW])\s*/.exec(text)
  const trail = /\s*([NSEW])$/.exec(text)
  if (lead) {
    hemisphere = lead[1] as Part['hemisphere']
    text = text.slice(lead[0].length)
  } else if (trail) {
    hemisphere = trail[1] as Part['hemisphere']
    text = text.slice(0, text.length - trail[0].length)
  }
  if (/[NSEW]/.test(text)) return `“${raw.trim()}” has a hemisphere letter in the middle.`
  if (!text) return 'A coordinate is missing its number.'
  // Degrees, minutes and seconds are separated by symbols or spaces; nothing else may be there.
  if (/[^0-9.\-+°'"\s]/.test(text)) return `“${raw.trim()}” is not a coordinate.`
  const numbers = text.match(/[-+]?\d+(?:\.\d+)?/g) ?? []
  const leftover = text.replace(/[-+]?\d+(?:\.\d+)?/g, '').replace(/[°'"\s]/g, '')
  if (leftover || !numbers.length || numbers.length > 3) return `“${raw.trim()}” is not a coordinate.`
  const [degreesText = '', minutesText, secondsText] = numbers
  const negative = degreesText.startsWith('-')
  const degrees = Math.abs(Number(degreesText))
  const minutes = minutesText !== undefined ? Number(minutesText) : 0
  const seconds = secondsText !== undefined ? Number(secondsText) : 0
  if (numbers.slice(1).some((n) => /^[-+]/.test(n))) return 'Only the degrees may carry a sign.'
  // A decimal in any but the last part ("53.5 30") says two different things.
  if (numbers.slice(0, -1).some((n) => n.includes('.'))) return `“${raw.trim()}”: only the last part may have decimals.`
  if (minutes >= 60 || seconds >= 60) return `“${raw.trim()}”: minutes and seconds run below 60.`
  if (negative && (hemisphere === 'S' || hemisphere === 'W'))
    return `“${raw.trim()}” is both negative and ${hemisphere}: give one or the other.`
  const last = numbers[numbers.length - 1]
  const unit = numbers.length === 1 ? 1 : numbers.length === 2 ? 1 / 60 : 1 / 3600
  const magnitude = degrees + minutes / 60 + seconds / 3600
  const sign = negative || hemisphere === 'S' || hemisphere === 'W' ? -1 : 1
  return { value: sign * magnitude, hemisphere, precisionDegrees: halfLastDigit(decimalsOf(last)) * unit }
}

/** Splits "lat, lon" (or "N.. W..", or "d m s d m s") into its two coordinates. */
function splitPair(text: string): [string, string] | null {
  const commaParts = text.split(/\s*[,;]\s*/).filter(Boolean)
  if (commaParts.length === 2) return [commaParts[0], commaParts[1]]
  if (commaParts.length > 2) return null
  // A trailing hemisphere letter ends the first coordinate: "53 54 44.4 N 122 42 44.4 W".
  const trailing = /^(.*?[NS])\s+(.+)$/.exec(text)
  if (trailing && /\d/.test(trailing[1]) && /\d/.test(trailing[2])) return [trailing[1], trailing[2]]
  // A leading hemisphere letter starts the second: "N53.9 W122.7".
  const leading = /^([NS].*?)\s+([EW].+)$/.exec(text)
  if (leading) return [leading[1], leading[2]]
  const tokens = text.split(/\s+/).filter(Boolean)
  if (tokens.length === 2 || tokens.length === 4 || tokens.length === 6) {
    const half = tokens.length / 2
    return [tokens.slice(0, half).join(' '), tokens.slice(half).join(' ')]
  }
  return null
}

/** Normalises the many ways a degree, minute and second are typed. */
function normalise(text: string): string {
  return text
    .toUpperCase()
    .replace(/[º˚]/g, '°')
    .replace(/[′’‘`´]/g, "'")
    .replace(/[″”“]|''/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Reads latitude and longitude, latitude first (unless hemisphere letters say otherwise): decimal degrees, degrees
 * and decimal minutes, or degrees, minutes and seconds, separated by a comma, or by hemisphere letters or spaces. A
 * longitude east of Greenwich is refused rather than turned round: BC lies west, and a dropped minus sign is far more
 * likely than a view in Asia.
 */
export function parseLatLon(input: string): ParsedPlace {
  const text = normalise(input)
  if (!text) return fail('Type a latitude and a longitude, latitude first: 53.91234, -122.71234.')
  if (text.length > MAX_TEXT) return fail('That is longer than any coordinate pair.')
  const pair = splitPair(text)
  if (!pair) return fail('Give two coordinates, latitude first, separated by a comma: 53.91234, -122.71234.')
  const first = parsePart(pair[0])
  const second = parsePart(pair[1])
  if (typeof first === 'string') return fail(first)
  if (typeof second === 'string') return fail(second)
  const isLat = (part: Part) => part.hemisphere === 'N' || part.hemisphere === 'S'
  const isLon = (part: Part) => part.hemisphere === 'E' || part.hemisphere === 'W'
  if ((isLat(first) && isLat(second)) || (isLon(first) && isLon(second)))
    return fail('Both coordinates name the same axis: give one latitude (N or S) and one longitude (E or W).')
  const [lat, lon] = isLon(first) || isLat(second) ? [second, first] : [first, second]
  if (Math.abs(lat.value) > 90) {
    return fail(
      Math.abs(lon.value) <= 90
        ? `Latitude ${lat.value} is past the pole: give the latitude first (or mark them N and W).`
        : `Latitude ${lat.value} is past the pole.`,
    )
  }
  if (Math.abs(lon.value) > 180) return fail(`Longitude ${lon.value} is past 180°.`)
  if (lat.value < 0) return fail(`Latitude ${lat.value} is south of the equator: BC lies north.`)
  if (lon.value > 0 && lon.hemisphere !== 'E')
    return fail(`Longitude ${lon.value} is east of Greenwich, and BC lies west: write -${lon.value} or ${lon.value} W.`)
  const precisionMeters = Math.max(
    lat.precisionDegrees * METRES_PER_DEGREE,
    lon.precisionDegrees * METRES_PER_DEGREE * Math.cos((lat.value * Math.PI) / 180),
  )
  return { ok: true, lng: lon.value, lat: lat.value, precisionMeters, warnings: placeWarnings(lon.value, lat.value) }
}

/** A typed easting or northing: digits, an optional decimal part, thousands separated by spaces or commas. */
function parseMetres(input: string, what: string): { value: number; decimals: number } | string {
  const text = input.trim().replace(/[\s,_]/g, '')
  if (!text) return `Type the ${what} in metres.`
  if (!/^\d+(?:\.\d+)?$/.test(text)) return `The ${what} “${input.trim()}” is not a number of metres.`
  return { value: Number(text), decimals: decimalsOf(text) }
}

/** The proj4 definition of a UTM zone in the northern hemisphere. Both datums are the same ellipsoid with no shift. */
function utmDefinition(zone: number, datum: CoordinateDatum): string {
  return `+proj=utm +zone=${zone} +datum=${datum === 'NAD83' ? 'NAD83' : 'WGS84'} +units=m +no_defs`
}

/** The zone a longitude falls in by its 6° band. */
export function naturalUtmZone(lng: number): number {
  return Math.max(1, Math.min(60, Math.floor((lng + 180) / 6) + 1))
}

/** UTM easting and northing in `zone` (northern hemisphere) to WGS84 degrees. */
export function utmToLngLat(
  zone: number,
  easting: number,
  northing: number,
  datum: CoordinateDatum = 'NAD83',
): { lng: number; lat: number } {
  const [lng, lat] = proj4(utmDefinition(zone, datum), 'EPSG:4326', [easting, northing])
  return { lng, lat }
}

/** WGS84 degrees to UTM easting and northing in `zone` (its own band's when absent). */
export function lngLatToUtm(
  lng: number,
  lat: number,
  zone: number = naturalUtmZone(lng),
  datum: CoordinateDatum = 'NAD83',
): { zone: number; easting: number; northing: number } {
  const [easting, northing] = proj4('EPSG:4326', utmDefinition(zone, datum), [lng, lat])
  return { zone, easting, northing }
}

/**
 * Reads a UTM easting and northing in one of BC's zones. The zone is checked against BC's five, the numbers against
 * what a northern-hemisphere UTM coordinate in BC can be (and a swapped pair is named as such), and the point against
 * its zone's own 6° band: a point well outside the band is usually a wrong zone, so it is accepted with a warning.
 */
export function parseUtm(input: { zone: number; easting: string; northing: string }): ParsedPlace {
  const { zone } = input
  if (!(BC_UTM_ZONES as readonly number[]).includes(zone))
    return fail(`Zone ${zone} is not one of BC's: BC lies in UTM zones 7 to 11.`)
  const easting = parseMetres(input.easting, 'easting')
  const northing = parseMetres(input.northing, 'northing')
  if (typeof easting === 'string') return fail(easting)
  if (typeof northing === 'string') return fail(northing)
  const looksNorthing = (value: number) => value >= 5_000_000 && value <= 7_000_000
  const looksEasting = (value: number) => value >= 100_000 && value <= 900_000
  if (looksNorthing(easting.value) && looksEasting(northing.value))
    return fail('The easting and northing look swapped: the easting has six digits, the northing seven.')
  if (!looksEasting(easting.value))
    return fail(`An easting runs from 100,000 to 900,000 m; ${easting.value.toLocaleString('en-CA')} is outside it.`)
  if (northing.value < 5_300_000 || northing.value > 6_700_000)
    return fail(
      `A northing in BC runs from about 5,300,000 to 6,700,000 m; ${northing.value.toLocaleString('en-CA')} is outside it.`,
    )
  const { lng, lat } = utmToLngLat(zone, easting.value, northing.value)
  if (![lng, lat].every(Number.isFinite)) return fail('That point cannot be placed.')
  const warnings = placeWarnings(lng, lat)
  const west = -180 + (zone - 1) * 6
  const outside = lng < west ? west - lng : lng > west + 6 ? lng - (west + 6) : 0
  if (outside > 0.5)
    warnings.unshift(
      `It lies ${outside.toFixed(1)}° outside zone ${zone}'s band, in zone ${naturalUtmZone(lng)}: check the zone.`,
    )
  return {
    ok: true,
    lng,
    lat,
    precisionMeters: Math.max(halfLastDigit(easting.decimals), halfLastDigit(northing.decimals)),
    warnings,
  }
}

function placeWarnings(lng: number, lat: number): string[] {
  const [west, south, east, north] = BC_BOUNDS
  return lng < west || lng > east || lat < south || lat > north ? ['It lies outside British Columbia.'] : []
}

/** The EPSG code of a typed place's system: the plain NAD83 or WGS84 codes (no realisation is claimed). */
export function placeEpsg(entry: Pick<ViewPlaceEntry, 'system' | 'datum' | 'zone'>): number {
  if (entry.system === 'latlon') return entry.datum === 'NAD83' ? 4269 : 4326
  return (entry.datum === 'NAD83' ? 26900 : 32600) + (entry.zone ?? 10)
}

/** "NAD83 / UTM zone 10N (EPSG:26910)", "WGS84 latitude and longitude (EPSG:4326)". */
export function placeCrsLabel(entry: Pick<ViewPlaceEntry, 'system' | 'datum' | 'zone'>): string {
  const name =
    entry.system === 'utm' ? `${entry.datum} / UTM zone ${entry.zone}N` : `${entry.datum} latitude and longitude`
  return `${name} (EPSG:${placeEpsg(entry)})`
}

/** "±0.5 m", "±6 m": the precision as a reviewer reads it. */
export function precisionLabel(metres: number): string {
  if (!Number.isFinite(metres)) return '±?'
  if (metres < 0.05) return '±0.05 m or better'
  if (metres < 1) return `±${metres.toFixed(metres < 0.1 ? 2 : 1)} m`
  if (metres < 10) return `±${metres.toFixed(1).replace(/\.0$/, '')} m`
  return `±${Math.round(metres).toLocaleString('en-CA')} m`
}

/** "53.912340° N, 122.712340° W". */
export function formatDecimalDegrees(lng: number, lat: number, decimals = 6): string {
  const one = (value: number, positive: string, negative: string) =>
    `${Math.abs(value).toFixed(decimals)}° ${value < 0 ? negative : positive}`
  return `${one(lat, 'N', 'S')}, ${one(lng, 'E', 'W')}`
}

/** "53°54'44.42\" N, 122°42'44.42\" W" (ASCII marks, so it prints in every export). */
export function formatDms(lng: number, lat: number, secondDecimals = 2): string {
  const one = (value: number, positive: string, negative: string) => {
    const scale = 10 ** secondDecimals
    // Rounded in whole units of the last second digit, so 59.999″ carries into the next minute.
    const total = Math.round(Math.abs(value) * 3600 * scale)
    const degrees = Math.floor(total / (3600 * scale))
    const minutes = Math.floor((total - degrees * 3600 * scale) / (60 * scale))
    const seconds = (total - degrees * 3600 * scale - minutes * 60 * scale) / scale
    return `${degrees}°${String(minutes).padStart(2, '0')}'${seconds.toFixed(secondDecimals).padStart(secondDecimals ? secondDecimals + 3 : 2, '0')}" ${value < 0 ? negative : positive}`
  }
  return `${one(lat, 'N', 'S')}, ${one(lng, 'E', 'W')}`
}

/** "UTM 10N 512,345.6 E 5,973,210.4 N", in `zone` or the point's own. */
export function formatUtm(lng: number, lat: number, zone?: number, decimals = 1): string {
  const utm = lngLatToUtm(lng, lat, zone)
  const metres = (value: number) =>
    value.toLocaleString('en-CA', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  return `UTM ${utm.zone}N ${metres(utm.easting)} E ${metres(utm.northing)} N`
}

/** What a typed entry is asked to read: the text for lat/lon, the zone and two numbers for UTM. */
export type PlaceInput =
  | { system: 'latlon'; datum: CoordinateDatum; text: string }
  | { system: 'utm'; datum: CoordinateDatum; zone: number; easting: string; northing: string }

/** Reads a typed entry, and the record a view keeps of it once applied (null while it does not read). */
export function readPlaceInput(input: PlaceInput): { parsed: ParsedPlace; entry: ViewPlaceEntry | null } {
  const parsed = input.system === 'latlon' ? parseLatLon(input.text) : parseUtm(input)
  if (!parsed.ok) return { parsed, entry: null }
  const text =
    input.system === 'latlon'
      ? input.text.trim().replace(/\s+/g, ' ')
      : `${input.zone} ${input.easting.trim()} ${input.northing.trim()}`
  return {
    parsed,
    entry: {
      text: text.slice(0, MAX_TEXT),
      system: input.system,
      datum: input.datum,
      ...(input.system === 'utm' ? { zone: input.zone } : {}),
      precisionMeters: parsed.precisionMeters,
      lng: parsed.lng,
      lat: parsed.lat,
    },
  }
}

/** The input an entry was made from, to edit it again. */
export function placeInputOf(entry: ViewPlaceEntry): PlaceInput {
  if (entry.system === 'latlon') return { system: 'latlon', datum: entry.datum, text: entry.text }
  const [, easting = '', northing = ''] = entry.text.split(' ')
  return { system: 'utm', datum: entry.datum, zone: entry.zone ?? 10, easting, northing }
}

/**
 * The view's typed place while it still stands there; null when it was never typed or has moved since (a drag on the
 * plan, a re-accepted photo): the text then describes another point, and nothing prints it.
 */
export function placeEntryOf(view: { lng: number; lat: number; place?: ViewPlaceEntry | null }): ViewPlaceEntry | null {
  const entry = view.place
  if (!entry) return null
  return haversineMeters(view, entry) <= PLACE_ENTRY_MATCH_METERS ? entry : null
}

/** "Entered as 10 512345.6 5973210.4 (NAD83 / UTM zone 10N (EPSG:26910), ±0.05 m)": one line for exports. */
export function placeEntryLine(entry: ViewPlaceEntry): string {
  return `${entry.text} (${placeCrsLabel(entry)}, ${precisionLabel(entry.precisionMeters)} from the digits given)`
}

/** Reads a kept entry, dropping it (and keeping the view) when it does not read. */
export function parseViewPlaceEntry(raw: unknown): ViewPlaceEntry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
  if (typeof value.text !== 'string' || !value.text.trim() || value.text.length > MAX_TEXT) return null
  if (value.system !== 'latlon' && value.system !== 'utm') return null
  if (value.datum !== 'NAD83' && value.datum !== 'WGS84') return null
  if (!finite(value.precisionMeters) || value.precisionMeters < 0 || value.precisionMeters > 100_000) return null
  if (!finite(value.lng) || !finite(value.lat) || Math.abs(value.lng) > 180 || Math.abs(value.lat) > 90) return null
  if (value.system === 'utm' && !(finite(value.zone) && (BC_UTM_ZONES as readonly number[]).includes(value.zone)))
    return null
  return {
    text: value.text,
    system: value.system,
    datum: value.datum,
    ...(value.system === 'utm' ? { zone: value.zone as number } : {}),
    precisionMeters: value.precisionMeters,
    lng: value.lng,
    lat: value.lat,
  }
}
