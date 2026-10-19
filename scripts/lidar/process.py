#!/usr/bin/env python3
"""Reproducible exploratory forestry/building analysis of the supplied BC tile.
All calculations use metric EPSG:3157. Geometry candidates are not inventory.
"""

import argparse, hashlib, json, time
from pathlib import Path
import laspy
import numpy as np
from scipy import ndimage as ndi
from scipy.spatial import Delaunay
import rasterio
from rasterio.transform import from_origin
from rasterio.features import shapes
from rasterio.warp import calculate_default_transform, reproject, Resampling
from shapely.geometry import shape, mapping
from shapely.ops import transform as transform_geometry
from pyproj import Transformer
from skimage.feature import peak_local_max
from skimage.segmentation import watershed
from PIL import Image
import matplotlib

matplotlib.use("Agg")
from matplotlib import colormaps

SOURCE_SHA = "f5246f351e8d5923bf8a5dfddc0753032dbe8cb6e687ae58818cc701cb398ecf"
NODATA = -9999.0


def save_tif(path, a, transform):
    data = np.where(np.isfinite(a), a, NODATA).astype("float32")
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=a.shape[1],
        height=a.shape[0],
        count=1,
        dtype="float32",
        crs="EPSG:3157",
        transform=transform,
        nodata=NODATA,
        compress="deflate",
        predictor=3,
        tiled=True,
    ) as dst:
        dst.write(data, 1)


def feature_collection(features):
    return {"type": "FeatureCollection", "features": features}


def feature(geom, props):
    return {"type": "Feature", "geometry": geom, "properties": props}


def array_stats(values):
    values = values[np.isfinite(values)]
    return {
        k: round(float(v), 3)
        for k, v in zip(
            ["min", "p05", "median", "mean", "p95", "p99", "max"],
            [
                np.min(values),
                np.percentile(values, 5),
                np.median(values),
                np.mean(values),
                np.percentile(values, 95),
                np.percentile(values, 99),
                np.max(values),
            ],
        )
    }


