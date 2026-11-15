/**
 * Stage 2: heading, pitch and roll from the photo's skyline. A coarse search in angles (each skyline column as a
 * ray against the terrain profile), then `fitSkyline` (unchanged) around the best pose and a finer roll step. Checks
 * the result against the sun and writes `pose` (source "skyline") to the case file, with an overlay image.
 *
 * Also reports the best heading at least 15° from the winner; when it fits nearly as well (AMBIGUOUS_LOSS_GAP), the
 * camera is not trustworthy whatever fitSkyline says. orient.jpg: yellow is the photo's skyline as read, green the
 * terrain skyline at the fitted camera, red the terrain skyline at the recorded heading, the white circle the sun.
 *
 *   node --import tsx scripts/forestry/photo-matching/orient.ts <case.json>
 */
import { join } from 'node:path'
import { fitSkyline, terrainProfile, type ProfilePoint } from '../../../src/pages/dev-forestry/skylineFit'
import { cameraAxes, terrainSkyline } from '../../../src/pages/dev-forestry/photoPose'
import { boundsAround, dem, poseFrom, saveJpeg } from './lib/geo'
import { fmt, readCase, readSkyline, sunPosition, workFrame, writeCase, type CaseFile } from './lib/photo'

const RAD = Math.PI / 180
const c = readCase(process.argv[2])
const o = c.observation
if (!o) throw Error('Run read-photo.ts first.')
const frame = await workFrame(c.photo, c.metadata)
const ground = (c.results?.ground as { elevation: number } | undefined)?.elevation ?? NaN
const alt = c.platform === 'ground' ? ground + (c.eyeHeight ?? 1.7) : (o.gpsAltitude ?? ground + 1.7)
const radius = 90000
const far = await dem(boundsAround(o.lng, o.lat, radius), 10, 100)
const profile: ProfilePoint[] = terrainProfile({ lng: o.lng, lat: o.lat, altitudeMeters: alt }, far, { from: 0, to: 359.9, step: 0.1, maxDistanceMeters: radius * 0.95 })
const elevAt = (az: number) => profile[Math.round((((az % 360) + 360) % 360) / 0.1) % profile.length]?.elevation ?? NaN

const base = poseFrom({ lng: o.lng, lat: o.lat, alt, bearing: o.compass ?? 0, pitch: 0, roll: 0, hfov: o.hfov, width: frame.width, height: frame.height })
const accelOk = !!o.accel && Math.abs(o.accel.g - 1) <= 0.05
const pitchRange = c.orientation?.pitch ?? (accelOk ? [o.accel!.pitch - 6, o.accel!.pitch + 6] : [-50, 10])
const rollRange = c.orientation?.roll ?? [-15, 15]
const span = c.orientation?.span ?? (c.platform === 'ground' ? 30 : 180)
type Fit = NonNullable<ReturnType<typeof fitSkyline>>
type Found = {
  roll: number
  bearing: number
  pitch: number
  fit: Fit
  skyline: Array<{ x: number; y: number } | null>
  reader: NonNullable<CaseFile['skyline']>
  /** Coarse loss per skyline column (degrees, truncated at 1) of the best pose, and of the best pose at least 15° of heading away. */
  meanLoss: number
  runnerUp: { bearing: number; meanLoss: number } | null
}
/**
 * A runner-up this close in mean loss per column (degrees) fits the skyline about as well: the heading is ambiguous.
 * Provisional, from four cases (November 2026): two right cameras had gaps of 0.138° and 0.144°; a wrong one from a
 * hand-traced straight ridge had 0.062°, and an automatic read of the same photo 0.003°.
 */
const AMBIGUOUS_LOSS_GAP = Number(process.env.AMBIGUOUS_LOSS_GAP ?? 0.1)

