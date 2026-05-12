#!/usr/bin/env python3
"""Render a CANUE postal-code point preview from a source ZIP.

This is for local QA/planning only. CANUE postal-code locations are restricted
source data, so do not publish the raw point output unless your agreement allows it.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import zipfile
from pathlib import Path

import matplotlib.pyplot as plt


DEFAULT_SOURCE = (
    "/Users/ahmadjalil/Library/CloudStorage/GoogleDrive-ahzs645@gmail.com/"
    "My Drive/University/Research/Grad/Data/Canue/2026 pull/"
    "nhacs_ava_2026-05-07_20-31-54_annual.zip"
)
DEFAULT_OUTPUT = "docs/canue-points-pg-preview.png"
BC_BOUNDARY = "public/data/boundaries/BCMoH/simplified/health_authorities.json"
PG_BOUNDARY = "public/data/citypg/community_boundaries.geojson"


VIEWS = {
    "bc": (-139.5, -113.5, 47.5, 60.5),
    "pg": (-123.35, -122.25, 53.55, 54.25),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--zip", default=DEFAULT_SOURCE, help="CANUE source ZIP path")
    parser.add_argument("--year", type=int, default=2021, help="Postal location year")
    parser.add_argument("--view", choices=sorted(VIEWS), default="pg", help="Map extent")
    parser.add_argument("--output", default=DEFAULT_OUTPUT, help="PNG output path")
    parser.add_argument("--limit", type=int, default=0, help="Optional max points after filtering")
    return parser.parse_args()


def read_points(zip_path: Path, year: int, bbox: tuple[float, float, float, float]):
    yy = str(year)[-2:]
    member = f"DMTI_SLI_{yy}.csv"
    lon_min, lon_max, lat_min, lat_max = bbox
    points = []
    total_bc = 0
    with zipfile.ZipFile(zip_path) as archive:
        with archive.open(member) as raw:
            reader = csv.DictReader((line.decode("utf-8-sig") for line in raw))
            for row in reader:
                province = (row.get(f"PROV_{yy}") or row.get("PROV_16") or "").upper()
                if province != "BC":
                    continue
                total_bc += 1
                lat = to_float(row.get(f"LATITUDE_{yy}") or row.get("LATITUDE_16"))
                lon = to_float(row.get(f"LONGITUDE_{yy}") or row.get("LONGITUDE_16"))
                if lat is None or lon is None:
                    continue
                if lon_min <= lon <= lon_max and lat_min <= lat <= lat_max:
                    points.append((lon, lat))
    return points, total_bc


def to_float(value: str | None) -> float | None:
    try:
        number = float(value or "")
    except ValueError:
        return None
    return number if math.isfinite(number) else None


def plot_geojson(ax, path: Path, color: str, linewidth: float, alpha: float = 1.0):
    if not path.exists():
        return
    data = json.loads(path.read_text())
    for feature in data.get("features", []):
        geometry = feature.get("geometry") or {}
        plot_geometry(ax, geometry, color, linewidth, alpha)


def plot_geometry(ax, geometry, color: str, linewidth: float, alpha: float):
    kind = geometry.get("type")
    coordinates = geometry.get("coordinates")
    if not coordinates:
        return
    if kind == "Polygon":
        for ring in coordinates:
            xs, ys = zip(*ring)
            ax.plot(xs, ys, color=color, linewidth=linewidth, alpha=alpha)
    elif kind == "MultiPolygon":
        for polygon in coordinates:
            for ring in polygon:
                xs, ys = zip(*ring)
                ax.plot(xs, ys, color=color, linewidth=linewidth, alpha=alpha)
    elif kind == "LineString":
        xs, ys = zip(*coordinates)
        ax.plot(xs, ys, color=color, linewidth=linewidth, alpha=alpha)
    elif kind == "MultiLineString":
        for line in coordinates:
            xs, ys = zip(*line)
            ax.plot(xs, ys, color=color, linewidth=linewidth, alpha=alpha)


def main() -> None:
    args = parse_args()
    zip_path = Path(args.zip)
    bbox = VIEWS[args.view]
    points, total_bc = read_points(zip_path, args.year, bbox)
    if args.limit and len(points) > args.limit:
        points = points[: args.limit]

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)

    fig, ax = plt.subplots(figsize=(11, 8.5), dpi=180)
    ax.set_facecolor("#f8fafc")
    fig.patch.set_facecolor("white")

    if args.view == "bc":
      plot_geojson(ax, Path(BC_BOUNDARY), "#94a3b8", 0.7, 0.85)
    else:
      plot_geojson(ax, Path(PG_BOUNDARY), "#64748b", 0.8, 0.7)
      plot_geojson(ax, Path("public/data/citypg/roads.geojson"), "#cbd5e1", 0.25, 0.45)

    if points:
        xs, ys = zip(*points)
        ax.scatter(xs, ys, s=6 if args.view == "pg" else 1.1, c="#2563eb", alpha=0.35, linewidths=0)

    lon_min, lon_max, lat_min, lat_max = bbox
    ax.set_xlim(lon_min, lon_max)
    ax.set_ylim(lat_min, lat_max)
    ax.set_aspect("equal", adjustable="box")
    ax.set_xlabel("Longitude")
    ax.set_ylabel("Latitude")
    ax.grid(color="#e2e8f0", linewidth=0.5)
    ax.set_title(
        f"CANUE postal-code point preview ({args.view.upper()}, DMTI {args.year})\n"
        f"{len(points):,} points in view; {total_bc:,} BC postal-code locations in source",
        fontsize=12,
        color="#0f172a",
    )

    fig.tight_layout()
    fig.savefig(output, bbox_inches="tight")
    print(f"Wrote {output} ({len(points)} points in view, {total_bc} BC points total)")


if __name__ == "__main__":
    main()
