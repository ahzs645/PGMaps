#!/usr/bin/env python3
"""Crop original roof/ground points and run pinned Roofer on unverified roof patches."""

import argparse, subprocess, json, hashlib
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--analysis", type=Path, required=True)
parser.add_argument("--source", type=Path, required=True)
parser.add_argument("--work", type=Path, required=True)
parser.add_argument("--roofer", required=True)
args = parser.parse_args()
import numpy as np, laspy, rasterio
from rasterio.features import rasterize
from shapely.geometry import shape, mapping
from shapely import transform
from pyproj import Transformer

root = args.analysis
out = args.work
out.mkdir(parents=True, exist_ok=True)
fc = json.loads((root / "building-candidates.geojson").read_text())
proj = Transformer.from_crs(4326, 3157, always_xy=True)
with rasterio.open(root / "dtm-1m.tif") as src:
    dtm = src.read(1, masked=True).filled(np.nan)
    affine = src.transform
    projected = []
    for f in fc["features"]:
        f["geometry"] = mapping(
            transform(shape(f["geometry"]), proj.transform, interleaved=False)
        )
        projected.append(shape(f["geometry"]))
    roof = (
        rasterize(
            [(mapping(p), 1) for p in projected],
            out_shape=dtm.shape,
            transform=affine,
            dtype="uint8",
        )
        > 0
    )
    from scipy.ndimage import distance_transform_edt

    near = distance_transform_edt(~roof) <= 8
fc["crs"] = {"type": "name", "properties": {"name": "EPSG:3157"}}
(out / "roofprints.geojson").write_text(json.dumps(fc))
digest = hashlib.sha256()
with args.source.open("rb") as source_file:
    for block in iter(lambda: source_file.read(4 * 1024 * 1024), b""):
        digest.update(block)
if (
    digest.hexdigest()
    != json.loads((root / "summary.json").read_text())["source_sha256"]
):
    raise ValueError("Original LAZ source hash mismatch")
with laspy.open(args.source) as source:
    header = source.header.copy()
    with laspy.open(out / "screened-points.laz", mode="w", header=header) as target:
        total = 0
        roofs = 0
        grounds = 0
        for chunk in source.chunk_iterator(2000000):
            x = np.asarray(chunk.x)
            y = np.asarray(chunk.y)
            z = np.asarray(chunk.z)
            col = np.floor((x - affine.c) / affine.a).astype(int)
            row = np.floor((y - affine.f) / affine.e).astype(int)
            ok = (row >= 0) & (row < dtm.shape[0]) & (col >= 0) & (col < dtm.shape[1])
            ids = np.where(ok)[0]
            r = row[ids]
            c = col[ids]
            cl = np.asarray(chunk.classification)[ids]
            good = (
                near[r, c]
                & ~np.isin(cl, [7, 12, 18])
                & ~np.asarray(chunk.withheld)[ids].astype(bool)
            )
            roof_pts = (
                roof[r, c]
                & np.isfinite(dtm[r, c])
                & ((z[ids] - dtm[r, c]) > 2)
                & (cl != 2)
            )
            keep = good & ((cl == 2) | roof_pts)
            selected = chunk[ids[keep]].copy()
            classes = np.where(cl[keep] == 2, 2, 6).astype("uint8")
            selected.classification = classes
            target.write_points(selected)
            total += len(selected)
            roofs += int((classes == 6).sum())
            grounds += int((classes == 2).sum())
        print(
            json.dumps(
                {
                    "points": total,
                    "screened_roof_points": roofs,
                    "classified_ground_points": grounds,
                }
            ),
            flush=True,
        )

version = subprocess.check_output([args.roofer, "--version"], text=True).strip()
if not version.startswith("roofer 1.0.0 "):
    raise ValueError("Expected pinned Roofer 1.0.0")
command = [
    args.roofer,
    "--jobs",
    "3",
    "--srs",
    "EPSG:3157",
    "--id-attribute",
    "id",
    "--lod12",
    "--lod22",
    "--lod11-fallback-time",
    "30000",
    str((out / "screened-points.laz").resolve()),
    str((out / "roofprints.geojson").resolve()),
    str((out / "output").resolve()),
]
with (out / "execution.log").open("w") as log:
    subprocess.run(
        command, stdout=log, stderr=subprocess.STDOUT, check=True, timeout=900, cwd=out
    )
(out / "run.json").write_text(
    json.dumps(
        {
            "version": version,
            "parameters": command[1:],
            "input_source_sha256": json.loads((root / "summary.json").read_text())[
                "source_sha256"
            ],
            "screened_points": total,
            "screened_roof_points": roofs,
            "classified_ground_points": grounds,
            "input_status": "Unverified roof-like patches; class 6 assigned by height >2 m within candidates; not an authoritative building classifier.",
        },
        indent=2,
    )
    + "\n"
)
