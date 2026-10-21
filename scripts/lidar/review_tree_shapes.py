#!/usr/bin/env python3
"""Render original-return crown crops as equal-scale 3D/profile review artifacts.

Generate the input TreeCrop JSON with inspect_tree_ept.py first. No tree species,
stems or branch surfaces are reconstructed. Review notes are visual observations
of these five named examples, never an automatic classification rule.
"""

import argparse
import hashlib
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from plotly.offline import get_plotlyjs
from pyproj import Transformer

EXAMPLES = {
    "crown-85": "Tree-shaped crown; sparse lower returns. Species and individual-tree membership unverified.",
    "crown-3146": "Tree-shaped crown. Individual-tree membership unverified.",
    "crown-12323": "Structure review: straight/sloping linear features resemble a pole and crossarm or wires. Unverified.",
    "crown-15190": "Low, broad vegetation-shaped selection; may contain more than one plant. Unverified.",
    "crown-1": "Structure review: lattice and horizontal features resemble a utility tower. Unverified.",
}


def prepare(crop):
    transform = Transformer.from_crs(4326, 3157, always_xy=True)
    cx, cy = transform.transform(*crop["centre"])
    points = crop["points"]
    assert points and len({(p["node"], p["index"]) for p in points}) == len(points)
    x, y = transform.transform([p["lon"] for p in points], [p["lat"] for p in points])
    x, y = np.asarray(x) - cx, np.asarray(y) - cy
    h = np.asarray([p["height"] for p in points])
    z = np.asarray([p["z"] - crop["ground_m"] for p in points])
    assert np.isfinite(np.column_stack((x, y, h, z))).all()
    assert ((h >= 2) & (h <= 80)).all()
    return x, y, h, z


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--crops", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    packed, summaries = [], []
    for name, note in EXAMPLES.items():
        path = args.crops / f"{name}.json"
        crop = json.loads(path.read_text())
        assert crop["id"] == name and not crop["budget_limited"]
        assert crop["loaded_nodes"] == crop["available_nodes"]
        x, y, h, z = prepare(crop)
        summary = {
            "id": name,
            "source_sha256": crop["source_sha256"],
            "crop_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "returns": len(h),
            "height_max_m": float(h.max()),
            "height_p95_m": float(np.percentile(h, 95)),
            "east_span_m": float(np.ptp(x)),
            "north_span_m": float(np.ptp(y)),
            "returns_2_to_5m": int((h < 5).sum()),
            "all_nodes_loaded": True,
            "budget_limited": False,
            "review_note": note,
        }
        summaries.append(summary)
        packed.append(
            {
                **summary,
                "centre": crop["centre"],
                "ground_m": crop["ground_m"],
                "x": x.tolist(),
                "y": y.tolist(),
                "h": h.tolist(),
                "z": z.tolist(),
                "identity": [
                    [p["node"], p["index"], p["classification"]] for p in crop["points"]
                ],
            }
        )
    assert len({p["source_sha256"] for p in packed}) == 1
    highest = max(max(p["h"]) for p in packed)
    height_limit = float((np.floor(highest / 5) + 1) * 5)
    largest_offset = max(
        float(np.abs(p[axis]).max()) for p in packed for axis in ["x", "y"]
    )
    half_width = float(np.ceil(largest_offset) + 1)
    fig = plt.figure(figsize=(17, 10))
    for j, item in enumerate(packed):
        x, y, h = map(np.asarray, (item["x"], item["y"], item["h"]))
        ax = fig.add_subplot(2, 5, j + 1, projection="3d")
        ax.scatter(
            x,
            y,
            h,
            c=h,
            cmap="viridis",
            s=0.8,
            vmin=0,
            vmax=height_limit,
            depthshade=False,
        )
        ax.set(
            xlim=(-half_width, half_width),
            ylim=(-half_width, half_width),
            zlim=(0, height_limit),
        )
        ax.set_box_aspect((half_width * 2, half_width * 2, height_limit))
        ax.view_init(elev=12, azim=-65)
        ax.set_title(f"{item['id']}\n{len(h):,} returns", fontsize=11, pad=12)
        ax.set_xticks([-half_width, 0, half_width])
        ax.set_yticks([-half_width, 0, half_width])
        ax.tick_params(labelsize=7, pad=1)
        ax = fig.add_subplot(2, 5, 6 + j)
        ax.scatter(x, h, c=h, cmap="viridis", s=1, vmin=0, vmax=height_limit)
        ax.set(
            ylim=(0, height_limit),
            xlim=(-half_width, half_width),
            xlabel="East offset (m)",
        )
        ax.set_aspect("equal")
        ax.grid(alpha=0.15)
        ax.axhspan(0, 2, color="orange", alpha=0.1)
        if j == 0:
            ax.set_ylabel("Height above terrain (m)")
        ax.set_title("Side profile", fontsize=10)
    fig.suptitle(
        "Original LiDAR crown-column selections — 3D and side view", fontsize=17
    )
    fig.text(
        0.5,
        0.02,
        "Equal metre axes • All retained returns • 0–2 m excluded • Candidate columns, not validated tree instances",
        ha="center",
        fontsize=11,
    )
    fig.tight_layout(rect=(0, 0.04, 1, 0.96))
    fig.savefig(args.output / "tree-shapes.png", dpi=125)
    plt.close(fig)
    report = {
        "scope": "Five original LiDAR crown-column crops; no new neural segmentation",
        "points_omitted_from_artifact": 0,
        "height_limit_m": height_limit,
        "half_width_m": half_width,
        "examples": summaries,
    }
    (args.output / "review.json").write_text(json.dumps(report, indent=2) + "\n")
    template = Path(__file__).with_name("tree_shape_review.html").read_text()
    data = json.dumps(packed, separators=(",", ":")).replace("<", "\\u003c")
    html = template.replace("/*PLOTLY_LIBRARY*/", get_plotlyjs()).replace(
        "/*CROP_DATA*/", data
    )
    (args.output / "index.html").write_text(html)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
