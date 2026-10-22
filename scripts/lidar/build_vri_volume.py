"""Clip pinned VRI rank-1 volumes to the real LiDAR support; no wood-volume inference.

Areas use BC Albers like PGMaps AVAST. LiDAR heights are context only.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import rasterio
from rasterio.features import geometry_mask, shapes
from rasterio.windows import from_bounds, Window
from pyproj import Transformer
from shapely import transform, union_all, make_valid
from shapely.geometry import shape, mapping


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def polygonal(g):
    if g.geom_type in ['Polygon', 'MultiPolygon']:
        return g
    return union_all([p for p in g.geoms if p.geom_type in ['Polygon', 'MultiPolygon']])


def build(analysis, inventory_path, metadata_path, output):
    summary = json.loads((analysis / 'summary.json').read_text())
    inventory = json.loads(inventory_path.read_text())
    metadata = json.loads(metadata_path.read_text())
    if metadata['source_sha256'] != summary['source_sha256']:
        raise ValueError('Inventory query source mismatch')
    if inventory['numberMatched'] != len(inventory['features']):
        raise ValueError('Incomplete inventory snapshot')
    ids = [str(f['properties']['FEATURE_ID']) for f in inventory['features']]
    if len(ids) != len(set(ids)):
        raise ValueError('Duplicate VRI feature IDs')
    to_albers = Transformer.from_crs(4326, 3005, always_xy=True).transform
    grid_to_albers = Transformer.from_crs(3157, 3005, always_xy=True).transform
    to_geo = Transformer.from_crs(3005, 4326, always_xy=True).transform
    to_grid = Transformer.from_crs(4326, 3157, always_xy=True).transform
    project = lambda g, fn: transform(g, fn, interleaved=False)
    with rasterio.open(analysis / 'height-1m.tif') as src:
        if src.crs.to_epsg() != 3157 or src.res != (1, 1):
            raise ValueError('Expected the original EPSG:3157 1 m height grid')
        height = src.read(1, masked=True)
        valid = ~np.ma.getmaskarray(height) & np.isfinite(height.data)
        footprint_grid = union_all([shape(g) for g, v in shapes(valid.astype('uint8'), mask=valid, transform=src.transform) if v])
        footprint = project(footprint_grid, grid_to_albers)
        pieces, geometries = [], []
        for f in sorted(inventory['features'], key=lambda f: f['properties']['FEATURE_ID']):
            p = f['properties']
            raw = shape(f['geometry'])
            g = polygonal(make_valid(project(raw, to_albers)).intersection(footprint))
            if g.is_empty or g.area < 1e-6:
                continue
            grid_geometry = project(raw, to_grid)
            window = from_bounds(*grid_geometry.bounds, src.transform).round_offsets().round_lengths().intersection(Window(0, 0, src.width, src.height))
            # Integer array bounds enclose the clipped geometry; masks stay on source pixel centres.
            r0, c0 = max(0, int(window.row_off)), max(0, int(window.col_off))
            r1, c1 = min(src.height, int(window.row_off + window.height) + 1), min(src.width, int(window.col_off + window.width) + 1)
            clip_window = Window(c0, r0, c1-c0, r1-r0)
            local_valid = valid[r0:r1, c0:c1]
            inside = geometry_mask([mapping(grid_geometry)], out_shape=local_valid.shape, transform=src.window_transform(clip_window), invert=True)
            values = height.data[r0:r1, c0:c1][inside & local_valid]
            if not np.all(np.isfinite(values)):
                raise ValueError('Invalid height context')
            pieces.append({'type': 'Feature', 'geometry': mapping(project(g, to_geo)), 'properties': {
                'id': f"vri-{p['FEATURE_ID']}", 'area_ha': g.area / 10000, 'inventory': p,
                'lidar': {'cells': int(len(values)), 'canopy_percent': float(np.mean(values >= 2) * 100) if len(values) else None,
                          'surface_p95_m': float(np.quantile(values, .95)) if len(values) else None}}})
            geometries.append(g)
    combined = union_all(geometries)
    overlap = (sum(g.area for g in geometries) - combined.area) / 10000
    if overlap > 1e-5:
        raise ValueError(f'VRI pieces overlap by {overlap} ha; resolve before summing')
    treed_area = sum(f['properties']['area_ha'] for f in pieces if f['properties']['inventory']['BCLCS_LEVEL_2'] == 'T')
    centre = footprint.representative_point()
    payload = {
        'schema_version': 1, 'source_sha256': summary['source_sha256'], 'height_sha256': sha(analysis / 'height-1m.tif'),
        'source': {'publisher': 'Province of British Columbia · Forest Analysis and Inventory Branch',
                   'licence': 'Open Government Licence – British Columbia',
                   'catalogue': 'https://catalogue.data.gov.bc.ca/dataset/2ebb35d8-c82f-4a17-9c96-612ac3532d55',
                   'dictionary': 'https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/forestry/stewardship/forest-analysis-inventory/data-management/standards/vegcomp_poly_rank1_data_dictionaryv5_2019.pdf',
                   'request_url': metadata['request_url'], 'retrieved_utc': metadata['retrieved_utc'], 'inventory_sha256': sha(inventory_path),
                   'matched': inventory['numberMatched'], 'projected_dates': sorted({f['properties'].get('PROJECTED_DATE', '') for f in inventory['features']}),
                   'main_reference': 'PGMaps main 0c5e454 · dev-avast/vriFill.ts and dev-forestry/bcVegetationInventory.ts'},
        'centre': list(to_geo(centre.x, centre.y)),
        'bounds': list(project(footprint, to_geo).bounds),
        'coverage': {'supported_ha': footprint.area / 10000, 'mapped_ha': sum(f['properties']['area_ha'] for f in pieces),
                     'treed_ha': treed_area, 'non_treed_ha': combined.area / 10000 - treed_area,
                     'unmapped_ha': footprint.difference(combined).area / 10000, 'overlap_ha': max(0, overlap)},
        'area_method': 'Original VRI polygons intersected with valid native 1 m LiDAR-height support; planar EPSG:3005 hectares, as in AVAST. Whole-stand density is uniform within each clipped inventory piece.',
        'limitations': ['VRI modelled net rank-1 volumes, not a new LiDAR volume model or a timber cruise.',
                        'Net fields already deduct decay, waste and breakage; no second defect deduction.',
                        'Inventory projected date is not the field measurement or LiDAR acquisition date. Later disturbance is not automatically removed.',
                        'LiDAR CHM p95 and inventory leading-species height are different statistics; no automatic height rescaling.',
                        'Null dead or utilization fields remain unreported. Known live-only sums are labelled partial if dead inclusion is requested.',
                        'No AVAST LiDAR calibration factor, slope split or automatic harvestability determination is applied.'],
        'stands': {'type': 'FeatureCollection', 'features': pieces},
    }
    output.write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n')
    live = [(f['properties']['area_ha'], f['properties']['inventory'].get('LIVE_STAND_VOLUME_175')) for f in pieces if f['properties']['inventory']['BCLCS_LEVEL_2'] == 'T']
    print(json.dumps({'pieces': len(pieces), 'treed_pieces': len(live), 'coverage': payload['coverage'],
                      'live_175_m3': sum(a*v for a, v in live if v is not None and v >= 0)}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--analysis', type=Path, default=Path('public/data/lidar-analysis/bc-093g086'))
    parser.add_argument('--inventory', type=Path, default=Path('scripts/lidar/sources/volume-vri.geojson'))
    parser.add_argument('--metadata', type=Path, default=Path('scripts/lidar/sources/volume-vri.metadata.json'))
    parser.add_argument('--output', type=Path, default=Path('src/pages/dev-lidar/volume/vri.generated.json'))
    args = parser.parse_args()
    build(args.analysis, args.inventory, args.metadata, args.output)
