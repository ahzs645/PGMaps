/** Try transferring a checked camera to an overlapping photo. The result is a camera candidate for review. */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { projectToPhoto } from '../../../src/pages/dev-forestry/photoPose'
import { boundsAround, dem, layered, poseFrom } from './lib/geo'
import { transferCamera, type ImageMatch } from './lib/overlap'
import { readCase, readObservation, workFrame, type PoseRecord } from './lib/photo'

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    candidate: { type: 'string' },
    'reviewed-reference': { type: 'boolean' },
    descriptor: { type: 'string', default: 'sift' },
  },
})
if (positionals.length !== 2)
  throw Error(
    'Usage: overlap.ts reference.json target.json [--descriptor sift|rootsift|contrast-rootsift|multiscale-rootsift|orb] [--reviewed-reference --candidate new-case.json]',
  )
if (values.candidate && !values['reviewed-reference'])
  throw Error('Review the reference camera against mapped features before exporting a transferred candidate.')

const here = dirname(fileURLToPath(import.meta.url))
const repo = realpathSync(resolve(here, '../../..'))
function outsideRepository(path: string): string {
  const rel = relative(repo, path)
  if (rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep)))
    throw Error('Keep photo-matching cases and outputs outside the repository.')
  return path
}

const reference = readCase(outsideRepository(realpathSync(positionals[0])))
const target = readCase(outsideRepository(realpathSync(positionals[1])))
if (realpathSync(reference.photo) === realpathSync(target.photo)) throw Error('Choose two different photographs.')
if (!reference.pose) throw Error('The reference case needs a camera pose.')
const output = values.candidate
  ? outsideRepository(join(realpathSync(dirname(resolve(values.candidate))), basename(values.candidate)))
  : null

const [refFrame, targetFrame, observed] = await Promise.all([
  workFrame(reference.photo, reference.metadata),
  workFrame(target.photo, target.metadata),
  target.observation ?? readObservation(target.photo, target.metadata),
])
const targetPosition = target.pose ?? observed
if (
  ![reference.pose.lng, reference.pose.lat, reference.pose.alt, targetPosition.lng, targetPosition.lat].every(
    Number.isFinite,
  )
)
  throw Error('Both cameras need a position and the reference needs an altitude.')

const directory = mkdtempSync(join(tmpdir(), 'pgmaps-overlap-'))
let imageMatches: { reciprocal: number; matches: ImageMatch[] }
try {
  const a = join(directory, 'reference.png')
  const b = join(directory, 'target.png')
  writeFileSync(a, refFrame.canvas.toBuffer('image/png'))
  writeFileSync(b, targetFrame.canvas.toBuffer('image/png'))
  imageMatches = JSON.parse(
    execFileSync(
      process.env.PHOTO_MATCH_PYTHON ?? 'python3',
      [join(here, 'lib/overlap_features.py'), '--method', values.descriptor, a, b],
      {
        encoding: 'utf8',
      },
    ),
  )
} finally {
  rmSync(directory, { recursive: true, force: true })
}

if (!imageMatches.matches.length) {
  console.log(
    JSON.stringify({
      status: 'insufficient',
      descriptor: values.descriptor,
      reciprocal: imageMatches.reciprocal,
      reason: 'No strong image overlap',
    }),
  )
} else {
  const terrain = layered(
    ...(await Promise.all([
      dem(boundsAround(reference.pose.lng, reference.pose.lat, 14000), 12, 120),
      dem(boundsAround(reference.pose.lng, reference.pose.lat, 25000), 11, 160),
    ])),
  )
  const { lng, lat } = targetPosition
  const targetPose = target.pose ?? {
    lng,
    lat,
    alt:
      target.platform === 'ground' ? terrain.elevationAt(lng, lat) + (target.eyeHeight ?? 1.7) : observed.gpsAltitude,
    bearing: observed.compass ?? 0,
    pitch: 0,
    roll: 0,
    hfov: observed.hfov,
  }
  if (targetPose.alt === null || !Number.isFinite(targetPose.alt))
    throw Error('The target camera needs a GPS or ground-derived altitude.')
  if (![reference.pose.hfov, targetPose.hfov].every((hfov) => Number.isFinite(hfov) && hfov >= 3 && hfov <= 150))
    throw Error('Both cameras need their horizontal field of view.')
  const referenceCamera = { ...poseFrom({ ...reference.pose, ...refFrame }), hfov: reference.pose.hfov }
  const start = { ...poseFrom({ ...targetPose, alt: targetPose.alt, ...targetFrame }), hfov: targetPose.hfov }
  const result = transferCamera(referenceCamera, start, terrain, imageMatches.matches)
  const candidate = result.status === 'candidate' ? result.pose : null

  // Explicitly mapped points in the target case are additional checks. They never enter the transfer fit.
  const independent = (target.controls?.points ?? []).flatMap(({ name, pixel, lngLat }) => {
    if (!candidate || !lngLat) return []
    const [lng, lat] = lngLat
    const elevation = terrain.elevationAt(lng, lat)
    if (!Number.isFinite(elevation)) return [{ name, baselinePx: null, candidatePx: null }]
    const residual = (camera: typeof start) => {
      const point = projectToPhoto(camera, lng, lat, elevation)
      return point ? Math.hypot(point.x - pixel[0], point.y - pixel[1]) : null
    }
    return [{ name, baselinePx: residual(start), candidatePx: residual(candidate) }]
  })

  const { status, ...diagnostics } = result
  console.log(
    JSON.stringify(
      {
        status,
        descriptor: values.descriptor,
        reciprocal: imageMatches.reciprocal,
        geometric: imageMatches.matches.length,
        ...diagnostics,
        ...(candidate ? { pose: { bearing: candidate.bearing, pitch: candidate.pitch, roll: candidate.roll } } : {}),
        independent,
      },
      null,
      2,
    ),
  )
  if (candidate && output) {
    const dir = dirname(output)
    const { lng, lat, altitudeMeters: alt, bearing, pitch, roll, hfov } = candidate
    const pose: PoseRecord = { lng, lat, alt, bearing, pitch, roll, hfov, source: 'photo-overlap' }
    const document = {
      photo: relative(dir, target.photo),
      ...(target.metadata ? { metadata: relative(dir, target.metadata) } : {}),
      out: basename(output, '.json') + '-checks',
      platform: target.platform,
      observation: observed,
      controls: target.controls,
      pose,
      results: {
        orientation: { trustworthy: false },
        overlap: {
          descriptor: values.descriptor,
          reference: basename(reference.photo),
          ...diagnostics,
          pose: undefined,
          independent,
        },
      },
    }
    writeFileSync(output, JSON.stringify(document, null, 2) + '\n', { flag: 'wx' })
    console.log('Exported a provisional camera. Review it against independent mapped features.')
  }
}
