/** Explicitly refresh the tile's pinned, narrowed rank-1 inventory snapshot. */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { vriVolumeQueryUrl } from '../../src/pages/dev-lidar/volume/vri'
const analysis = 'public/data/lidar-analysis/bc-093g086/summary.json'
const summary = JSON.parse(readFileSync(analysis, 'utf8'))
const bounds = summary.bounds_wgs84.map((v: number) => Number(v.toFixed(6))) as [number, number, number, number]
const url = vriVolumeQueryUrl(bounds)
const response = execFileSync('curl', ['--fail', '--silent', '--show-error', '--max-time', '45', url], {
  maxBuffer: 16 * 1024 * 1024,
}).toString()
const data = JSON.parse(response)
if (
  !Array.isArray(data.features) ||
  data.exceptions ||
  data.numberMatched !== data.features.length ||
  data.features.length >= 500
)
  throw Error('VRI response is invalid or truncated; existing snapshot retained')
writeFileSync('scripts/lidar/sources/volume-vri.geojson', response)
writeFileSync(
  'scripts/lidar/sources/volume-vri.metadata.json',
  JSON.stringify(
    {
      request_url: url,
      retrieved_utc: new Date().toISOString(),
      number_matched: data.numberMatched,
      source_sha256: summary.source_sha256,
    },
    null,
    2,
  ) + '\n',
)
console.log(`Pinned ${data.features.length} complete VRI features from the shared forestry WFS query`)
