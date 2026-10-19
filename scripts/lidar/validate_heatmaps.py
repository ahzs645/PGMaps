#!/usr/bin/env python3
"""Validate bounded heatmap previews/provenance on deployment cache hits (stdlib)."""

import argparse, base64, json, struct
from pathlib import Path

p = argparse.ArgumentParser(description=__doc__)
p.add_argument("--analysis", type=Path, required=True)
p.add_argument(
    "--snapshot", type=Path, default=Path("src/pages/dev-lidar/heatmaps.generated.json")
)
a = p.parse_args()
data = json.loads(a.snapshot.read_text())
summary = json.loads((a.analysis / "summary.json").read_text())
checksums = json.loads((a.analysis / "checksums.json").read_text())
assert data["schema_version"] == 1 and data["source_sha256"] == summary["source_sha256"]
for name, digest in data["input_sha256"].items():
    assert checksums[name]["sha256"] == digest, name
assert data["density_window_m"] == 21 and data["minimum_window_support_percent"] == 80
width, height = data["grid"]["width"], data["grid"]["height"]
size = width * height
samples = {}
for key, r in data["rasters"].items():
    assert r["png_data_url"].startswith("data:image/png;base64,")
    png = base64.b64decode(r["png_data_url"].split(",")[1], validate=True)
    assert png[:8] == b"\x89PNG\r\n\x1a\n"
    assert struct.unpack(">II", png[16:24]) == (width, height)
    samples[key] = base64.b64decode(r["samples_base64"], validate=True)
    assert len(samples[key]) == size
    assert any(n != 255 for n in samples[key])
    assert 0 <= r["source_min"] <= r["source_max"]
    if key != "height":
        assert (
            r["source_max"] <= 100
            and r["source_valid_cells"]
            <= data["rasters"]["height"]["source_valid_cells"]
        )
assert all(
    (a == b == 255) or (a != 255 and b != 255 and a >= b) for a, b in zip(samples["density2"], samples["density5"])
)
print(
    json.dumps(
        {
            "heatmaps": len(samples),
            "display_grid": [width, height],
            "provenance": "matched",
        }
    )
)
