#!/usr/bin/env python3
"""Validate the saved analysis using only Python's standard library (also on cache hits)."""

import argparse, hashlib, json, struct
from pathlib import Path

p = argparse.ArgumentParser(description=__doc__)
p.add_argument("--analysis", type=Path, required=True)
args = p.parse_args()
root = args.analysis
summary = json.loads((root / "summary.json").read_text())
hashes = json.loads((root / "checksums.json").read_text())
assert summary["source_points"] == 84608005
assert (
    summary["source_sha256"]
    == "f5246f351e8d5923bf8a5dfddc0753032dbe8cb6e687ae58818cc701cb398ecf"
)
assert sum(summary["classification_counts"].values()) == summary["source_points"]
assert 0 < summary["supported_area_ha"] <= summary["observed_area_ha"]
assert 0 <= summary["elevated_first_return_cover_percent"] <= 100
for name, item in hashes.items():
    path = root / name
    assert path.stat().st_size == item["bytes"], name
    assert (
        hashlib.file_digest(path.open("rb"), "sha256").hexdigest() == item["sha256"]
    ), name
for kind, name in [
    ("tree", "tree-candidates.geojson"),
    ("building", "building-candidates.geojson"),
]:
    features = json.loads((root / name).read_text())["features"]
    assert len(features) == summary[kind + "_candidate_count"]
    assert len({f["properties"]["id"] for f in features}) == len(features)
    assert all(f["properties"]["height_m"] >= 0 for f in features)
for download in summary["downloads"]:
    assert (root / download["file"]).is_file()
grid = summary["sample_grid"]
assert (root / grid["file"]).stat().st_size == grid["width"] * grid["height"] * 4
runs = json.loads((root / "geolibre-runs.json").read_text())
for tool in [
    "slope",
    "hillshade",
    "individual_tree_detection",
    "regularize_building_footprints",
]:
    assert any(r["tool"] == tool and r["exit_code"] == 0 for r in runs), tool
print(
    f"Validated {len(hashes)} products, {summary['tree_candidate_count']:,} crown candidates and {summary['building_candidate_count']:,} roof-like patches."
)
