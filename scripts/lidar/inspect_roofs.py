#!/usr/bin/env python3
"""Create a small, versioned inspection snapshot from published roof candidates/grids.
No new buildings are detected. Whole-patch fits are exploratory, not roof models.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import rasterio
from rasterio.features import geometry_mask
from pyproj import Transformer
from shapely.geometry import Point, shape, mapping
from shapely import transform as project_geometry


def plane_metrics(x, y, z):
    """Least-squares whole-patch roof plane; report residual over every input cell."""
    matrix = np.column_stack((x - x.mean(), y - y.mean(), np.ones(len(x))))
    coefficients, _, rank, _ = np.linalg.lstsq(matrix, z, rcond=None)
    if rank < 3:
        return None
    east, north = coefficients[:2]
    pitch = float(np.degrees(np.arctan(np.hypot(east, north))))
    aspect = float(np.degrees(np.arctan2(-east, -north)) % 360) if pitch >= 2 else None
    residual = z - matrix @ coefficients
    return {"pitch_deg": round(pitch, 2), "downslope_aspect_deg": round(aspect, 2) if aspect is not None else None,
            "plane_rmse_m": round(float(np.sqrt(np.mean(residual ** 2))), 3)}


def sample_profile(polygon, dtm, dsm, transform):
    corners = np.asarray(polygon.minimum_rotated_rectangle.exterior.coords)[:4]
    edges = np.roll(corners, -1, axis=0) - corners
    edge = edges[np.argmax(np.linalg.norm(edges, axis=1))]
    length = float(np.linalg.norm(edge))
    axis = edge / length
    centre = np.asarray(polygon.minimum_rotated_rectangle.centroid.coords[0])
    span = length + 12
    distances = np.linspace(0, span, min(65, int(np.ceil(span)) + 1))
    points = centre + (distances - span / 2)[:, None] * axis
    inverse = ~transform
    values = []
    for distance, (x, y) in zip(distances, points):
        colf, rowf = inverse @ (x, y)
        col, row = int(np.floor(colf)), int(np.floor(rowf))
        terrain = surface = None
        if 0 <= row < dtm.shape[0] and 0 <= col < dtm.shape[1]:
            if np.isfinite(dtm[row, col]): terrain = round(float(dtm[row, col]), 2)
            if np.isfinite(dsm[row, col]): surface = round(float(dsm[row, col]), 2)
        values.append({"distance_m": round(float(distance), 2), "terrain_m": terrain, "surface_m": surface,
                       "inside_patch": bool(polygon.covers(Point(float(x), float(y))))})
    return values


def inspect(analysis, output):
    files = ["building-candidates.geojson", "dtm-1m.tif", "dsm-1m.tif", "ground-support-distance.tif"]
    hashes = {name: hashlib.sha256((analysis / name).read_bytes()).hexdigest() for name in files}
    summary = json.loads((analysis / "summary.json").read_text())
    candidates = json.loads((analysis / files[0]).read_text())["features"]
    arrays = []
    transform = None
    for name in files[1:]:
        with rasterio.open(analysis / name) as dataset:
            if dataset.crs.to_epsg() != 3157: raise ValueError("Expected source-grid EPSG:3157")
            if transform is not None and (dataset.transform != transform or dataset.shape != arrays[0].shape):
                raise ValueError("Source grids do not align")
            transform = dataset.transform
            arrays.append(dataset.read(1, masked=True).astype(float).filled(np.nan))
    dtm, dsm, support = arrays
    projection = Transformer.from_crs(4326, 3157, always_xy=True)
    records = []
    for candidate in candidates:
        polygon = project_geometry(shape(candidate["geometry"]), projection.transform, interleaved=False)
        mask = geometry_mask([mapping(polygon)], out_shape=dtm.shape, transform=transform, invert=True)
        mask &= np.isfinite(dtm) & np.isfinite(dsm)
        rows, cols = np.where(mask)
        if len(rows) < 3: continue
        x, y = rasterio.transform.xy(transform, rows, cols)
        z = dsm[mask]
        heights = z - dtm[mask]
        plane = plane_metrics(np.asarray(x), np.asarray(y), z)
        record = {"id": candidate["properties"]["id"], "cells": int(mask.sum()),
                  "sampled_area_m2": round(float(mask.sum() * abs(transform.a * transform.e)), 1),
                  "height_median_m": round(float(np.median(heights)), 2),
                  "height_p95_m": round(float(np.percentile(heights, 95)), 2),
                  "terrain_median_m": round(float(np.median(dtm[mask])), 2),
                  "surface_median_m": round(float(np.median(z)), 2),
                  "ground_support_p95_m": round(float(np.percentile(support[mask], 95)), 2),
                  "plane": plane, "profile": sample_profile(polygon, dtm, dsm, transform)}
        records.append(record)
    report = {"schema_version": 1, "source_sha256": summary["source_sha256"], "input_sha256": hashes,
              "method": "Published 1 m EPSG:3157 DSM/DTM sampled inside existing roof-patch polygons. Whole-patch least-squares plane, no facet segmentation. Profile along longest minimum-rectangle axis plus 6 m at each end; nearest source-grid samples, maximum 65 positions.",
              "vertical_datum": "CGVD2013 (CGG2013)", "records": records,
              "limitations": ["Candidates are not verified buildings or full building footprints.",
                              "A gabled/multiple-facet roof, smooth canopy or boundary contamination can produce a misleading whole-patch pitch/aspect; inspect the residual and profile.",
                              "A low residual is geometric consistency, not a building probability or accuracy estimate.",
                              "Ground under roofs may be interpolated; ground-support distance is not measured vertical error.",
                              "No solar yield, structural capacity, roof condition, building volume or engineering-grade dimensions are inferred."]}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, separators=(",", ":"), allow_nan=False) + "\n")
    print(json.dumps({"output": str(output), "records": len(records), "bytes": output.stat().st_size,
                      "whole_patch_plane_rmse_le_030": sum(r["plane"] is not None and r["plane"]["plane_rmse_m"] <= .3 for r in records)}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--analysis", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    inspect(args.analysis, args.output)
