"""Build the app-owned Prince George pilot for the shared Flatten engine.

Requires numpy, scipy and Pillow. Run with --cache DIR to retain downloaded
Terrarium tiles. OSM node IDs preserve junctions and separated bridge crossings.
No endpoints are joined by proximity or by intersecting road drawings.
"""
import argparse
import concurrent.futures
import gzip
import hashlib
import io
import json
import math
from collections import Counter
from pathlib import Path
import urllib.request

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

ROOT = Path(__file__).resolve().parent.parent
BBOX = (-122.92, 53.81, -122.62, 54.02)
ZOOM = 13
THRESHOLDS = [3, 5, 8, 10, 15]
TILE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'


def pixel(lon, lat):
    scale = 256 * 2 ** ZOOM
    return ((np.asarray(lon) + 180) / 360 * scale,
            (1 - np.arcsinh(np.tan(np.radians(lat))) / np.pi) / 2 * scale)


def lonlat(x, y):
    scale = 256 * 2 ** ZOOM
    return x / scale * 360 - 180, math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / scale))))


def length(a, b):
    lon1, lat1 = map(math.radians, a)
    lon2, lat2 = map(math.radians, b)
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 6371008.8 * 2 * math.asin(min(1, math.sqrt(h)))


def polyline(coords):
    out, previous = [], [0, 0]
    for lon, lat in coords:
        for index, value in enumerate([round(lat * 1e5), round(lon * 1e5)]):
            delta = value - previous[index]
            previous[index] = value
            encoded = ~(delta << 1) if delta < 0 else delta << 1
            while encoded >= 32:
                out.append(chr((encoded & 31 | 32) + 63))
                encoded >>= 5
            out.append(chr(encoded + 63))
    return ''.join(out)


def permissions(tags):
    cls = tags['highway']
    access = tags.get('access', '') not in ['no', 'private']
    walk = access and cls not in ['motorway', 'motorway_link']
    bike = access and cls not in ['motorway', 'motorway_link', 'steps', 'footway', 'pedestrian']
    for mode, default in [('foot', walk), ('bicycle', bike)]:
        value = tags.get(mode)
        allowed = default if value is None else value not in ['no', 'private', 'use_sidepath']
        if mode == 'foot': walk = allowed
        else: bike = allowed and cls != 'steps'
    return walk, bike


def comfort(tags):
    cls = tags['highway']
    value = {'cycleway': .8, 'living_street': .9, 'path': 1., 'residential': 1., 'service': 1.1,
             'tertiary': 1.2, 'footway': 1.3, 'secondary': 1.4, 'primary': 1.6, 'trunk': 2.}.get(cls, 1.1)
    facilities = [v for k, v in tags.items() if k.startswith('cycleway')]
    if any(v in ['track', 'separate'] for v in facilities): value = .8
    elif 'lane' in facilities: value = min(value, 1.)
    return value


