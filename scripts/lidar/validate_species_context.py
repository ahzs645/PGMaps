#!/usr/bin/env python3
"""Check linked plot IDs, source hashes and missing-context semantics (stdlib)."""

import hashlib
import json
from pathlib import Path


def validate_context(root=Path(".")):
    base = root / "src/pages/dev-lidar"
    data = json.loads((base / "species-context.generated.json").read_text())
    species = json.loads((base / "species.generated.json").read_text())
    forest = json.loads((base / "forestry.generated.json").read_text())
    assert data["schema_version"] == 1
    assert data["source_sha256"] == species["source_sha256"] == forest["source_sha256"]
    assert (
        data["species_sha256"]
        == hashlib.sha256((base / "species.generated.json").read_bytes()).hexdigest()
    )
    assert (
        data["forestry_sha256"]
        == hashlib.sha256((base / "forestry.generated.json").read_bytes()).hexdigest()
    )
    ids = {f["properties"]["id"] for f in species["stands"]["features"]}
    assert set(data["field_points"]) == ids
    assert set(data["plots"]) == {
        f["properties"]["id"] for f in forest["plots"]["features"]
    }
    for link in data["plots"].values():
        assert 0 <= link["overlap_percent"] <= 100
        assert (
            (link["stand_id"] in ids and link["overlap_percent"] >= 80)
            if link["stand_id"] is not None
            else link["overlap_percent"] < 80
        )
    for assignment in species["experiment"]["assignments"]:
        assert (
            data["plots"][assignment["plot"]]["stand_id"]
            == "vri-" + assignment["stand"]
        )
    for lon, lat in data["field_points"].values():
        assert -123 < lon < -122 and 53 < lat < 55
    return {
        "plots": len(data["plots"]),
        "linked": sum(bool(p["stand_id"]) for p in data["plots"].values()),
        "stand_points": len(ids),
        "provenance": "matched",
    }


if __name__ == "__main__":
    print(json.dumps(validate_context()))