function search(reader: NonNullable<CaseFile['skyline']>): Found | null {
  const skyline = readSkyline({ ...c, skyline: reader }, frame)
  const usable = skyline.filter((p): p is { x: number; y: number } => !!p)
  if (usable.length < 12) return null
  // Coarse: truncated angular loss, sky below the bare ridge weighted 3× (the rule fitSkyline uses).
  let coarse = { bearing: base.bearing, pitch: 0, roll: 0, loss: Infinity }
  // The best pose in each 10° slice of heading, so a second heading that fits nearly as well is seen.
  const sectors = Array.from({ length: 36 }, () => ({ bearing: NaN, loss: Infinity }))
  for (let roll = rollRange[0]; roll <= rollRange[1]; roll += 1) {
    for (let pitch = pitchRange[0]; pitch <= pitchRange[1]; pitch += 0.5) {
      for (let db = -span; db < span; db += 0.5) {
        const heading = (((base.bearing + db) % 360) + 360) % 360
        const sector = sectors[Math.floor(heading / 10) % 36]
        const { right, down, forward } = cameraAxes({ bearing: base.bearing + db, pitch, roll })
        let loss = 0
        for (const p of usable) {
          const nx = (p.x - base.width / 2) / base.focalPx, ny = (p.y - base.height / 2) / base.focalPx
          const e = forward[0] + nx * right[0] + ny * down[0], n = forward[1] + nx * right[1] + ny * down[1], u = forward[2] + nx * right[2] + ny * down[2]
          const t = elevAt(Math.atan2(e, n) / RAD)
          if (!Number.isFinite(t)) {
            loss += 1
            continue
          }
          const d = Math.atan2(u, Math.hypot(e, n)) / RAD - t
          loss += Math.min(1, d < 0 ? -3 * d : d)
          if (loss >= sector.loss) break
        }
        if (loss < sector.loss) {
          sector.loss = loss
          sector.bearing = heading
        }
        if (loss < coarse.loss) coarse = { bearing: base.bearing + db, pitch, roll, loss }
      }
    }
  }
  const bestHeading = (((coarse.bearing % 360) + 360) % 360)
  const apart = (a: number) => Math.abs(((a - bestHeading + 540) % 360) - 180) >= 15
  const runner = sectors.filter((x) => Number.isFinite(x.loss) && apart(x.bearing)).sort((a, b) => a.loss - b.loss)[0]
  const meanLoss = coarse.loss / usable.length
  const runnerUp = runner ? { bearing: runner.bearing, meanLoss: runner.loss / usable.length } : null
  // Fine: fitSkyline (heading and pitch) at rolls in quarter degrees round the coarse roll.
  let best: Found | null = null
  for (let roll = coarse.roll - 1; roll <= coarse.roll + 1 + 1e-9; roll += 0.25) {
    const fit = fitSkyline({ ...base, bearing: coarse.bearing, pitch: coarse.pitch, roll }, profile, skyline)
    if (!fit) continue
    const score = fit.agreeing * fit.agreement
    if (!best || score > best.fit.agreeing * best.fit.agreement || (score === best.fit.agreeing * best.fit.agreement && fit.medianErrorPx < best.fit.medianErrorPx))
      best = { roll, bearing: coarse.bearing + fit.nudge.bearing, pitch: coarse.pitch + fit.nudge.pitch, fit, skyline, reader, meanLoss, runnerUp }
  }
  return best
}

// The case's reader, or (when it names none) each reader in turn, keeping the best trustworthy fit.
const readers: Array<NonNullable<CaseFile['skyline']>> = c.skyline ? [c.skyline] : [{ mode: 'auto' }, { mode: 'luma', from: 0.2 }, { mode: 'luma', from: 0.3 }, { mode: 'luma', from: 0.4 }]
const t0 = Date.now()
const tried: Array<{ reader: string; agreement: number; agreeing: number; trustworthy: boolean }> = []
let best: Found | null = null
for (const reader of readers) {
  const found = search(reader)
  const label = reader.mode === 'luma' ? `luma from ${reader.from}` : reader.mode
  if (!found) {
    tried.push({ reader: label, agreement: 0, agreeing: 0, trustworthy: false })
    continue
  }
  tried.push({ reader: label, agreement: found.fit.agreement, agreeing: found.fit.agreeing, trustworthy: found.fit.trustworthy })
  const rank = (f: Found) => (f.fit.trustworthy ? 1e6 : 0) + f.fit.agreeing * f.fit.agreement
  if (!best || rank(found) > rank(best)) best = found
  if (!c.skyline && found.fit.trustworthy && found.fit.agreement >= 0.95) break
}
const seconds = (Date.now() - t0) / 1000
if (!best) throw Error('No skyline reader found enough sky to fit. Trace the skyline (skyline.mode "trace") or mark regions for classes.ts.')
const usable = best.skyline.filter((p): p is { x: number; y: number } => !!p)
if (!c.skyline) c.skyline = best.reader
const pose = poseFrom({ lng: o.lng, lat: o.lat, alt, bearing: ((best.bearing % 360) + 360) % 360, pitch: best.pitch, roll: best.roll, hfov: o.hfov, width: frame.width, height: frame.height })

// The sun under the fitted pose, and against where the photo shows it.
const sun = o.gpsTimeUtc ? sunPosition(o.lng, o.lat, new Date(o.gpsTimeUtc)) : null
let sunCheck: Record<string, number> | null = null
if (sun) {
  const sx = Math.sin(sun.azimuth * RAD) * Math.cos(sun.elevation * RAD), sy = Math.cos(sun.azimuth * RAD) * Math.cos(sun.elevation * RAD), sz = Math.sin(sun.elevation * RAD)
  const { right, down, forward } = cameraAxes(pose)
  const z = sx * forward[0] + sy * forward[1] + sz * forward[2]
  if (z > 0) {
    const px = pose.width / 2 + (pose.focalPx * (sx * right[0] + sy * right[1] + sz * right[2])) / z
    const py = pose.height / 2 + (pose.focalPx * (sx * down[0] + sy * down[1] + sz * down[2])) / z
    sunCheck = { predictedX: Math.round(px), predictedY: Math.round(py) }
    if (c.sunPixel) sunCheck.offsetDeg = Math.hypot(px - c.sunPixel[0], py - c.sunPixel[1]) / pose.focalPx / RAD
  }
}