def interpolate_ground(dtm, observed, res, max_distance=30.0, max_edge=60.0):
    dtm = dtm.copy()
    height, width = dtm.shape
    ground_observed = np.isfinite(dtm)
    distance, nearest = ndi.distance_transform_edt(
        ~ground_observed, sampling=res, return_indices=True
    )
    # Interpolate missing terrain through a coarsened ground TIN. A wider bounded
    # span is needed under roofs; nearest filling would flatten sloping ground.
    rr, cc = np.where(ground_observed)
    coarse_cols = int(np.ceil(width / 3))
    coarse_index = (rr // 3) * coarse_cols + (cc // 3)
    unique, inverse = np.unique(coarse_index, return_inverse=True)
    count = np.bincount(inverse)
    cx = np.bincount(inverse, weights=cc + 0.5) / count
    cy = np.bincount(inverse, weights=rr + 0.5) / count
    cz = np.bincount(inverse, weights=dtm[rr, cc]) / count
    tri = Delaunay(np.column_stack((cx, cy)))
    fr, fc = np.where((~ground_observed) & observed & (distance <= max_distance))
    query = np.column_stack((fc + 0.5, fr + 0.5))
    simplices = tri.find_simplex(query)
    inside = simplices >= 0
    selected = simplices[inside]
    verts = tri.simplices[selected]
    corners = tri.points[verts]
    edge = (
        np.maximum.reduce(
            [
                np.linalg.norm(corners[:, 0] - corners[:, 1], axis=1),
                np.linalg.norm(corners[:, 1] - corners[:, 2], axis=1),
                np.linalg.norm(corners[:, 0] - corners[:, 2], axis=1),
            ]
        )
        * res
    )
    matrix = tri.transform[selected, :2]
    delta = query[inside] - tri.transform[selected, 2]
    bary = np.einsum("ijk,ik->ij", matrix, delta)
    weights = np.column_stack((bary, 1 - bary.sum(axis=1)))
    z = np.sum(cz[verts] * weights, axis=1)
    bounded = edge <= max_edge
    dtm[fr[inside][bounded], fc[inside][bounded]] = z[bounded]
    # A two-cell nearest fill only repairs the coarsened TIN's outer rim.
    rim = (~np.isfinite(dtm)) & observed & (distance <= 2 * res)
    dtm[rim] = dtm[tuple(nearest[:, rim])]
    fill = (~ground_observed) & np.isfinite(dtm)
    return dtm, distance, fill


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--resolution", type=float, default=1.0, choices=[1.0])
    args = parser.parse_args()
    out = args.output
    out.mkdir(parents=True, exist_ok=True)
    start = time.time()
    digest = hashlib.file_digest(args.source.open("rb"), "sha256").hexdigest()
    if digest != SOURCE_SHA:
        raise ValueError("Unexpected source checksum")
    with laspy.open(args.source) as reader:
        header = reader.header
        res = args.resolution
        xmin = np.floor(header.mins[0] / res) * res
        ymax = np.ceil(header.maxs[1] / res) * res
        width = int(np.ceil((header.maxs[0] - xmin) / res))
        height = int(np.ceil((ymax - header.mins[1]) / res))
        size = width * height
        transform = from_origin(xmin, ymax, res, res)
        ground_count = np.zeros(size, "uint32")
        ground_sum = np.zeros(size, "float64")
        total = np.zeros(size, "uint32")
        first = np.zeros(size, "uint32")
        single = np.zeros(size, "uint32")
        zmax = np.full(size, -np.inf, "float32")
        zmin = np.full(size, np.inf, "float32")
        classes = np.zeros(256, "int64")
        returns = np.zeros(16, "int64")
        for i, p in enumerate(reader.chunk_iterator(2_000_000)):
            c = np.asarray(p.classification)
            classes += np.bincount(c, minlength=256)
            returns += np.bincount(np.asarray(p.return_number), minlength=16)
            good = (
                (c != 7) & (c != 18) & (c != 12) & (~np.asarray(p.withheld, dtype=bool))
            )
            x = np.asarray(p.x)
            y = np.asarray(p.y)
            z = np.asarray(p.z)
            col = np.clip(((x - xmin) / res).astype("int32"), 0, width - 1)
            row = np.clip(((ymax - y) / res).astype("int32"), 0, height - 1)
            index = row * width + col
            gi = index[good]
            gz = z[good]
            total += np.bincount(gi, minlength=size).astype("uint32")
            np.maximum.at(zmax, gi, gz)
            np.minimum.at(zmin, gi, gz)
            f = good & (np.asarray(p.return_number) == 1)
            s = good & (np.asarray(p.number_of_returns) == 1)
            first += np.bincount(index[f], minlength=size).astype("uint32")
            single += np.bincount(index[s], minlength=size).astype("uint32")
            g = good & (c == 2)
            ground_count += np.bincount(index[g], minlength=size).astype("uint32")
            ground_sum += np.bincount(index[g], weights=z[g], minlength=size)
            if i % 10 == 0:
                print(
                    "Raster aggregation",
                    min((i + 1) * 2_000_000, header.point_count),
                    flush=True,
                )
    grid_shape = (height, width)
    ground_count = ground_count.reshape(grid_shape)
    total = total.reshape(grid_shape)
    first = first.reshape(grid_shape)
    single = single.reshape(grid_shape)
    observed = total > 0
    ground_observed = ground_count > 0
    dtm = np.divide(
        ground_sum.reshape(grid_shape),
        ground_count,
        out=np.full(grid_shape, np.nan),
        where=ground_observed,
    ).astype("float32")
    dtm, distance, fill = interpolate_ground(dtm, observed, res)
    valid = observed & np.isfinite(dtm)
    dsm = zmax.reshape(grid_shape)
    dsm[~observed] = np.nan
    chm = dsm - dtm
    negative = int(np.sum(valid & (chm < 0)))
    high = int(np.sum(valid & (chm > 80)))
    chm = np.where(valid, np.maximum(chm, 0), np.nan).astype("float32")
    chm[chm > 80] = np.nan
    valid &= np.isfinite(chm)
    print("Supported cells", int(valid.sum()), "of", int(observed.sum()), flush=True)
    save_tif(out / "dtm-1m.tif", dtm, transform)
    save_tif(out / "dsm-1m.tif", np.where(valid, dsm, np.nan), transform)
    save_tif(out / "height-1m.tif", chm, transform)
    save_tif(
        out / "ground-support-distance.tif",
        np.where(observed, distance, np.nan),
        transform,
    )
    # Roof-like planar patches: a geometric screen, never building truth.
    surface = np.where(np.isfinite(dsm), dsm, 0).astype("float64")
    window = 5
    support = ndi.uniform_filter(
        np.isfinite(dsm).astype(float), size=window, mode="constant"
    )
    mean = ndi.uniform_filter(surface, size=window, mode="nearest")
    variance = np.maximum(
        ndi.uniform_filter(surface**2, size=window, mode="nearest") - mean**2, 0
    )
    axis = np.arange(-2, 3, dtype=float)
    kernelx = np.tile(axis, (5, 1)) / 50.0
    kernely = kernelx.T
    gx = ndi.correlate(surface, kernelx, mode="nearest") / res
    gy = ndi.correlate(surface, kernely, mode="nearest") / res
    roughness = np.sqrt(np.maximum(variance - 2 * res**2 * (gx**2 + gy**2), 0))
    single_fraction = np.divide(single, total, out=np.zeros(grid_shape), where=observed)
    single_local = ndi.uniform_filter(single_fraction, size=3)
    roof_seed = (
        valid
        & (chm >= 2.5)
        & (chm <= 35)
        & (roughness <= 0.22)
        & (single_local >= 0.65)
        & (support >= 0.99)
        & (np.hypot(gx, gy) <= 1.2)
    )
    roof_mask = (
        ndi.binary_closing(roof_seed, structure=np.ones((3, 3))) & valid & (chm >= 2.5)
    )
    labels, n = ndi.label(roof_mask)
    areas = np.bincount(labels.ravel()) * res * res
    keep = np.where(areas >= 20)[0]
    keep = keep[keep != 0]
    roof_mask = np.isin(labels, keep)
    ll = Transformer.from_crs(3157, 4326, always_xy=True)
    roofs = []
    for geom, label in shapes(
        labels.astype("int32"), mask=roof_mask, transform=transform
    ):
        mask = labels == int(label)
        poly = shape(geom).simplify(0.5, preserve_topology=True)
        roofs.append(
            feature(
                mapping(transform_geometry(ll.transform, poly)),
                {
                    "id": f"roof-{int(label)}",
                    "area_m2": round(float(mask.sum() * res * res), 1),
                    "height_m": round(float(np.nanmedian(chm[mask])), 2),
                    "roughness_m": round(float(np.median(roughness[mask])), 3),
                    "status": "unvalidated roof-like planar patch",
                    "method": "5m local plane residual + single-return fraction; area >=20m2",
                },
            )
        )
    (out / "building-candidates.geojson").write_text(
        json.dumps(feature_collection(roofs), separators=(",", ":"))
    )
    # Canopy-shaped local maxima and crown regions (dominant crowns only).
    safe = np.nan_to_num(chm, nan=0.0)
    smooth = ndi.gaussian_filter(safe, sigma=0.7 / res)
    roof_buffer = ndi.binary_dilation(roof_mask, iterations=max(1, round(2 / res)))
    tree_mask = valid & (safe >= 5) & (~roof_buffer) & (distance <= 3)
    coords = peak_local_max(
        smooth,
        min_distance=max(1, round(3 / res)),
        threshold_abs=5,
        labels=tree_mask.astype("uint8"),
        exclude_border=False,
    )
    relief = smooth - ndi.minimum_filter(smooth, size=max(3, round(7 / res)))
    coords = coords[relief[tuple(coords.T)] >= 1.0]
    markers = np.zeros(grid_shape, "int32")
    markers[tuple(coords.T)] = np.arange(1, len(coords) + 1)
    crowns = watershed(-smooth, markers, mask=valid & (safe >= 2) & (~roof_buffer))
    crown_areas = np.bincount(crowns.ravel()) * res * res
    trees = []
    for ident, (row, col) in enumerate(coords, 1):
        if crown_areas[ident] < 4:
            continue
        x = xmin + (float(col) + 0.5) * res
        y = ymax - (float(row) + 0.5) * res
        lon, lat = ll.transform(x, y)
        trees.append(
            feature(
                {"type": "Point", "coordinates": [round(lon, 8), round(lat, 8)]},
                {
                    "id": f"crown-{ident}",
                    "height_m": round(float(chm[row, col]), 2),
                    "crown_area_m2": round(float(crown_areas[ident]), 1),
                    "ground_support_m": round(float(distance[row, col]), 2),
                    "method": "1m height grid; Gaussian sigma 0.7m; local maxima 3m separation; watershed",
                    "status": "dominant crown candidate; not a stem inventory",
                    "edge": bool(
                        row < 5 or col < 5 or row >= height - 5 or col >= width - 5
                    ),
                },
            )
        )
    (out / "tree-candidates.geojson").write_text(
        json.dumps(feature_collection(trees), separators=(",", ":"))
    )
    # Sensitivity is disclosed rather than implying a single true tree count.
    sensitivity = []
    for separation in [2, 3, 5]:
        peaks = peak_local_max(
            smooth,
            min_distance=max(1, round(separation / res)),
            threshold_abs=5,
            labels=tree_mask.astype("uint8"),
            exclude_border=False,
        )
        peaks = peaks[relief[tuple(peaks.T)] >= 1]
        sensitivity.append(
            {"minimum_separation_m": separation, "local_maxima": len(peaks)}
        )
    # Stream the original points again; these statistics are return-weighted, not fuel mass.
    strata = np.zeros(7, "int64")
    height_bins = [-np.inf, 0.5, 2, 5, 15, 30, np.inf]
    elevated_first = np.zeros(size, "uint32")
    valid_first = np.zeros(size, "uint32")
    ground_residuals = []
    with laspy.open(args.source) as reader:
        for p in reader.chunk_iterator(2_000_000):
            c = np.asarray(p.classification)
            good = (
                (c != 7) & (c != 18) & (c != 12) & (~np.asarray(p.withheld, dtype=bool))
            )
            cols = np.clip(
                ((np.asarray(p.x) - xmin) / res).astype("int32"), 0, width - 1
            )
            rows = np.clip(
                ((ymax - np.asarray(p.y)) / res).astype("int32"), 0, height - 1
            )
            h = np.asarray(p.z) - dtm[rows, cols]
            ok = good & np.isfinite(h) & (h >= -1) & (h <= 80)
            strata[:6] += np.histogram(h[ok], bins=height_bins)[0]
            f = ok & (np.asarray(p.return_number) == 1)
            idx = rows * width + cols
            valid_first += np.bincount(idx[f], minlength=size).astype("uint32")
            elevated_first += np.bincount(idx[f & (h > 2)], minlength=size).astype(
                "uint32"
            )
            ground_residuals.extend(h[ok & (c == 2)][::50].tolist())
    cover = (
        np.divide(
            elevated_first,
            valid_first,
            out=np.full(size, np.nan),
            where=valid_first > 0,
        ).reshape(grid_shape)
        * 100
    )
    save_tif(out / "elevated-first-return-cover.tif", cover, transform)
    # A metric-projected sample surface feeds the actual GeoLibre tree tool.
    rows, cols = np.where(tree_mask)
    surface_header = laspy.LasHeader(point_format=0, version="1.2")
    surface_header.scales = np.array([0.01, 0.01, 0.01])
    surface_header.offsets = np.array([xmin, ymax - height * res, 0])
    surface_header.add_crs(header.parse_crs().sub_crs_list[0])
    sample = laspy.LasData(surface_header)
    sample.x = xmin + (cols + 0.5) * res
    sample.y = ymax - (rows + 0.5) * res
    sample.z = chm[rows, cols]
    sample.classification = np.ones(len(rows), dtype="uint8")
    sample.write(out / "normalized-surface.las")
    np.savez_compressed(
        out / "analysis-grids.npz",
        dtm=dtm,
        dsm=dsm,
        chm=chm,
        valid=valid,
        ground_count=ground_count,
        distance=distance,
        roughness=roughness,
        roof_mask=roof_mask,
        crowns=crowns,
        smooth=smooth,
        cover=cover,
    )
    bounds = [xmin, ymax - height * res, xmin + width * res, ymax]
    lonmin, latmin = ll.transform(bounds[0], bounds[1])
    lonmax, latmax = ll.transform(bounds[2], bounds[3])
    validheights = chm[valid]
    canopy = valid & (chm > 2) & (~roof_mask)
    hist, edges = np.histogram(
        validheights, bins=[0, 2, 5, 10, 15, 20, 25, 30, 40, 60, 80]
    )
    summary = {
        "source_sha256": SOURCE_SHA,
        "source_points": int(header.point_count),
        "classification_counts": {str(i): int(v) for i, v in enumerate(classes) if v},
        "crs": "EPSG:3157",
        "vertical_datum": "CGVD2013 (CGG2013)",
        "resolution_m": res,
        "width": width,
        "height": height,
        "bounds_utm": bounds,
        "bounds_wgs84": [lonmin, latmin, lonmax, latmax],
        "observed_area_ha": round(float(observed.sum() * res * res / 10000), 3),
        "supported_area_ha": round(float(valid.sum() * res * res / 10000), 3),
        "ground_supported_percent": round(float(valid.sum() / observed.sum() * 100), 3),
        "ground_observed_cells": int(ground_observed.sum()),
        "ground_interpolated_cells": int(fill.sum()),
        "max_ground_fill_distance_m": 30,
        "max_ground_tin_edge_m": 60,
        "height_stats_m": array_stats(validheights),
        "elevated_surface_height_stats_m": array_stats(chm[canopy]),
        "elevated_area_percent": round(
            float(np.sum(valid & (chm > 2)) / valid.sum() * 100), 2
        ),
        "elevated_first_return_cover_percent": round(
            float(elevated_first.sum() / valid_first.sum() * 100), 2
        ),
        "tree_candidate_count": len(trees),
        "building_candidate_count": len(roofs),
        "building_candidate_area_m2": round(
            sum(f["properties"]["area_m2"] for f in roofs), 2
        ),
        "tree_detection_sensitivity": sensitivity,
        "height_histogram": {"edges_m": edges.tolist(), "cell_counts": hist.tolist()},
        "return_height_profile": {
            "bins_m": ["<0.5", "0.5–2", "2–5", "5–15", "15–30", ">=30"],
            "counts": strata[:6].tolist(),
        },
        "ground_residual_sample_stats_m": array_stats(np.array(ground_residuals)),
        "negative_surface_cells_clamped": negative,
        "surface_cells_above_80m_excluded": high,
        "limitations": [
            "No vegetation or building classes in source: canopy height and cover are elevated-surface proxies; roofs and other objects can remain.",
            "Tree tops and watershed crowns are unvalidated candidates, not tree stems, species, DBH or a complete inventory.",
            "Roof-like patches can include rock, vehicles, smooth canopy or other planar objects; no building footprint ground truth was supplied.",
            "Ground means on a 1m grid; missing terrain uses a coarsened ground TIN bounded by 30m ground distance and 60m triangle edges. No independent vertical accuracy assessment.",
            "Tile-edge crowns are truncated; count sensitivity varies with detection spacing.",
            "Return-height strata describe sampling distribution, not biomass, canopy base height or fuel load.",
        ],
        "parameters": {
            "excluded_classes": [7, 12, 18],
            "tree_min_height_m": 5,
            "tree_min_separation_m": 3,
            "smoothing_sigma_m": 0.7,
            "roof_min_height_m": 2.5,
            "roof_plane_residual_max_m": 0.22,
            "roof_min_area_m2": 20,
            "roof_single_return_fraction_min": 0.65,
        },
        "processing_seconds": round(time.time() - start, 2),
    }
    (out / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(
        json.dumps(
            {
                k: summary[k]
                for k in [
                    "observed_area_ha",
                    "supported_area_ha",
                    "height_stats_m",
                    "tree_candidate_count",
                    "building_candidate_count",
                    "processing_seconds",
                ]
            },
            indent=2,
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()
