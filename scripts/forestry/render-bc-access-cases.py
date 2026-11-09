"""Render a comparison from locally retained BcAccessPilotResult JSON files.

Usage: python scripts/forestry/render-bc-access-cases.py --output cases.png pilot1.json pilot2.json ...
Input extracts stay outside the repository. This writes a derived, attributed figure, not a data snapshot.
"""
import argparse
import json
import math
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
from matplotlib.patches import Patch


def draw_case(ax, pilot):
    blocks = pilot["blocks"]
    if not blocks:
        raise ValueError("The pilot contains no mapped cutblock")
    points = [p for block in blocks for ring in block["geometry"]["coordinates"] for p in ring]
    lon0 = sum(p[0] for p in points) / len(points)
    lat0 = sum(p[1] for p in points) / len(points)
    x_scale = math.cos(math.radians(lat0)) * 111195.0802335329

    def xy(points):
        return ([ (p[0] - lon0) * x_scale for p in points ],
                [ (p[1] - lat0) * 111195.0802335329 for p in points ])

    candidates = pilot["roadCandidates"]
    nearest = min(candidates, key=lambda c: (c["distanceM"], c["roadId"])) if candidates else None
    road_by_id = {r["id"]: r for r in pilot["roads"]}
    for road in pilot["roads"]:
        ax.plot(*xy(road["geometry"]["coordinates"]), color="#83919e", linewidth=1.5, zorder=2)
    for block in blocks:
        rings = block["geometry"]["coordinates"]
        ax.fill(*xy(rings[0]), facecolor="#b4dcc8", edgecolor="#287356", alpha=0.8, linewidth=1.5, zorder=3)
        for hole in rings[1:]:
            ax.fill(*xy(hole), facecolor="#f7faf9", edgecolor="#287356", linewidth=1, zorder=3)
    if nearest:
        road = road_by_id[nearest["roadId"]]
        ax.plot(*xy(road["geometry"]["coordinates"]), color="#007eb1", linewidth=2.8, zorder=4)
        label = road["name"].replace(" · ", " / ")
        distance = "intersects footprint" if nearest["distanceM"] == 0 else f'{nearest["distanceM"]:.1f} m from footprint'
        ax.text(0.025, 0.97, f"{label}\n{distance}", transform=ax.transAxes,
                ha="left", va="top", color="#005978", fontsize=10, fontweight="bold",
                bbox={"facecolor": "white", "edgecolor": "none", "alpha": 0.92, "pad": 5}, zorder=5)
    xs, ys = xy(points)
    span = max(max(xs) - min(xs), max(ys) - min(ys)) + 600
    cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
    ax.set_xlim(cx - span / 2, cx + span / 2)
    ax.set_ylim(cy - span / 2, cy + span / 2)
    ax.set_aspect("equal")
    ax.set_facecolor("#f7faf9")
    ax.tick_params(left=False, bottom=False, labelleft=False, labelbottom=False)
    for spine in ax.spines.values():
        spine.set_color("#d5dfdc")
    record = next((r for r in pilot["identity"]["records"] if r["source"] == "ften-cutblock"), {})
    start, end = record.get("disturbanceStartDate", "unknown"), record.get("disturbanceEndDate", "unknown")
    ax.set_title(f'Opening {pilot["openingId"]}  |  {record.get("forestFileId", "?")} / {record.get("cuttingPermitId", "?")} / {record.get("cutBlockId", "?")}\n'
                 f"Reported harvest: {start} to {end}", loc="left", fontsize=10.5, pad=9, color="#173c34")
    contact = sum(c["distanceM"] == 0 for c in candidates)
    ax.text(0.025, 0.028, f'{len(pilot["roads"])} road parts loaded  ·  {len(candidates)} within 1 km  ·  {contact} intersect',
            transform=ax.transAxes, fontsize=9, color="#2f463f", va="bottom",
            bbox={"facecolor": "white", "edgecolor": "none", "alpha": 0.93, "pad": 4}, zorder=6)
    # A metric scale is calculated from source coordinates, independently in each panel.
    scale = 200 if span < 1800 else 500
    x0, y0 = cx + span * 0.44 - scale, cy - span * 0.36
    ax.plot([x0, x0 + scale], [y0, y0], color="#24443b", linewidth=2, zorder=7)
    ax.text(x0 + scale / 2, y0 + span * 0.015, f"{scale} m", ha="center", fontsize=8, zorder=7)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    parser.add_argument("pilots", nargs="+")
    args = parser.parse_args()
    if not 1 <= len(args.pilots) <= 4:
        parser.error("Render between one and four locally retained pilot records")
    pilots = [json.loads(Path(path).read_text()) for path in args.pilots]
    rows = math.ceil(len(pilots) / 2)
    figure, axes = plt.subplots(rows, 2, figsize=(12, 5.7 * rows + 1), squeeze=False)
    figure.patch.set_facecolor("white")
    for ax, pilot in zip(axes.flat, pilots):
        draw_case(ax, pilot)
    for ax in list(axes.flat)[len(pilots):]:
        ax.axis("off")
    figure.suptitle("Four actual BC block and road studies" if len(pilots) == 4 else "Actual BC block and road studies",
                   fontsize=20, fontweight="bold", color="#173c34", x=0.07, y=0.985, ha="left")
    figure.text(0.07, 0.955, "Retained ministry geometry · nearest source line highlighted · source lines may continue beyond each frame",
                fontsize=10, color="#566a63")
    figure.legend(handles=[Patch(facecolor="#b4dcc8", edgecolor="#287356", label="FTEN cutblock footprint"),
                           Line2D([], [], color="#83919e", linewidth=2, label="FTEN tenure road"),
                           Line2D([], [], color="#007eb1", linewidth=3, label="Nearest geometric candidate")],
                  loc="lower center", bbox_to_anchor=(0.5, 0.062), ncol=3, frameon=False, fontsize=10)
    figure.text(0.07, 0.044, "Distances describe geometry, not a confirmed entrance or historical route. Harvest completion may be estimated.", fontsize=9, color="#41574f")
    figure.text(0.07, 0.026, "Source: Province of British Columbia · FTEN cutblocks/roads and RESULTS · Open Government Licence – BC · checked 9 Nov 2026.", fontsize=8.5, color="#60756c")
    figure.subplots_adjust(top=0.9, bottom=0.115, left=0.07, right=0.97, hspace=0.27, wspace=0.14)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(output, dpi=160, facecolor="white")
    plt.close(figure)


if __name__ == "__main__":
    main()
