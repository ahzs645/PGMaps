#!/usr/bin/env python3
"""Freeze an immutable, matched snapshot of completed full-run chunks for the UI."""

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import rasterio
from prepare_full_tile import DTYPE, atomic_json
from pyproj import Transformer


def build(inputs, runs, dtm_path, output):
    manifest = json.loads((inputs / "manifest.json").read_text())
    tiles = {(t["x"], t["y"]): t for t in manifest["tiles"]}
    done = {
        m: {
            p.stem[5:]
            for p in (runs / m).glob("tile-*.json")
            if p.with_suffix(".npz").exists()
        }
        for m in ["sat", "forainet"]
    }
    common = sorted(
        done["sat"] & done["forainet"], key=lambda s: tuple(map(int, s.split("-")))
    )
    projection = Transformer.from_crs(3157, 4326, always_xy=True)
    origin = np.array(manifest["origin_xy"])
    size = manifest["tile_size_m"]
    models = {
        m: {
            "assigned": 0,
            "tree_class": 0,
            "semantic_counts": {},
            "inference_seconds": 0.0,
        }
        for m in done
    }
    cells = []
    total = 0
    disagreement = 0
    for key in common:
        tx, ty = map(int, key.split("-"))
        tile = tiles[tx, ty]
        data = {}
        meta = {}
        for m in done:
            path = runs / m / f"tile-{key}.npz"
            meta[m] = json.loads(path.with_suffix(".json").read_text())
            if (
                hashlib.sha256(path.read_bytes()).hexdigest()
                != meta[m]["point_output_sha256"]
            ):
                raise ValueError("Checkpoint hash differs")
            data[m] = np.load(path)
        a, b = data["sat"], data["forainet"]
        for name in ["source_rows", "core"]:
            assert np.array_equal(a[name], b[name]), (key, name)
        for x, y in zip(
            meta["sat"]["window_inputs"], meta["forainet"]["window_inputs"], strict=True
        ):
            for name in [
                "x_index",
                "y_index",
                "raw_returns",
                "representatives",
                "representative_source_ids_sha256",
            ]:
                assert x[name] == y[name], (key, name)
        core = a["core"]
        n = int(core.sum())
        assert n == tile["returns"]
        total += n
        values = {}
        for m in done:
            labels = data[m]["instance"][core]
            sem = data[m]["semantic"][core]
            assert np.all(sem >= 0)
            assigned = labels >= 0
            values[m] = assigned
            tree = np.isin(sem, [1] if m == "sat" else [2, 3, 4])
            models[m]["assigned"] += int(assigned.sum())
            models[m]["tree_class"] += int(tree.sum())
            models[m]["inference_seconds"] += meta[m]["seconds"]
            for cls, count in zip(*np.unique(sem, return_counts=True)):
                label = str(int(cls))
                models[m]["semantic_counts"][label] = models[m]["semantic_counts"].get(
                    label, 0
                ) + int(count)
            values[m + "_share"] = float(assigned.mean())
            values[m + "_local_candidates"] = len(np.unique(labels[assigned]))
        mismatch = int((values["sat"] != values["forainet"]).sum())
        disagreement += mismatch
        lo = origin + np.array([tx, ty]) * size
        hi = lo + size
        ring = [
            projection.transform(*p)
            for p in [lo, [hi[0], lo[1]], hi, [lo[0], hi[1]], lo]
        ]
        cells.append(
            {
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [ring]},
                "properties": {
                    "id": key,
                    "returns": n,
                    "sat_share": values["sat_share"],
                    "forainet_share": values["forainet_share"],
                    "disagreement": mismatch / n,
                    "sat_local_candidates": values["sat_local_candidates"],
                    "forainet_local_candidates": values["forainet_local_candidates"],
                },
            }
        )
        for z in data.values():
            z.close()
    # Cache point views spanning the observed extent and distinct behaviours.
    selected = []
    for q in [0.05, 0.25, 0.5, 0.75, 0.95]:
        eligible = [c for c in cells if c["properties"]["returns"] >= 20000]
        if eligible:
            selected.append(
                eligible[min(len(eligible) - 1, int(q * (len(eligible) - 1)))][
                    "properties"
                ]["id"]
            )
    selected.extend(
        c["properties"]["id"]
        for c in sorted(
            cells, key=lambda c: c["properties"]["disagreement"], reverse=True
        )[:2]
    )
    selected = list(dict.fromkeys(selected))
    samples = []
    with rasterio.open(dtm_path) as terrain:
        for key in selected:
            tx, ty = map(int, key.split("-"))
            tile = tiles[tx, ty]
            raw = np.memmap(inputs / tile["file"], mode="r", dtype=DTYPE)
            xyz = np.column_stack([raw[k] for k in ["X", "Y", "Z"]]).astype(
                np.float64
            ) * np.array(manifest["scales"]) + np.array(manifest["offsets"])
            indices = np.unique(
                np.linspace(0, len(raw) - 1, min(6000, len(raw)), dtype=int)
            )
            coords = xyz[indices]
            ground = np.array(
                [x[0] for x in terrain.sample(coords[:, :2], masked=True)], dtype=float
            )
            valid = np.isfinite(ground) & (ground != terrain.nodata)
            indices = indices[valid]
            coords = coords[valid]
            ground = ground[valid]
            lon, lat = projection.transform(coords[:, 0], coords[:, 1])
            centre = projection.transform(*(origin + (np.array([tx, ty]) + 0.5) * size))
            points = [
                [
                    round(float(lon[i]), 8),
                    round(float(lat[i]), 8),
                    round(float(p[2]), 2),
                    round(float(p[2] - ground[i]), 2),
                    int(raw["row"][indices[i]]),
                ]
                for i, p in enumerate(coords)
            ]
            outputs = {}
            for m in done:
                with np.load(runs / m / f"tile-{key}.npz") as data:
                    core = data["core"]
                    assert np.array_equal(data["source_rows"][core], raw["row"])
                    outputs[m] = {
                        "instance": data["instance"][core][indices].tolist(),
                        "semantic": data["semantic"][core][indices].tolist(),
                    }
            samples.append(
                {
                    "id": key,
                    "centre": centre,
                    "ground_m": float(np.median(ground)),
                    "original_returns": len(raw),
                    "points": points,
                    "models": outputs,
                }
            )
    lower, upper = manifest["bounds"]
    outline = [
        projection.transform(*p)
        for p in [
            lower[:2],
            [upper[0], lower[1]],
            upper[:2],
            [lower[0], upper[1]],
            lower[:2],
        ]
    ]
    xs = [p[0] for p in outline]
    ys = [p[1] for p in outline]
    snapshot = {
        "schema_version": 1,
        "stage": "preliminary_partial_full_run",
        "snapshot_utc": datetime.now(timezone.utc).isoformat(),
        "source_sha256": manifest["source_sha256"],
        "total_returns": manifest["point_count"],
        "total_chunks": len(tiles),
        "common_chunks": len(common),
        "common_returns": total,
        "models": models,
        "assignment_disagreement_returns": disagreement,
        "whole_tile_complete": False,
        "global_tree_counts_available": False,
        "same_window_inputs_verified": True,
        "bounds": [min(xs), min(ys), max(xs), max(ys)],
        "outline": {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {"type": "Polygon", "coordinates": [outline]},
                    "properties": {"id": "Original tile extent", "colour": "#64748b"},
                }
            ],
        },
        "cells": {"type": "FeatureCollection", "features": cells},
        "samples": samples,
        "point_identity": "Original LAZ row; original classification omitted from display sample; no EPT node identity implied",
        "display_sampling": "Up to 6000 evenly indexed original returns per selected core; network uses 0.2 m voxel representatives; labels transferred to all original returns",
        "instance_scope": "Chunk-local IDs, not final seam-merged trees; model colours do not establish cross-model matches",
    }
    output.parent.mkdir(exist_ok=True, parents=True)
    output.write_text(json.dumps(snapshot, separators=(",", ":")) + "\n")
    atomic_json(
        output.with_suffix(".summary.json"),
        {k: v for k, v in snapshot.items() if k not in ["cells", "samples", "outline"]},
    )
    print(
        json.dumps(
            {
                "common_chunks": len(common),
                "common_returns": total,
                "models": models,
                "assignment_disagreement_returns": disagreement,
                "samples": selected,
                "bytes": output.stat().st_size,
            }
        ),
        flush=True,
    )


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--input", type=Path, required=True)
    p.add_argument("--run", type=Path, required=True)
    p.add_argument("--dtm", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    a = p.parse_args()
    build(a.input, a.run, a.dtm, a.output)
