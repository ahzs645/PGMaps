#!/usr/bin/env python3
"""Prepare all BC tile analysis products; expensive work stays outside the viewer."""

import argparse, shutil, subprocess, sys, tempfile, urllib.request
from pathlib import Path

p = argparse.ArgumentParser(description=__doc__)
p.add_argument("--source", type=Path)
p.add_argument(
    "--output", type=Path, default=Path("public/data/lidar-analysis/bc-093g086")
)
# Keep the intermediate products (analysis-grids.npz) for snapshot regeneration.
p.add_argument("--work", type=Path)
args = p.parse_args()
root = Path(__file__).parent
with tempfile.TemporaryDirectory(prefix="pgmaps-lidar-analysis-") as tmp:
    source = args.source
    if source is None:
        source = Path(tmp) / "source.laz"
        url = "https://drive.usercontent.google.com/download?id=12HM0-w7PNe_cC1t-ThLrFoBZngr4jgfI&export=download&confirm=t"
        with (
            urllib.request.urlopen(url, timeout=120) as response,
            source.open("wb") as target,
        ):
            shutil.copyfileobj(response, target, 4 * 1024 * 1024)
    work = args.work.resolve() if args.work else Path(tmp) / "analysis"
    commands = [
        ["process.py", "--source", str(source.resolve()), "--output", str(work)],
        ["geolibre_tools.py", "--analysis", str(work)],
        ["reference_tools.py", "--analysis", str(work)],
        ["publish.py", "--analysis", str(work), "--output", str(args.output.resolve())],
    ]
    for command in commands:
        subprocess.run(
            [sys.executable, str(root / command[0]), *command[1:]], check=True
        )
