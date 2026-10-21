#!/usr/bin/env python3
"""Export existing benchmark plots without subsampling or inventing tree labels.

Input is the cache made by benchmark_tree_methods.py --prepare. Preserve the NPZ
and JSON alongside these disposable XYZ PLY copies: row index joins back to the
EPT node + decoded point index. Does not run a segmentation network.
"""

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np


def sha(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    cache_manifest = json.loads((args.cache / "manifest.json").read_text())
    cache_plots = {plot["id"]: plot for plot in cache_manifest["plots"]}
    args.output.mkdir(parents=True, exist_ok=True)
    plots = []
    for plot in ["crown-3146-north", "crown-85", "crown-1"]:
        points = np.load(args.cache / f"{plot}.npz")["points"]
        metadata = json.loads((args.cache / f"{plot}.json").read_text())
        assert metadata["input_sha256"] == cache_plots[plot]["input_sha256"]
        assert points.shape == (metadata["accepted_returns"], 7)
        assert np.isfinite(points).all()
        array_sha = hashlib.sha256(points.astype("<f8").tobytes()).hexdigest()
        assert array_sha == metadata["input_identity"]["accepted_array_sha256"]
        assert len(np.unique(points[:, 4:6], axis=0)) == len(points)
        xyz = points[:, :3].copy()
        xyz[:, :2] += metadata["centre_utm"]
        path = args.output / f"{plot}.ply"
        # Doubles retain UTM precision; no fake RGB, species or tree IDs.
        with path.open("wb") as stream:
            stream.write(
                (
                    f"ply\nformat binary_little_endian 1.0\nelement vertex {len(points)}\n"
                    "property double x\nproperty double y\nproperty double z\n"
                    "end_header\n"
                ).encode()
            )
            stream.write(xyz.astype("<f8").tobytes())
        # Full identity map lives outside the point cloud so runners cannot
        # accidentally treat row IDs as learned input features or truth labels.
        identity = args.output / f"{plot}.identity.npz"
        np.savez_compressed(
            identity,
            row=np.arange(len(points), dtype=np.uint32),
            ept_node_index=points[:, 4].astype(np.uint32),
            ept_point_index=points[:, 5].astype(np.uint32),
            height=points[:, 3],
            classification=points[:, 6].astype(np.uint8),
        )
        entry = {
            "id": plot,
            "returns": len(points),
            "core_size_m": 25,
            "buffer_m": 10,
            "horizontal_crs": "EPSG:3157",
            "vertical_crs": "EPSG:6647",
            "z": "source elevation, not normalized height",
            "nominal_accepted_returns_per_m2": len(points) / (45 * 45),
            "input_sha256": metadata["input_sha256"],
            "array_sha256": array_sha,
            "ply_sha256": sha(path),
            "identity_sha256": sha(identity),
            "nodes": metadata["nodes"],
            "centre_utm": metadata["centre_utm"],
            "instance_ground_truth_available": False,
        }
        plots.append(entry)
    manifest = {
        "schema_version": 1,
        "stage": "input_prepared_not_network_inference",
        "source_sha256": cache_manifest["source_sha256"],
        "cache_manifest_sha256": sha(args.cache / "manifest.json"),
        "input_attributes": "XYZ only; source classes/heights retained in identity sidecar",
        "points_omitted": 0,
        "plots": plots,
    }
    (args.output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
