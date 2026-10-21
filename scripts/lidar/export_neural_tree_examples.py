#!/usr/bin/env python3
"""Export complete core-point sets for a bounded selection of neural candidates."""

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import rasterio
from prepare_full_tile import DTYPE
from pyproj import Transformer


def export(snapshot_path, inputs, runs, dtm_path, output, limit=12):
    snapshot = json.loads(snapshot_path.read_text())
    manifest = json.loads((inputs / "manifest.json").read_text())
    assert snapshot["source_sha256"] == manifest["source_sha256"]
    tiles = {f"{t['x']}-{t['y']}": t for t in manifest["tiles"]}
    projection = Transformer.from_crs(3157, 4326, always_xy=True)
    trees = []
    with rasterio.open(dtm_path) as terrain:
        for sample in snapshot["samples"]:
            key = sample["id"]
            raw = np.memmap(inputs / tiles[key]["file"], mode="r", dtype=DTYPE)
            xyz = (
                np.column_stack([raw[k] for k in ["X", "Y", "Z"]]).astype(np.float64)
                * manifest["scales"]
                + manifest["offsets"]
            )
            ground = np.ma.concatenate(
                list(terrain.sample(xyz[:, :2], masked=True))
            ).filled(np.nan)
            assert np.all(np.isfinite(ground)) and np.all(ground != terrain.nodata), (
                "Missing DTM coverage"
            )
            height = xyz[:, 2] - ground
            lon, lat = projection.transform(xyz[:, 0], xyz[:, 1])
            tx, ty = map(int, key.split("-"))
            lower = (
                np.array(manifest["origin_xy"])
                + np.array([tx, ty]) * manifest["tile_size_m"]
            )
            upper = lower + manifest["tile_size_m"]
            for model in ["sat", "forainet"]:
                path = runs / model / f"tile-{key}.npz"
                meta = json.loads(path.with_suffix(".json").read_text())
                assert (
                    hashlib.sha256(path.read_bytes()).hexdigest()
                    == meta["point_output_sha256"]
                )
                with np.load(path) as data:
                    core = data["core"]
                    assert np.array_equal(data["source_rows"][core], raw["row"])
                    labels = data["instance"][core]
                    semantic = data["semantic"][core]
                candidates = []
                for label in np.unique(labels[labels >= 0]):
                    indices = np.flatnonzero(labels == label)
                    if len(indices) < 100 or np.percentile(height[indices], 95) < 5:
                        continue
                    lo = xyz[indices, :2].min(axis=0)
                    hi = xyz[indices, :2].max(axis=0)
                    touches = bool(np.any(lo < lower + 0.3) or np.any(hi > upper - 0.3))
                    candidates.append(
                        (touches, -len(indices), int(label), indices, lo, hi)
                    )
                for touches, _, label, indices, lo, hi in sorted(
                    candidates, key=lambda c: c[:3]
                )[:limit]:
                    centre = projection.transform(*((lo + hi) / 2))
                    points = [
                        [
                            round(float(lon[i]), 8),
                            round(float(lat[i]), 8),
                            round(float(xyz[i, 2]), 2),
                            round(float(height[i]), 2),
                            int(raw["row"][i]),
                        ]
                        for i in indices
                    ]
                    trees.append(
                        {
                            "id": f"{model}:{key}:{label}",
                            "model": model,
                            "chunk": key,
                            "instance": label,
                            "centre": centre,
                            "ground_m": float(np.median(ground[indices])),
                            "core_returns": len(indices),
                            "height_max_m": round(float(height[indices].max()), 2),
                            "height_p95_m": round(
                                float(np.percentile(height[indices], 95)), 2
                            ),
                            "width_m": round(float(np.linalg.norm(hi - lo)), 2),
                            "touches_core_boundary": touches,
                            "points": points,
                            "semantic": semantic[indices].tolist(),
                        }
                    )
    result = {
        "schema_version": 1,
        "source_sha256": snapshot["source_sha256"],
        "snapshot_utc": snapshot["snapshot_utc"],
        "scope": "chunk_local_core_candidates",
        "display_thinned": False,
        "selection": f"Up to {limit} candidates per model per cached chunk; at least 100 core returns and p95 height >= 5 m; prefer interior candidates, then larger return counts. Not a representative inventory.",
        "points": "Every original core return assigned to the candidate; halo excluded. Models may split or merge trees, and boundary candidates may be clipped.",
        "trees": trees,
    }
    output.write_text(json.dumps(result, separators=(",", ":")) + "\n")
    print(
        json.dumps(
            {
                "examples": len(trees),
                "returns": sum(t["core_returns"] for t in trees),
                "bytes": output.stat().st_size,
                "by_model": {
                    m: sum(t["model"] == m for t in trees) for m in ["sat", "forainet"]
                },
            }
        )
    )


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    for arg in ["snapshot", "input", "run", "dtm", "output"]:
        p.add_argument("--" + arg, type=Path, required=True)
    p.add_argument("--limit", type=int, default=12)
    a = p.parse_args()
    export(a.snapshot, a.input, a.run, a.dtm, a.output, a.limit)
