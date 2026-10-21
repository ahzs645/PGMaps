"""Official PointGroup network adapter for streaming CPU windows, no fake labels."""

import hashlib
import random
import sys
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import torch
from scipy.spatial import cKDTree


class SerialPool:
    """Run the identical clustering function without per-window process startup."""

    def __init__(self, **_kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def map(self, function, values):
        return list(map(function, values))


def seed(value):
    random.seed(value)
    np.random.seed(value)
    torch.manual_seed(value)


def file_sha(path):
    result = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


class PointGroupCPU:
    def __init__(self, repo, weights, threads=2):
        sys.path.insert(0, str(Path(repo).resolve()))
        from omegaconf import OmegaConf
        from torch_points3d.core.data_transform import (
            GridSampling3D,
            instantiate_transforms,
        )
        from torch_points3d.models.model_factory import instantiate_model
        from torch_points3d.utils import hdbscan_cluster, meanshift_cluster

        torch.set_num_threads(threads)
        # These modules previously used a one-worker Pool after OpenMP inference.
        # Calling the same worker function serially avoids fork deadlock and spawn overhead.
        meanshift_cluster.multiprocessing = SimpleNamespace(Pool=SerialPool)
        hdbscan_cluster.multiprocessing = SimpleNamespace(Pool=SerialPool)
        checkpoint = torch.load(weights, map_location="cpu")
        self.config = OmegaConf.create(checkpoint["run_config"])
        props = dict(checkpoint["dataset_properties"])
        props.setdefault(
            "thing_classes",
            [i for i in range(props["num_classes"]) if i not in props["stuff_classes"]],
        )
        self.things = props["thing_classes"]
        self.classes = props["num_classes"]
        self.model = instantiate_model(self.config, SimpleNamespace(**props))
        self.model.load_state_dict(checkpoint["models"]["latest"], strict=True)
        self.model = self.model.to(torch.device("cpu")).eval()
        self.grid = GridSampling3D(
            float(self.config.data.first_subsampling), mode=str(self.config.data.mode)
        )
        self.transform = instantiate_transforms(self.config.data.test_transform)
        self.coordinates = []
        self.model.Backbone.up_modules[-1].register_forward_hook(
            lambda _m, _i, result: self.coordinates.append(
                result.C.detach().cpu().clone()
            )
        )

    def subsample(self, xyz, random_seed):
        from torch_geometric.data import Data

        seed(random_seed)
        return self.grid(
            Data(pos=torch.from_numpy(xyz.copy()), origin_id=torch.arange(len(xyz)))
        )

    def predict(self, positions, original_indices, random_seed):
        from torch_geometric.data import Data

        seed(random_seed)
        data = self.transform(
            Data(pos=positions.clone(), origin_id=original_indices.clone())
        )
        data.batch = torch.zeros(len(data.pos), dtype=torch.long)
        self.model.input = data
        self.model.raw_pos = data.pos
        self.coordinates.clear()
        with torch.inference_mode():
            self.model.forward(epoch=int(self.model.opt.prepare_epoch) + 1)
            expected = torch.cat([data.batch[:, None].int(), data.coords.int()], dim=1)
            if len(self.coordinates) != 1 or not torch.equal(
                self.coordinates[0], expected
            ):
                raise ValueError("Backbone output/source-coordinate join failed")
            output = self.model.output
            if not torch.isfinite(output.semantic_logits).all():
                raise ValueError("Non-finite model prediction")
            chosen, clusters = output.get_instances(
                nms_threshold=0.3, min_cluster_points=100, min_score=0.6
            )
        logits = output.semantic_logits.cpu().numpy().copy()
        labels = np.full(len(data.pos), -1, dtype=np.int32)
        scores = output.cluster_scores[chosen].cpu().numpy() if chosen else np.empty(0)
        # Higher proposal score wins where accepted proposals overlap.
        for index in np.argsort(scores, kind="stable"):
            labels[clusters[index].cpu().numpy()] = index
        ids = data.origin_id.cpu().numpy()
        return ids, logits, labels, len(clusters or [])


def centres_for_core(bounds, origin, radius=8.0, stride=8.0):
    """Every core point is within radius of a centre; include halo centres."""
    lo, hi = np.asarray(bounds[0]), np.asarray(bounds[1])
    origin = np.asarray(origin)
    begin = np.ceil((lo - radius - origin) / stride).astype(int)
    end = np.floor((hi + radius - origin) / stride).astype(int)
    return [
        (origin + np.array([i, j]) * stride, i, j)
        for i in range(begin[0], end[0] + 1)
        for j in range(begin[1], end[1] + 1)
    ]


def merge_window(existing, new, next_id, threshold=0.3):
    """Merge by common-source-point IoU inside this window, preserving prior labels.

    Same fixed policy for both networks. It is a PGMaps adapter, not the original
    trackers' differing IoU/overlap policies. IDs are local to one buffered tile.
    """
    result = existing.copy()
    for label in np.unique(new[new >= 0]):
        mask = new == label
        old_ids, intersections = np.unique(
            existing[mask & (existing >= 0)], return_counts=True
        )
        best = None
        best_iou = threshold
        for old, intersection in zip(old_ids, intersections):
            union = (
                np.count_nonzero(existing == old)
                + np.count_nonzero(mask)
                - intersection
            )
            iou = intersection / union
            if iou > best_iou:
                best = int(old)
                best_iou = iou
        if best is None:
            best = next_id
            next_id += 1
        result[mask & (result < 0)] = best
    return result, next_id


def expand_predictions(xyz, raw_indices, representative_indices, logits, instances):
    distance, nearest = cKDTree(xyz[representative_indices]).query(xyz[raw_indices])
    return logits[nearest], instances[nearest], distance
