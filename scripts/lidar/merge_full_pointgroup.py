#!/usr/bin/env python3
"""Validate and stitch completed buffered tiles using original return identities.

Both networks use the same IoU threshold. Semantic output uses the single owner
core; overlapping halo predictions only stitch instance identities. All original
source rows are retained, including background and unassigned tree predictions.
"""

import argparse
import json
import time
from pathlib import Path

import numpy as np
from prepare_full_tile import atomic_json


class Components:
    def __init__(self):
        self.parents = []

    def add(self):
        index = len(self.parents)
        self.parents.append(index)
        return index

    def root(self, index):
        index = int(index)
        while self.parents[index] != index:
            self.parents[index] = self.parents[self.parents[index]]
            index = self.parents[index]
        return index

    def join(self, a, b):
        a, b = self.root(a), self.root(b)
        low, high = min(a, b), max(a, b)
        self.parents[high] = low
        return low

    def resolve(self, values):
        result = values.copy()
        valid = result >= 0
        unique, inverse = np.unique(result[valid], return_inverse=True)
        result[valid] = np.array([self.root(x) for x in unique], dtype=np.int32)[
            inverse
        ]
        return result


def stitch_tile(components, previous, labels, threshold=0.3):
    """Return local-ID mapping and halo assignments; match by source-point IoU."""
    previous = components.resolve(previous)
    result = previous.copy()
    mapping = {}
    old_ids, old_counts = np.unique(previous[previous >= 0], return_counts=True)
    old_sizes = dict(zip(old_ids.tolist(), old_counts.tolist()))
    for local_id in np.unique(labels[labels >= 0]):
        mask = labels == local_id
        ids, counts = np.unique(previous[mask & (previous >= 0)], return_counts=True)
        matches = []
        for old, intersection in zip(ids, counts):
            union = int(mask.sum()) + old_sizes[int(old)] - int(intersection)
            if intersection / union > threshold:
                matches.append(int(old))
        if matches:
            global_id = matches[0]
            for other in matches[1:]:
                global_id = components.join(global_id, other)
        else:
            global_id = components.add()
        mapping[int(local_id)] = global_id
        result[mask & (result < 0)] = global_id
    return mapping, result


def merge(input_dir, run_dir):
    manifest = json.loads((input_dir / "manifest.json").read_text())
    run = json.loads((run_dir / "run.json").read_text())
    complete = json.loads((run_dir / "inference-completed.json").read_text())
    count = manifest["point_count"]
    if run["source_sha256"] != manifest["source_sha256"]:
        raise ValueError("Model run belongs to a different source")
    if (
        complete["core_returns_processed"] != count
        or complete["source_sha256"] != manifest["source_sha256"]
    ):
        raise ValueError("Inference does not cover this entire source")
    from pointgroup_full_runtime import file_sha

    output = run_dir / "merged"
    output.mkdir(exist_ok=True)
    # A failed merge must not retain a success marker from an older attempt.
    (output / "summary.json").unlink(missing_ok=True)
    provisional = np.lib.format.open_memmap(
        output / "halo-instances.npy", mode="w+", dtype=np.int32, shape=(count,)
    )
    provisional[:] = -1
    instances = np.lib.format.open_memmap(
        output / "instance.npy", mode="w+", dtype=np.int32, shape=(count,)
    )
    instances[:] = -1
    semantic = np.lib.format.open_memmap(
        output / "semantic.npy", mode="w+", dtype=np.int8, shape=(count,)
    )
    semantic[:] = -1
    written = np.lib.format.open_memmap(
        output / "owner-written.npy", mode="w+", dtype=np.uint8, shape=(count,)
    )
    written[:] = 0
    components = Components()
    started = time.monotonic()
    for number, tile in enumerate(manifest["tiles"]):
        key = f"{tile['x']}-{tile['y']}"
        path = run_dir / f"tile-{key}.npz"
        meta = json.loads((run_dir / f"tile-{key}.json").read_text())
        if meta["point_output_sha256"] != file_sha(path):
            raise ValueError("Tile checksum mismatch")
        with np.load(path) as data:
            rows = data["source_rows"].astype(np.int64)
            core = data["core"]
            labels = data["instance"]
            sem = data["semantic"]
            if (
                len(np.unique(rows)) != len(rows)
                or rows.min() < 0
                or rows.max() >= count
            ):
                raise ValueError("Invalid source-row join")
            if np.count_nonzero(core) != tile["returns"] or np.any(sem[core] < 0):
                raise ValueError("Incomplete core predictions")
            if np.any(written[rows[core]]):
                raise ValueError("Source return has multiple core owners")
            mapping, updated = stitch_tile(
                components, np.asarray(provisional[rows]), labels
            )
            provisional[rows] = updated
            ids = rows[core]
            local = labels[core]
            mapped = np.full(len(ids), -1, dtype=np.int32)
            for local_id, global_id in mapping.items():
                mapped[local == local_id] = global_id
            instances[ids] = mapped
            semantic[ids] = sem[core]
            written[ids] = 1
        if number % 25 == 0:
            atomic_json(
                output / "progress.json",
                {
                    "stage": "stitching_tile_boundaries",
                    "tiles": number + 1,
                    "total_tiles": len(manifest["tiles"]),
                },
            )
    if not np.all(written):
        raise ValueError("Missing source rows during merge")
    things = [1] if run["model"] == "sat" else [2, 3, 4]
    root_counts = {}
    step = 1_000_000
    for begin in range(0, count, step):
        end = min(count, begin + step)
        values = components.resolve(np.asarray(instances[begin:end]))
        sem = np.asarray(semantic[begin:end])
        values[~np.isin(sem, things)] = -1
        instances[begin:end] = values
        roots, counts = np.unique(values[values >= 0], return_counts=True)
        for root, n in zip(roots, counts):
            root_counts[int(root)] = root_counts.get(int(root), 0) + int(n)
    compact = np.full(len(components.parents), -1, dtype=np.int32)
    for i, root in enumerate(sorted(root_counts)):
        compact[root] = i
    class_counts = {}
    assigned = 0
    for begin in range(0, count, step):
        end = min(count, begin + step)
        values = np.asarray(instances[begin:end]).copy()
        mask = values >= 0
        values[mask] = compact[values[mask]]
        instances[begin:end] = values
        assigned += int(mask.sum())
        classes, n = np.unique(semantic[begin:end], return_counts=True)
        for cls, c in zip(classes, n):
            class_counts[int(cls)] = class_counts.get(int(cls), 0) + int(c)
    instances.flush()
    semantic.flush()
    written.flush()
    provisional.flush()
    del provisional, written
    (output / "halo-instances.npy").unlink()
    (output / "owner-written.npy").unlink()
    atomic_json(
        output / "summary.json",
        {
            "stage": "full_source_predictions_completed",
            "source_sha256": manifest["source_sha256"],
            "model": run["model"],
            "original_returns": count,
            "predicted_returns": count,
            "missing_returns": 0,
            "tree_candidates": len(root_counts),
            "instance_assigned_returns": assigned,
            "semantic_counts": class_counts,
            "all_core_owners_unique": True,
            "cross_tile_merge_iou_threshold": 0.3,
            "accuracy_measured": False,
            "adapter": run["adapter"],
            "merge_seconds": time.monotonic() - started,
            "instance_sha256": file_sha(output / "instance.npy"),
            "semantic_sha256": file_sha(output / "semantic.npy"),
            "merge_code_sha256": file_sha(__file__),
        },
    )


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--input", type=Path, required=True)
    p.add_argument("--run", type=Path, required=True)
    a = p.parse_args()
    merge(a.input, a.run)
