#!/usr/bin/env python3
"""Derive forestry structure proxies from original returns and 1 m source grids.
No species, biomass, fire behaviour or habitat-quality model is inferred.
"""

import argparse
import hashlib
import json
from pathlib import Path
import laspy
import numpy as np
import rasterio
from rasterio.features import rasterize
from scipy import ndimage as ndi
from pyproj import Transformer
from shapely import transform as project
from shapely.geometry import shape, mapping

BANDS = [0, 2, 5, 10, 20, 30, 81]


def normalized_entropy(counts):
    """Shannon entropy divided by log(number of fixed bins); undefined if empty."""
    counts = np.asarray(counts, dtype=float)
    total = counts.sum()
    if total == 0:
        return None
    p = counts[counts > 0] / total
    return float(-np.sum(p * np.log(p)) / np.log(len(counts)))


def local_texture(height, valid, window=5):
    """Local population SD, including low cells; require a complete valid window."""
    count = (
        ndi.uniform_filter(valid.astype(float), size=window, mode="constant")
        * window**2
    )
    values = np.where(valid, height, 0).astype(float)
    sums = ndi.uniform_filter(values, size=window, mode="constant") * window**2
    squares = ndi.uniform_filter(values**2, size=window, mode="constant") * window**2
    mean = np.divide(sums, count, out=np.zeros_like(sums), where=count > 0)
    variance = (
        np.divide(squares, count, out=np.zeros_like(sums), where=count > 0) - mean**2
    )
    return np.where(count >= window**2 - 1e-6, np.sqrt(np.maximum(variance, 0)), np.nan)


def edge_classes(canopy, opening, unknown, distance):
    """Known opening proximity, defensible interior and censored canopy partition."""
    if opening.any():
        to_open = ndi.distance_transform_edt(~opening)
    else:
        to_open = np.full(canopy.shape, np.inf)
    # Pad so the tile perimeter always counts as unknown, including fully supported tiles.
    to_unknown = ndi.distance_transform_edt(np.pad(~unknown, 1, constant_values=False))[
        1:-1, 1:-1
    ]
    edge = canopy & (to_open <= distance)
    interior = canopy & (to_open > distance) & (to_unknown > distance)
    censored = canopy & ~edge & ~interior
    return edge, interior, censored


def return_metrics(histogram):
    counts = np.array(
        [histogram[BANDS[i] : BANDS[i + 1]].sum() for i in range(len(BANDS) - 1)],
        dtype="int64",
    )
    total = int(histogram.sum())
    elevated = int(histogram[2:].sum())
    return {
        "returns": total,
        "bands": counts.tolist(),
        "elevated_returns": elevated,
        "low_layer_percent": (
            round(float(histogram[2:5].sum() / elevated * 100), 3) if elevated else None
        ),
        "height_entropy": (
            round(normalized_entropy(histogram[2:]), 5) if elevated else None
        ),
    }


