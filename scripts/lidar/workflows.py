#!/usr/bin/env python3
"""Reproducible source-grid opening, plot and roof-proximity screening (EPSG:3157).
Outputs small versioned GeoJSON snapshots consumed by the static interface.
"""

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import rasterio
from rasterio.features import rasterize, shapes
from scipy import ndimage as ndi
from scipy.spatial import cKDTree
from shapely.geometry import shape, mapping, box, Point, LineString
from shapely import transform as project
from shapely.ops import nearest_points
from pyproj import Transformer


def gap_labels(height, valid, roof, threshold, minimum=25):
    """4-connected low-height openings; retain missing/roof boundaries for review."""
    low = valid & ~roof & (height <= threshold)
    labels, count = ndi.label(low)
    sizes = np.bincount(labels.ravel(), minlength=count + 1)
    keep = sizes >= minimum
    keep[0] = False
    return np.where(keep[labels], labels, 0).astype("int32")


def plot_metrics(height, supported, crowns, nominal_cells):
    values = height[supported]
    if not len(values):
        return None
    return {
        "sampled_m2": int(len(values)),
        "support_percent": round(100 * len(values) / nominal_cells, 2),
        "mean_m": round(float(np.mean(values)), 2),
        "median_m": round(float(np.median(values)), 2),
        "p95_m": round(float(np.percentile(values, 95)), 2),
        "sd_m": round(float(np.std(values)), 2),
        "above_2m_percent": round(100 * float(np.mean(values > 2)), 2),
        "crown_candidates": int(crowns),
        "crown_candidates_per_ha": round(crowns / (len(values) / 10000), 1),
    }


def proximity(polygon, tree, xy, heights, radius=30):
    """Exact polygon-to-candidate-cell-centre distance within a finite search radius."""
    indices = tree.query_ball_point(
        [polygon.centroid.x, polygon.centroid.y],
        radius + polygon.hausdorff_distance(polygon.centroid),
    )
    if not indices:
        return None
    distances = np.array([polygon.distance(Point(xy[i])) for i in indices])
    best = int(np.argmin(distances))
    distance = float(distances[best])
    if distance > radius:
        return None
    index = indices[best]
    point = Point(xy[index])
    on_roof = nearest_points(polygon, point)[0]
    return {
        "distance_m": round(distance, 2),
        "cell_distance_min_m": round(max(0, distance - np.sqrt(0.5)), 2),
        "cell_distance_max_m": round(distance + np.sqrt(0.5), 2),
        "candidate_height_m": round(float(heights[index]), 2),
        "line": LineString([on_roof, point]),
    }


