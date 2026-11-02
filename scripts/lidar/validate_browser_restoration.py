#!/usr/bin/env python3
"""Independently check one source cloud against exported browser restoration products.

Usage:
  python scripts/lidar/validate_browser_restoration.py \
    --source tile.laz --products /path/to/extracted/pgmaps-restoration

Requires numpy, rasterio and laspy with a LAZ backend (e.g. ``laspy[lazrs]``).
Reads the source in bounded chunks. This is a reference check of the documented
ground-cell-mean/bilinear screening method, not a claim of lidR/LAStools parity.
The input must be a single original elevation cloud; mosaics are deliberately
rejected because one source cannot validate a multi-source run.
"""

import argparse
import hashlib
import json
import sys
import time
from dataclasses import dataclass
from pathlib import Path

import laspy
import numpy as np
import rasterio
from rasterio.crs import CRS


PRODUCT_IDS = (
    "terrain", "slope", "meanHeight", "vegetation", "canopy", "understory",
    "midstory", "overstory", "ground", "support",
)
PEM_PRODUCT_IDS = (
    "pemEligible", "pemAbove2", "pemMean", "pemRms", "pemStd", "pemCover", "pemCv",
)


@dataclass
class Raster:
    width: int
    height: int
    west: float
    north: float
    cell: float
    values: np.ndarray

    @property
    def size(self):
        return self.width * self.height

    def indices(self, x, y):
        col = np.floor((x - self.west) / self.cell).astype(np.int64)
        row = np.floor((self.north - y) / self.cell).astype(np.int64)
        valid = (col >= 0) & (row >= 0) & (col < self.width) & (row < self.height)
        return row * self.width + col, valid


def load_rasters(folder, manifest):
    rasters = {}
    product_ids = PRODUCT_IDS + (PEM_PRODUCT_IDS if manifest.get("structuralMethod") else ())
    for name in product_ids:
        metadata = manifest["products"][name]
        # GDAL otherwise strips a GeoTIFF 1.0 vertical component from its CRS report.
        with rasterio.Env(GTIFF_REPORT_COMPD_CS="YES"), rasterio.open(folder / f"{name}.tif") as image:
            if image.count != 1 or image.dtypes != ("float32",):
                raise ValueError(f"{name}: expected a single float32 band")
            if image.nodata is None or not np.isnan(image.nodata):
                raise ValueError(f"{name}: expected explicit NaN NoData")
            transform = image.transform
            if transform.a <= 0 or transform.e >= 0 or transform.b or transform.d:
                raise ValueError(f"{name}: expected north-up metre grid")
            expected_crs = f'EPSG:{manifest["horizontalEpsg"]}'
            if name == "terrain" and manifest.get("verticalEpsg"):
                expected_crs += f'+{manifest["verticalEpsg"]}'
            if image.crs != CRS.from_string(expected_crs):
                raise ValueError(f"{name}: CRS disagrees with manifest")
            expected = (
                metadata["width"], metadata["height"], metadata["west"],
                metadata["north"], metadata["cellM"], -metadata["cellM"],
            )
            actual = (image.width, image.height, transform.c, transform.f, transform.a, transform.e)
            if not np.allclose(actual, expected, rtol=0, atol=1e-9):
                raise ValueError(f"{name}: grid geometry disagrees with manifest")
            rasters[name] = Raster(
                image.width, image.height, transform.c, transform.f,
                transform.a, image.read(1).ravel(),
            )
    return rasters


def sample_ground(terrain, x, y):
    """Bilinear cell centres, clamped within the outside half-cell only."""
    _, inside = terrain.indices(x, y)
    fx = np.clip((x - terrain.west) / terrain.cell - 0.5, 0, terrain.width - 1)
    fy = np.clip((terrain.north - y) / terrain.cell - 0.5, 0, terrain.height - 1)
    col, row = np.floor(fx).astype(np.int64), np.floor(fy).astype(np.int64)
    tx, ty = fx - col, fy - row
    sampled = np.zeros(len(x), dtype=np.float64)
    for dy in (0, 1):
        for dx in (0, 1):
            weight = (tx if dx else 1 - tx) * (ty if dy else 1 - ty)
            indices = np.minimum(terrain.height - 1, row + dy) * terrain.width
            indices += np.minimum(terrain.width - 1, col + dx)
            z = terrain.values[indices]
            sampled += np.where(weight == 0, 0.0, weight * z)
    sampled[~inside] = np.nan
    return sampled


