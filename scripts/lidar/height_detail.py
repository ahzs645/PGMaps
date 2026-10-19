#!/usr/bin/env python3
"""Pin the exact 1 m canopy heatmap eligibility mask for zoomed browser rendering."""

import argparse, base64, hashlib, json
from pathlib import Path
import numpy as np
import rasterio
from rasterio.features import rasterize
from scipy import ndimage as ndi
from pyproj import Transformer
from shapely import transform
from shapely.geometry import shape, mapping


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--analysis", type=Path, required=True)
    p.add_argument(
        "--output",
        type=Path,
        default=Path("src/pages/dev-lidar/height-detail.generated.json"),
    )
    a = p.parse_args()
    names = [
        "height-1m.tif",
        "ground-support-distance.tif",
        "building-candidates.geojson",
    ]
    arrays = []
    for name in names[:2]:
        with rasterio.open(a.analysis / name) as src:
            arrays.append(src.read(1, masked=True).astype(float).filled(np.nan))
            affine = src.transform
            bounds = list(src.bounds)
    height, support = arrays
    forward = Transformer.from_crs(4326, 3157, always_xy=True).transform
    features = json.loads((a.analysis / names[2]).read_text())["features"]
    roof = (
        rasterize(
            [
                (
                    mapping(
                        transform(shape(f["geometry"]), forward, interleaved=False)
                    ),
                    1,
                )
                for f in features
            ],
            out_shape=height.shape,
            transform=affine,
            dtype="uint8",
        )
        > 0
    )
    mask = (
        np.isfinite(height)
        & np.isfinite(support)
        & (ndi.distance_transform_edt(~roof) > 2)
    )
    ll = Transformer.from_crs(3157, 4326, always_xy=True)
    west, south, east, north = bounds
    out = {
        "schema_version": 1,
        "source_sha256": json.loads((a.analysis / "summary.json").read_text())[
            "source_sha256"
        ],
        "input_sha256": {
            n: hashlib.sha256((a.analysis / n).read_bytes()).hexdigest() for n in names
        },
        "grid": {
            "width": height.shape[1],
            "height": height.shape[0],
            "bounds": bounds,
            "resolution": 1,
            "crs": "EPSG:3157",
        },
        "coordinates": [
            list(ll.transform(x, y))
            for x, y in [(west, north), (east, north), (east, south), (west, south)]
        ],
        "eligible_cells": int(mask.sum()),
        "mask_base64": base64.b64encode(
            np.packbits(mask.ravel(), bitorder="little").tobytes()
        ).decode(),
        "mask_bit_order": "little",
        "detail_min_zoom": 16,
        "method": "Original 1 m height values and identical heatmap mask: finite height/support; Euclidean cell-centre distance >2 m from rasterized roof patches. Bit-packed row-major eligibility. Source-grid image georeferenced by four true grid corners; click and crop coordinates use the metric source grid.",
    }
    a.output.write_text(json.dumps(out, separators=(",", ":")))
    print(
        json.dumps(
            {"eligible_cells": out["eligible_cells"], "bytes": a.output.stat().st_size}
        )
    )


if __name__ == "__main__":
    main()
