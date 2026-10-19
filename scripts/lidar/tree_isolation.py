#!/usr/bin/env python3
"""Export exact crown-cell membership and display footprints for existing candidates."""

import argparse, hashlib, json
from pathlib import Path
import numpy as np
import rasterio
from rasterio.features import shapes
from scipy import ndimage as ndi
from pyproj import Transformer
from shapely import transform as project
from shapely.geometry import shape, mapping


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--analysis", type=Path, required=True)
    p.add_argument("--grids", type=Path, required=True)
    p.add_argument(
        "--output",
        type=Path,
        default=Path("src/pages/dev-lidar/treeIsolation.generated.json"),
    )
    a = p.parse_args()
    base = a.analysis
    summary = json.loads((base / "summary.json").read_text())
    trees = json.loads((base / "tree-candidates.geojson").read_text())["features"]
    arrays = np.load(a.grids)
    labels = arrays["crowns"].astype("int32")
    dtm = arrays["dtm"]
    ids = {int(f["properties"]["id"].split("-")[1]): f for f in trees}
    runs = {i: [] for i in ids}
    for row, values in enumerate(labels):
        edges = np.r_[0, np.flatnonzero(values[1:] != values[:-1]) + 1, len(values)]
        for start, end in zip(edges[:-1], edges[1:]):
            ident = int(values[start])
            if ident in ids:
                runs[ident].append([row, int(start), int(end - start)])
    with rasterio.open(base / "height-1m.tif") as src:
        affine = src.transform
        width = src.width
        height = src.height
        bounds = list(src.bounds)
    to_geo = Transformer.from_crs(3157, 4326, always_xy=True).transform
    to_utm = Transformer.from_crs(4326, 3157, always_xy=True).transform
    records = []
    for geometry, ident in shapes(
        labels, mask=np.isin(labels, list(ids)), transform=affine
    ):
        ident = int(ident)
        source = ids[ident]
        props = source["properties"]
        g = shape(geometry).simplify(0.7, preserve_topology=True)
        # round after projection; exact selection always uses stored cell runs.
        geo = project(g, to_geo, interleaved=False)
        xy = to_utm(*source["geometry"]["coordinates"])
        rr = int(np.floor((bounds[3] - xy[1]) / affine.a))
        cc = int(np.floor((xy[0] - bounds[0]) / affine.a))
        ground = float(dtm[rr, cc])
        records.append(
            {
                "type": "Feature",
                "geometry": mapping(geo),
                "properties": {
                    **props,
                    "centre": source["geometry"]["coordinates"],
                    "centre_utm": [round(xy[0], 3), round(xy[1], 3)],
                    "ground_m": round(ground, 3),
                    "runs": runs[ident],
                },
            }
        )
    # One retained marker must have exactly one connected watershed footprint.
    assert len(records) == len(ids) == len({f["properties"]["id"] for f in records})
    records.sort(key=lambda f: int(f["properties"]["id"].split("-")[1]))
    out = {
        "schema_version": 1,
        "source_sha256": summary["source_sha256"],
        "input_sha256": {
            n: sha(base / n)
            for n in [
                "tree-candidates.geojson",
                "height-1m.tif",
                "dtm-1m.tif",
                "building-candidates.geojson",
            ]
        },
        "label_grid_sha256": hashlib.sha256(labels.tobytes()).hexdigest(),
        "grid": {
            "width": width,
            "height": height,
            "bounds": bounds,
            "resolution": affine.a,
            "crs": "EPSG:3157",
        },
        "method": "Existing local-maxima/watershed crown candidates; 1 m source grid. Display geometry simplified 0.7 m; exact point membership uses cell runs. Original returns are cropped vertically above 2 m in these columns, not independently segmented 3D tree instances.",
        "crowns": {"type": "FeatureCollection", "features": records},
    }

    # Quantize only geographic display vertices; runs/metric coordinates stay exact.
    def round_geo(g):
        def walk(x):
            return [walk(v) for v in x] if isinstance(x, list) else round(x, 7)

        g["coordinates"] = walk(json.loads(json.dumps(g["coordinates"])))

    for f in records:
        round_geo(f["geometry"])
    a.output.write_text(json.dumps(out, separators=(",", ":"), allow_nan=False))
    print(
        json.dumps(
            {
                "crowns": len(records),
                "cells": sum(
                    sum(r[2] for r in f["properties"]["runs"]) for f in records
                ),
                "bytes": a.output.stat().st_size,
            }
        )
    )


if __name__ == "__main__":
    main()
