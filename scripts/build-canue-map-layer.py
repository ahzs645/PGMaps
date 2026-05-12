#!/usr/bin/env python3
"""Build map-ready CANUE layers from source ZIPs.

Outputs newline-delimited GeoJSON features for either postal-code points or
aggregated grid cells. If tippecanoe and pmtiles are installed, the script can
also build MBTiles/PMTiles from that NDJSON.

CANUE postal-code rows are restricted source data. Prefer --mode grid for
public map outputs.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import shutil
import subprocess
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


DEFAULT_SOURCE_DIR = "/Volumes/Main/2026 pull/zip"
DEFAULT_OUTPUT_DIR = "build/canue-map-layers"

VIEWS = {
    "bc": (-139.5, -113.5, 47.5, 60.5),
    "pg": (-123.35, -122.25, 53.55, 54.25),
}

NULL_VALUES = {"", "NULL", "-9999", "-9999.0", "-9999.00"}


@dataclass
class SourceMatch:
    zip_path: Path
    value_member: str
    location_member: str
    variable: str
    variables: list[str]
    year: int


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", default=DEFAULT_SOURCE_DIR, help="Folder containing CANUE ZIPs")
    parser.add_argument("--zip", dest="zip_path", help="Specific CANUE ZIP to read")
    parser.add_argument("--dataset", help="Dataset ZIP prefix, e.g. aqfpm_01 or nhacs_ava")
    parser.add_argument("--year", type=int, required=True, help="Four-digit year to extract")
    parser.add_argument("--variable", help="Variable column to map. Defaults to first numeric-looking variable.")
    parser.add_argument("--all-variables", action="store_true", help="Include every numeric variable for the selected dataset/year")
    parser.add_argument("--mode", choices=["grid", "points"], default="grid", help="Output feature geometry")
    parser.add_argument("--view", choices=sorted(VIEWS), default="pg", help="Spatial bbox")
    parser.add_argument("--bbox", help="Custom bbox as minLon,minLat,maxLon,maxLat")
    parser.add_argument("--grid-km", type=float, default=1.0, help="Grid cell size for --mode grid")
    parser.add_argument("--output-dir", default=DEFAULT_OUTPUT_DIR, help="Output folder")
    parser.add_argument("--layer", default="canue", help="Vector tile layer name")
    parser.add_argument("--pmtiles", action="store_true", help="Build PMTiles when tippecanoe and pmtiles are installed")
    parser.add_argument("--minzoom", type=int, default=5)
    parser.add_argument("--maxzoom", type=int, default=12)
    parser.add_argument("--include-postalcode", action="store_true", help="Include postal code in point properties")
    return parser.parse_args()


def archive_dataset_id(zip_path: Path) -> str:
    return zip_path.name.replace(".zip", "").split("_2026-")[0]


def candidate_zips(args: argparse.Namespace) -> list[Path]:
    if args.zip_path:
        return [Path(args.zip_path)]
    if not args.dataset:
        raise SystemExit("Provide --dataset or --zip")
    root = Path(args.source_dir)
    return sorted(
        p for p in root.glob(f"{args.dataset}_*.zip")
        if p.is_file() and not p.name.startswith("._")
    )


def year_suffix(year: int) -> str:
    return str(year)[-2:]


def find_source(args: argparse.Namespace) -> SourceMatch:
    yy = year_suffix(args.year)
    for zip_path in candidate_zips(args):
        try:
            with zipfile.ZipFile(zip_path) as archive:
                members = archive.namelist()
                location_member = f"DMTI_SLI_{yy}.csv"
                if location_member not in members:
                    continue
                csv_members = [
                    member for member in members
                    if member.lower().endswith(".csv") and not member.startswith("DMTI_SLI_")
                ]
                for member in csv_members:
                    header = read_header(archive, member)
                    if not header:
                        continue
                    if header[0].lower() != f"postalcode{yy}":
                        continue
                    if args.all_variables:
                        variables = numeric_like_variables(archive, member, header[2:])
                        if variables:
                            return SourceMatch(zip_path, member, location_member, "allvars", variables, args.year)
                    elif args.variable:
                        if args.variable in header:
                            return SourceMatch(zip_path, member, location_member, args.variable, [args.variable], args.year)
                    else:
                        variable = choose_default_variable(archive, member, header)
                        if variable:
                            return SourceMatch(zip_path, member, location_member, variable, [variable], args.year)
        except zipfile.BadZipFile:
            continue
    requested = f"{args.dataset or args.zip_path} {args.year}"
    suffix = f" variable {args.variable}" if args.variable else ""
    raise SystemExit(f"No CANUE CSV found for {requested}{suffix}")


def read_header(archive: zipfile.ZipFile, member: str) -> list[str]:
    with archive.open(member) as raw:
        line = raw.readline().decode("utf-8-sig", "replace").strip()
    return next(csv.reader([line])) if line else []


def choose_default_variable(archive: zipfile.ZipFile, member: str, header: list[str]) -> str | None:
    candidates = [column for column in header[2:] if column]
    if not candidates:
        return None
    with archive.open(member) as raw:
        reader = csv.DictReader(line.decode("utf-8-sig", "replace") for line in raw)
        for row in reader:
            for column in candidates:
                if to_number(row.get(column)) is not None:
                    return column
    return candidates[0]


def numeric_like_variables(archive: zipfile.ZipFile, member: str, variables: list[str]) -> list[str]:
    numeric = []
    with archive.open(member) as raw:
        reader = csv.DictReader(line.decode("utf-8-sig", "replace") for line in raw)
        for row_index, row in enumerate(reader):
            for variable in variables:
                if variable in numeric:
                    continue
                if to_number(row.get(variable)) is not None:
                    numeric.append(variable)
            if row_index >= 5000 or len(numeric) == len(variables):
                break
    return numeric


def field_value(row: dict, *names: str):
    lower = {key.lower(): key for key in row}
    for name in names:
        key = lower.get(name.lower())
        if key is not None:
            return row.get(key)
    return None


def bbox_from_args(args: argparse.Namespace) -> tuple[float, float, float, float]:
    if args.bbox:
        values = [float(part) for part in args.bbox.split(",")]
        if len(values) != 4:
            raise SystemExit("--bbox must be minLon,minLat,maxLon,maxLat")
        min_lon, min_lat, max_lon, max_lat = values
        return min_lon, max_lon, min_lat, max_lat
    return VIEWS[args.view]


def load_locations(archive: zipfile.ZipFile, member: str, year: int, bbox: tuple[float, float, float, float]) -> dict[str, dict]:
    yy = year_suffix(year)
    lon_min, lon_max, lat_min, lat_max = bbox
    locations = {}
    with archive.open(member) as raw:
        reader = csv.DictReader(line.decode("utf-8-sig", "replace") for line in raw)
        for row in reader:
            province = str(field_value(row, f"PROV_{yy}", "prov", "province") or "").upper()
            if province != "BC":
                continue
            lat = to_number(field_value(row, f"LATITUDE_{yy}", "latitude", "lat"))
            lon = to_number(field_value(row, f"LONGITUDE_{yy}", "longitude", "lon", "lng"))
            if lat is None or lon is None:
                continue
            if not (lon_min <= lon <= lon_max and lat_min <= lat <= lat_max):
                continue
            postal_code = normalize_postal(field_value(row, f"POSTALCODE{yy}", "postalcode", "postal_code"))
            if not postal_code:
                continue
            locations[postal_code] = {
                "lat": lat,
                "lon": lon,
                "community": field_value(row, f"COMM_NAME_{yy}", "community") or "",
            }
    return locations


def normalize_postal(value: str | None) -> str:
    return "".join(str(value or "").upper().split())


def to_number(value: str | None) -> float | None:
    text = str(value or "").strip()
    if text in NULL_VALUES:
        return None
    try:
        number = float(text)
    except ValueError:
        return None
    return number if math.isfinite(number) else None


def iter_rows(match: SourceMatch, bbox: tuple[float, float, float, float]) -> Iterable[dict]:
    yy = year_suffix(match.year)
    with zipfile.ZipFile(match.zip_path) as archive:
        locations = load_locations(archive, match.location_member, match.year, bbox)
        with archive.open(match.value_member) as raw:
            reader = csv.DictReader(line.decode("utf-8-sig", "replace") for line in raw)
            postal_field = f"postalcode{yy}"
            for row in reader:
                postal_code = normalize_postal(row.get(postal_field))
                location = locations.get(postal_code)
                if not location:
                    continue
                values = {
                    variable: value
                    for variable in match.variables
                    if (value := to_number(row.get(variable))) is not None
                }
                if not values:
                    continue
                yield {
                    "postalcode": postal_code,
                    "lon": location["lon"],
                    "lat": location["lat"],
                    "community": location["community"],
                    "value": values.get(match.variable) if len(match.variables) == 1 else None,
                    "values": values,
                }


def grid_steps(grid_km: float, center_lat: float) -> tuple[float, float]:
    lat_step = grid_km / 111.32
    lon_step = grid_km / (111.32 * max(math.cos(math.radians(center_lat)), 0.1))
    return lon_step, lat_step


def grid_feature(cell: tuple[int, int], stats: dict, match: SourceMatch, args: argparse.Namespace, bbox: tuple[float, float, float, float]):
    lon_min, _, lat_min, _ = bbox
    center_lat = stats["lat_sum"] / stats["count"]
    lon_step, lat_step = grid_steps(args.grid_km, center_lat)
    ix, iy = cell
    west = lon_min + ix * lon_step
    south = lat_min + iy * lat_step
    east = west + lon_step
    north = south + lat_step
    properties = {
        "dataset": archive_dataset_id(match.zip_path),
        "year": match.year,
        "variable": match.variable,
        "count": stats["count"],
        "grid_km": args.grid_km,
    }
    if len(match.variables) == 1:
        variable_name = match.variables[0]
        variable_stats = stats["variables"][variable_name]
        mean = variable_stats["sum"] / variable_stats["count"]
        properties.update({
            "value": round(mean, 6),
            "min": round(variable_stats["min"], 6),
            "max": round(variable_stats["max"], 6),
        })
    else:
        for variable, variable_stats in stats["variables"].items():
            properties[variable] = round(variable_stats["sum"] / variable_stats["count"], 6)

    return {
        "type": "Feature",
        "geometry": {
            "type": "Polygon",
            "coordinates": [[
                [west, south], [east, south], [east, north], [west, north], [west, south],
            ]],
        },
        "properties": properties,
    }


def write_features(match: SourceMatch, args: argparse.Namespace, output_path: Path) -> dict:
    bbox = bbox_from_args(args)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    feature_count = 0
    row_count = 0
    value_min = None
    value_max = None
    variable_stats = {
        variable: {"count": 0, "min": None, "max": None}
        for variable in match.variables
    }

    with output_path.open("w", encoding="utf-8") as out:
        if args.mode == "points":
            for row in iter_rows(match, bbox):
                properties = {
                    "dataset": archive_dataset_id(match.zip_path),
                    "year": match.year,
                    "variable": match.variable,
                    "community": row["community"],
                }
                if len(match.variables) == 1:
                    properties["value"] = row["value"]
                else:
                    properties.update(row["values"])
                if args.include_postalcode:
                    properties["postalcode"] = row["postalcode"]
                feature = {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [row["lon"], row["lat"]]},
                    "properties": properties,
                }
                out.write(json.dumps(feature, separators=(",", ":")) + "\n")
                feature_count += 1
                row_count += 1
                for variable, value in row["values"].items():
                    stats = variable_stats[variable]
                    stats["count"] += 1
                    stats["min"] = value if stats["min"] is None else min(stats["min"], value)
                    stats["max"] = value if stats["max"] is None else max(stats["max"], value)
                    if len(match.variables) == 1:
                        value_min = value if value_min is None else min(value_min, value)
                        value_max = value if value_max is None else max(value_max, value)
        else:
            lon_min, _, lat_min, _ = bbox
            center_lat = (bbox[2] + bbox[3]) / 2
            lon_step, lat_step = grid_steps(args.grid_km, center_lat)
            cells = {}
            for row in iter_rows(match, bbox):
                ix = math.floor((row["lon"] - lon_min) / lon_step)
                iy = math.floor((row["lat"] - lat_min) / lat_step)
                stats = cells.setdefault((ix, iy), {
                    "count": 0,
                    "lat_sum": 0.0,
                    "variables": {},
                })
                stats["count"] += 1
                stats["lat_sum"] += row["lat"]
                for variable, value in row["values"].items():
                    variable_cell = stats["variables"].setdefault(variable, {
                        "count": 0, "sum": 0.0, "min": value, "max": value,
                    })
                    variable_cell["count"] += 1
                    variable_cell["sum"] += value
                    variable_cell["min"] = min(variable_cell["min"], value)
                    variable_cell["max"] = max(variable_cell["max"], value)
                    global_stats = variable_stats[variable]
                    global_stats["count"] += 1
                    global_stats["min"] = value if global_stats["min"] is None else min(global_stats["min"], value)
                    global_stats["max"] = value if global_stats["max"] is None else max(global_stats["max"], value)
                    if len(match.variables) == 1:
                        value_min = value if value_min is None else min(value_min, value)
                        value_max = value if value_max is None else max(value_max, value)
                row_count += 1
            for cell, stats in sorted(cells.items()):
                feature = grid_feature(cell, stats, match, args, bbox)
                out.write(json.dumps(feature, separators=(",", ":")) + "\n")
                feature_count += 1

    return {
        "dataset": archive_dataset_id(match.zip_path),
        "sourceZip": str(match.zip_path),
        "valueMember": match.value_member,
        "locationMember": match.location_member,
        "year": match.year,
        "variable": match.variable,
        "variables": match.variables,
        "variableCount": len(match.variables),
        "mode": args.mode,
        "view": args.view,
        "gridKm": args.grid_km if args.mode == "grid" else None,
        "sourceRows": row_count,
        "features": feature_count,
        "min": value_min,
        "max": value_max,
        "variableStats": variable_stats,
        "ndjson": str(output_path),
    }


def build_tiles(ndjson_path: Path, manifest: dict, args: argparse.Namespace) -> None:
    tippecanoe = shutil.which("tippecanoe")
    pmtiles = shutil.which("pmtiles")
    if not tippecanoe:
        print("tippecanoe not found; wrote NDJSON only")
        return

    output_dir = ndjson_path.parent
    mbtiles_path = output_dir / f"{ndjson_path.stem}.mbtiles"
    pmtiles_path = output_dir / f"{ndjson_path.stem}.pmtiles"
    command = [
        tippecanoe,
        "-o", str(mbtiles_path),
        "-l", args.layer,
        "--force",
        "--minimum-zoom", str(args.minzoom),
        "--maximum-zoom", str(args.maxzoom),
        "--drop-densest-as-needed",
        str(ndjson_path),
    ]
    subprocess.run(command, check=True)
    manifest["mbtiles"] = str(mbtiles_path)

    if pmtiles:
        subprocess.run([pmtiles, "convert", str(mbtiles_path), str(pmtiles_path)], check=True)
        manifest["pmtiles"] = str(pmtiles_path)
    else:
        print("pmtiles CLI not found; wrote MBTiles only")


def safe_name(value: str) -> str:
    return "".join(char if char.isalnum() or char in "-_" else "-" for char in value).strip("-")


def main() -> None:
    args = parse_args()
    match = find_source(args)
    dataset = archive_dataset_id(match.zip_path)
    stem = safe_name(f"{dataset}_{match.year}_{match.variable}_{args.mode}_{args.view}")
    output_dir = Path(args.output_dir)
    ndjson_path = output_dir / f"{stem}.geojsonseq"
    manifest = write_features(match, args, ndjson_path)

    if args.pmtiles:
        with tempfile.TemporaryDirectory():
            build_tiles(ndjson_path, manifest, args)

    manifest_path = output_dir / f"{stem}.manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
