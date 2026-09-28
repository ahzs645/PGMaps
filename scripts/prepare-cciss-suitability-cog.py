#!/usr/bin/env python3
"""Validate a numeric CCISS suitability GeoTIFF and make a lossless COG.

This accepts an existing single-band class raster. It does not infer numeric
classes from a colour image or change one CCISS product into another.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.shutil import copy as raster_copy


CLASS_CODES = {10, 20, 30}


def checksum(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def class_counts(dataset: rasterio.io.DatasetReader) -> dict[int, int]:
    counts: dict[int, int] = {}
    for _, window in dataset.block_windows(1):
        values = dataset.read(1, window=window, masked=True).compressed()
        if not values.size:
            continue
        codes, frequencies = np.unique(values, return_counts=True)
        for code, frequency in zip(codes, frequencies, strict=True):
            value = int(code)
            counts[value] = counts.get(value, 0) + int(frequency)
    return counts


def validate_source(dataset: rasterio.io.DatasetReader) -> dict[int, int]:
    if dataset.count != 1:
        raise ValueError(f"Expected one numeric band, found {dataset.count}")
    if dataset.crs != rasterio.crs.CRS.from_epsg(4326):
        raise ValueError(f"Expected EPSG:4326, found {dataset.crs}")
    if not np.issubdtype(np.dtype(dataset.dtypes[0]), np.integer):
        raise ValueError(f"Expected integer class codes, found {dataset.dtypes[0]}")
    if dataset.nodata is None:
        raise ValueError("Expected an explicit NoData value")
    if dataset.transform.b != 0 or dataset.transform.d != 0 or dataset.transform.a <= 0 or dataset.transform.e >= 0:
        raise ValueError("Expected a north-up longitude/latitude raster")
    counts = class_counts(dataset)
    if not counts:
        raise ValueError("No valid class cells found")
    unknown = set(counts) - CLASS_CODES
    if unknown:
        raise ValueError(f"Unexpected suitability codes: {sorted(unknown)}")
    return counts


def verify_copy(source_path: Path, output_path: Path, expected_counts: dict[int, int]) -> dict:
    with rasterio.open(source_path) as source, rasterio.open(output_path) as output:
        if (source.width, source.height, source.count, source.crs, source.transform, source.nodata, source.dtypes) != (
            output.width, output.height, output.count, output.crs, output.transform, output.nodata, output.dtypes
        ):
            raise ValueError("COG changed the raster grid or band metadata")
        if output.profile.get("driver") != "GTiff" or not output.is_tiled or not output.overviews(1):
            raise ValueError("Output is missing COG tiles or overviews")
        for _, window in source.block_windows(1):
            if not np.array_equal(source.read(1, window=window), output.read(1, window=window)):
                raise ValueError(f"COG changed source cells in window {window}")
        if class_counts(output) != expected_counts:
            raise ValueError("COG class counts differ from the source")
        for factor in output.overviews(1):
            overview = output.read(
                1,
                out_shape=((output.height + factor - 1) // factor, (output.width + factor - 1) // factor),
                resampling=Resampling.nearest,
                masked=True,
            )
            unexpected = set(np.unique(overview.compressed())) - CLASS_CODES
            if unexpected:
                raise ValueError(f"COG overview {factor} has unexpected codes: {sorted(unexpected)}")
        return {
            "width": output.width,
            "height": output.height,
            "crs": str(output.crs),
            "pixelSize": [output.transform.a, -output.transform.e],
            "nodata": output.nodata,
            "overviewFactors": output.overviews(1),
            "classCounts": {str(code): count for code, count in sorted(expected_counts.items())},
        }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Single-band numeric suitability GeoTIFF")
    parser.add_argument("output", type=Path, help="Output Cloud Optimized GeoTIFF")
    args = parser.parse_args()
    source_path = args.source.resolve()
    output_path = args.output.resolve()
    if source_path == output_path:
        parser.error("Source and output paths must differ")
    if not source_path.is_file():
        parser.error(f"Source file does not exist: {source_path}")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = output_path.with_name(f".{output_path.stem}.{os.getpid()}.tif")
    try:
        with rasterio.open(source_path) as source:
            counts = validate_source(source)
            raster_copy(
                source,
                temporary_path,
                driver="COG",
                COMPRESS="DEFLATE",
                BLOCKSIZE="512",
                RESAMPLING="NEAREST",
                OVERVIEW_RESAMPLING="NEAREST",
                OVERVIEWS="IGNORE_EXISTING",
            )
        summary = verify_copy(source_path, temporary_path, counts)
        os.replace(temporary_path, output_path)
    finally:
        temporary_path.unlink(missing_ok=True)
    print(json.dumps({
        "source": str(source_path),
        "sourceBytes": source_path.stat().st_size,
        "sourceSha256": checksum(source_path),
        "output": str(output_path),
        "outputBytes": output_path.stat().st_size,
        "outputSha256": checksum(output_path),
        **summary,
    }, indent=2))


if __name__ == "__main__":
    main()
