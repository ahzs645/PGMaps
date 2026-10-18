#!/usr/bin/env python3
"""Additional bounded reference experiments using actual GeoLibre WASI tools."""

import argparse, hashlib, json, time
from pathlib import Path
import geolibre_wasm as gl
from pyproj import Transformer
from shapely.geometry import shape, mapping
from shapely.ops import transform

p = argparse.ArgumentParser(description=__doc__)
p.add_argument("--analysis", type=Path, required=True)
a = p.parse_args()
root = a.analysis
runs = [
    r
    for r in json.loads((root / "geolibre-runs.json").read_text())
    if r["tool"]
    not in ["individual_tree_segmentation", "regularize_building_footprints"]
]


def run(tool, args, input, allow_unsupported=False):
    start = time.time()
    r = gl.run_tool(tool, args=args, input=input)
    rec = {
        "engine": "geolibre-wasm",
        "engine_version": "1.7.1",
        "tool": tool,
        "args": args,
        "exit_code": r.exit_code,
        "seconds": round(time.time() - start, 2),
        "stdout": r.stdout,
        "input_sha256": {k: hashlib.sha256(v).hexdigest() for k, v in input.items()},
        "outputs": {},
    }
    for name, data in r.files.items():
        (root / name).write_bytes(data)
        rec["outputs"][name] = {
            "bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
        }
    runs.append(rec)
    (root / "geolibre-runs.json").write_text(json.dumps(runs, indent=2) + "\n")
    print(tool, r.exit_code, rec["seconds"], list(r.files), flush=True)
    if r.exit_code and not (
        allow_unsupported and "failed building thread pool" in str(r.stdout)
    ):
        raise RuntimeError(r.stdout)


run(
    "individual_tree_segmentation",
    [
        "--input=/work/reference-roi.las",
        "--output=/work/geolibre-segmented.las",
        "--only_use_veg=false",
        "--min_height=5",
        "--bandwidth_min=1",
        "--bandwidth_max=4",
        "--grid_acceleration=true",
        "--grid_cell_size=1",
        "--max_iterations=10",
        "--min_cluster_points=4",
        "--output_id_mode=point_source_id",
        "--output_sidecar_csv=true",
        "--seed=1",
        "--threads=1",
    ],
    {"reference-roi.las": (root / "reference-roi.las").read_bytes()},
    allow_unsupported=True,
)
fc = json.loads((root / "building-candidates.geojson").read_text())
to_utm = Transformer.from_crs(4326, 3157, always_xy=True)
for f in fc["features"]:
    f["geometry"] = mapping(transform(to_utm.transform, shape(f["geometry"])))
fc["crs"] = {"type": "name", "properties": {"name": "EPSG:3157"}}
run(
    "regularize_building_footprints",
    [
        "--input=/work/roof-candidates.geojson",
        "--output=/work/roof-regularized-utm.geojson",
        "--method=right_angles",
        "--tolerance=1",
    ],
    {"roof-candidates.geojson": json.dumps(fc).encode()},
)
fc = json.loads((root / "roof-regularized-utm.geojson").read_text())
to_ll = Transformer.from_crs(3157, 4326, always_xy=True)
for f in fc["features"]:
    f["geometry"] = mapping(transform(to_ll.transform, shape(f["geometry"])))
fc.pop("crs", None)
(root / "roof-regularized.geojson").write_text(
    json.dumps(fc, separators=(",", ":")) + "\n"
)