def fill_ground(sum_z, counts, grid):
    """Rebuild three simultaneous short-gap passes from independently counted ground."""
    values = np.full(grid.size, np.nan, dtype=np.float32)
    occupied = counts > 0
    values[occupied] = sum_z[occupied] / counts[occupied]
    values = values.reshape(grid.height, grid.width)
    filled = 0
    for _ in range(3):
        total = np.zeros(values.shape, dtype=np.float64)
        known = np.zeros(values.shape, dtype=np.uint8)
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                if dr == dc == 0:
                    continue
                r0, r1 = max(0, -dr), min(grid.height, grid.height - dr)
                c0, c1 = max(0, -dc), min(grid.width, grid.width - dc)
                neighbor = values[r0 + dr:r1 + dr, c0 + dc:c1 + dc]
                finite = np.isfinite(neighbor)
                total[r0:r1, c0:c1] += np.where(finite, neighbor, 0)
                known[r0:r1, c0:c1] += finite
        fill = np.isnan(values) & (known >= 3)
        next_values = values.copy()
        next_values[fill] = total[fill] / known[fill]
        filled += int(np.count_nonzero(fill))
        values = next_values
    return values.ravel(), filled


def slope_from_ground(grid):
    z = grid.values.reshape(grid.height, grid.width).astype(np.float64)
    output = np.full(z.shape, np.nan, dtype=np.float32)
    if grid.width < 3 or grid.height < 3:
        return output.ravel()
    valid = np.ones((grid.height - 2, grid.width - 2), dtype=bool)
    for dr in range(3):
        for dc in range(3):
            valid &= np.isfinite(z[dr:dr + grid.height - 2, dc:dc + grid.width - 2])
    dx = (z[:-2, 2:] + 2*z[1:-1, 2:] + z[2:, 2:]
          - z[:-2, :-2] - 2*z[1:-1, :-2] - z[2:, :-2]) / (8*grid.cell)
    dy = (z[2:, :-2] + 2*z[2:, 1:-1] + z[2:, 2:]
          - z[:-2, :-2] - 2*z[:-2, 1:-1] - z[:-2, 2:]) / (8*grid.cell)
    interior = output[1:-1, 1:-1]
    interior[valid] = np.hypot(dx[valid], dy[valid])*100
    return output.ravel()


def compare(actual, expected, absolute_tolerance):
    a, e = np.asarray(actual), np.asarray(expected, dtype=np.float32)
    infinite_cells = int(np.count_nonzero(np.isinf(a)))
    missing_mismatch = int(np.count_nonzero(np.isfinite(a) != np.isfinite(e)))
    finite = np.isfinite(a) & np.isfinite(e)
    difference = np.abs(a[finite].astype(np.float64) - e[finite].astype(np.float64))
    limit = absolute_tolerance + 2e-6 * np.abs(e[finite])
    mismatches = int(np.count_nonzero(difference > limit))
    return {
        "passed": not (infinite_cells or missing_mismatch or mismatches),
        "infinite_cells": infinite_cells,
        "finite_cells": int(np.count_nonzero(finite)),
        "missing_mask_mismatches": missing_mismatch,
        "value_mismatches": mismatches,
        "max_absolute_error": float(difference.max()) if len(difference) else 0.0,
    }


