/**
 * Where the sun stands, from NOAA's solar position equations (after Meeus, *Astronomical Algorithms*): the geometric
 * centre of the disc, without refraction, good to about 0.01° between 1800 and 2100. Pure; no DOM or network.
 *
 * The viewshed tool keeps its own low-order ephemeris (`solarPosition` in `features/terrain-viewshed/model.ts`), which
 * differs from this by up to a few tenths of a degree near the horizon; anything that hands a sun to an engine or a
 * report, where two renderers have to agree, takes this one.
 */

export type SunPosition = {
  /** Degrees above the horizon (negative below it). */
  elevationDegrees: number
  /** Degrees clockwise from true north. */
  azimuthDegrees: number
}

const RAD = Math.PI / 180

export function sunPosition(instant: Date | number, place: { lng: number; lat: number }): SunPosition {
  const ms = typeof instant === 'number' ? instant : instant.getTime()
  const julianCentury = (ms / 86_400_000 + 2_440_587.5 - 2_451_545) / 36_525
  const T = julianCentury
  const meanLongitude = (((280.46646 + T * (36_000.76983 + T * 0.0003032)) % 360) + 360) % 360
  const meanAnomaly = 357.52911 + T * (35_999.05029 - 0.0001537 * T)
  const eccentricity = 0.016708634 - T * (0.000042037 + 0.0000001267 * T)
  const centre =
    Math.sin(meanAnomaly * RAD) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * meanAnomaly * RAD) * (0.019993 - 0.000101 * T) +
    Math.sin(3 * meanAnomaly * RAD) * 0.000289
  const omega = 125.04 - 1934.136 * T
  const apparentLongitude = meanLongitude + centre - 0.00569 - 0.00478 * Math.sin(omega * RAD)
  const meanObliquity = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60
  const obliquity = meanObliquity + 0.00256 * Math.cos(omega * RAD)
  const declination = Math.asin(Math.sin(obliquity * RAD) * Math.sin(apparentLongitude * RAD))
  const y = Math.tan((obliquity * RAD) / 2) ** 2
  const L = meanLongitude * RAD
  const M = meanAnomaly * RAD
  const equationOfTimeMinutes =
    (4 / RAD) *
    (y * Math.sin(2 * L) -
      2 * eccentricity * Math.sin(M) +
      4 * eccentricity * y * Math.sin(M) * Math.cos(2 * L) -
      0.5 * y * y * Math.sin(4 * L) -
      1.25 * eccentricity * eccentricity * Math.sin(2 * M))
  const utcMinutes = (((ms % 86_400_000) + 86_400_000) % 86_400_000) / 60_000
  const trueSolarMinutes = (((utcMinutes + equationOfTimeMinutes + 4 * place.lng) % 1440) + 1440) % 1440
  const hourAngle = (trueSolarMinutes / 4 - 180) * RAD
  const lat = place.lat * RAD
  const cosZenith = Math.min(
    1,
    Math.max(-1, Math.sin(lat) * Math.sin(declination) + Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle)),
  )
  const elevation = 90 - Math.acos(cosZenith) / RAD
  const azimuth =
    (Math.atan2(Math.sin(hourAngle), Math.cos(hourAngle) * Math.sin(lat) - Math.tan(declination) * Math.cos(lat)) /
      RAD +
      180 +
      360) %
    360
  return { elevationDegrees: elevation, azimuthDegrees: azimuth }
}
