#!/usr/bin/env python3
"""Validate crown membership and native-height masks with source provenance (stdlib)."""

import argparse, base64, json, math
from pathlib import Path


def validate(analysis):
    base = Path("src/pages/dev-lidar")
    trees = json.loads((base / "treeIsolation.generated.json").read_text())
    detail = json.loads((base / "height-detail.generated.json").read_text())
    summary = json.loads((analysis / "summary.json").read_text())
    checksums = json.loads((analysis / "checksums.json").read_text())
    candidates = {
        f["properties"]["id"]: f
        for f in json.loads((analysis / "tree-candidates.geojson").read_text())[
            "features"
        ]
    }
    for data in [trees, detail]:
        assert (
            data["schema_version"] == 1
            and data["source_sha256"] == summary["source_sha256"]
        )
        for name, digest in data["input_sha256"].items():
            assert checksums[name]["sha256"] == digest, name
    assert trees["grid"] == detail["grid"]
    assert set(candidates) == {
        f["properties"]["id"] for f in trees["crowns"]["features"]
    }
    rows = {}
    total = 0
    for f in trees["crowns"]["features"]:
        p = f["properties"]
        source = candidates[p["id"]]
        for key in ["height_m", "crown_area_m2", "ground_support_m", "edge"]:
            assert p[key] == source["properties"][key]
        assert p["centre"] == source["geometry"]["coordinates"]
        assert math.isfinite(p["ground_m"]) and len(p["runs"]) > 0
        cells = 0
        for row, col, length in p["runs"]:
            assert (
                0 <= row < trees["grid"]["height"]
                and 0 <= col < col + length <= trees["grid"]["width"]
            )
            rows.setdefault(row, []).append((col, col + length))
            cells += length
        assert cells == p["crown_area_m2"]
        total += cells
    for intervals in rows.values():
        ordered = sorted(intervals)
        assert all(
            a[1] <= b[0] for a, b in zip(ordered, ordered[1:])
        ), "Overlapping crown assignments"
    mask = base64.b64decode(detail["mask_base64"])
    n = detail["grid"]["width"] * detail["grid"]["height"]
    assert len(mask) == (n + 7) // 8
    assert sum(b.bit_count() for b in mask) == detail["eligible_cells"]
    assert (
        detail["eligible_cells"]
        == json.loads((base / "heatmaps.generated.json").read_text())["rasters"][
            "height"
        ]["source_valid_cells"]
    )
    return {
        "crowns": len(candidates),
        "nonoverlapping_crown_cells": total,
        "native_height_cells": detail["eligible_cells"],
        "provenance": "matched",
    }


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--analysis", type=Path, required=True)
    args = p.parse_args()
    print(json.dumps(validate(args.analysis)))