const pitchVsSensor = accelOk ? best.pitch - o.accel!.pitch : null
const ambiguous = !!best.runnerUp && best.runnerUp.meanLoss - best.meanLoss < AMBIGUOUS_LOSS_GAP
/** Trustworthy by fitSkyline, and no clearly different heading fits about as well. */
const trustworthy = best.fit.trustworthy && !ambiguous
const compassError = o.compass === null ? null : ((((o.compass - pose.bearing) % 360) + 540) % 360) - 180
c.pose = { lng: o.lng, lat: o.lat, alt, bearing: pose.bearing, pitch: pose.pitch, roll: pose.roll, hfov: o.hfov, source: 'skyline' }
c.results = {
  ...c.results,
  orientation: {
    columns: usable.length, skylineReader: c.skyline?.mode ?? 'auto', readersTried: tried, agreement: best.fit.agreement, agreeing: best.fit.agreeing, span: best.fit.span,
    medianErrorPx: best.fit.medianErrorPx, fitSkylineTrustworthy: best.fit.trustworthy, trustworthy, ambiguous, meanLossDeg: best.meanLoss, runnerUp: best.runnerUp, compassError, pitchVsSensor, sun: sunCheck, seconds,
  },
}
writeCase(c)

// Overlay: photo skyline (yellow), terrain skyline at the fit (green) and at the recorded heading (red), sun (circle).
const ctx = frame.canvas.getContext('2d')
const dot = (x: number, y: number, color: string, r: number) => {
  ctx.fillStyle = color
  ctx.fillRect(x - r, y - r, 2 * r + 1, 2 * r + 1)
}
for (const p of usable) dot(p.x, p.y, '#ffe600', 2)
for (const p of terrainSkyline({ ...pose, bearing: o.compass ?? pose.bearing }, far, { columns: 200, maxDistanceMeters: radius * 0.95 })) dot(p.x, p.y, '#ff3030', 1)
for (const p of terrainSkyline(pose, far, { columns: 260, maxDistanceMeters: radius * 0.95 })) dot(p.x, p.y, '#28ff5a', 1)
if (sunCheck) {
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(sunCheck.predictedX, sunCheck.predictedY, 14, 0, 2 * Math.PI)
  ctx.stroke()
}
saveJpeg(frame.canvas, join(c.out!, 'orient.jpg'))

console.log(`skyline columns ${usable.length} (${c.skyline?.mode ?? 'auto'}); searched ±${span}° heading, pitch ${pitchRange.map((v) => fmt(v)).join('…')}°${accelOk ? ' (from the tilt sensor)' : ''}, roll ${rollRange.join('…')}° in ${fmt(seconds)} s`)
console.log(`readers tried: ${tried.map((t) => `${t.reader} ${fmt(t.agreement * 100, 0)}%${t.trustworthy ? ' ✓' : ''}`).join('; ')}`)
console.log(`pose: heading ${fmt(pose.bearing, 2)}°, pitch ${fmt(pose.pitch, 2)}°, roll ${fmt(pose.roll, 2)}°, eye ${fmt(alt, 0)} m`)
console.log(`fit: ${best.fit.agreeing} columns agree (${fmt(best.fit.agreement * 100, 0)}%) across ${fmt(best.fit.span * 100, 0)}% of the frame, median ${fmt(best.fit.medianErrorPx)} px — ${best.fit.trustworthy ? 'trustworthy by fitSkyline' : 'NOT trustworthy by fitSkyline'}`)
console.log(`next-best heading at least 15° away: ${best.runnerUp ? `${fmt(best.runnerUp.bearing, 0)}°, mean loss ${fmt(best.runnerUp.meanLoss, 3)}° against ${fmt(best.meanLoss, 3)}° per column` : 'none'}${ambiguous ? ' — AMBIGUOUS: another heading fits about as well, so the camera is NOT trustworthy; check both, or use regions or controls' : ''}`)
console.log(`recorded heading off by ${fmt(compassError)}°; ${accelOk ? `tilt-sensor pitch off by ${fmt(pitchVsSensor)}°` : 'tilt sensor not used (not reading gravity alone)'}`)
if (sunCheck) console.log(`sun (az ${fmt(sun!.azimuth)}°, el ${fmt(sun!.elevation)}°) should appear at (${sunCheck.predictedX}, ${sunCheck.predictedY})${sunCheck.offsetDeg !== undefined ? `; marked at ${c.sunPixel!.join(', ')}, ${fmt(sunCheck.offsetDeg)}° away` : ''}`)
else if (sun) console.log(`sun (az ${fmt(sun.azimuth)}°, el ${fmt(sun.elevation)}°) is behind the camera`)
