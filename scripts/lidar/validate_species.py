#!/usr/bin/env python3
"""Validate pinned species context, held-out folds and metrics without ML dependencies."""

import argparse
import hashlib
import json
import math
from pathlib import Path


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def validate(data, forest, inventory, checksums, source_hash):
    assert data["schema_version"] == 1 and data["source_sha256"] == source_hash
    assert data["forestry_sha256"] == sha(forest)
    assert data["inventory_sha256"] == sha(inventory)
    for name, digest in data["input_sha256"].items():
        assert checksums[name]["sha256"] == digest
    stands = [f["properties"] for f in data["stands"]["features"]]
    assert len(stands) == len({s["id"] for s in stands})
    coverage = data["coverage"]
    assert (
        abs(
            sum(s["area_m2"] for s in stands)
            + coverage["unmapped_m2"]
            - coverage["supported_m2"]
        )
        < 0.1
    )
    assert (
        abs(
            sum(s["area_m2"] for s in stands if s["labelled"]) - coverage["labelled_m2"]
        )
        < 0.1
    )
    assert abs(sum(data["area_weighted_inventory_index"].values()) - 100) < 1e-6
    assert all(s["area_m2"] > 0 for s in stands)
    models = [s for s in stands if s["model"]]
    experiment = data["experiment"]
    assignments = experiment["assignments"]
    assert (
        len(assignments) == len({a["plot"] for a in assignments}) == experiment["plots"]
    )
    assert len(models) == experiment["stands"]
    groups = {s["feature_id"] for s in models}
    assert set(a["stand"] for a in assignments) == groups
    code_order = data["species_order"]
    broad = [i for i, c in enumerate(code_order) if c in ("EP", "AC", "AT")]
    errors = {
        kind: {"species": [], "broadleaf": []} for kind in ("predicted", "baseline")
    }
    for s in models:
        m = s["model"]
        assert set(m["train_groups"]) == groups - {
            s["feature_id"]
        }, "Held-out stand leaked into training"
        assert m["plots"] == sum(a["stand"] == s["feature_id"] for a in assignments)
        assert m["observed"] == [s["composition"][c] for c in code_order]
        for key in ("observed", "predicted", "baseline"):
            assert len(m[key]) == len(code_order)
            assert all(math.isfinite(v) and 0 <= v <= 100 for v in m[key])
            assert abs(sum(m[key]) - 100) < 1e-6
        for key in errors:
            errors[key]["species"].extend(
                abs(a - b) for a, b in zip(m[key], m["observed"])
            )
            errors[key]["broadleaf"].append(
                abs(sum(m[key][i] - m["observed"][i] for i in broad))
            )
    for key, result in [("predicted", "model"), ("baseline", "baseline")]:
        for metric, values in errors[key].items():
            assert (
                abs(sum(values) / len(values) - experiment[result][metric + "_mae_pp"])
                < 1e-7
            )
    assert experiment["status"] == "exploratory_weak_labels"
    return {
        "stands": len(stands),
        "holdouts": len(models),
        "plots": len(assignments),
        "provenance": "matched",
        "folds": "disjoint",
    }


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--analysis", type=Path, required=True)
    a = p.parse_args()
    data = json.loads(Path("src/pages/dev-lidar/species.generated.json").read_text())
    print(
        json.dumps(
            validate(
                data,
                "src/pages/dev-lidar/forestry.generated.json",
                "scripts/lidar/sources/species-vri.geojson",
                json.loads((a.analysis / "checksums.json").read_text()),
                json.loads((a.analysis / "summary.json").read_text())["source_sha256"],
            )
        )
    )
