import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const GTFS_URL =
  process.env.PG_GTFS_URL || 'https://bct.tmix.se/Tmix.Cap.TdExport.WebApi/gtfs/?operatorIds=22'
const SUMMARY_OUTPUT = 'public/data/transit/prince_george_gtfs_summary.json'
const ROUTES_OUTPUT = 'public/data/transit/prince_george_gtfs_routes.geojson'
const SEGMENTS_OUTPUT = 'public/data/transit/prince_george_gtfs_route_segments.geojson'
const BUNDLES_OUTPUT = 'public/data/transit/prince_george_gtfs_route_bundles.geojson'
const ROADS_OUTPUT = 'public/data/citypg/roads.geojson'
const ROAD_LAYER_URL =
  'https://gishub.princegeorge.ca/server/rest/services/GroupMapServices/Transportation_Infrastructure/MapServer/37'
const PAGE_SIZE = 2000

function layerQueryUrl(layerUrl, offset) {
  const params = new URLSearchParams({
    where: '1=1',
    outFields: '*',
    outSR: '4326',
    f: 'geojson',
    resultRecordCount: String(PAGE_SIZE),
    resultOffset: String(offset),
  })
  return `${layerUrl}/query?${params.toString()}`
}

async function fetchGeojsonLayer(layerUrl) {
  const features = []
  let offset = 0
  let template = null

  while (true) {
    const response = await fetch(layerQueryUrl(layerUrl, offset))
    if (!response.ok) throw new Error(`Failed to fetch road centerlines: ${response.status}`)
    const geojson = await response.json()
    if (!template) template = { ...geojson, features }
    features.push(...geojson.features)
    if (!geojson.exceededTransferLimit || geojson.features.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  return template ?? { type: 'FeatureCollection', features }
}

async function main() {
  const response = await fetch(GTFS_URL)
  if (!response.ok) throw new Error(`Failed to fetch GTFS feed: ${response.status}`)
  const tempDir = await mkdtemp(path.join(tmpdir(), 'pgmaps-gtfs-'))
  const zipPath = path.join(tempDir, 'gtfs.zip')
  const roadsPath = path.join(tempDir, 'roads.geojson')
  await writeFile(zipPath, Buffer.from(await response.arrayBuffer()))
  const roadsGeojson = await fetchGeojsonLayer(ROAD_LAYER_URL)
  await writeFile(roadsPath, JSON.stringify(roadsGeojson))

  const python = String.raw`
import csv, json, math, sys, zipfile
from collections import defaultdict

zip_path = sys.argv[1]
roads_path = sys.argv[2]
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

LON0 = -122.78
LAT0 = 53.91
X_SCALE = 111320 * math.cos(math.radians(LAT0))
Y_SCALE = 110540
SNAP_TOLERANCE_M = 130
GRID_SIZE_M = 120

def to_xy(coord):
    return ((coord[0] - LON0) * X_SCALE, (coord[1] - LAT0) * Y_SCALE)

def to_lonlat(point):
    return [point[0] / X_SCALE + LON0, point[1] / Y_SCALE + LAT0]

def dist2(a, b):
    dx = a[0] - b[0]
    dy = a[1] - b[1]
    return dx * dx + dy * dy

def point_segment_projection(point, start, end):
    vx = end[0] - start[0]
    vy = end[1] - start[1]
    length2 = vx * vx + vy * vy
    if length2 == 0:
        return start, 0, math.sqrt(dist2(point, start))
    t = ((point[0] - start[0]) * vx + (point[1] - start[1]) * vy) / length2
    t = max(0, min(1, t))
    projected = (start[0] + t * vx, start[1] + t * vy)
    return projected, t, math.sqrt(dist2(point, projected))

def angle_penalty(a_start, a_end, b_start, b_end):
    ax = a_end[0] - a_start[0]
    ay = a_end[1] - a_start[1]
    bx = b_end[0] - b_start[0]
    by = b_end[1] - b_start[1]
    alen = math.hypot(ax, ay)
    blen = math.hypot(bx, by)
    if alen == 0 or blen == 0:
        return 0
    dot = abs((ax * bx + ay * by) / (alen * blen))
    dot = max(-1, min(1, dot))
    return (1 - dot) * 45

def flatten_road_coords(geometry):
    if not geometry:
        return []
    if geometry.get('type') == 'LineString':
        return [geometry.get('coordinates') or []]
    if geometry.get('type') == 'MultiLineString':
        return geometry.get('coordinates') or []
    return []

with open(roads_path) as f:
    roads_geojson = json.load(f)

road_segments = []
road_grid = defaultdict(list)
for feature in roads_geojson.get('features', []):
    props = feature.get('properties') or {}
    road_id = props.get('OBJECTID') or props.get('AssetID') or len(road_segments)
    road_name = props.get('FullName') or props.get('Location') or props.get('StrName') or ''
    for part_index, part in enumerate(flatten_road_coords(feature.get('geometry'))):
        for segment_index in range(len(part) - 1):
            start_ll = part[segment_index]
            end_ll = part[segment_index + 1]
            start_xy = to_xy(start_ll)
            end_xy = to_xy(end_ll)
            length = math.hypot(end_xy[0] - start_xy[0], end_xy[1] - start_xy[1])
            if length < 2:
                continue
            item = {
                'id': f'{road_id}:{part_index}:{segment_index}',
                'roadName': road_name,
                'start': start_xy,
                'end': end_xy,
                'startLL': start_ll,
                'endLL': end_ll,
                'length': length,
            }
            index = len(road_segments)
            road_segments.append(item)
            min_x = min(start_xy[0], end_xy[0]) - SNAP_TOLERANCE_M
            max_x = max(start_xy[0], end_xy[0]) + SNAP_TOLERANCE_M
            min_y = min(start_xy[1], end_xy[1]) - SNAP_TOLERANCE_M
            max_y = max(start_xy[1], end_xy[1]) + SNAP_TOLERANCE_M
            for gx in range(math.floor(min_x / GRID_SIZE_M), math.floor(max_x / GRID_SIZE_M) + 1):
                for gy in range(math.floor(min_y / GRID_SIZE_M), math.floor(max_y / GRID_SIZE_M) + 1):
                    road_grid[(gx, gy)].append(index)

def candidate_road_indices(point):
    gx = math.floor(point[0] / GRID_SIZE_M)
    gy = math.floor(point[1] / GRID_SIZE_M)
    candidates = set()
    for dx in range(-1, 2):
        for dy in range(-1, 2):
            candidates.update(road_grid.get((gx + dx, gy + dy), []))
    return candidates

def snap_route_segment(start_ll, end_ll):
    start_xy = to_xy(start_ll)
    end_xy = to_xy(end_ll)
    route_len = math.hypot(end_xy[0] - start_xy[0], end_xy[1] - start_xy[1])
    if route_len < 2:
        return None
    mid_xy = ((start_xy[0] + end_xy[0]) / 2, (start_xy[1] + end_xy[1]) / 2)
    candidates = candidate_road_indices(mid_xy) | candidate_road_indices(start_xy) | candidate_road_indices(end_xy)
    best = None
    for index in candidates:
        road = road_segments[index]
        mid_projected, mid_t, mid_dist = point_segment_projection(mid_xy, road['start'], road['end'])
        if mid_dist > SNAP_TOLERANCE_M:
            continue
        start_projected, start_t, start_dist = point_segment_projection(start_xy, road['start'], road['end'])
        end_projected, end_t, end_dist = point_segment_projection(end_xy, road['start'], road['end'])
        if max(start_dist, end_dist) > SNAP_TOLERANCE_M * 1.8:
            continue
        score = mid_dist + 0.25 * (start_dist + end_dist) + angle_penalty(start_xy, end_xy, road['start'], road['end'])
        if best is None or score < best['score']:
            best = {
                'score': score,
                'road': road,
                'start': start_projected,
                'end': end_projected,
                'startT': start_t,
                'endT': end_t,
                'fallback': False,
            }
    if best is None:
        return {
            'coordinates': [start_ll, end_ll],
            'segmentKey': None,
            'roadName': None,
            'snapped': False,
        }

    snapped_len = math.hypot(best['end'][0] - best['start'][0], best['end'][1] - best['start'][1])
    if snapped_len < 1:
        return None
    road = best['road']
    a = round(min(best['startT'], best['endT']) * road['length'] / 8) * 8
    b = round(max(best['startT'], best['endT']) * road['length'] / 8) * 8
    return {
        'coordinates': [to_lonlat(best['start']), to_lonlat(best['end'])],
        'segmentKey': f"{road['id']}:{a}:{b}",
        'roadName': road['roadName'],
        'snapped': True,
    }

def snap_point_to_road(coord):
    point = to_xy(coord)
    best = None
    for index in candidate_road_indices(point):
        road = road_segments[index]
        projected, t, distance_m = point_segment_projection(point, road['start'], road['end'])
        if distance_m > SNAP_TOLERANCE_M:
            continue
        if best is None or distance_m < best['distance']:
            best = {'distance': distance_m, 'projected': projected}
    return to_lonlat(best['projected']) if best else coord

snapped_features = []
for feature in features:
    snapped_coords = []
    snapped_count = 0
    for coord in feature['geometry']['coordinates']:
        snapped = snap_point_to_road(coord)
        if snapped != coord:
            snapped_count += 1
        if not snapped_coords or snapped_coords[-1] != snapped:
            snapped_coords.append(snapped)
    if len(snapped_coords) < 2:
        continue
    snapped_features.append({
        **feature,
        'geometry': {'type': 'LineString', 'coordinates': snapped_coords},
        'properties': {
            **feature['properties'],
            'snappedPointCount': snapped_count,
            'pointCount': len(feature['geometry']['coordinates']),
        }
    })
routes_geojson = {'type': 'FeatureCollection', 'features': snapped_features}

def rounded_coord_key(coord):
    return f'{round(coord[0], 5)},{round(coord[1], 5)}'

def undirected_edge_key(start, end):
    start_key = rounded_coord_key(start)
    end_key = rounded_coord_key(end)
    return ':'.join(sorted([start_key, end_key]))

def normalized_road_name(value):
    return (value or '').strip().lower()

def road_bucket_key(name, coord, bucket_m=90):
    if not name:
        return None
    point = to_xy(coord)
    return f"{normalized_road_name(name)}:{round(point[0] / bucket_m)}:{round(point[1] / bucket_m)}"

edge_routes = defaultdict(dict)
seen_route_road_buckets = set()
for feature in snapped_features:
    props = feature['properties']
    route_short_name = props['routeShortName']
    coords = feature['geometry']['coordinates']
    for index in range(len(coords) - 1):
        start = coords[index]
        end = coords[index + 1]
        if start == end:
            continue
        start_xy = to_xy(start)
        end_xy = to_xy(end)
        if math.hypot(end_xy[0] - start_xy[0], end_xy[1] - start_xy[1]) < 3:
            continue
        road_match = snap_route_segment(start, end)
        midpoint = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]
        road_bucket = road_bucket_key(road_match.get('roadName') if road_match else None, midpoint)
        if road_bucket:
            route_road_bucket = (route_short_name, road_bucket)
            if route_road_bucket in seen_route_road_buckets:
                continue
            seen_route_road_buckets.add(route_road_bucket)
        key = undirected_edge_key(start, end)
        start_key = rounded_coord_key(start)
        end_key = rounded_coord_key(end)
        existing = edge_routes[key].get(route_short_name)
        if existing:
            existing['shapeIds'].add(props['shapeId'])
            existing['headsigns'].update(props['headsigns'])
            existing['directions'].update(props['directions'])
            continue
        edge_routes[key][route_short_name] = {
            'route': props,
            'coordinates': [start, end],
            'startKey': start_key,
            'endKey': end_key,
            'shapeIds': {props['shapeId']},
            'headsigns': set(props['headsigns']),
            'directions': set(props['directions']),
            'roadName': road_match.get('roadName') if road_match else None,
        }

segment_features = []
for key, route_entries in edge_routes.items():
    routes_for_segment = sorted(route_entries.values(), key=lambda item: (
        int(item['route']['routeShortName']) if item['route']['routeShortName'].isdigit() else 9999,
        item['route']['routeShortName'],
    ))
    count = len(routes_for_segment)
    for index, entry in enumerate(routes_for_segment):
        route = entry['route']
        offset = 0 if count == 1 else (index - (count - 1) / 2) * 4
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
                'startKey': entry['startKey'],
                'endKey': entry['endKey'],
                'roadName': entry['roadName'],
                'snappedToRoad': True,
            },
        })

segment_features.sort(key=lambda feature: (
    feature['properties']['segmentKey'],
    int(feature['properties']['routeShortName']) if feature['properties']['routeShortName'].isdigit() else 9999,
    feature['properties']['routeShortName'],
))
segments_geojson = {'type': 'FeatureCollection', 'features': segment_features}

def extend_chain(chain, unused, adjacency, chain_indices, forward=True):
    while True:
        key = chain[-1]['key'] if forward else chain[0]['key']
        candidates = [idx for idx in adjacency.get(key, []) if idx in unused]
        if len(candidates) != 1:
            break
        idx = candidates[0]
        unused.remove(idx)
        chain_indices.add(idx)
        segment = bundle_seed_segments[idx]
        if segment['startKey'] == key:
            addition = {'key': segment['endKey'], 'coord': segment['coordinates'][1]}
        else:
            addition = {'key': segment['startKey'], 'coord': segment['coordinates'][0]}
        if forward:
            chain.append(addition)
        else:
            chain.insert(0, addition)
    return chain

bundle_groups = defaultdict(list)
for feature in segment_features:
    props = feature['properties']
    if not props.get('snappedToRoad'):
        continue
    key = (
        props['routeShortName'],
        props['routeId'],
        props['routeLongName'],
        props['routeColor'],
        props['routeTextColor'],
        props['segmentOffset'],
    )
    bundle_groups[key].append({
        'coordinates': feature['geometry']['coordinates'],
        'startKey': props['startKey'],
        'endKey': props['endKey'],
        'shapeIds': set(props['shapeIds']),
        'headsigns': set(props['headsigns']),
        'directions': set(props['directions']),
        'sharedRouteCount': props['sharedRouteCount'],
    })

bundle_features = []
for group_key, group_segments in bundle_groups.items():
    route_short_name, route_id, route_long_name, route_color, route_text_color, segment_offset = group_key
    bundle_seed_segments = group_segments
    adjacency = defaultdict(list)
    for idx, segment in enumerate(bundle_seed_segments):
        adjacency[segment['startKey']].append(idx)
        adjacency[segment['endKey']].append(idx)

    unused = set(range(len(bundle_seed_segments)))
    while unused:
        start_idx = None
        for idx in list(unused):
            segment = bundle_seed_segments[idx]
            if len(adjacency[segment['startKey']]) != 2 or len(adjacency[segment['endKey']]) != 2:
                start_idx = idx
                break
        if start_idx is None:
            start_idx = next(iter(unused))

        unused.remove(start_idx)
        chain_indices = {start_idx}
        start_segment = bundle_seed_segments[start_idx]
        chain = [
            {'key': start_segment['startKey'], 'coord': start_segment['coordinates'][0]},
            {'key': start_segment['endKey'], 'coord': start_segment['coordinates'][1]},
        ]
        chain = extend_chain(chain, unused, adjacency, chain_indices, forward=True)
        chain = extend_chain(chain, unused, adjacency, chain_indices, forward=False)

        if len(chain) < 2:
            continue
        coordinates = [point['coord'] for point in chain]

        shape_ids = set(start_segment['shapeIds'])
        headsigns = set(start_segment['headsigns'])
        directions = set(start_segment['directions'])
        max_shared = start_segment['sharedRouteCount']
        for idx in chain_indices:
            segment = bundle_seed_segments[idx]
            shape_ids.update(segment['shapeIds'])
            headsigns.update(segment['headsigns'])
            directions.update(segment['directions'])
            max_shared = max(max_shared, segment['sharedRouteCount'])

        bundle_features.append({
            'type': 'Feature',
            'id': f"{route_id}:{segment_offset}:{len(bundle_features)}",
            'geometry': {'type': 'LineString', 'coordinates': coordinates},
            'properties': {
                'routeId': route_id,
                'routeShortName': route_short_name,
                'routeLongName': route_long_name,
                'routeColor': route_color,
                'routeTextColor': route_text_color,
                'shapeIds': sorted(shape_ids),
                'headsigns': sorted(headsigns),
                'directions': sorted(directions),
                'sharedRouteCount': max_shared,
                'segmentOffset': segment_offset,
                'bundledSegmentCount': len(chain) - 1,
            },
        })

bundle_features.sort(key=lambda feature: (
    int(feature['properties']['routeShortName']) if feature['properties']['routeShortName'].isdigit() else 9999,
    feature['properties']['routeShortName'],
    feature['id'],
))
bundles_geojson = {'type': 'FeatureCollection', 'features': bundle_features}

print(json.dumps({'summary': summary, 'routes': routes_geojson, 'segments': segments_geojson, 'bundles': bundles_geojson}, separators=(',', ':')))
`

  const result = spawnSync('python3', ['-c', python, zipPath, roadsPath], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(result.stderr || 'Failed to parse GTFS feed')
  const payload = JSON.parse(result.stdout)
  await mkdir(path.dirname(SUMMARY_OUTPUT), { recursive: true })
  await writeFile(SUMMARY_OUTPUT, `${JSON.stringify(payload.summary)}\n`)
  await writeFile(ROUTES_OUTPUT, `${JSON.stringify(payload.routes)}\n`)
  await writeFile(SEGMENTS_OUTPUT, `${JSON.stringify(payload.segments)}\n`)
  await writeFile(BUNDLES_OUTPUT, `${JSON.stringify(payload.bundles)}\n`)
  await mkdir(path.dirname(ROADS_OUTPUT), { recursive: true })
  await writeFile(ROADS_OUTPUT, `${JSON.stringify(roadsGeojson)}\n`)
  console.log(`GTFS summary: wrote ${SUMMARY_OUTPUT}`)
  console.log(`GTFS routes: wrote ${ROUTES_OUTPUT}`)
  console.log(`GTFS route segments: wrote ${SEGMENTS_OUTPUT}`)
  console.log(`GTFS route bundles: wrote ${BUNDLES_OUTPUT}`)
  console.log(`CityPG roads: wrote ${roadsGeojson.features.length} features to ${ROADS_OUTPUT}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
