import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const GTFS_URL =
  process.env.PG_GTFS_URL || 'https://bct.tmix.se/Tmix.Cap.TdExport.WebApi/gtfs/?operatorIds=22'
const OUTPUT = 'public/data/transit/prince_george_gtfs_summary.json'

async function main() {
  const response = await fetch(GTFS_URL)
  if (!response.ok) throw new Error(`Failed to fetch GTFS feed: ${response.status}`)
  const tempDir = await mkdtemp(path.join(tmpdir(), 'pgmaps-gtfs-'))
  const zipPath = path.join(tempDir, 'gtfs.zip')
  await writeFile(zipPath, Buffer.from(await response.arrayBuffer()))

  const python = String.raw`
import csv, json, sys, zipfile
from collections import defaultdict

zip_path = sys.argv[1]
with zipfile.ZipFile(zip_path) as z:
    def rows(name):
        with z.open(name) as f:
            return list(csv.DictReader((line.decode('utf-8-sig') for line in f)))

    stop_times = rows('stop_times.txt')

events = defaultdict(int)
first = {}
last = {}
for row in stop_times:
    stop_id = (row.get('stop_id') or '').strip()
    time = (row.get('arrival_time') or row.get('departure_time') or '').strip()
    if not stop_id or ':' not in time:
        continue
    parts = time.split(':')
    try:
        seconds = int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
    except Exception:
        continue
    events[stop_id] += 1
    first[stop_id] = min(first.get(stop_id, seconds), seconds)
    last[stop_id] = max(last.get(stop_id, seconds), seconds)

summary = []
for stop_id, count in events.items():
    span = max(0, (last[stop_id] - first[stop_id]) / 3600)
    summary.append({
        'stopId': stop_id,
        'weekdayTrips': count,
        'serviceSpanHours': round(span, 2),
    })
summary.sort(key=lambda item: item['stopId'])
print(json.dumps(summary, separators=(',', ':')))
`

  const result = spawnSync('python3', ['-c', python, zipPath], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr || 'Failed to parse GTFS feed')
  await mkdir(path.dirname(OUTPUT), { recursive: true })
  await writeFile(OUTPUT, `${result.stdout.trim()}\n`)
  console.log(`GTFS summary: wrote ${OUTPUT}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
