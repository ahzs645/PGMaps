import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const GTFS_URL =
  process.env.PG_GTFS_URL || 'https://bct.tmix.se/Tmix.Cap.TdExport.WebApi/gtfs/?operatorIds=22'
const SUMMARY_OUTPUT = 'public/data/transit/prince_george_gtfs_summary.json'
const ROUTES_OUTPUT = 'public/data/transit/prince_george_gtfs_routes.geojson'
const SEGMENTS_OUTPUT = 'public/data/transit/prince_george_gtfs_route_segments.geojson'

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

    routes = rows('routes.txt')
    trips = rows('trips.txt')
    shapes = rows('shapes.txt')
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

route_by_id = {}
for row in routes:
    route_id = (row.get('route_id') or '').strip()
    if route_id:
        route_by_id[route_id] = row

route_for_shape = {}
headsigns_by_shape = defaultdict(set)
directions_by_shape = defaultdict(set)
for row in trips:
    route_id = (row.get('route_id') or '').strip()
    shape_id = (row.get('shape_id') or '').strip()
    if not route_id or not shape_id:
        continue
    route_for_shape.setdefault(shape_id, route_id)
    if row.get('trip_headsign'):
        headsigns_by_shape[shape_id].add(row['trip_headsign'].strip())
    if row.get('direction_id') not in (None, ''):
        directions_by_shape[shape_id].add(str(row['direction_id']).strip())

points_by_shape = defaultdict(list)
for row in shapes:
    shape_id = (row.get('shape_id') or '').strip()
    if not shape_id:
        continue
    try:
        lat = float(row.get('shape_pt_lat') or '')
        lon = float(row.get('shape_pt_lon') or '')
        seq = int(float(row.get('shape_pt_sequence') or 0))
    except Exception:
        continue
    points_by_shape[shape_id].append((seq, lon, lat))

features = []
for shape_id, points in points_by_shape.items():
    route_id = route_for_shape.get(shape_id)
    route = route_by_id.get(route_id)
    if not route:
        continue
    coords = [[lon, lat] for seq, lon, lat in sorted(points)]
    if len(coords) < 2:
        continue
    short_name = (route.get('route_short_name') or route_id.replace('-PRG', '')).strip()
    color = (route.get('route_color') or '').strip().lstrip('#') or '64748B'
    text_color = (route.get('route_text_color') or '').strip().lstrip('#') or 'FFFFFF'
    features.append({
        'type': 'Feature',
        'id': f'{route_id}:{shape_id}',
        'geometry': {'type': 'LineString', 'coordinates': coords},
        'properties': {
            'routeId': route_id,
            'routeShortName': short_name,
            'routeLongName': (route.get('route_long_name') or '').strip(),
            'routeColor': f'#{color.upper()}',
            'routeTextColor': f'#{text_color.upper()}',
            'shapeId': shape_id,
            'headsigns': sorted(headsigns_by_shape.get(shape_id, [])),
            'directions': sorted(directions_by_shape.get(shape_id, [])),
        },
    })

features.sort(key=lambda feature: (
    int(feature['properties']['routeShortName']) if feature['properties']['routeShortName'].isdigit() else 9999,
    feature['properties']['routeShortName'],
    feature['properties']['shapeId'],
))
routes_geojson = {'type': 'FeatureCollection', 'features': features}

segment_routes = defaultdict(dict)
for feature in features:
    props = feature['properties']
    route_short_name = props['routeShortName']
    coords = feature['geometry']['coordinates']
    for index in range(len(coords) - 1):
        start = coords[index]
        end = coords[index + 1]
        if start == end:
            continue
        rounded_start = (round(start[0], 5), round(start[1], 5))
        rounded_end = (round(end[0], 5), round(end[1], 5))
        key_parts = sorted([rounded_start, rounded_end])
        key = f'{key_parts[0][0]},{key_parts[0][1]}:{key_parts[1][0]},{key_parts[1][1]}'
        existing = segment_routes[key].get(route_short_name)
        if existing:
            existing['shapeIds'].add(props['shapeId'])
            existing['headsigns'].update(props['headsigns'])
            existing['directions'].update(props['directions'])
            continue
        segment_routes[key][route_short_name] = {
            'route': props,
            'coordinates': [start, end],
            'shapeIds': {props['shapeId']},
            'headsigns': set(props['headsigns']),
            'directions': set(props['directions']),
        }

segment_features = []
for key, route_entries in segment_routes.items():
    routes_for_segment = sorted(route_entries.values(), key=lambda item: (
        int(item['route']['routeShortName']) if item['route']['routeShortName'].isdigit() else 9999,
        item['route']['routeShortName'],
    ))
    count = len(routes_for_segment)
    for index, entry in enumerate(routes_for_segment):
        route = entry['route']
        offset = 0 if count == 1 else (index - (count - 1) / 2) * 5
        segment_features.append({
            'type': 'Feature',
            'id': f"{key}:{route['routeId']}",
            'geometry': {'type': 'LineString', 'coordinates': entry['coordinates']},
            'properties': {
                'segmentKey': key,
                'routeId': route['routeId'],
                'routeShortName': route['routeShortName'],
                'routeLongName': route['routeLongName'],
                'routeColor': route['routeColor'],
                'routeTextColor': route['routeTextColor'],
                'shapeIds': sorted(entry['shapeIds']),
                'headsigns': sorted(entry['headsigns']),
                'directions': sorted(entry['directions']),
                'sharedRouteCount': count,
                'segmentOffset': offset,
            },
        })

segment_features.sort(key=lambda feature: (
    feature['properties']['segmentKey'],
    int(feature['properties']['routeShortName']) if feature['properties']['routeShortName'].isdigit() else 9999,
    feature['properties']['routeShortName'],
))
segments_geojson = {'type': 'FeatureCollection', 'features': segment_features}

print(json.dumps({'summary': summary, 'routes': routes_geojson, 'segments': segments_geojson}, separators=(',', ':')))
`

  const result = spawnSync('python3', ['-c', python, zipPath], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr || 'Failed to parse GTFS feed')
  const payload = JSON.parse(result.stdout)
  await mkdir(path.dirname(SUMMARY_OUTPUT), { recursive: true })
  await writeFile(SUMMARY_OUTPUT, `${JSON.stringify(payload.summary)}\n`)
  await writeFile(ROUTES_OUTPUT, `${JSON.stringify(payload.routes)}\n`)
  await writeFile(SEGMENTS_OUTPUT, `${JSON.stringify(payload.segments)}\n`)
  console.log(`GTFS summary: wrote ${SUMMARY_OUTPUT}`)
  console.log(`GTFS routes: wrote ${ROUTES_OUTPUT}`)
  console.log(`GTFS route segments: wrote ${SEGMENTS_OUTPUT}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
