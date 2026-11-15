/**
 * One command from a photo to a checked camera: creates the case file (outside the repository), then runs
 * read-photo → orient → check, and overlay when proposals are given and the camera fit is trustworthy. Prints what to
 * look at and what a person still has to decide. Rerunning keeps the case file, so marked skylines, controls and
 * regions survive; delete `pose` from it to search again.
 *
 *   node --import tsx scripts/forestry/photo-matching/match.ts <photo> [--cases <dir>] [--ground] [--proposal a.geojson …]
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fmt } from './lib/photo'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../../..')
const args = process.argv.slice(2)
const photo = resolve(args[0] ?? '')
if (!args[0] || !existsSync(photo)) throw Error('Usage: match.ts <photo> [--cases <dir>] [--ground] [--proposal a.geojson …]')
const casesDir = resolve(args.includes('--cases') ? args[args.indexOf('--cases') + 1] : join(dirname(photo), 'photo-matching'))
if (!relative(repo, casesDir).startsWith('..')) throw Error(`Case files record where photos were taken; keep them outside the repository (not ${casesDir}).`)
const proposals = args.flatMap((a, i) => (args[i - 1] === '--proposal' ? [resolve(a)] : []))

const name = basename(photo, extname(photo))
const casePath = join(casesDir, `${name}.json`)
mkdirSync(join(casesDir, `out-${name}`), { recursive: true })
if (!existsSync(casePath)) {
  // HEIC (the iPhone default) is turned into PNG beside the case; metadata and rotation still come from the original.
  let pixels = photo
  if (/^\.hei[cf]$/i.test(extname(photo))) {
    pixels = join(casesDir, `${name}.png`)
    const conv = spawnSync('sips', ['-s', 'format', 'png', photo, '--out', pixels], { encoding: 'utf8' })
    if (conv.status !== 0) throw Error(`Could not convert ${photo} to PNG with sips; export it as JPEG or PNG first.`)
  }
  const fresh = { photo: relative(casesDir, pixels), ...(pixels !== photo ? { metadata: relative(casesDir, photo) } : {}), out: `out-${name}`, platform: args.includes('--ground') ? 'ground' : 'air' }
  writeFileSync(casePath, JSON.stringify(fresh, null, 2) + '\n')
  console.log(`created ${casePath}`)
}
if (proposals.length) {
  const c = JSON.parse(readFileSync(casePath, 'utf8'))
  c.proposals = proposals.map((file) => ({ file: relative(casesDir, file) }))
  writeFileSync(casePath, JSON.stringify(c, null, 2) + '\n')
}

function stage(script: string, ...extra: string[]) {
  console.log(`\n— ${script}`)
  const run = spawnSync(process.execPath, ['--import', 'tsx', join(here, script), casePath, ...extra], { cwd: repo, encoding: 'utf8' })
  const out = (run.stdout + run.stderr).split('\n').filter((l) => l && !/DeprecationWarning|trace-deprecation/.test(l))
  console.log(out.join('\n'))
  if (run.status !== 0) throw Error(`${script} failed`)
}
const read = () => JSON.parse(readFileSync(casePath, 'utf8'))

stage('read-photo.ts')
if (!read().pose) stage('orient.ts')
else console.log('\n— orient.ts skipped: the case already has a pose (delete it to search again)')
stage('check.ts')
const c = read()
const o = c.results?.orientation
const trusted = !!o?.trustworthy || String(c.pose?.source ?? '').startsWith('solve')
if (proposals.length || c.proposals?.length) {
  if (trusted) stage('overlay.ts')
  else console.log('\n— overlay.ts skipped: the camera is not trustworthy yet (see below)')
}

const out = resolve(casesDir, c.out ?? `out-${name}`)
console.log('\nSummary')
console.log(`  camera: ${fmt(c.pose?.bearing, 1)}° / ${fmt(c.pose?.pitch, 1)}° / roll ${fmt(c.pose?.roll, 1)}° from ${c.pose?.source}`)
if (o) console.log(`  skyline: ${o.agreeing} columns, ${fmt(o.agreement * 100, 0)}% agreeing, ${o.trustworthy ? 'trustworthy' : o.ambiguous ? `NOT trustworthy: a heading near ${fmt(o.runnerUp?.bearing, 0)}° fits about as well` : 'NOT trustworthy'}; recorded heading off by ${fmt(o.compassError, 0)}°`)
console.log('\nLook at')
console.log(`  ${join(out, 'check-model-pose.jpg')} — does the model view show the same ground as the photo?`)
console.log(`  ${join(out, 'check-features-pose.jpg')} — do lakes, wetlands, roads and cutblocks sit on what the photo shows?`)
if (existsSync(join(out, 'overlay-compare.jpg'))) console.log(`  ${join(out, 'overlay-outline.jpg')} and overlay-compare.jpg — the proposals`)
console.log('\nThen')
if (!trusted) console.log('  The skyline fit is not trustworthy: trace the skyline (skyline.mode "trace") or mark regions and run classes.ts, then check each candidate.')
console.log('  If features near the camera sit off, add a control line or two (crop.ts to read pixels) and run solve.ts --hold hfov --use.')
