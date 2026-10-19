"""Check the shipped method comparison without R, Torch or optional Python packages."""

import argparse
import hashlib
import json
import math
from pathlib import Path


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def validate(analysis=None):
    root = Path(__file__).resolve().parents[2]
    base = root / "src/pages/dev-lidar"
    source_path = base / "treeIsolation.generated.json"
    source = json.loads(source_path.read_text())
    data = json.loads((base / "treeBenchmarks.generated.json").read_text())
    assert data["schema_version"] == 1
    assert data["source_sha256"] == source["source_sha256"]
    assert data["segmentation_sha256"] == digest(source_path)
    assert data["label_grid_sha256"] == source["label_grid_sha256"]
    assert data["generator_sha256"] == digest(
        root / "scripts/lidar/benchmark_tree_methods.py"
    )
    assert data["input_sha256"]["dtm-1m.tif"] == source["input_sha256"]["dtm-1m.tif"]
    if analysis:
        summary = json.loads((analysis / "summary.json").read_text())
        checks = json.loads((analysis / "checksums.json").read_text())
        assert summary["source_sha256"] == data["source_sha256"]
        assert checks["dtm-1m.tif"]["sha256"] == data["input_sha256"]["dtm-1m.tif"]
        assert digest(analysis / "dtm-1m.tif") == data["input_sha256"]["dtm-1m.tif"]
    runs = 0
    assert 0 < len(data["plots"]) <= 10
    for plot in data["plots"]:
        assert 0 < plot["examined_returns"] <= 750000
        assert 0 < plot["accepted_returns"] <= plot["examined_returns"]
        sample = plot["sample"]
        assert len(sample["points"]) == sample["sampled"] <= 2800
        assert sample["total"] == plot["accepted_returns"]
        identities = set()
        for row in sample["points"]:
            assert len(row) == 7 and all(math.isfinite(v) for v in row)
            assert isinstance(row[4], int) and 0 <= row[4] < len(sample["nodes"])
            assert isinstance(row[5], int) and row[5] >= 0
            assert (row[4], row[5]) not in identities
            identities.add((row[4], row[5]))
        assert {m["id"] for m in plot["methods"]} == {
            "watershed",
            "dalponte2016",
            "li2012",
            "pointtree-treex",
        }
        for method in plot["methods"]:
            assert method["status"] in {"completed", "failed", "blocked"}
            assert method["input_sha256"] == plot["input_sha256"]
            assert len(method["labels"]) == sample["sampled"]
            assert all(isinstance(v, int) and v >= -1 for v in method["labels"])
            assert (
                method["assigned_points"] + method["unassigned_points"]
                == method["eligible_core_points"]
            )
            assert (
                method["instances_core"] >= 0
                and method["instances_buffer"] >= method["instances_core"]
            )
            runs += method["status"] == "completed"
        for agreement in plot["pairwise_agreement"]:
            score = agreement["adjusted_rand_index"]
            assert score is None or math.isfinite(score) and -1 <= score <= 1
            assert (
                0
                <= agreement["common_assigned_points"]
                <= agreement["eligible_core_points"]
            )
    return {
        "plots": len(data["plots"]),
        "completed_method_runs": runs,
        "provenance": "matched",
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--analysis", type=Path)
    args = parser.parse_args()
    print(json.dumps(validate(args.analysis)))
