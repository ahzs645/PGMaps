"""Build a completed, source-backed ABA volume example; never transfer it to BC.

Inputs: the pinned 2026_lidRtutorial CSV, field-plot GPKGs, metric TIFF and
forest-mask GPKG. Dependencies: numpy, scipy, rasterio, shapely, pyproj.
"""
import argparse
import csv
import hashlib
import json
import sqlite3
import urllib.request
from pathlib import Path

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.features import rasterize
from rasterio.windows import from_bounds
from scipy.spatial import Delaunay
from shapely import from_wkb
from shapely.geometry import mapping
from shapely.ops import transform

COMMIT = '20ee19167c317e2f7209bf2f61170bf71f4a8148'
REPOSITORY = 'https://github.com/james-f-mcglade/2026_lidRtutorial'
FILES = {
    'plots_all.csv': 'data/plots/plots_all.csv',
    'fm_efi_plots.gpkg': 'data/plots/fm_efi_plots.gpkg',
    'ctg_plots.gpkg': 'data/plots/ctg_plots.gpkg',
    'fm_mets_20m.tif': 'data/metrics/fm_mets_20m.tif',
    'forest_mask.gpkg': 'data/forest_mask.gpkg',
}
EXPECTED_SHA256 = {
    'plots_all.csv': 'b63e1fa2f4c1a1502257998838ceb89a5459b4609100d24f244530c5e79bb410',
    'fm_efi_plots.gpkg': '3d57a7c94c4077ed6314311cf99dcd6917c8d811f34c3d71326ecd35acbbcac6',
    'ctg_plots.gpkg': '30ef731f1a4f59e395b7aaf0a63e2d056bf9678a43c7262db59204b82fcf7c1c',
    'fm_mets_20m.tif': '5e173a58fc473d335e87c7ea4821970a322bfc53cf334556c202e6a7e5dcc173',
    'forest_mask.gpkg': 'bf84977af8d145a37faea54c81145692c0e9ca22804a17f634300bbdb97fb219',
}


def gpkg(path):
    with sqlite3.connect(path) as db:
        db.row_factory = sqlite3.Row
        table, crs = db.execute('SELECT table_name,srs_id FROM gpkg_contents').fetchone()
        geom_column = db.execute('SELECT column_name FROM gpkg_geometry_columns').fetchone()[0]
        rows = []
        for row in db.execute(f'SELECT * FROM "{table}"'):
            row = dict(row)
            raw = row.pop(geom_column)
            envelope = (raw[3] >> 1) & 7
            offset = 8 + [0, 32, 48, 48, 64][envelope]
            row['geometry'] = from_wkb(raw[offset:])
            rows.append(row)
    return rows, crs


def score(observed, predicted):
    error = predicted - observed
    tss = np.sum((observed - np.mean(observed)) ** 2)
    return {'rmse_m3_ha': float(np.sqrt(np.mean(error ** 2))),
            'bias_m3_ha': float(np.mean(error)),
            'r2': float(1 - np.sum(error ** 2) / tss) if tss > 0 else None}


def fit(x, y):
    coefficients, _, rank, _ = np.linalg.lstsq(x, y, rcond=None)
    if rank != x.shape[1]:
        raise ValueError('Rank-deficient training data')
    return coefficients


