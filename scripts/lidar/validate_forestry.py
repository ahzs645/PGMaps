#!/usr/bin/env python3
"""Check versioned forestry metrics, counts and source provenance (stdlib only)."""

import argparse, hashlib, json, math
from pathlib import Path

p = argparse.ArgumentParser(description=__doc__)
p.add_argument("--analysis", type=Path, required=True)
p.add_argument(
    "--snapshot", type=Path, default=Path("src/pages/dev-lidar/forestry.generated.json")
)
args = p.parse_args()
data = json.loads(args.snapshot.read_text())
summary = json.loads((args.analysis / "summary.json").read_text())
checksums = json.loads((args.analysis / "checksums.json").read_text())
assert data["schema_version"] == 1
assert data["source_sha256"] == summary["source_sha256"]
for name, digest in data["input_sha256"].items():
    assert checksums[name]["sha256"] == digest, name
counts = data["counts"]
features = data["plots"]["features"]
assert (
    counts["source_points"]
    == summary["source_points"]
    == counts["accepted_returns"] + counts["excluded_returns"]
)
assert len(features) == len({f["properties"]["id"] for f in features})
assert sum(f["properties"]["sampled_m2"] for f in features) == counts["eligible_cells"]
assert sum(f["properties"]["canopy_m2"] for f in features) == counts["canopy_cells"]
assert (
    sum(f["properties"]["profiles"]["all"]["returns"] for f in features)
    == counts["accepted_returns"]
)
assert (
    sum(f["properties"]["profiles"]["first"]["returns"] for f in features)
    == counts["first_returns"]
)
for f in features:
    r = f["properties"]
    assert 0 < r["sampled_m2"] <= 2500 and 0 <= r["canopy_m2"] <= r["sampled_m2"]
    assert r["support_percent"] == round(r["sampled_m2"] / 2500 * 100, 2)
    assert r["rugosity_m"] is None or r["rugosity_m"] >= 0
    assert 0 <= r["texture_supported_m2"] <= r["sampled_m2"]
    assert all(math.isfinite(v) for v in r["centre_utm"])
    for key in ("all", "first"):
        profile = r["profiles"][key]
        assert len(profile["bands"]) == 6 and all(n >= 0 for n in profile["bands"])
        assert sum(profile["bands"]) == profile["returns"]
        assert sum(profile["bands"][1:]) == profile["elevated_returns"]
        assert profile["height_entropy"] is None or 0 <= profile["height_entropy"] <= 1
        if profile["elevated_returns"]:
            assert profile["low_layer_percent"] == round(
                profile["bands"][1] / profile["elevated_returns"] * 100, 3
            )
        else:
            assert (
                profile["height_entropy"] is None
                and profile["low_layer_percent"] is None
            )
    assert all(
        a <= b
        for a, b in zip(r["profiles"]["first"]["bands"], r["profiles"]["all"]["bands"])
    )
    previous_interior = r["canopy_m2"]
    for distance in (10, 20, 30):
        partition = r[f"edge_{distance}"]
        assert sum(partition["counts"]) == r["canopy_m2"]
        assert partition["counts"][1] <= previous_interior
        previous_interior = partition["counts"][1]
        if r["canopy_m2"]:
            assert abs(sum(partition["percent"]) - 100) <= 0.002
        else:
            assert all(value is None for value in partition["percent"])
print(
    json.dumps(
        {
            "plots": len(features),
            "accepted_returns": counts["accepted_returns"],
            "first_returns": counts["first_returns"],
            "eligible_cells": counts["eligible_cells"],
            "provenance": "matched",
            "partitions": "all passed",
        }
    )
)
