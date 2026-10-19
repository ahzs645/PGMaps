#!/usr/bin/env python3
"""Create bounded canopy-height/cover heatmap previews from verified 1 m grids."""

import argparse, base64, hashlib, io, json
from pathlib import Path
import numpy as np
import rasterio
from rasterio.features import rasterize
from rasterio.warp import calculate_default_transform, reproject, Resampling
from rasterio.transform import array_bounds
from scipy import ndimage as ndi
from pyproj import Transformer
from shapely.geometry import shape, mapping
from shapely import transform as project
from PIL import Image

COLORS = ["#2c1e85", "#2877b8", "#2ab7a9", "#fde725", "#ef3b2c"]


def canopy_cover(height, eligible, threshold, window=21, minimum_support=0.8):
    """Area fraction above threshold / eligible area, not point or stem density."""
    valid = eligible & np.isfinite(height)
    count = (
        ndi.uniform_filter(valid.astype(float), size=window, mode="constant")
        * window**2
    )
    above = (
        ndi.uniform_filter(
            (valid & (height > threshold)).astype(float), size=window, mode="constant"
        )
        * window**2
    )
    fraction = np.divide(
        100 * above, count, out=np.full_like(count, np.nan), where=count > 0
    )
    # Keep excluded cells themselves transparent even if neighbours have support.
    return np.where(
        valid & (count >= minimum_support * window**2 - 1e-6),
        np.clip(fraction, 0, 100),
        np.nan,
    )


def rgba(values, maximum):
    valid = np.isfinite(values)
    scale = np.clip(np.nan_to_num(values, nan=0) / maximum, 0, 1)
    colors = np.array(
        [[int(color[i : i + 2], 16) for i in (1, 3, 5)] for color in COLORS]
    )
    result = np.zeros((*values.shape, 4), dtype="uint8")
    for channel in range(3):
        result[:, :, channel] = np.rint(
            np.interp(scale, np.linspace(0, 1, 5), colors[:, channel])
        ).astype("uint8")
    result[:, :, 3] = valid.astype("uint8") * 255
    return result


def generate(analysis, output):
    names = [
        "height-1m.tif",
        "ground-support-distance.tif",
        "building-candidates.geojson",
    ]
    hashes = {
        name: hashlib.sha256((analysis / name).read_bytes()).hexdigest()
        for name in names
    }
    arrays = []
    affine = None
    for name in names[:2]:
        with rasterio.open(analysis / name) as src:
            if src.crs.to_epsg() != 3157:
                raise ValueError("Expected EPSG:3157")
            if affine is not None and (
                src.transform != affine or src.shape != arrays[0].shape
            ):
                raise ValueError("Grid mismatch")
            affine = src.transform
            bounds = src.bounds
            crs = src.crs
            arrays.append(src.read(1, masked=True).astype(float).filled(np.nan))
    height, support = arrays
    projection = Transformer.from_crs(4326, 3157, always_xy=True)
    fc = json.loads((analysis / names[2]).read_text())
    polygons = [
        mapping(project(shape(f["geometry"]), projection.transform, interleaved=False))
        for f in fc["features"]
    ]
    roof = (
        rasterize(
            [(p, 1) for p in polygons],
            out_shape=height.shape,
            transform=affine,
            dtype="uint8",
        )
        > 0
    )
    eligible = (
        np.isfinite(height)
        & np.isfinite(support)
        & (ndi.distance_transform_edt(~roof) > 2)
    )
    web, width, rows = calculate_default_transform(
        crs, "EPSG:3857", height.shape[1], height.shape[0], *bounds, resolution=6
    )
    web_bounds = list(array_bounds(rows, width, web))
    ll = Transformer.from_crs(3857, 4326, always_xy=True)
    west, south = ll.transform(web_bounds[0], web_bounds[1])
    east, north = ll.transform(web_bounds[2], web_bounds[3])
    rasters = {}
    products = {
        "height": np.where(eligible, height, np.nan),
        "density2": canopy_cover(height, eligible, 2),
        "density5": canopy_cover(height, eligible, 5),
    }
    for name, values in products.items():
        target = np.full((rows, width), np.nan, dtype="float32")
        reproject(
            values.astype("float32"),
            target,
            src_transform=affine,
            src_crs=crs,
            dst_transform=web,
            dst_crs="EPSG:3857",
            src_nodata=np.nan,
            dst_nodata=np.nan,
            resampling=Resampling.nearest,
        )
        maximum = 40 if name == "height" else 100
        buffer = io.BytesIO()
        Image.fromarray(rgba(target, maximum)).save(buffer, format="PNG", optimize=True)
        # One-byte display samples support inspection; 255 is no-data, 0..254 maps to range.
        sample_maximum = 80 if name == "height" else 100
        samples = np.where(
            np.isfinite(target),
            np.rint(np.clip(np.nan_to_num(target, nan=0) / sample_maximum, 0, 1) * 254),
            255,
        ).astype("uint8")
        rasters[name] = {
            "png_data_url": "data:image/png;base64,"
            + base64.b64encode(buffer.getvalue()).decode(),
            "samples_base64": base64.b64encode(samples.tobytes()).decode(),
            "sample_maximum": sample_maximum,
            "display_maximum": maximum,
            "source_valid_cells": int(np.isfinite(values).sum()),
            "source_min": round(float(np.nanmin(values)), 3),
            "source_max": round(float(np.nanmax(values)), 3),
        }
    summary = json.loads((analysis / "summary.json").read_text())
    result = {
        "schema_version": 1,
        "source_sha256": summary["source_sha256"],
        "input_sha256": hashes,
        "colors": COLORS,
        "coordinates": [[west, north], [east, north], [east, south], [west, south]],
        "grid": {
            "width": width,
            "height": rows,
            "bounds_mercator": web_bounds,
            "resolution_mercator_m": 6,
        },
        "density_window_m": 21,
        "minimum_window_support_percent": 80,
        "roof_exclusion_m": 2,
        "method": "Height is the supported 1 m normalized surface, excluding known roof patches plus 2 m. Density is the share of eligible 1 m cells above 2/5 m within a 21×21 m square, requiring >=80% eligible window support; divided by eligible cells, not by returns. Excluded centres stay missing. Nearest-neighbour 6 m Web Mercator previews preserve masks and avoid colour interpolation across missing cells. Height colour clips at 40 m; display samples quantize height to 80/254 m and density to 100/254 percentage points. Source products retain their original precision.",
        "rasters": rasters,
    }
    output.write_text(json.dumps(result, separators=(",", ":"), allow_nan=False) + "\n")
    print(
        json.dumps(
            {
                "bytes": output.stat().st_size,
                "display_grid": [width, rows],
                "valid_cells": {k: v["source_valid_cells"] for k, v in rasters.items()},
                "height_max": rasters["height"]["source_max"],
            }
        )
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--analysis", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    generate(args.analysis, args.output)