def build(inputs, output):
    for name in FILES:
        if hashlib.sha256((inputs / name).read_bytes()).hexdigest() != EXPECTED_SHA256[name]:
            raise ValueError(f'Pinned input checksum mismatch: {name}')
    with (inputs / 'plots_all.csv').open() as f:
        rows = list(csv.DictReader(f))
    fields, crs = gpkg(inputs / 'fm_efi_plots.gpkg')
    by_id = {r['plot_id']: r for r in fields}
    assert len(rows) == len(by_id) == 169
    assert len({r['plot_id'] for r in rows}) == len(rows)
    for r in rows:
        assert abs(float(r['merch_vol_ha']) - by_id[r['plot_id']]['merch_vol_ha']) < 1e-6
    x = np.array([[1, float(r['zq95']), float(r['zskew']), float(r['pzabove2'])] for r in rows])
    y = np.array([float(r['merch_vol_ha']) for r in rows])
    assert np.all(np.isfinite(x)) and np.all(np.isfinite(y)) and np.all(y >= 0)
    # Fixed geographic bands ordered west to east. Each prediction is made by a
    # model trained without that entire band; no response-driven selection/tuning.
    eastings = np.array([by_id[r['plot_id']]['geometry'].x for r in rows])
    groups = np.array_split(np.argsort(eastings, kind='stable'), 5)
    cv = np.full(len(y), np.nan)
    fold_ids = np.zeros(len(y), dtype=int)
    folds = []
    for fold, test in enumerate(groups):
        train = np.setdiff1d(np.arange(len(y)), test)
        assert not np.intersect1d(train, test).size
        cv[test] = x[test] @ fit(x[train], y[train])
        fold_ids[test] = fold + 1
        folds.append({'fold': fold + 1, 'train_n': len(train), 'test_n': len(test),
                      'test_ids': [rows[i]['plot_id'] for i in test], **score(y[test], cv[test])})
    assert np.all(np.isfinite(cv))
    coefficients = fit(x, y)
    domain = Delaunay(x[:, 1:])
    to_wgs = Transformer.from_crs(crs, 4326, always_xy=True).transform
    references = []
    for i, row in enumerate(rows):
        point = by_id[row['plot_id']]['geometry']
        references.append({'type': 'Feature', 'geometry': mapping(transform(to_wgs, point)),
                           'properties': {'id': row['plot_id'], 'observed_m3_ha': float(y[i]),
                                          'cv_m3_ha': float(cv[i]), 'fold': int(fold_ids[i]),
                                          'zq95_m': float(x[i, 1]), 'zskew': float(x[i, 2]),
                                          'returns_above_2m_percent': float(x[i, 3])}})
    # Preserve the native 20 m grid in the 2 x 2 km tutorial tile subset. Do not
    # send the 3.3 million-cell full forest to the browser or create overviews.
    extent = [253000, 5235000, 255000, 5237000]
    masks, mask_crs = gpkg(inputs / 'forest_mask.gpkg')
    with rasterio.open(inputs / 'fm_mets_20m.tif') as ds:
        assert ds.crs.to_epsg() == crs and ds.descriptions == ('zq95', 'zskew', 'pzabove2')
        window = from_bounds(*extent, ds.transform)
        metrics = ds.read(window=window, masked=True)
        affine = ds.window_transform(window)
        project_mask = Transformer.from_crs(mask_crs, crs, always_xy=True).transform
        forest = rasterize([(transform(project_mask, r['geometry']), 1) for r in masks],
                           out_shape=metrics.shape[1:], transform=affine, fill=0, dtype='uint8')
        valid = ~np.any(np.ma.getmaskarray(metrics), axis=0) & np.all(np.isfinite(metrics.data), axis=0)
        cells, supported, exclusions = [], [], {'nodata': 0, 'nonforest': 0, 'outside_domain': 0, 'negative': 0}
        for row in range(metrics.shape[1]):
            for col in range(metrics.shape[2]):
                if not valid[row, col]:
                    exclusions['nodata'] += 1
                    continue
                if not forest[row, col]:
                    exclusions['nonforest'] += 1
                    continue
                z = metrics[:, row, col].data
                value = float(np.r_[1, z] @ coefficients)
                if domain.find_simplex(z) < 0:
                    value, status = None, 'Outside training predictor domain'
                    exclusions['outside_domain'] += 1
                elif value < 0:
                    value, status = None, 'Nonphysical negative prediction'
                    exclusions['negative'] += 1
                else:
                    status = 'Modelled merchantable stem volume'
                    supported.append(value)
                west, north = affine * (col, row)
                east, south = affine * (col + 1, row + 1)
                ring = [[round(v, 7) for v in to_wgs(a, b)] for a, b in
                        [(west, north), (east, north), (east, south), (west, south), (west, north)]]
                cells.append({'type': 'Feature', 'geometry': {'type': 'Polygon', 'coordinates': [ring]},
                              'properties': {'id': f'fm-{row}-{col}', 'volume_m3_ha': None if value is None else round(value, 4),
                                             'status': status, 'height_p95_m': round(float(z[0]), 2)}})
    assert supported
    centres, _ = gpkg(inputs / 'ctg_plots.gpkg')
    assert len(centres) == 9
    payload = {
        'schema_version': 1, 'dataset': 'Forêt Montmorency, Québec', 'target': 'merchantable stem volume',
        'source': {'repository': REPOSITORY, 'commit': COMMIT,
                   'tutorial': 'https://james-f-mcglade.github.io/2026_lidRtutorial/07_aba.html',
                   'attribution': 'UBC Integrated Remote Sensing Studio · Irwin, Murray, Russell and 2026 workshop contributors',
                   'input_sha256': {name: hashlib.sha256((inputs / name).read_bytes()).hexdigest() for name in FILES},
                   'input_paths': FILES,
                   'note': 'Tutorial text says 162 plots; this pinned CSV and field geometry contain 169 matched records. Field period 2015–2016; ALS 2016.'},
        'model': {'formula': 'merchantable m³/ha = b0 + b1 × return-height p95 + b2 × height skewness + b3 × returns above 2 m (%)',
                  'coefficients': coefficients.tolist(), 'training_n': len(y),
                  'diagnostics': {'method': 'Five geographic easting bands; out-of-fold predictions', **score(y, cv), 'folds': folds}},
        'map': {'centre': list(to_wgs((extent[0] + extent[2]) / 2, (extent[1] + extent[3]) / 2)),
                'crs': crs, 'native_cell_m': 20, 'cell_area_ha': 0.04, 'subset_m2': 4_000_000,
                'forest_mask_rule': 'Native pixel centre inside supplied forest mask; no boundary-area correction',
                'exclusions': exclusions, 'supported_cells': len(supported),
                'supported_area_ha': len(supported) * 0.04,
                'modelled_merchantable_m3': float(np.sum(supported) * 0.04),
                'mean_m3_ha': float(np.mean(supported)),
                'cells': {'type': 'FeatureCollection', 'features': cells}},
        'references': {'type': 'FeatureCollection', 'features': references},
        'limitations': ['Historical tutorial example, not a current harvest appraisal or an estimate for the BC tile.',
                        'CV errors describe these field references; not confidence intervals or independent operational validation.',
                        'Merchantable definitions follow the source dataset; no gross-to-merchantable factor inferred.',
                        'No new raw-cloud inference: metrics were precomputed by the workshop; this model and diagnostics were rerun.',
                        '20 m cells preserve native metrics. Forest boundary pixels use a centre mask; totals are illustrative grid estimates.'],
    }
    output.write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n')
    print(json.dumps({**{k: v for k, v in payload['map'].items() if k not in ['cells']},
                      'diagnostics': {k: v for k, v in payload['model']['diagnostics'].items() if k != 'folds'}}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--inputs', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--download', action='store_true', help='Download missing inputs at the pinned public commit')
    args = parser.parse_args()
    if args.download:
        args.inputs.mkdir(parents=True, exist_ok=True)
        for name, path in FILES.items():
            if not (args.inputs / name).exists():
                urllib.request.urlretrieve(f'https://raw.githubusercontent.com/james-f-mcglade/2026_lidRtutorial/{COMMIT}/{path}', args.inputs / name)
    build(args.inputs, args.output)
