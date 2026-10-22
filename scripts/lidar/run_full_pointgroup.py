#!/usr/bin/env python3
"""Checkpointed full-source CPU inference; shared tiled adapter for both networks.

Every original return belongs to one 50 m core. A 16 m halo supplies complete
8 m windows centred within 8 m of that core. Core coverage is checked per tile.
Raw source-row IDs join all outputs; no display thinning or point filters.
"""

import argparse
import json
import os
import subprocess
import time
from pathlib import Path

from prepare_full_tile import DTYPE, atomic_json


def run(args):
    os.environ["OMP_NUM_THREADS"] = str(args.threads)
    os.environ["OPENBLAS_NUM_THREADS"] = "1"
    import numpy as np
    from pointgroup_full_runtime import (
        PointGroupCPU,
        centres_for_core,
        expand_predictions,
        file_sha,
        merge_window,
    )
    from scipy.spatial import cKDTree

    manifest = json.loads((args.input / "manifest.json").read_text())
    args.output.mkdir(parents=True, exist_ok=True)
    signature = {
        "schema_version": 1,
        "model": args.model,
        "source_sha256": manifest["source_sha256"],
        "point_count": manifest["point_count"],
        "checkpoint_sha256": file_sha(args.weights),
        "repo_commit": subprocess.check_output(
            ["git", "-C", str(args.repo), "rev-parse", "HEAD"], text=True
        ).strip(),
        "tile_size_m": manifest["tile_size_m"],
        "radius_m": 8,
        "stride_m": 8,
        "halo_m": 16,
        "voxel_m": 0.2,
        "seed": 2022,
        "nms_iou": 0.3,
        "minimum_proposal_points_exclusive": 100,
        "minimum_proposal_score_exclusive": 0.6,
        "adapter": "PGMaps shared windows and source-point IoU merge v1; not upstream end-to-end tracker",
        "adapter_sha256": file_sha(
            Path(__file__).with_name("pointgroup_full_runtime.py")
        ),
        "runner_sha256": file_sha(__file__),
        "threads": args.threads,
        "blas_implementation": os.environ.get(
            "PGMAPS_BLAS_IMPLEMENTATION", "system-reference-blas"
        ),
    }
    run_path = args.output / "run.json"
    if run_path.exists() and json.loads(run_path.read_text()) != signature:
        raise ValueError("Existing run uses different source/model/parameters/code")
    atomic_json(run_path, signature)
    model = PointGroupCPU(args.repo, args.weights, args.threads)
    tiles = {(t["x"], t["y"]): t for t in manifest["tiles"]}
    size = manifest["tile_size_m"]
    origin = np.asarray(manifest["origin_xy"])
    scales = np.asarray(manifest["scales"])
    offsets = np.asarray(manifest["offsets"])
    start = time.monotonic()
    completed = 0
    core_processed = 0
    windows_processed = 0
    resumed = 0
    for tile in manifest["tiles"]:
        key = f"{tile['x']}-{tile['y']}"
        result_path = args.output / f"tile-{key}.npz"
        meta_path = args.output / f"tile-{key}.json"
        if result_path.exists() and meta_path.exists():
            meta = json.loads(meta_path.read_text())
            if (
                meta.get("stage") != "core_inference_completed"
                or meta["core_returns"] != tile["returns"]
            ):
                raise ValueError("Invalid tile checkpoint")
            if file_sha(result_path) != meta["point_output_sha256"]:
                raise ValueError("Tile checkpoint checksum mismatch")
            completed += 1
            core_processed += meta["core_returns"]
            resumed += 1
            continue
        if args.only and args.only != key:
            continue
        step_start = time.monotonic()
        core_lo = origin + np.array([tile["x"], tile["y"]]) * size
        core_hi = core_lo + size
        pieces = []
        for dx in [-1, 0, 1]:
            for dy in [-1, 0, 1]:
                neighbour = tiles.get((tile["x"] + dx, tile["y"] + dy))
                if neighbour:
                    pieces.append(
                        np.memmap(args.input / neighbour["file"], dtype=DTYPE, mode="r")
                    )
        records = np.concatenate(pieces)
        xyz = (
            np.column_stack([records[n] for n in ["X", "Y", "Z"]]).astype(np.float64)
            * scales
            + offsets
        )
        mask = ((xyz[:, :2] >= core_lo - 16) & (xyz[:, :2] <= core_hi + 16)).all(axis=1)
        xyz = xyz[mask]
        source_rows = records["row"][mask].copy()
        owner = np.floor((xyz[:, :2] - origin) / size).astype(int)
        core = (owner[:, 0] == tile["x"]) & (owner[:, 1] == tile["y"])
        if np.count_nonzero(core) != tile["returns"]:
            raise ValueError("Core ownership count mismatch")
        xyz_offset = xyz.min(axis=0)
        local = (xyz - xyz_offset).astype(np.float32)
        sampled = model.subsample(local, 2022 + tile["x"] * 10000 + tile["y"])
        raw_tree = cKDTree(local[:, :2])
        sample_tree = cKDTree(sampled.pos.numpy()[:, :2])
        votes = np.zeros((len(local), model.classes), dtype=np.float32)
        seen = np.zeros(len(local), dtype=np.uint16)
        instances = np.full(len(local), -1, dtype=np.int32)
        next_instance = 0
        window_records = []
        max_distance = 0.0
        for centre, ix, iy in centres_for_core([core_lo, core_hi], origin):
            c = centre - xyz_offset[:2]
            raw = np.sort(raw_tree.query_ball_point(c, 8.0))
            if not len(raw):
                continue
            sampled_indices = np.sort(sample_tree.query_ball_point(c, 8.0))
            if not len(sampled_indices):
                continue
            random_seed = (2022 + (ix + 1000) * 100000 + (iy + 1000)) % (2**32)
            ids, logits, labels, candidates = model.predict(
                sampled.pos[sampled_indices],
                sampled.origin_id[sampled_indices],
                random_seed,
            )
            expanded, raw_labels, distances = expand_predictions(
                local, raw, ids, logits, labels
            )
            votes[raw] += expanded
            seen[raw] += 1
            merged, next_instance = merge_window(
                instances[raw], raw_labels, next_instance
            )
            instances[raw] = merged
            max_distance = max(max_distance, float(distances.max()))
            import hashlib

            window_records.append(
                {
                    "x_index": ix,
                    "y_index": iy,
                    "raw_returns": len(raw),
                    "representatives": len(ids),
                    "representative_source_ids_sha256": hashlib.sha256(
                        source_rows[ids].tobytes()
                    ).hexdigest(),
                    "accepted_proposals": candidates,
                }
            )
            if len(window_records) % 10 == 0:
                atomic_json(
                    args.output / "progress.json",
                    {
                        "stage": "full_tile_inference_running",
                        "model": args.model,
                        "completed_tiles": completed,
                        "total_tiles": len(tiles),
                        "core_returns_processed": core_processed,
                        "total_returns": manifest["point_count"],
                        "current_tile": key,
                        "current_tile_windows": len(window_records),
                        "current_tile_elapsed_seconds": time.monotonic() - step_start,
                        "session_elapsed_seconds": time.monotonic() - start,
                        "source_sha256": manifest["source_sha256"],
                    },
                )
        missing = np.count_nonzero(core & (seen == 0))
        if missing:
            raise ValueError(
                f"{missing} original core returns have no inference coverage; tile not marked complete"
            )
        semantic = np.full(len(local), -1, dtype=np.int8)
        semantic[seen > 0] = votes[seen > 0].argmax(1).astype(np.int8)
        temp = result_path.with_suffix(".tmp.npz")
        np.savez_compressed(
            temp,
            source_rows=source_rows,
            core=core,
            semantic=semantic,
            instance=instances,
            predictions_per_return=seen,
        )
        temp.replace(result_path)
        meta = {
            "stage": "core_inference_completed",
            "tile": key,
            "core_returns": int(core.sum()),
            "buffered_returns": len(local),
            "windows": len(window_records),
            "core_missing_returns": int(missing),
            "seconds": time.monotonic() - step_start,
            "local_instance_ids": next_instance,
            "xyz_offset": xyz_offset.tolist(),
            "interpolation_max_m": max_distance,
            "window_inputs": window_records,
            "point_output_sha256": file_sha(result_path),
            "backbone_coordinate_order_verified_every_window": True,
        }
        atomic_json(meta_path, meta)
        completed += 1
        core_processed += int(core.sum())
        windows_processed += len(window_records)
        progress = {
            "stage": "full_tile_inference_running",
            "model": args.model,
            "completed_tiles": completed,
            "total_tiles": len(tiles),
            "core_returns_processed": core_processed,
            "total_returns": manifest["point_count"],
            "resumed_tiles": resumed,
            "current_tile": key,
            "last_tile_seconds": meta["seconds"],
            "session_elapsed_seconds": time.monotonic() - start,
            "session_windows": windows_processed,
            "source_sha256": manifest["source_sha256"],
        }
        atomic_json(args.output / "progress.json", progress)
        print(json.dumps(progress), flush=True)
        if args.only:
            break
    if not args.only:
        if completed != len(tiles) or core_processed != manifest["point_count"]:
            raise ValueError("Full input coverage is incomplete")
        atomic_json(
            args.output / "inference-completed.json",
            dict(
                signature,
                stage="all_core_tiles_inferred",
                completed_tiles=completed,
                core_returns_processed=core_processed,
                requires_cross_tile_instance_merge=True,
            ),
        )
        print(
            "All source returns have completed tiled inference; final merge follows.",
            flush=True,
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--weights", type=Path, required=True)
    parser.add_argument("--model", choices=["sat", "forainet"], required=True)
    parser.add_argument("--threads", type=int, default=2)
    parser.add_argument("--only")
    run(parser.parse_args())
