#!/usr/bin/env python3
"""Execute real GeoLibre/Whitebox WASI algorithms against prepared tile products."""

import argparse, hashlib, json, time
import laspy
import numpy as np
from pathlib import Path
import geolibre_wasm as gl

p = argparse.ArgumentParser(description=__doc__)
p.add_argument("--analysis", type=Path, required=True)
args = p.parse_args()
root = args.analysis
manifests = {m["id"]: m for m in gl.list_manifests()}
runs = []


def run(tool, args, input):
    start = time.time()
    result = gl.run_tool(tool, args=args, input=input)
    record = {
        "engine": "geolibre-wasm",
        "engine_version": "1.7.1",
        "tool": tool,
        "args": args,
        "exit_code": result.exit_code,
        "seconds": round(time.time() - start, 2),
        "stdout": result.stdout,
        "input_sha256": {
            name: hashlib.sha256(data).hexdigest() for name, data in input.items()
        },
        "outputs": {},
    }
    for name, data in result.files.items():
        dest = root / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        record["outputs"][name] = {
            "bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
        }
    runs.append(record)
    (root / "geolibre-runs.json").write_text(json.dumps(runs, indent=2) + "\n")
    print(
        tool, result.exit_code, record["seconds"], list(record["outputs"]), flush=True
    )
    if result.exit_code != 0:
        raise RuntimeError(result.stdout)


run(
    "slope",
    [
        "--input=/work/dtm.tif",
        "--output=/work/slope.tif",
        "--units=degrees",
        "--z_factor=1",
    ],
    {"dtm.tif": (root / "dtm-1m.tif").read_bytes()},
)
run(
    "hillshade",
    [
        "--input=/work/dtm.tif",
        "--output=/work/hillshade.tif",
        "--azimuth=315",
        "--altitude=45",
        "--z_factor=1",
    ],
    {"dtm.tif": (root / "dtm-1m.tif").read_bytes()},
)
surface = laspy.read(root / "normalized-surface.las")
x0 = 512700.0
y0 = 5971550.0
mask = (
    (surface.x >= x0)
    & (surface.x < x0 + 100)
    & (surface.y >= y0)
    & (surface.y < y0 + 100)
)
roi = laspy.LasData(surface.header)
roi.points = surface.points[mask]
roi.write(root / "reference-roi.las")
(root / "reference-scope.json").write_text(
    json.dumps(
        {
            "bounds_utm": [x0, y0, x0 + 100, y0 + 100],
            "area_ha": 1,
            "points": len(roi.points),
            "input": "1m normalized surface samples >=5m, outside roof buffers; not the original full cloud",
            "full_surface_attempt": "Stopped after 275s without output; no result used",
        },
        indent=2,
    )
    + "\n"
)
run(
    "individual_tree_detection",
    [
        "--input=/work/reference-roi.las",
        "--output=/work/geolibre-trees.shp",
        "--min_search_radius=2",
        "--max_search_radius=4",
        "--min_height=5",
        "--max_height=40",
        "--only_use_veg=false",
    ],
    {"reference-roi.las": (root / "reference-roi.las").read_bytes()},
)
(root / "geolibre-manifests.json").write_text(
    json.dumps(
        [manifests[k] for k in ["slope", "hillshade", "individual_tree_detection"]],
        indent=2,
    )
    + "\n"
)