def generate(analysis, output):
    files = [
        "height-1m.tif",
        "ground-support-distance.tif",
        "building-candidates.geojson",
        "tree-candidates.geojson",
    ]
    hashes = {
        name: hashlib.sha256((analysis / name).read_bytes()).hexdigest()
        for name in files
    }
    summary = json.loads((analysis / "summary.json").read_text())
    arrays = []
    transform = None
    for name in files[:2]:
        with rasterio.open(analysis / name) as src:
            if src.crs.to_epsg() != 3157:
                raise ValueError("Expected EPSG:3157")
            if transform is not None and (
                src.transform != transform or src.shape != arrays[0].shape
            ):
                raise ValueError("Grids do not align")
            transform = src.transform
            arrays.append(src.read(1, masked=True).astype(float).filled(np.nan))
    height, support = arrays
    valid = np.isfinite(height) & np.isfinite(support)
    to_utm = Transformer.from_crs(4326, 3157, always_xy=True)
    to_ll = Transformer.from_crs(3157, 4326, always_xy=True)
    roofs = json.loads((analysis / files[2]).read_text())["features"]
    polygons = [
        project(shape(f["geometry"]), to_utm.transform, interleaved=False)
        for f in roofs
    ]
    roof = (
        rasterize(
            [(mapping(p), 1) for p in polygons],
            out_shape=height.shape,
            transform=transform,
            dtype="uint8",
        )
        > 0
    )
    roof_exclusion = ndi.distance_transform_edt(~roof) <= 2
    missing_edge = ndi.binary_dilation(~valid, iterations=1)
    missing_edge[[0, -1], :] = True
    missing_edge[:, [0, -1]] = True
    roof_edge = ndi.binary_dilation(roof_exclusion)
    crown_fc = json.loads((analysis / files[3]).read_text())["features"]
    crown_xy = np.array(
        [to_utm.transform(*f["geometry"]["coordinates"][:2]) for f in crown_fc]
    )
    crown_cols = np.floor((crown_xy[:, 0] - transform.c) / transform.a).astype(int)
    crown_rows = np.floor((crown_xy[:, 1] - transform.f) / transform.e).astype(int)

    def geo(geometry):
        result = mapping(project(geometry, to_ll.transform, interleaved=False))

        def rounded(value):
            return (
                [rounded(x) for x in value]
                if isinstance(value, (list, tuple))
                else round(value, 7)
            )

        return {"type": result["type"], "coordinates": rounded(result["coordinates"])}

    def feature(geometry, properties):
        return {"type": "Feature", "geometry": geo(geometry), "properties": properties}

    def fc(features):
        return {"type": "FeatureCollection", "features": features}

    gaps = {}
    clearances = {}
    for threshold in (2, 5):
        labels = gap_labels(height, valid, roof_exclusion, threshold)
        sizes = np.bincount(labels.ravel())
        edge_ids = set(np.unique(labels[missing_edge]))
        roof_ids = set(np.unique(labels[roof_edge]))
        objects = ndi.find_objects(labels)
        features = []
        for geometry, value in shapes(labels, mask=labels > 0, transform=transform):
            index = int(value)
            sl = objects[index - 1]
            # A canopy edge fraction is a geometric screening descriptor, not a forest mask.
            expanded = tuple(
                slice(max(0, s.start - 1), min(height.shape[i], s.stop + 1))
                for i, s in enumerate(sl)
            )
            component = labels[expanded] == index
            boundary = ndi.binary_dilation(component) & ~component
            tall = (
                valid[expanded]
                & ~roof_exclusion[expanded]
                & (height[expanded] > threshold)
            )
            fraction = float((boundary & tall).sum() / max(1, boundary.sum()))
            clipped = index in edge_ids
            near_roof = index in roof_ids
            properties = {
                "id": f"gap-{threshold}-{index}",
                "area_m2": int(sizes[index]),
                "threshold_m": threshold,
                "canopy_edge_percent": round(fraction * 100, 1),
                "boundary_clipped": clipped,
                "near_roof": near_roof,
                "enclosed_candidate": not clipped and not near_roof and fraction >= 0.8,
            }
            features.append(
                feature(
                    shape(geometry).simplify(0.75, preserve_topology=True), properties
                )
            )
        gaps[str(threshold)] = fc(features)
        canopy = valid & ~roof_exclusion & (height > threshold)
        rows, cols = np.where(canopy)
        x, y = rasterio.transform.xy(transform, rows, cols)
        xy = np.column_stack([x, y])
        tree = cKDTree(xy)
        heights = height[canopy]
        entries = []
        for candidate, polygon in zip(roofs, polygons):
            match = proximity(polygon, tree, xy, heights)
            props = {
                "id": candidate["properties"]["id"],
                "threshold_m": threshold,
                "search_radius_m": 30,
            }
            if match:
                line = match.pop("line")
                props.update(match)
                entries.append(feature(line, props))
            else:
                props.update(
                    {
                        "distance_m": None,
                        "cell_distance_min_m": None,
                        "cell_distance_max_m": None,
                        "candidate_height_m": None,
                    }
                )
                entries.append(feature(polygon.centroid, props))
        clearances[str(threshold)] = fc(entries)
    plots = {}
    for size in (25, 50):
        features = []
        for r in range(0, height.shape[0], size):
            for c in range(0, height.shape[1], size):
                sl = np.s_[r : r + size, c : c + size]
                count = int(
                    (
                        (crown_rows >= r)
                        & (crown_rows < r + size)
                        & (crown_cols >= c)
                        & (crown_cols < c + size)
                    ).sum()
                )
                metrics = plot_metrics(height[sl], valid[sl], count, size * size)
                if metrics is None:
                    continue
                metrics.update(
                    {
                        "id": f"plot-{size}-{r//size}-{c//size}",
                        "size_m": size,
                        "ground_support_p95_m": round(
                            float(np.percentile(support[sl][valid[sl]], 95)), 2
                        ),
                    }
                )
                west, north = transform * (c, r)
                east, south = transform * (
                    min(c + size, height.shape[1]),
                    min(r + size, height.shape[0]),
                )
                features.append(feature(box(west, south, east, north), metrics))
        plots[str(size)] = fc(features)
    report = {
        "schema_version": 1,
        "source_sha256": summary["source_sha256"],
        "input_sha256": hashes,
        "crs": "EPSG:3157",
        "supported_cells": int(valid.sum()),
        "cell_size_m": 1,
        "gap_minimum_m2": 25,
        "roof_exclusion_m": 2,
        "methods": {
            "gaps": "4-connected supported cells at/below height threshold, >=25 m²; roof patches plus 2 m excluded. Enclosed screening requires >=80% high-cell boundary, no missing/tile boundary and no roof contact. Geometry display simplified 0.75 m; area from original cells.",
            "plots": "25/50 m tile-origin squares. Height mean/median/P95/SD are surface-cell metrics over all finite heights including structures. Cover is share of supported surface cells >2 m, not return cover. Candidate density uses supported area, not stem counts. Support % denominator is a complete square; clipped squares remain partial.",
            "clearance": "Exact horizontal distance from candidate roof polygon to nearest supported elevated cell centre within 30 m, excluding all roof patches plus 2 m. Cell-edge range is centre distance ±0.707 m. Candidate surface includes unclassified structures; this is proximity screening, not measured 3D vegetation clearance.",
        },
        "gaps": gaps,
        "plots": plots,
        "clearance": clearances,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, separators=(",", ":"), allow_nan=False) + "\n")
    print(
        json.dumps(
            {
                "output": str(output),
                "bytes": output.stat().st_size,
                "gaps": {k: len(v["features"]) for k, v in gaps.items()},
                "enclosed": {
                    k: sum(f["properties"]["enclosed_candidate"] for f in v["features"])
                    for k, v in gaps.items()
                },
                "plots": {k: len(v["features"]) for k, v in plots.items()},
                "proximity": {k: len(v["features"]) for k, v in clearances.items()},
            }
        )
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--analysis", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    generate(args.analysis, args.output)
