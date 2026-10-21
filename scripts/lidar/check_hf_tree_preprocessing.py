#!/usr/bin/env python3
"""Run two pinned upstream coordinate loaders; this does not run neural inference.

Supply cloned upstream repositories and the output of prepare_hf_tree_plots.py.
All writes go to the output directory; source point files are read-only inputs.
"""

import argparse
import importlib
import json
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import torch
from plyfile import PlyData


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--models-root", type=Path, required=True)
    parser.add_argument("--plots", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    sat = args.models_root / "SegmentAnyTree"
    ff = args.models_root / "FF3D_inference/ff3d_forestsens/data/ForAINetV2"
    sys.path[:0] = [str(sat), str(ff)]
    sat_loader = importlib.import_module("nibio_inference.pipeline_utm2local_parallel")
    ff_loader = importlib.import_module("load_forainetv2_data")
    manifest = json.loads((args.plots / "manifest.json").read_text())
    checks = []
    for plot in manifest["plots"]:
        path = args.plots / f"{plot['id']}.ply"
        v = PlyData.read(path)["vertex"].data
        xyz = np.column_stack([v[k] for k in ["x", "y", "z"]])
        assert len(xyz) == plot["returns"]
        destination = args.output / path.name
        if destination.resolve() == path.resolve():
            parser.error(
                "Output directory must differ from the original input directory."
            )
        offsets = destination.with_suffix(".json")
        start = time.monotonic()
        sat_loader.modification_pipeline(
            str(path), str(destination), str(offsets), True
        )
        v2 = PlyData.read(destination)["vertex"].data
        recovered = np.column_stack([v2[k] for k in ["x", "y", "z"]]) + np.array(
            json.loads(offsets.read_text())
        )
        assert recovered.shape == xyz.shape
        sat_error = float(abs(xyz - recovered).max())
        assert sat_error < 0.00001
        sat_seconds = time.monotonic() - start
        start = time.monotonic()
        result = ff_loader.export(str(path), test_mode=True)
        ff_error = float(abs(result[0] + result[-1] - xyz).max())
        assert ff_error < 0.00001
        assert len(result[0]) == len(xyz) and result[1] is None and result[2] is None
        checks.append(
            {
                "plot": plot["id"],
                "returns": len(xyz),
                "sat_preprocess_seconds": sat_seconds,
                "sat_roundtrip_max_error_m": sat_error,
                "forestformer_preprocess_seconds": time.monotonic() - start,
                "forestformer_roundtrip_max_error_m": ff_error,
                "forestformer_test_mode_has_no_truth": True,
            }
        )
    try:
        torch.empty(1, device="cuda")
        cuda_probe = "available"
    except (AssertionError, RuntimeError) as error:
        cuda_probe = f"{type(error).__name__}: {error}"
    pins = {
        name: subprocess.check_output(
            ["git", "-C", str(args.models_root / name), "rev-parse", "HEAD"], text=True
        ).strip()
        for name in ["SegmentAnyTree", "FF3D_inference"]
    }
    report = {
        "stage": "upstream_preprocessing_completed_network_inference_not_run",
        "cuda_available": torch.cuda.is_available(),
        "cuda_allocation_probe": cuda_probe,
        "points_omitted": 0,
        "plots": checks,
        "git_commits": pins,
    }
    (args.output / "preprocessing.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
