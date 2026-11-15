/**
 * Stage 1: what the photo's file knows. Reads EXIF, the GPS time and Apple's acceleration vector, the ground under
 * the camera and the sun at the GPS time, and stores them in the case file as `observation`.
 *
 *   node --import tsx scripts/forestry/photo-matching/read-photo.ts <case.json>
 */
import { boundsAround, dem } from './lib/geo'
import { fmt, readCase, readObservation, sunPosition, writeCase } from './lib/photo'

const c = readCase(process.argv[2])
const o = await readObservation(c.photo, c.metadata)
c.observation = o
const ground = (await dem(boundsAround(o.lng, o.lat, 800), 13)).elevationAt(o.lng, o.lat)
const sun = o.gpsTimeUtc ? sunPosition(o.lng, o.lat, new Date(o.gpsTimeUtc)) : null
c.results = { ...c.results, ground: { elevation: ground, agl: o.gpsAltitude === null ? null : o.gpsAltitude - ground }, sun }
writeCase(c)

const rows: Array<[string, string]> = [
  ['Frame', `${o.width} × ${o.height} (working frame)`],
  ['Lens', `${fmt(o.focal35, 0)} mm equivalent${o.digitalZoom ? ` (digital zoom ${fmt(o.digitalZoom, 3)}, already included)` : ''} → ${fmt(o.hfov)}° × ${fmt(o.vfov)}°`],
  ['GPS altitude', `${fmt(o.gpsAltitude, 0)} m; ground ${fmt(ground, 0)} m; above ground ${fmt((o.gpsAltitude ?? NaN) - ground, 0)} m`],
  ['Horizontal error (stated)', `${fmt(o.horizontalErrorM)} m`],
  ['Recorded heading', `${fmt(o.compass)}° (${o.compassRef ?? '?'}) — a starting value only from an aircraft`],
  ['Tilt sensor', o.accel ? `|a| ${fmt(o.accel.g, 3)} g → pitch ${fmt(o.accel.pitch)}°, roll ${fmt(o.accel.roll)}°${Math.abs(o.accel.g - 1) > 0.05 ? ' — not gravity alone; do not use' : ''}` : 'none'],
  ['Camera clock', `${o.takenLocal ?? '—'} ${o.offset ?? ''}`],
  ['GPS fix (UTC)', `${o.gpsTimeUtc ?? '—'}; fix ${fmt(o.fixAgeSeconds)} s older than the shutter${o.fixAgeSeconds && o.speedKmh ? ` (${fmt((o.fixAgeSeconds * o.speedKmh) / 3.6, 0)} m at ${fmt(o.speedKmh)} km/h)` : ''}`],
  ['Sun at GPS time', sun ? `azimuth ${fmt(sun.azimuth)}°, elevation ${fmt(sun.elevation)}°` : '—'],
]
for (const [k, v] of rows) console.log(`${k.padEnd(26)} ${v}`)