def build(cache):
    snapshot = ROOT / 'scripts/flatten-pg-source.json.gz'
    osm = json.loads(gzip.decompress(snapshot.read_bytes()))
    nodes = {e['id']: (e['lon'], e['lat']) for e in osm['elements'] if e['type'] == 'node' and 'lon' in e}
    ways = [e for e in osm['elements'] if e['type'] == 'way' and e.get('tags', {}).get('highway')
            and any(permissions(e['tags'])) and all(n in nodes for n in e['nodes'])]
    # A junction has the same OSM node ID in multiple ways. Break long runs at
    # existing vertices as well, keeping the uint16 metric range and profiles.
    uses = Counter(n for way in ways for n in way['nodes'])
    edges = []
    for way in ways:
        ids = way['nodes']
        start, distance = 0, 0.
        for index in range(1, len(ids)):
            distance += length(nodes[ids[index - 1]], nodes[ids[index]])
            if uses[ids[index]] > 1 or distance >= 150 or index == len(ids) - 1:
                coords = [nodes[n] for n in ids[start:index + 1]]
                if distance >= .5 and ids[start] != ids[index]:
                    # Sparse ways can have a single segment longer than 3 km;
                    # subdivision adds real points on that geometry, no links.
                    pieces = max(1, math.ceil(distance / 1000))
                    if pieces == 1:
                        edges.append((ids[start], ids[index], coords, way['tags']))
                    else:
                        stations = np.r_[0., np.cumsum([length(a, b) for a, b in zip(coords, coords[1:])])]
                        for piece in range(pieces):
                            left, right = distance * piece / pieces, distance * (piece + 1) / pieces
                            p = tuple(float(np.interp(left, stations, np.array(coords)[:, k])) for k in range(2))
                            q = tuple(float(np.interp(right, stations, np.array(coords)[:, k])) for k in range(2))
                            interior = [c for c, d in zip(coords, stations) if left < d < right]
                            u = ids[start] if piece == 0 else f'{way["id"]}:{start}:{piece}'
                            v = ids[index] if piece == pieces - 1 else f'{way["id"]}:{start}:{piece+1}'
                            nodes[u], nodes[v] = p, q
                            edges.append((u, v, [p, *interior, q], way['tags']))
                start, distance = index, 0.
    print(f'{len(ways)} public ways, {len(edges)} geometry edges', flush=True)

    west, south, east, north = BBOX
    # Include all fetched way vertices: Overpass returns whole boundary ways.
    coords = np.array([p for _, _, points, _ in edges for p in points])
    px, py = pixel(coords[:, 0], coords[:, 1])
    x0, x1 = int(np.floor(px.min() / 256)), int(np.floor(px.max() / 256))
    y0, y1 = int(np.floor(py.min() / 256)), int(np.floor(py.max() / 256))
    tiles = [(x, y) for y in range(y0, y1 + 1) for x in range(x0, x1 + 1)]
    mosaic = np.zeros(((y1 - y0 + 1) * 256, (x1 - x0 + 1) * 256), dtype=np.float32)
    hashes = {}
    cache.mkdir(parents=True, exist_ok=True)
    def fetch(tile):
        x, y = tile
        path = cache / f'{ZOOM}-{x}-{y}.png'
        if not path.exists():
            url = TILE_URL.format(z=ZOOM, x=x, y=y)
            for attempt in range(3):
                try:
                    data = urllib.request.urlopen(url, timeout=30).read()
                    Image.open(io.BytesIO(data)).verify()
                    path.write_bytes(data)
                    break
                except Exception:
                    if attempt == 2: raise
        data = path.read_bytes()
        rgb = np.array(Image.open(io.BytesIO(data)).convert('RGB'), dtype=np.float32)
        return x, y, rgb[:, :, 0] * 256 + rgb[:, :, 1] + rgb[:, :, 2] / 256 - 32768, hashlib.sha256(data).hexdigest()
    with concurrent.futures.ThreadPoolExecutor(6) as pool:
        for count, (x, y, z, digest) in enumerate(pool.map(fetch, tiles), 1):
            mosaic[(y - y0) * 256:(y - y0 + 1) * 256, (x - x0) * 256:(x - x0 + 1) * 256] = z
            hashes[f'{ZOOM}/{x}/{y}'] = digest
            if count % 20 == 0: print(f'Elevation tiles: {count}/{len(tiles)}', flush=True)
    # The raster is regional terrain, not lidar survey data. Smooth at roughly
    # one source pixel and interpolate bilinearly; do not round samples first.
    mosaic = gaussian_filter(mosaic, .6)
    def elevations(points):
        p = np.asarray(points)
        x, y = pixel(p[:, 0], p[:, 1])
        x, y = np.clip(x - x0 * 256 - .5, 0, mosaic.shape[1] - 1.001), np.clip(y - y0 * 256 - .5, 0, mosaic.shape[0] - 1.001)
        ix, iy = x.astype(int), y.astype(int)
        fx, fy = x - ix, y - iy
        return ((1 - fy) * ((1 - fx) * mosaic[iy, ix] + fx * mosaic[iy, ix + 1])
                + fy * ((1 - fx) * mosaic[iy + 1, ix] + fx * mosaic[iy + 1, ix + 1]))
    ids = list(dict.fromkeys(n for u, v, _, _ in edges for n in [u, v]))
    index = {n: i for i, n in enumerate(ids)}
    node_coords = np.array([nodes[n] for n in ids])
    node_z = elevations(node_coords)
    classes = sorted(set(tags['highway'] for _, _, _, tags in edges))
    names = sorted(set(tags.get('name', '') for _, _, _, tags in edges) - {''})
    cls_index, name_index = {c: i for i, c in enumerate(classes)}, {n: i + 1 for i, n in enumerate(names)}
    arcs, edge_data, parts, offsets = [], [], [], [0]
    for eid, (u, v, points, tags) in enumerate(edges):
        dist = np.r_[0., np.cumsum([length(a, b) for a, b in zip(points, points[1:])])]
        total = dist[-1]
        sample_d = np.linspace(0, total, max(3, math.ceil(total / 10) + 1))
        samples = np.column_stack([np.interp(sample_d, dist, np.array(points)[:, k]) for k in range(2)])
        z = elevations(samples)
        z[0], z[-1] = node_z[index[u]], node_z[index[v]]
        if tags.get('bridge', 'no') != 'no' or tags.get('tunnel', 'no') != 'no':
            z = np.linspace(z[0], z[-1], len(z))
        # Drop interior reversals below one metre, retaining both endpoints.
        turning = [float(z[0])]
        for value in z[1:]:
            if len(turning) > 1 and (turning[-1] - turning[-2]) * (value - turning[-1]) >= 0: turning[-1] = float(value)
            elif value != turning[-1]: turning.append(float(value))
        while len(turning) > 3:
            candidates = [(abs(turning[i + 1] - turning[i]), i) for i in range(1, len(turning) - 2)]
            delta, i = min(candidates)
            if delta >= 1: break
            del turning[i:i + 2]
        changes = np.diff(turning)
        gain, loss = float(changes[changes > 0].sum()), float(-changes[changes < 0].sum())
        lengths = np.diff(sample_d)
        grades = np.clip(np.diff(z) / lengths, -.6, .6)
        absolute = float(np.max(np.abs(grades)))
        walk, bike = permissions(tags)
        oneway = tags.get('oneway', 'yes' if tags.get('junction') == 'roundabout' else 'no')
        for reverse in [False, True]:
            w = walk and not (reverse and tags.get('oneway:foot') == 'yes')
            b = bike and (tags.get('oneway:bicycle') == 'no' or oneway not in ['yes', '1', 'true', '-1'] or (reverse == (oneway == '-1')))
            flags = int(w) | int(b) << 1 | int(reverse) << 2
            if not (flags & 3): continue
            signed = -grades if reverse else grades
            arcs.append({'u': index[v if reverse else u], 'head': index[u if reverse else v], 'edge': eid,
                         'len': total, 'gain': loss if reverse else gain, 'loss': gain if reverse else loss,
                         'maxgrade': float(signed.max()), 'meangrade': float(np.sum(np.abs(grades) * lengths) / total),
                         'cls': cls_index[tags['highway']], 'flags': flags,
                         **{f'th{t}': float(lengths[signed >= t / 100].sum()) for t in THRESHOLDS}})
        encoded = polyline(points)
        parts.append(encoded); offsets.append(offsets[-1] + len(encoded))
        edge_data.append({'name': name_index.get(tags.get('name'), 0), 'cls': cls_index[tags['highway']],
                          'bucket': int(np.searchsorted([.03, .05, .08, .1, .15], absolute)), 'maxgrade': absolute,
                          'avggrade': (z[-1] - z[0]) / total, 'len': total, 'gainkm': gain / total * 1000,
                          'lowstress': int(comfort(tags) <= 1.), 'stress': comfort(tags)})
    node_flags = np.zeros(len(ids), dtype=np.uint8)
    # Match the upstream engine's per-mode largest strongly connected network.
    for bit in [1, 2]:
        allowed = [a for a in arcs if a['flags'] & bit]
        f, t = np.array([a['u'] for a in allowed]), np.array([a['head'] for a in allowed])
        adj = coo_matrix((np.ones(len(f)), (f, t)), shape=(len(ids), len(ids))).tocsr()
        _, labels = connected_components(adj, directed=True, connection='strong')
        touched = np.unique(np.r_[f, t])
        biggest = np.bincount(labels[touched]).argmax()
        valid = labels == biggest
        node_flags[valid] |= bit
        for a in arcs:
            if not (valid[a['u']] and valid[a['head']]): a['flags'] &= ~bit
        print(f'{"Walk" if bit == 1 else "Bike"}: {valid.sum()} connected nodes', flush=True)
    arcs = sorted([a for a in arcs if a['flags'] & 3], key=lambda a: a['u'])
    indptr = np.r_[0, np.cumsum(np.bincount([a['u'] for a in arcs], minlength=len(ids)))].astype('<i4')
    def quant(values, scale, dtype):
        info = np.iinfo(dtype)
        return np.clip(np.rint(np.asarray(values) * scale), info.min, info.max).astype(dtype)
    arrays = {'node_lon': quant(node_coords[:, 0], 1e6, '<i4'), 'node_lat': quant(node_coords[:, 1], 1e6, '<i4'),
              'node_flags': node_flags, 'node_elev': quant(node_z, 20, '<i2'), 'indptr': indptr, 'geom_off': np.array(offsets, dtype='<i4')}
    for field in ['head', 'edge', 'len', 'gain', 'loss', 'maxgrade', 'meangrade', 'cls', 'flags'] + [f'th{t}' for t in THRESHOLDS]:
        dtype = '<i4' if field in ['head', 'edge'] else '<u1' if field in ['cls', 'flags'] else '<i2' if field == 'maxgrade' else '<u2'
        scale = 20 if field == 'len' or field.startswith('th') else 100 if field in ['gain', 'loss'] else 10000 if 'grade' in field else 1
        arrays['arc_' + field] = quant([a[field] for a in arcs], scale, dtype)
    for field in edge_data[0]:
        dtype = '<i2' if field == 'avggrade' else '<u1' if field in ['cls', 'bucket', 'lowstress', 'stress'] else '<u2'
        scale = 10000 if 'grade' in field else 20 if field in ['len', 'gainkm'] else 100 if field == 'stress' else 1
        arrays['edge_' + field] = quant([e[field] for e in edge_data], scale, dtype)
    # Named OSM amenities/parks supply local place search; intersections are
    # derived by the existing search engine. No invented addresses or POIs.
    places = {}
    for e in osm['elements']:
        tags = e.get('tags', {}); p = e.get('center', e)
        if tags.get('name') and ('amenity' in tags or tags.get('leisure') == 'park') and 'lon' in p:
            if west <= p['lon'] <= east and south <= p['lat'] <= north:
                places.setdefault(tags['name'], (p['lon'], p['lat']))
                if tags.get('short_name'):
                    places.setdefault(tags['short_name'], (p['lon'], p['lat']))
    strings = {'geom': ''.join(parts), 'places': json.dumps({'names': list(places), 'groups': ['place'], 'group': [0] * len(places),
                                                           'lon': [p[0] for p in places.values()], 'lat': [p[1] for p in places.values()]})}
    blobs, manifest, offset = [], {'arrays': {}, 'strings': {}}, 0
    tags = {'int32': 'i4', 'int16': 'i2', 'uint16': 'u2', 'uint8': 'u1'}
    for key, array in arrays.items():
        padding = (-offset) % array.dtype.itemsize
        if padding: blobs.append(bytes(padding)); offset += padding
        data = array.tobytes(); manifest['arrays'][key] = {'t': tags[array.dtype.name], 'o': offset, 'n': array.size}
        blobs.append(data); offset += len(data)
    for key, value in strings.items():
        data = value.encode(); manifest['strings'][key] = {'o': offset, 'b': len(data)}
        blobs.append(data); offset += len(data)
    manifest['bytes'] = offset
    packed = gzip.compress(b''.join(blobs), compresslevel=9, mtime=0)
    out = ROOT / 'public/data/flatten-pg'; out.mkdir(parents=True, exist_ok=True)
    filename = 'graph-' + hashlib.sha256(packed).hexdigest()[:10] + '.bin.gz'
    (out / filename).write_bytes(packed)
    # Match the map's image source, in Web Mercator with exact tile bounds.
    metres_per_pixel = 2 * math.pi * 6378137 * math.cos(math.radians(53.92)) / (256 * 2 ** ZOOM)
    dy, dx = np.gradient(mosaic, metres_per_pixel)
    light = np.clip((.8 - .6 * dx + .6 * dy) / np.sqrt(1 + dx * dx + dy * dy), 0, 1)
    shade = Image.fromarray(np.uint8(light * 255), mode='L')
    shade.thumbnail((2048, 2048), Image.Resampling.LANCZOS)
    buffer = io.BytesIO(); shade.save(buffer, format='PNG', optimize=True)
    shade_name = 'hillshade-' + hashlib.sha256(buffer.getvalue()).hexdigest()[:10] + '.png'
    (out / shade_name).write_bytes(buffer.getvalue())
    nw, se = lonlat(x0 * 256, y0 * 256), lonlat((x1 + 1) * 256, (y1 + 1) * 256)
    data = {'manifest': manifest, 'meta': {'n_nodes': len(ids), 'n_arcs': len(arcs), 'n_edges': len(edges), 'classes': classes, 'names': names,
            'thresholds': THRESHOLDS, 'scales': {'dm': 20, 'cm': 100, 'grade': 10000, 'coord': 1e6, 'stress': 100},
            'bikeways': False, 'multipliers': {'walk': [1.] * len(classes), 'bike': [1.] * len(classes)}},
            'labels': [{'n': 'Downtown', 'lon': -122.747, 'lat': 53.917}, {'n': 'College Heights', 'lon': -122.805, 'lat': 53.874},
                       {'n': 'Hart', 'lon': -122.789, 'lat': 53.988}, {'n': 'UNBC', 'lon': -122.814, 'lat': 53.893},
                       {'n': 'Lheidli T’enneh Memorial Park', 'lon': -122.732, 'lat': 53.905}],
            'default': [{'label': 'Prince George City Hall', 'lon': -122.7453699, 'lat': 53.9127927},
                        {'label': 'University of Northern British Columbia', 'lon': -122.8149252, 'lat': 53.891548}],
            'bundle_url': filename, 'bundle_bytes': len(packed),
            'hillshade': {'url': shade_name, 'bounds': [[se[1], nw[0]], [nw[1], se[0]]]}}
    (ROOT / 'src/pages/dev-flatten/data-pg.json').write_text(json.dumps(data, indent=2) + '\n')
    provenance = {'city': 'Prince George', 'bbox': BBOX, 'osm_timestamp': osm['osm3s']['timestamp_osm_base'],
                  'streets_source': 'https://www.openstreetmap.org/copyright', 'streets_license': 'ODbL-1.0',
                  'osm_snapshot_sha256': hashlib.sha256(snapshot.read_bytes()).hexdigest(),
                  'elevation_source': 'https://registry.opendata.aws/terrain-tiles/', 'tile_url': TILE_URL,
                  'elevation_tiles_sha256': hashes, 'terrain_zoom': ZOOM, 'sample_spacing_m': 10,
                  'notes': 'Regional terrain estimates, not lidar. Bridges/tunnels interpolate between terrain elevations at endpoints. OSM turn restrictions are not modelled.'}
    (out / 'sources.json').write_text(json.dumps(provenance, indent=2) + '\n')
    print(f'Built {len(ids)} nodes, {len(arcs)} directed arcs, {len(places)} places; bundle {len(packed):,} bytes', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, default=Path.home() / '.cache/pgmaps/flatten-pg')
    build(parser.parse_args().cache)
