#!/usr/bin/env python3
"""Validate tracked workflow/model snapshots against deployed products (stdlib only)."""

import argparse, hashlib, json, math
from pathlib import Path

p = argparse.ArgumentParser(description=__doc__)
p.add_argument("--analysis", type=Path, required=True)
p.add_argument("--snapshots", type=Path, default=Path("src/pages/dev-lidar"))
args = p.parse_args()
summary = json.loads((args.analysis / "summary.json").read_text())
checksums = json.loads((args.analysis / "checksums.json").read_text())
data = json.loads((args.snapshots / "workflows.generated.json").read_text())
models = json.loads((args.snapshots / "models.generated.json").read_text())
assert data["schema_version"] == models["schema_version"] == 1
assert data["source_sha256"] == models["source_sha256"] == summary["source_sha256"]
for name, digest in data["input_sha256"].items():
    assert (
        checksums[name]["sha256"] == digest
    ), f"Regenerate workflow snapshot: {name} differs"
assert models["candidate_sha256"] == checksums["building-candidates.geojson"]["sha256"]
assert (
    models["cityjson_sha256"]
    == hashlib.file_digest(
        (args.snapshots / "buildings.generated.city.jsonl").open("rb"), "sha256"
    ).hexdigest()
)
roof_ids = {
    f["properties"]["id"]
    for f in json.loads((args.analysis / "building-candidates.geojson").read_text())[
        "features"
    ]
}
assert {row["id"] for row in models["records"]} == roof_ids
assert (
    models["engine"]["screened_points"]
    == models["engine"]["screened_roof_points"]
    + models["engine"]["classified_ground_points"]
)
assert models["engine"]["version"].startswith("roofer 1.0.0 ")
for threshold in ("2", "5"):
    for feature in data["gaps"][threshold]["features"]:
        r = feature["properties"]
        assert r["area_m2"] >= 25 and r["threshold_m"] == int(threshold)
        if r["enclosed_candidate"]:
            assert (
                not r["boundary_clipped"]
                and not r["near_roof"]
                and r["canopy_edge_percent"] >= 80
            )
    assert {
        f["properties"]["id"] for f in data["clearance"][threshold]["features"]
    } == roof_ids
    for feature in data["clearance"][threshold]["features"]:
        r = feature["properties"]
        if r["distance_m"] is not None:
            assert (
                0
                <= r["cell_distance_min_m"]
                <= r["distance_m"]
                <= r["cell_distance_max_m"]
                and r["distance_m"] <= 30
            )
assert (
    abs(data["supported_cells"] - summary["supported_area_ha"] * 10000) <= 5
), "Summary hectares are rounded to 0.001 ha"
for size in ("25", "50"):
    plots = data["plots"][size]["features"]
    assert len({f["properties"]["id"] for f in plots}) == len(plots)
    assert (
        sum(f["properties"]["sampled_m2"] for f in plots) == data["supported_cells"]
    ), "Plots must partition supported source cells"
    for feature in plots:
        r = feature["properties"]
        assert 0 < r["support_percent"] <= 100
        assert r["support_percent"] == round(
            100 * r["sampled_m2"] / (int(size) ** 2), 2
        )
        assert (
            r["p95_m"] >= r["median_m"]
            and r["sd_m"] >= 0
            and 0 <= r["above_2m_percent"] <= 100
        )
for model in models["records"]:
    assert model["triangles"] and model["success"]
    assert model["skipped_degenerate_surfaces"] == 0
    assert model["closed_edge_incidence"] and model["nonmanifold_edges"] == 0
    assert model["rmse_m"] is None or model["rmse_m"] >= 0
    for triangle in model["triangles"]:
        assert len(triangle["vertices"]) == 3
        for x, y, z in triangle["vertices"]:
            assert -180 <= x <= 180 and -90 <= y <= 90 and math.isfinite(z)
print(
    json.dumps(
        {
            "gap_counts": {k: len(v["features"]) for k, v in data["gaps"].items()},
            "plot_counts": {k: len(v["features"]) for k, v in data["plots"].items()},
            "models": len(models["records"]),
            "roof_surfaces": sum(len(m["facets"]) for m in models["records"]),
            "triangles": sum(len(m["triangles"]) for m in models["records"]),
            "provenance": "all matched",
        }
    )
)