def generate(source, analysis, output):
    summary = json.loads((analysis / "summary.json").read_text())
    digest = hashlib.sha256()
    with source.open("rb") as f:
        for block in iter(lambda: f.read(4 * 1024 * 1024), b""):
            digest.update(block)
    if digest.hexdigest() != summary["source_sha256"]:
        raise ValueError("Source hash mismatch")
    names = [
        "height-1m.tif",
        "dtm-1m.tif",
        "ground-support-distance.tif",
        "building-candidates.geojson",
    ]
    hashes = {
        name: hashlib.sha256((analysis / name).read_bytes()).hexdigest()
        for name in names
    }
    arrays = []
    affine = None
    for name in names[:3]:
        with rasterio.open(analysis / name) as src:
            if src.crs.to_epsg() != 3157:
                raise ValueError("Expected source-grid EPSG:3157")
            if affine is not None and (
                src.transform != affine or src.shape != arrays[0].shape
            ):
                raise ValueError("Grid alignment mismatch")
            affine = src.transform
            arrays.append(src.read(1, masked=True).astype(float).filled(np.nan))
    height, dtm, support = arrays
    to_utm = Transformer.from_crs(4326, 3157, always_xy=True)
    roofs = json.loads((analysis / names[3]).read_text())["features"]
    polygons = [
        project(shape(f["geometry"]), to_utm.transform, interleaved=False)
        for f in roofs
    ]
    roof = (
        rasterize(
            [(mapping(p), 1) for p in polygons],
            out_shape=height.shape,
            transform=affine,
            dtype="uint8",
        )
        > 0
    )
    exclusion = ndi.distance_transform_edt(~roof) <= 2
    supported = np.isfinite(height) & np.isfinite(dtm) & np.isfinite(support)
    eligible = supported & ~exclusion
    canopy = eligible & (height > 5)
    opening = eligible & (height <= 2)
    texture = local_texture(height, eligible)
    # Match existing tile-origin 50 m plots exactly, including partial boundary squares.
    nx = int(np.ceil(height.shape[1] / 50))
    ny = int(np.ceil(height.shape[0] / 50))
    plot_count = nx * ny
    hist = {key: np.zeros((plot_count, 81), dtype="int64") for key in ("all", "first")}
    seen = 0
    excluded = 0
    accepted = 0
    with laspy.open(source) as reader:
        for points in reader.chunk_iterator(2_000_000):
            seen += len(points)
            cols = np.floor((np.asarray(points.x) - affine.c) / affine.a).astype(int)
            rows = np.floor((np.asarray(points.y) - affine.f) / affine.e).astype(int)
            inside = (
                (rows >= 0)
                & (rows < height.shape[0])
                & (cols >= 0)
                & (cols < height.shape[1])
            )
            ids = np.where(inside)[0]
            r = rows[ids]
            c = cols[ids]
            z = np.asarray(points.z)[ids] - dtm[r, c]
            good = (
                eligible[r, c]
                & ~np.isin(np.asarray(points.classification)[ids], [7, 12, 18])
                & ~np.asarray(points.withheld)[ids].astype(bool)
                & np.isfinite(z)
                & (z >= -1)
                & (z <= 80)
            )
            ids = ids[good]
            r = r[good]
            c = c[good]
            z = z[good]
            # Preserve [k,k+1) bins; [-1,0) residuals join the near-ground bin only.
            bins = np.floor(np.maximum(z, 0)).astype(int)
            plot = (r // 50) * nx + c // 50
            flat = plot * 81 + bins
            hist["all"] += np.bincount(flat, minlength=plot_count * 81).reshape(
                plot_count, 81
            )
            first = np.asarray(points.return_number)[ids] == 1
            hist["first"] += np.bincount(
                flat[first], minlength=plot_count * 81
            ).reshape(plot_count, 81)
            accepted += len(ids)
    excluded = seen - accepted
    edge_masks = {
        distance: edge_classes(canopy, opening, ~eligible, distance)
        for distance in (10, 20, 30)
    }
    # Geometry is rebuilt from integer grid edges, matching original plot IDs.
    ll = Transformer.from_crs(3157, 4326, always_xy=True)
    features = []
    for row in range(ny):
        for col in range(nx):
            r = row * 50
            c = col * 50
            sl = np.s_[r : r + 50, c : c + 50]
            mask = eligible[sl]
            n = int(mask.sum())
            if not n:
                continue
            index = row * nx + col
            canopy_n = int(canopy[sl].sum())
            values = height[sl][mask]
            texture_values = texture[sl][mask & np.isfinite(texture[sl])]
            props = {
                "id": f"forest-50-{row}-{col}",
                "sampled_m2": n,
                "support_percent": round(n / 2500 * 100, 2),
                "canopy_percent": round(canopy_n / n * 100, 2),
                "canopy_m2": canopy_n,
                "surface_p95_m": round(float(np.percentile(values, 95)), 2),
                "surface_sd_m": round(float(np.std(values)), 2),
                "rugosity_m": (
                    round(float(np.mean(texture_values)), 3)
                    if len(texture_values)
                    else None
                ),
                "texture_supported_m2": int(len(texture_values)),
                "ground_m": round(float(np.median(dtm[sl][mask])), 2),
                "ground_support_p95_m": round(
                    float(np.percentile(support[sl][mask], 95)), 2
                ),
                "profiles": {
                    key: return_metrics(value[index]) for key, value in hist.items()
                },
            }
            for distance, masks in edge_masks.items():
                counts = [int(m[sl].sum()) for m in masks]
                props[f"edge_{distance}"] = {
                    "counts": counts,
                    "percent": (
                        [round(n / canopy_n * 100, 3) for n in counts]
                        if canopy_n
                        else [None, None, None]
                    ),
                }
            west, north = affine * (c, r)
            east, south = affine * (
                min(c + 50, height.shape[1]),
                min(r + 50, height.shape[0]),
            )
            props["centre_utm"] = [(west + east) / 2, (south + north) / 2]
            ring = [
                [west, south],
                [east, south],
                [east, north],
                [west, north],
                [west, south],
            ]
            geometry = {
                "type": "Polygon",
                "coordinates": [
                    [
                        [round(x, 7), round(y, 7)]
                        for x, y in [ll.transform(x, y) for x, y in ring]
                    ]
                ],
            }
            features.append(
                {"type": "Feature", "geometry": geometry, "properties": props}
            )
    report = {
        "schema_version": 1,
        "source_sha256": summary["source_sha256"],
        "input_sha256": hashes,
        "crs": "EPSG:3157",
        "plot_size_m": 50,
        "roof_exclusion_m": 2,
        "counts": {
            "source_points": seen,
            "accepted_returns": accepted,
            "excluded_returns": excluded,
            "first_returns": int(hist["first"].sum()),
            "eligible_cells": int(eligible.sum()),
            "canopy_cells": int(canopy.sum()),
        },
        "bands": ["0–2 m", "2–5 m", "5–10 m", "10–20 m", "20–30 m", "30–80 m"],
        "methods": {
            "strata": "Original returns normalized against the supported 1 m DTM. Excludes classes 7/12/18, withheld points, roof candidates plus 2 m, unsupported cells and heights outside [-1,80] m. Negative residuals join bin 0. Integer-metre bins [k,k+1); counts shown in six height bands. Low-layer share uses 2–5 m returns / all returns >=2 m. Entropy is Shannon / ln(79) across fixed 1 m bins 2..80, null for no elevated returns. All vs first returns are separately counted, not independent repeated surveys.",
            "texture": "Mean population SD of the normalized height surface in 5×5 m windows. Only complete eligible 25-cell windows contribute; missing/roof neighborhoods stay missing. Plot SD/P95 use all eligible height cells. Rugosity depends on the selected 5 m scale and includes crown/opening transitions; it is not a biodiversity or maturity score.",
            "edges": "Taller-canopy proxy is eligible height >5 m; low-opening proxy <=2 m. Euclidean cell-centre distance to known openings. Edge is canopy within 10/20/30 m; interior is farther from both known openings and unknown/roof/tile boundaries; remaining canopy is censored. Counts partition canopy cells exactly. Distances are horizontal; polygons are plot aggregates, not measured forest edges.",
        },
        "limitations": [
            "No authoritative forest mask or source vegetation class: unrecognized structures can remain.",
            "Airborne returns are affected by occlusion, acquisition settings and multiple returns; profiles are not vegetation volume, leaf area or a seedling inventory.",
            "Edge/interior proxies do not establish habitat quality, species occurrence, fire risk, tree age or windthrow risk.",
            "One acquisition supports structure screening, not change detection; biomass/species/productivity need independent training/reference data.",
        ],
        "plots": {"type": "FeatureCollection", "features": features},
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, separators=(",", ":"), allow_nan=False) + "\n")
    print(
        json.dumps(
            {
                "plots": len(features),
                "counts": report["counts"],
                "bytes": output.stat().st_size,
            }
        )
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("source", "analysis", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    generate(args.source, args.analysis, args.output)
