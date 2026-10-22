#!/usr/bin/env python3
"""Render bounded CPU model results with original-point height and identities."""

import argparse
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.lines import Line2D


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--results", type=Path, required=True)
    parser.add_argument("--plots", type=Path, required=True)
    parser.add_argument("--plot-id", default="crown-85")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    datasets = [
        np.load(args.results / f"{m}-{args.plot_id}" / "points.npz")
        for m in ["sat", "forainet"]
    ]
    summaries = [
        json.loads((args.results / f"{m}-{args.plot_id}" / "summary.json").read_text())
        for m in ["sat", "forainet"]
    ]
    a, b = datasets
    assert np.array_equal(a["source_rows"], b["source_rows"])
    assert np.array_equal(a["xyz"], b["xyz"])
    assert np.array_equal(a["representative_rows"], b["representative_rows"])
    radius = summaries[0]["radius_m"]
    assert radius == summaries[1]["radius_m"]
    height = np.load(args.plots / f"{args.plot_id}.identity.npz")["height"][
        a["source_rows"]
    ]
    xy = a["xyz"][:, :2] - np.asarray(summaries[0]["centre_utm"])
    fig, axes = plt.subplots(2, 3, figsize=(14, 9), constrained_layout=True)
    titles = [
        "Original returns · height",
        "SegmentAnyTree · tree instances",
        "ForAINet · tree instances",
    ]
    colours = [plt.cm.viridis(np.clip(height / max(1, height.max()), 0, 1))]
    for data in datasets:
        ids = data["instance"]
        c = plt.cm.gist_ncar((ids * 0.61803398875) % 1)
        c[ids < 0] = [0.65, 0.68, 0.70, 0.3]
        colours.append(c)
    for col, colour in enumerate(colours):
        axes[0, col].scatter(xy[:, 0], xy[:, 1], c=colour, s=1.5, linewidths=0)
        axes[0, col].set_aspect("equal")
        axes[0, col].set(
            xlabel="East from centre (m)",
            ylabel="North from centre (m)",
            title=titles[col],
        )
        axes[1, col].scatter(xy[:, 0], height, c=colour, s=1.5, linewidths=0)
        axes[1, col].set(
            xlabel="East from centre (m)",
            ylabel="Height above terrain (m)",
            ylim=(-1, height.max() + 2),
        )
        if col:
            axes[1, col].set_title(
                f"{summaries[col - 1]['accepted_tree_instances']} accepted instances · {summaries[col - 1]['inference_seconds']:.1f} s CPU"
            )
    for ax in axes.flat:
        ax.spines[["right", "top"]].set_visible(False)
        ax.grid(alpha=0.12)
    fig.suptitle(
        f"BC LiDAR · {args.plot_id} · {len(height):,} original returns in a {radius:g} m radius\nExperimental model transfer; grey = unassigned. Colours identify instances within each model, not species or cross-model matches.",
        fontsize=12,
    )
    args.output.mkdir(parents=True, exist_ok=True)
    fig.savefig(args.output / f"{args.plot_id}-instances.png", dpi=160)
    plt.close(fig)

    palette = np.array(
        [
            [0.67, 0.65, 0.22],
            [0.35, 0.55, 0.68],
            [0.59, 0.30, 0.13],
            [0.08, 0.58, 0.31],
            [0.68, 0.25, 0.64],
        ]
    )
    names = [
        "Low vegetation",
        "Ground",
        "Stem points",
        "Live branches",
        "Branches (class 4)",
    ]
    fig, axes = plt.subplots(1, 2, figsize=(12, 5), constrained_layout=True)
    c = palette[b["semantic"]]
    axes[0].scatter(xy[:, 0], xy[:, 1], c=c, s=2, linewidths=0)
    axes[0].set(xlabel="East from centre (m)", ylabel="North from centre (m)")
    axes[0].set_aspect("equal")
    axes[1].scatter(xy[:, 0], height, c=c, s=2, linewidths=0)
    axes[1].set(xlabel="East from centre (m)", ylabel="Height above terrain (m)")
    fig.legend(
        [Line2D([], [], marker="o", linestyle="", color=colour) for colour in palette],
        names,
        loc="outside lower center",
        ncol=5,
    )
    fig.suptitle(
        "ForAINet · predicted point classes on the BC crop\nPredictions expanded from network voxels to original returns; no reviewed class truth."
    )
    fig.savefig(args.output / f"{args.plot_id}-semantics.png", dpi=160)
    plt.close(fig)


if __name__ == "__main__":
    main()
