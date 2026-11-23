/**
 * The camera information a perspective figure prints on the image, as the VIA handbook's
 * Appendix 7 recommends a simulation state: the lens and field of view, the observer's height and
 * position, the view's azimuth, the tallest tree drawn, and the date of rendering. The lines follow
 * a licensee's perspective view render's wording. No DOM or network access (proj4 is pure).
 */
import proj4 from 'proj4'

export type CameraInfo = {
  /** Frames joined into the figure, and each one's full-frame equivalent focal length, mm. */
  frames: number
  focalMm: number
  /** Horizontal field of view of the whole figure, degrees. */
  fovDeg: number
  /** Eye height above the ground (or water) under it, metres, and which. */
  observerHeightM: number
  above: 'ground' | 'lake level'
  /** Observer position. */
  lng: number
  lat: number
  /** Eye elevation above sea level, metres. */
  elevationM: number
  /**
   * The eye elevation is the reviewer's surveyed one rather than the terrain model's ground plus
   * the observer height; the position line says so. The observer height line still holds.
   */
  surveyed?: boolean
  /**
   * The terrain model's eye (its ground plus the observer height) where a surveyed elevation sits more than
   * `eyeToleranceM` from it: the position line gives both numbers. Absent when they agree or nothing was surveyed.
   */
  modelEyeM?: number
  eyeToleranceM?: number
  /** The UTM zone the view's place was typed in, so the position prints in it; absent: the eye's own zone. */
  utmZone?: number
  /** The lens as the reviewer entered it ("50 mm × 1.6 crop: …"), printed beside the lens used. */
  lensEntered?: string
  /** Azimuth of the view's centre line, degrees clockwise from north. */
  azimuthDeg: number
  /** Tallest tree the figure draws, metres; null when trees are not modelled. */
  maxTreeHeightM: number | null
  renderedOn: Date | string
}

/** WGS84 / UTM position: zone (the point's own unless given), easting, northing. */
export function utmPosition(
  lng: number,
  lat: number,
  zoneGiven?: number,
): { zone: number; easting: number; northing: number } {
  const zone =
    zoneGiven !== undefined && Number.isInteger(zoneGiven) && zoneGiven >= 1 && zoneGiven <= 60
      ? zoneGiven
      : Math.max(1, Math.min(60, Math.floor((lng + 180) / 6) + 1))
  const [easting, northing] = proj4(
    'EPSG:4326',
    `+proj=utm +zone=${zone}${lat < 0 ? ' +south' : ''} +datum=WGS84 +units=m +no_defs`,
    [lng, lat],
  )
  return { zone, easting, northing }
}

const whole = (value: number) => Math.round(value).toLocaleString('en-CA')

/** The lines of the camera information block, in print order. */
export function cameraInfoLines(info: CameraInfo): string[] {
  const utm = utmPosition(info.lng, info.lat, info.utmZone)
  // A surveyed eye the terrain model disagrees with: both numbers, on the position line (the block keeps six lines).
  const apart =
    info.surveyed && info.modelEyeM !== undefined && Number.isFinite(info.modelEyeM)
      ? info.elevationM - info.modelEyeM
      : null
  const surveyedNote =
    apart !== null
      ? ` (surveyed elevation; terrain model eye ${whole(info.modelEyeM!)} metres, ${Math.abs(apart).toFixed(1)} metres ${apart < 0 ? 'higher' : 'lower'})`
      : info.surveyed
        ? ' (surveyed elevation)'
        : ''
  // Early project ZIPs serialized the date as an empty object.
  const renderedOn = typeof info.renderedOn === 'string' ? new Date(info.renderedOn) : info.renderedOn
  const date =
    renderedOn instanceof Date && Number.isFinite(renderedOn.getTime())
      ? renderedOn.toISOString().slice(0, 10)
      : 'unavailable'
  return [
    `Composite of ${info.frames} simulated ${Math.round(info.focalMm)} mm camera image${info.frames === 1 ? '' : 's'}: FOV ${info.fovDeg.toFixed(1)} degrees${info.lensEntered ? ` (entered as ${info.lensEntered})` : ''}`,
    `Observer height: ${info.observerHeightM.toFixed(1)} metres above ${info.above}`,
    `Observer position (UTM zone ${utm.zone}): ${whole(utm.easting)}, ${whole(utm.northing)}, ${whole(info.elevationM)} metres${surveyedNote}`,
    `Viewline azimuth: ${Math.round(((info.azimuthDeg % 360) + 360) % 360)} degrees`,
    info.maxTreeHeightM === null
      ? 'Maximum tree height: trees not modelled'
      : `Maximum tree height: ${info.maxTreeHeightM.toFixed(1)} metres`,
    `Date of rendering: ${date}`,
  ]
}