def validate(source, folder, chunk_size, tolerance):
    manifest = json.loads((folder / "manifest.json").read_text())
    if manifest.get("schema") != "pgmaps-lidar-restoration-v1":
        raise ValueError("Unsupported restoration manifest schema")
    if manifest.get("method") != "ground-cell-mean-bilinear-v1":
        raise ValueError("This validator supports only ground-cell-mean-bilinear-v1")
    if len(manifest.get("sources", [])) != 1:
        raise ValueError("This validator accepts a single-source run, not a mosaic")
    if source.stat().st_size != manifest["sources"][0]["bytes"]:
        raise ValueError("Source byte length does not match the run manifest")
    rasters = load_rasters(folder, manifest)
    structural_method = manifest.get("structuralMethod")
    if structural_method and (
        structural_method.get("id") != "pem-structure-welford-v1"
        or structural_method.get("heightCutoffM") != 2
        or structural_method.get("heightCeilingM") != 100
    ):
        raise ValueError("Unsupported structural metric method or cutoff")
    terrain, density, mean = rasters["terrain"], rasters["ground"], rasters["meanHeight"]
    for name in ("vegetation", "canopy", "understory", "midstory", "overstory", "support"):
        r = rasters[name]
        if (r.width, r.height, r.west, r.north, r.cell) != (
            density.width, density.height, density.west, density.north, density.cell,
        ):
            raise ValueError(f"{name}: density products use different grids")
    raw, normalized, ground, under, mid, over = (
        np.zeros(density.size, dtype=np.uint64) for _ in range(6)
    )
    first, first_normalized = (np.zeros(mean.size, dtype=np.uint64) for _ in range(2))
    height_sum = np.zeros(mean.size, dtype=np.float64)
    ground_sum = np.zeros(terrain.size, dtype=np.float64)
    ground_count = np.zeros(terrain.size, dtype=np.uint64)
    if structural_method:
        structure = rasters["pemEligible"]
        for name in PEM_PRODUCT_IDS:
            r = rasters[name]
            if (r.width, r.height, r.west, r.north, r.cell) != (
                structure.width, structure.height, structure.west, structure.north, structure.cell,
            ):
                raise ValueError(f"{name}: structural products use different grids")
        pem_all, pem_above, pem_missing, pem_first, pem_first_above = (
            np.zeros(structure.size, dtype=np.uint64) for _ in range(5)
        )
        pem_sum, pem_squares = (np.zeros(structure.size, dtype=np.float64) for _ in range(2))
    counts = {"read": 0, "accepted": 0, "excluded": 0, "normalized": 0, "ground": 0}
    with laspy.open(source) as cloud:
        if cloud.header.point_count != manifest["sources"][0]["points"]:
            raise ValueError("Source point count does not match the run manifest")
        for chunk in cloud.chunk_iterator(chunk_size):
            x, y, z = np.asarray(chunk.x), np.asarray(chunk.y), np.asarray(chunk.z)
            classes = np.asarray(chunk.classification)
            valid = np.isfinite(x) & np.isfinite(y) & np.isfinite(z)
            valid &= ~np.asarray(chunk.withheld, dtype=bool) & (classes != 7) & (classes != 18)
            counts["read"] += len(chunk)
            counts["accepted"] += int(np.count_nonzero(valid))
            counts["excluded"] += int(np.count_nonzero(~valid))
            x, y, z, classes = x[valid], y[valid], z[valid], classes[valid]
            first_returns = np.asarray(chunk.return_number)[valid] == 1
            i, density_inside = density.indices(x, y)
            j, mean_inside = mean.indices(x, y)
            ti, terrain_inside = terrain.indices(x, y)
            if not np.all(density_inside & mean_inside & terrain_inside):
                raise ValueError("An accepted return lies outside an exported grid")
            np.add.at(raw, i, 1)
            np.add.at(first, j[first_returns], 1)
            is_ground = classes == 2
            np.add.at(ground, i[is_ground], 1)
            np.add.at(ground_count, ti[is_ground], 1)
            np.add.at(ground_sum, ti[is_ground], z[is_ground])
            counts["ground"] += int(np.count_nonzero(is_ground))
            heights = z - sample_ground(terrain, x, y)
            known = np.isfinite(heights)
            counts["normalized"] += int(np.count_nonzero(known))
            np.add.at(normalized, i[known], 1)
            np.add.at(first_normalized, j[first_returns & known], 1)
            np.add.at(height_sum, j[first_returns & known], heights[first_returns & known])
            np.add.at(under, i[known & (heights > 0.5) & (heights <= 2)], 1)
            np.add.at(mid, i[known & (heights > 2) & (heights <= 10)], 1)
            np.add.at(over, i[known & (heights > 10)], 1)
            if structural_method:
                si, structure_inside = structure.indices(x, y)
                if not np.all(structure_inside):
                    raise ValueError("An accepted return lies outside the structural grid")
                non_ground = classes != 2
                np.add.at(pem_missing, si[non_ground & ~known], 1)
                eligible = non_ground & known & (heights <= 100)
                above_cutoff = eligible & (heights > 2)
                np.add.at(pem_all, si[eligible], 1)
                np.add.at(pem_above, si[above_cutoff], 1)
                np.add.at(pem_first, si[eligible & first_returns], 1)
                np.add.at(pem_first_above, si[above_cutoff & first_returns], 1)
                # Independent sums/squared sums, rather than the browser's Welford recurrence.
                np.add.at(pem_sum, si[above_cutoff], heights[above_cutoff])
                np.add.at(pem_squares, si[above_cutoff], heights[above_cutoff]**2)
    reconstructed_ground, filled = fill_ground(ground_sum, ground_count, terrain)
    counts["filled"] = filled
    count_checks = {
        key: {"expected": value, "actual": manifest["counts"].get(key),
              "passed": value == manifest["counts"].get(key)}
        for key, value in counts.items()
    }
    expected = {}
    complete = (raw > 0) & (normalized == raw)
    observed = raw > 0
    for name, numerator in (
        ("canopy", under + mid + over), ("understory", under),
        ("midstory", mid), ("overstory", over),
    ):
        values = np.full(density.size, np.nan, dtype=np.float32)
        values[complete] = 100.0*numerator[complete]/raw[complete]
        expected[name] = values
    values = np.full(density.size, np.nan, dtype=np.float32)
    values[complete] = (under[complete]+mid[complete]+over[complete])/density.cell**2
    expected["vegetation"] = values
    for name, numerator, factor in (("ground", ground, 1/density.cell**2), ("support", normalized, 100.0)):
        values = np.full(density.size, np.nan, dtype=np.float32)
        values[observed] = (numerator[observed]*factor/raw[observed]
                            if name == "support" else numerator[observed]*factor)
        expected[name] = values
    values = np.full(mean.size, np.nan, dtype=np.float32)
    complete_first = (first > 0) & (first_normalized == first)
    values[complete_first] = height_sum[complete_first]/first[complete_first]
    expected["meanHeight"] = values
    expected["terrain"] = reconstructed_ground
    expected["slope"] = slope_from_ground(terrain)
    if structural_method:
        complete_structure = (pem_all > 0) & (pem_missing == 0)
        above_present = complete_structure & (pem_above > 0)
        multiple_above = complete_structure & (pem_above > 1)
        first_present = complete_structure & (pem_first > 0)
        mean_values = np.full(structure.size, np.nan, dtype=np.float64)
        mean_values[above_present] = pem_sum[above_present]/pem_above[above_present]
        rms_values = np.full(structure.size, np.nan, dtype=np.float64)
        rms_values[above_present] = np.sqrt(pem_squares[above_present]/pem_above[above_present])
        std_values = np.full(structure.size, np.nan, dtype=np.float64)
        variance_numerator = (pem_squares[multiple_above]
                              - pem_sum[multiple_above]**2/pem_above[multiple_above])
        std_values[multiple_above] = np.sqrt(
            np.maximum(0, variance_numerator)/(pem_above[multiple_above] - 1)
        )
        for name, count in (("pemEligible", pem_all), ("pemAbove2", pem_above)):
            values = np.full(structure.size, np.nan, dtype=np.float32)
            values[complete_structure] = count[complete_structure]
            expected[name] = values
        expected["pemMean"] = mean_values
        expected["pemRms"] = rms_values
        expected["pemStd"] = std_values
        values = np.full(structure.size, np.nan, dtype=np.float32)
        values[first_present] = 100.0*pem_first_above[first_present]/pem_first[first_present]
        expected["pemCover"] = values
        expected["pemCv"] = std_values/mean_values
    product_checks = {
        name: compare(rasters[name].values, values, tolerance)
        for name, values in expected.items()
    }
    with source.open("rb") as stream:
        source_hash = hashlib.file_digest(stream, "sha256").hexdigest()
    recorded_hash = manifest["sources"][0].get("sha256")
    source_matches = not recorded_hash or recorded_hash == source_hash
    passed = source_matches and all(c["passed"] for c in count_checks.values())
    passed &= all(p["passed"] for p in product_checks.values())
    return {
        "passed": bool(passed), "source_sha256": source_hash,
        "source_hash_recorded_in_manifest": recorded_hash is not None,
        "source_hash_matches_manifest": bool(source_matches) if recorded_hash else None,
        "chunk_size": chunk_size, "absolute_tolerance": tolerance,
        "relative_tolerance": 2e-6, "counts": count_checks, "products": product_checks,
        "scope": "One original source cloud; independent numpy/laspy reference of the documented browser method, including structural metrics when present.",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--products", type=Path, required=True)
    parser.add_argument("--chunk-size", type=int, default=500_000)
    parser.add_argument("--absolute-tolerance", type=float, default=0.0001)
    args = parser.parse_args()
    if not 1 <= args.chunk_size <= 2_000_000:
        parser.error("--chunk-size must be between 1 and 2000000")
    if not np.isfinite(args.absolute_tolerance) or args.absolute_tolerance < 0:
        parser.error("--absolute-tolerance must be finite and nonnegative")
    started = time.monotonic()
    try:
        report = validate(args.source, args.products, args.chunk_size, args.absolute_tolerance)
    except Exception as error:
        report = {"passed": False, "error": str(error)}
    report["runtime_seconds"] = round(time.monotonic() - started, 3)
    print(json.dumps(report, separators=(",", ":"), allow_nan=False))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
