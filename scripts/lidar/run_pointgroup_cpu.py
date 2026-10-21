#!/usr/bin/env python3
"""Bounded ForAINet/SegmentAnyTree CPU inference using official code and weights.

Runs one 8 m radius cylinder, not the full tiling/voting/merging pipeline.
Uses upstream checkpoint transforms and keeps original input-row identities.
Run each upstream repository in a separate process (both use torch_points3d).
Legacy checkpoints must come from the trusted upstream release.
"""

import argparse
import hashlib
import json
import multiprocessing
import os
import random
import subprocess
import sys
import time
from pathlib import Path
from types import SimpleNamespace


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--weights", type=Path, required=True)
    parser.add_argument("--plots", type=Path, required=True)
    parser.add_argument("--plot-id", default="crown-85")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--radius", type=float, default=8.0)
    parser.add_argument("--threads", type=int, default=2)
    parser.add_argument("--weight-name", default="latest")
    args = parser.parse_args()
    if not 0 < args.radius <= 12.5:
        parser.error("radius must be > 0 and <= 12.5 m to remain inside the plot core")
    os.environ["OMP_NUM_THREADS"] = str(args.threads)
    os.environ["OPENBLAS_NUM_THREADS"] = str(args.threads)
    # Forking after CPU OpenMP inference can deadlock upstream MeanShift workers.
    multiprocessing.set_start_method("spawn", force=True)
    sys.path.insert(0, str(args.repo.resolve()))

    import numpy as np
    import torch
    from omegaconf import OmegaConf
    from plyfile import PlyData
    from scipy.spatial import cKDTree
    from torch_geometric.data import Data
    from torch_points3d.core.data_transform import (
        GridSampling3D,
        instantiate_transforms,
    )
    from torch_points3d.models.model_factory import instantiate_model

    torch.set_num_threads(args.threads)
    random.seed(2022)
    np.random.seed(2022)
    torch.manual_seed(2022)
    manifest = json.loads((args.plots / "manifest.json").read_text())
    plot = next(p for p in manifest["plots"] if p["id"] == args.plot_id)
    source = args.plots / f"{args.plot_id}.ply"
    assert sha256(source) == plot["ply_sha256"], (
        "Input differs from provenance manifest"
    )
    vertices = PlyData.read(source)["vertex"].data
    xyz = np.column_stack([vertices[k] for k in ["x", "y", "z"]]).astype(np.float64)
    assert len(xyz) == plot["returns"]
    offset = xyz.min(axis=0)
    local = (xyz - offset).astype(np.float32)
    centre = np.asarray(plot["centre_utm"]) - offset[:2]
    raw_mask = np.sum((local[:, :2] - centre) ** 2, axis=1) <= args.radius**2
    raw_ids = np.flatnonzero(raw_mask)

    checkpoint = torch.load(args.weights, map_location="cpu")
    config = OmegaConf.create(checkpoint["run_config"])
    props = dict(checkpoint["dataset_properties"])
    props.setdefault(
        "thing_classes",
        [i for i in range(props["num_classes"]) if i not in props["stuff_classes"]],
    )
    dataset = SimpleNamespace(**props)
    started = time.monotonic()
    model = instantiate_model(config, dataset)
    # Strict loading: no randomly initialised or omitted network parameters.
    model.load_state_dict(checkpoint["models"][args.weight_name], strict=True)
    model = model.to(torch.device("cpu")).eval()
    load_seconds = time.monotonic() - started

    # Model construction consumes random numbers differently for 2/5 classes.
    # Reset before sampling so both models receive identical representatives.
    random.seed(2022)
    np.random.seed(2022)
    torch.manual_seed(2022)
    data = Data(pos=torch.from_numpy(local), origin_id=torch.arange(len(local)))
    # Upstream pre-collation voxel sampling, then one bounded evaluation cylinder.
    data = GridSampling3D(
        float(config.data.first_subsampling), mode=str(config.data.mode)
    )(data)
    mask = ((data.pos[:, :2] - torch.tensor(centre, dtype=torch.float32)) ** 2).sum(
        1
    ) <= args.radius**2
    data = Data(pos=data.pos[mask], origin_id=data.origin_id[mask])
    data = instantiate_transforms(config.data.test_transform)(data)
    data.batch = torch.zeros(len(data.pos), dtype=torch.long)
    assert len(torch.unique(data.origin_id)) == len(data.pos)
    model.input = data
    model.raw_pos = data.pos
    output_coords = []
    hook = model.Backbone.up_modules[-1].register_forward_hook(
        lambda _module, _inputs, result: output_coords.append(
            result.C.detach().cpu().clone()
        )
    )
    print(
        json.dumps(
            {
                "stage": "network_started",
                "plot": args.plot_id,
                "input_returns_in_cylinder": len(raw_ids),
                "network_voxels": len(data.pos),
            }
        ),
        flush=True,
    )
    started = time.monotonic()
    # Enable the checkpoint's grouping and scoring heads without computing losses.
    with torch.inference_mode():
        model.forward(epoch=int(model.opt.prepare_epoch) + 1)
        expected_coords = torch.cat(
            [data.batch[:, None].int(), data.coords.int()], dim=1
        )
        assert len(output_coords) == 1 and torch.equal(
            output_coords[0], expected_coords
        ), "Backbone output order differs from source representatives"
        output = model.output
        _, clusters = output.get_instances(
            nms_threshold=0.3, min_cluster_points=100, min_score=0.6
        )
    hook.remove()
    inference_seconds = time.monotonic() - started
    labels = output.semantic_logits.argmax(1).cpu().numpy()
    instances = np.full(len(data.pos), -1, dtype=np.int32)
    for tree_id, members in enumerate(clusters or []):
        members = members.cpu().numpy()
        instances[members] = tree_id
    ids = data.origin_id.cpu().numpy()
    # Spatial nearest-neighbour expansion is explicitly an interpolation step;
    # retain the direct network representatives so the two cannot be confused.
    distances, nearest = cKDTree(local[ids]).query(local[raw_ids])
    args.output.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        args.output / "points.npz",
        source_rows=raw_ids,
        xyz=xyz[raw_ids],
        semantic=labels[nearest],
        instance=instances[nearest],
        representative_rows=ids,
        representative_semantic=labels,
        representative_instance=instances,
        interpolation_distance_m=distances,
    )
    summary = {
        "stage": "bounded_cpu_network_inference_completed",
        "scope": "One cylinder; not upstream whole-plot tiling, voting or merging",
        "plot": args.plot_id,
        "radius_m": args.radius,
        "source_sha256": manifest["source_sha256"],
        "input_sha256": plot["ply_sha256"],
        "checkpoint_sha256": sha256(args.weights),
        "weight_name": args.weight_name,
        "repo_commit": subprocess.check_output(
            ["git", "-C", str(args.repo), "rev-parse", "HEAD"], text=True
        ).strip(),
        "runtime": {
            "python": sys.version.split()[0],
            "torch": torch.__version__,
            "device": "cpu",
            "threads": args.threads,
        },
        "coordinate_frame": "XYZ minus buffered plot XYZ minimum; local elevation, not DTM-normalised height",
        "offset_xyz": offset.tolist(),
        "centre_utm": plot["centre_utm"],
        "input_returns_in_cylinder": len(raw_ids),
        "network_representatives": len(ids),
        "accepted_tree_instances": len(clusters or []),
        "candidate_clusters": len(output.clusters or []),
        "semantic_representative_counts": {
            str(int(k)): int(v) for k, v in zip(*np.unique(labels, return_counts=True))
        },
        "load_seconds": load_seconds,
        "inference_seconds": inference_seconds,
        "raw_point_interpolation_max_m": float(distances.max()),
        "instance_ground_truth_available": False,
        "accuracy_measured": False,
        "backbone_output_coordinate_order_verified": True,
        "nms": {
            "iou_threshold": 0.3,
            "minimum_cluster_points_exclusive": 100,
            "minimum_score_exclusive": 0.6,
        },
    }
    (args.output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, indent=2), flush=True)


if __name__ == "__main__":
    main()
