#!/usr/bin/env python3
"""Run both full-tile models, merge their seams, then export the comparison.

Run detached in a persistent workspace. Progress and per-tile outputs are durable;
rerunning the same command resumes verified tiles. A stopped workspace stops CPU
work. No Hugging Face upload or paid job is involved.
"""

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

from prepare_full_tile import atomic_json


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--models", type=Path, required=True)
    parser.add_argument("--blas", type=Path, required=True)
    parser.add_argument("--max-hours", type=float, default=72)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    # Leave foreground workspace work responsive while the long run proceeds.
    os.nice(10)
    manifest = json.loads((args.input / "manifest.json").read_text())
    script = Path(__file__).resolve().parent
    env = os.environ.copy()
    env["LD_LIBRARY_PATH"] = str(args.blas)
    env["PGMAPS_BLAS_IMPLEMENTATION"] = "openblas-0.3.29-pthread"
    env["PYTHONPATH"] = str(args.models / "torch-points-kernels")
    started = time.time()
    deadline = started + args.max_hours * 3600
    jobs = {}
    streams = []
    state = {
        "stage": "full_tile_inference_running",
        "coordinator_pid": os.getpid(),
        "started_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(started)),
        "source_sha256": manifest["source_sha256"],
        "total_returns": manifest["point_count"],
        "total_core_tiles": len(manifest["tiles"]),
        "initial_estimate_hours": 28,
        "maximum_wall_hours": args.max_hours,
        "paid_job": False,
        "models": {},
    }
    status = args.output / "job-status.json"
    try:
        for model, repo, weight in [
            ("sat", "SegmentAnyTree", "segment-any-tree.pt"),
            ("forainet", "ForAINet/PointCloudSegmentation", "forainet-original.pt"),
        ]:
            stream = (args.output / f"{model}.log").open("a")
            streams.append(stream)
            command = [
                sys.executable,
                str(script / "run_full_pointgroup.py"),
                "--input",
                str(args.input),
                "--output",
                str(args.output / model),
                "--repo",
                str(args.models / repo),
                "--weights",
                str(args.models / weight),
                "--model",
                model,
                "--threads",
                "2",
            ]
            jobs[model] = subprocess.Popen(
                command, stdout=stream, stderr=subprocess.STDOUT, env=env
            )
        while True:
            for model, job in jobs.items():
                path = args.output / model / "progress.json"
                progress = (
                    json.loads(path.read_text())
                    if path.exists()
                    else {"completed_tiles": 0, "core_returns_processed": 0}
                )
                state["models"][model] = {
                    "pid": job.pid,
                    "return_code": job.poll(),
                    **progress,
                }
            state["elapsed_hours"] = (time.time() - started) / 3600
            atomic_json(status, state)
            if all(job.poll() is not None for job in jobs.values()):
                break
            if time.time() > deadline:
                raise TimeoutError(
                    "Full comparison reached its explicit wall-time limit; completed tiles are resumable"
                )
            time.sleep(10)
        failed = [model for model, job in jobs.items() if job.returncode]
        if failed:
            raise RuntimeError(
                "Inference worker failed: "
                + ", ".join(failed)
                + "; see model logs and retain checkpoints"
            )
        state["stage"] = "merging_full_tile_predictions"
        atomic_json(status, state)
        for model in jobs:
            with (args.output / f"{model}-merge.log").open("a") as log:
                subprocess.run(
                    [
                        sys.executable,
                        str(script / "merge_full_pointgroup.py"),
                        "--input",
                        str(args.input),
                        "--run",
                        str(args.output / model),
                    ],
                    check=True,
                    stdout=log,
                    stderr=subprocess.STDOUT,
                    env=env,
                    timeout=max(1, deadline - time.time()),
                )
        state["stage"] = "exporting_full_tile_comparison"
        atomic_json(status, state)
        with (args.output / "export.log").open("a") as log:
            subprocess.run(
                [
                    sys.executable,
                    str(script / "export_full_pointgroup_comparison.py"),
                    "--input",
                    str(args.input),
                    "--run",
                    str(args.output),
                ],
                check=True,
                stdout=log,
                stderr=subprocess.STDOUT,
                env=env,
                timeout=max(1, deadline - time.time()),
            )
        state["stage"] = "full_tile_comparison_completed"
        state["elapsed_hours"] = (time.time() - started) / 3600
        atomic_json(status, state)
    except BaseException as exc:
        state["stage"] = "failed_or_interrupted"
        state["error"] = str(exc)
        atomic_json(status, state)
        for job in jobs.values():
            if job.poll() is None:
                job.terminate()
        raise
    finally:
        for stream in streams:
            stream.close()


if __name__ == "__main__":
    main()
