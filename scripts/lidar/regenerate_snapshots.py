#!/usr/bin/env python3
"""Regenerate the committed LiDAR snapshots from one build of the products.

The snapshots in src/pages/dev-lidar pin the exact bytes of the analysis
products they were computed from, so they have to be regenerated in the same
environment that builds the deployed products (CI's Linux runners): a macOS
build of identical code gives different bytes. `.github/workflows/lidar-snapshots.yml`
runs this and uploads the result.

Every generator that reads the products runs here, in dependency order. The
tree segmentation benchmark needs R, lidR and PointTree, so it is not rerun;
`--repin-benchmarks` updates its terrain and segmentation pins only, and is
for builds where the benchmark plots' terrain has been checked unchanged.
"""

import argparse, hashlib, json, subprocess, sys
from pathlib import Path

root = Path(__file__).resolve().parents[2]
scripts = root / "scripts/lidar"


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def run(script, *args):
    print(f"→ {script} {' '.join(map(str, args))}", flush=True)
    subprocess.run([sys.executable, str(scripts / script), *map(str, args)], check=True, cwd=root)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--analysis", type=Path, required=True, help="Published analysis products (run.py --output)")
    p.add_argument("--grids", type=Path, required=True, help="analysis-grids.npz from process.py (run.py --work)")
    p.add_argument("--source", type=Path, required=True, help="The source LAZ point cloud")
    p.add_argument("--snapshots", type=Path, default=root / "src/pages/dev-lidar")
    p.add_argument("--repin-benchmarks", action="store_true")
    a = p.parse_args()
    out = a.snapshots
    run("inspect_roofs.py", "--analysis", a.analysis, "--output", out / "roofInspection.generated.json")
    run("workflows.py", "--analysis", a.analysis, "--output", out / "workflows.generated.json")
    run("heatmaps.py", "--analysis", a.analysis, "--output", out / "heatmaps.generated.json")
    run("height_detail.py", "--analysis", a.analysis, "--output", out / "height-detail.generated.json")
    run("tree_isolation.py", "--analysis", a.analysis, "--grids", a.grids, "--output", out / "treeIsolation.generated.json")
    run("forestry.py", "--source", a.source, "--analysis", a.analysis, "--output", out / "forestry.generated.json")
    run("species.py", "--analysis", a.analysis, "--forestry", out / "forestry.generated.json", "--output", out / "species.generated.json")
    run("species_context.py", "--species", out / "species.generated.json", "--forestry", out / "forestry.generated.json",
        "--output", out / "species-context.generated.json")
    if a.repin_benchmarks:
        path = out / "treeBenchmarks.generated.json"
        text = path.read_text()
        data = json.loads(text)
        isolation = json.loads((out / "treeIsolation.generated.json").read_text())
        replacements = {
            data["input_sha256"]["dtm-1m.tif"]: sha(a.analysis / "dtm-1m.tif"),
            data["segmentation_sha256"]: sha(out / "treeIsolation.generated.json"),
            data["label_grid_sha256"]: isolation["label_grid_sha256"],
        }
        # Swap the digests as text so the rest of the file stays byte-identical.
        for old, new in replacements.items():
            text = text.replace(old, new)
        path.write_text(text)
        print("re-pinned treeBenchmarks.generated.json terrain and segmentation digests", flush=True)


if __name__ == "__main__":
    main()
