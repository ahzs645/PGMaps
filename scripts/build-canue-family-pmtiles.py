#!/usr/bin/env python3
"""Build optimized CANUE family-year PMTiles.

This v2 builder merges all available datasets in a family for a single year
onto one stable 1 km grid. Tile features contain only numeric value properties
by default; constants and source metadata are written to manifests/catalogs.
"""

from __future__ import annotations

import argparse
import csv
import importlib.util
import json
import math
import shutil
import subprocess
import sys
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any


DEFAULT_PLAN = "docs/canue-map-layer-plan-bc.json"
DEFAULT_SOURCE_DIR = "/Volumes/Main/2026 pull/zip"
DEFAULT_OUTPUT_DIR = "/Volumes/Main/canue-pmtiles-bc-v2"
DEFAULT_R2_ENDPOINT = "https://479e77f49d4ac5d7498529ee360f194b.r2.cloudflarestorage.com"
DEFAULT_R2_BUCKET = "maps"
DEFAULT_R2_PREFIX = "canue/pmtiles-v2"
DEFAULT_PUBLIC_BASE_URL = "https://data.map.ahmad.sh"
DEFAULT_LAYER = "canue"

VIEWS = {
    "bc": (-139.5, -113.5, 47.5, 60.5),
    "pg": (-123.35, -122.25, 53.55, 54.25),
}

FAMILY_ORDER = {
    "air-quality": 10,
    "weather-thermal": 20,
    "weather-biometeorology": 30,
    "greenness": 40,
    "built-environment": 50,
    "neighborhood": 60,
    "other": 99,
}

FAMILY_LABELS = {
    "air-quality": "Air Quality",
    "weather-thermal": "Weather and Thermal Exposure",
    "weather-biometeorology": "Weather Biometeorology",
    "greenness": "Greenness and Vegetation",
    "built-environment": "Built Environment",
    "neighborhood": "Neighborhood Context",
    "other": "Other CANUE Layers",
}


@dataclass
class DatasetSelection:
    dataset: str
    year: int
    metadata: dict[str, Any] | None
    metadata_pdfs: list[str]
    source_archives: list[str]


@dataclass
class SourceMatch:
    source_path: Path
    source_kind: str
    value_member: str
    location_member: str
    variable: str
    variables: list[str]
    year: int


def load_v1_module():
    path = Path(__file__).with_name("build-canue-map-layer.py")
    spec = importlib.util.spec_from_file_location("canue_map_layer", path)
    if spec is None or spec.loader is None:
        raise SystemExit(f"Could not load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def family_for(dataset: str) -> tuple[str, str]:
    if dataset.startswith(("aq", "pm25", "no2", "o3", "so2")):
        return "air-quality", FAMILY_LABELS["air-quality"]
    if dataset.startswith("wtwbm_"):
        return "weather-biometeorology", FAMILY_LABELS["weather-biometeorology"]
    if dataset.startswith(("wtutv_", "wthnrc", "wbnrc", "wtfsi", "wtlst", "dtr_", "dtw_")):
        return "weather-thermal", FAMILY_LABELS["weather-thermal"]
    if dataset.startswith(("grlan_", "grmod_", "gravh_", "grtcc_", "grump_")):
        return "greenness", FAMILY_LABELS["greenness"]
    if dataset.startswith(("ale_", "cmg_", "indmsd_", "lcz_", "gen_", "nae_")):
        return "built-environment", FAMILY_LABELS["built-environment"]
    if dataset.startswith("nh"):
        return "neighborhood", FAMILY_LABELS["neighborhood"]
    return "other", FAMILY_LABELS["other"]


def dataset_label(dataset: str) -> str:
    known = {
        "aqfpm": "Fine particulate matter",
        "pm25dal": "PM2.5 DAL",
        "no2lur": "NO2 land-use regression",
        "o3chg": "Ozone change",
        "wtutv": "Universal thermal climate index",
        "wtwbm": "Weather biometeorology",
        "grlan": "Land greenness",
        "grmod": "Modeled greenness",
        "nh": "Neighborhood context",
    }
    for prefix, label in known.items():
        if dataset.startswith(prefix):
            suffix = dataset[len(prefix):].strip("_")
            return f"{label} {suffix}".strip()
    return dataset.replace("_", " ").upper()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", default=DEFAULT_PLAN)
    parser.add_argument("--source-dir", default=DEFAULT_SOURCE_DIR)
    parser.add_argument("--output-dir", default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--family", action="append", choices=sorted(FAMILY_LABELS))
    parser.add_argument("--year", type=int, action="append")
    parser.add_argument("--all-families", action="store_true")
    parser.add_argument("--all-years", action="store_true")
    parser.add_argument("--view", choices=sorted(VIEWS), default="bc")
    parser.add_argument("--bbox", help="Custom bbox as minLon,minLat,maxLon,maxLat")
    parser.add_argument("--mode", choices=["grid"], default="grid")
    parser.add_argument("--grid-km", type=float, default=1.0)
    parser.add_argument("--minzoom", type=int, default=5)
    parser.add_argument("--maxzoom", type=int, default=12)
    parser.add_argument("--layer", default=DEFAULT_LAYER)
    parser.add_argument("--skip-existing", action="store_true")
    parser.add_argument("--continue-on-error", action="store_true")
    parser.add_argument("--keep-intermediates", action="store_true")
    parser.add_argument("--include-cell-id", action="store_true")
    parser.add_argument("--include-counts", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--upload", action="store_true")
    parser.add_argument("--r2-endpoint", default=DEFAULT_R2_ENDPOINT)
    parser.add_argument("--r2-bucket", default=DEFAULT_R2_BUCKET)
    parser.add_argument("--r2-prefix", default=DEFAULT_R2_PREFIX)
    parser.add_argument("--public-base-url", default=DEFAULT_PUBLIC_BASE_URL)
    parser.add_argument("--aws-profile", default="r2")
    return parser.parse_args()


def load_plan(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise SystemExit(f"Plan not found: {path}")


def bbox_from_args(args: argparse.Namespace) -> tuple[float, float, float, float]:
    if args.bbox:
        parts = [float(part) for part in args.bbox.split(",")]
        if len(parts) != 4:
            raise SystemExit("--bbox must be minLon,minLat,maxLon,maxLat")
        min_lon, min_lat, max_lon, max_lat = parts
        return min_lon, max_lon, min_lat, max_lat
    return VIEWS[args.view]


def grid_steps(grid_km: float, bbox: tuple[float, float, float, float]) -> tuple[float, float]:
    center_lat = (bbox[2] + bbox[3]) / 2
    lat_step = grid_km / 111.32
    lon_step = grid_km / (111.32 * max(math.cos(math.radians(center_lat)), 0.1))
    return lon_step, lat_step


def selected_family_years(plan: dict[str, Any], args: argparse.Namespace) -> list[tuple[str, int]]:
    requested_families = set(args.family or [])
    if args.all_families:
        requested_families = set(FAMILY_LABELS)
    requested_years = set(args.year or [])
    family_years: set[tuple[str, int]] = set()

    for dataset in plan.get("datasets", []):
        dataset_id = dataset.get("datasetId")
        if not dataset_id:
            continue
        family_id, _ = family_for(dataset_id)
        if requested_families and family_id not in requested_families:
            continue
        years = sorted(set(dataset.get("years") or []))
        if requested_years:
            years = [year for year in years if year in requested_years]
        elif years and not args.all_years:
            years = [max(years)]
        for year in years:
            family_years.add((family_id, year))

    return sorted(family_years, key=lambda item: (FAMILY_ORDER.get(item[0], 99), item[0], item[1]))


def dataset_selections(plan: dict[str, Any], family: str, year: int) -> list[DatasetSelection]:
    selections = []
    for dataset in plan.get("datasets", []):
        dataset_id = dataset.get("datasetId")
        if not dataset_id or family_for(dataset_id)[0] != family:
            continue
        by_year = (
            dataset.get("numericVariablesByYear", {}).get(str(year))
            or dataset.get("variablesByYear", {}).get(str(year))
            or []
        )
        if not by_year:
            continue
        selections.append(DatasetSelection(
            dataset=dataset_id,
            year=year,
            metadata=dataset.get("metadata"),
            metadata_pdfs=dataset.get("metadataPdfs") or [],
            source_archives=dataset.get("sourceArchives") or [],
        ))
    return selections


def property_name(dataset: str, variable: str) -> str:
    return f"{dataset}__{variable}"


def source_dataset_id(path: Path) -> str:
    name = path.name[:-4] if path.suffix == ".zip" else path.name
    return name.split("_2026-")[0]


def candidate_dirs(source_dir: Path, dataset: str) -> list[Path]:
    if source_dir.name == "zip":
        source_dir = source_dir.parent
    return sorted(
        path for path in source_dir.glob(f"{dataset}_*")
        if path.is_dir() and not path.name.startswith("._")
    )


def read_header_path(path: Path) -> list[str]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        line = handle.readline().strip()
    return next(csv.reader([line])) if line else []


def numeric_like_variables_path(path: Path, variables: list[str], v1) -> list[str]:
    numeric = []
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        for row_index, row in enumerate(reader):
            for variable in variables:
                if variable in numeric:
                    continue
                if v1.to_number(row.get(variable)) is not None:
                    numeric.append(variable)
            if row_index >= 5000 or len(numeric) == len(variables):
                break
    return numeric


def find_unzipped_match(v1, selection: DatasetSelection, args: argparse.Namespace) -> SourceMatch | None:
    yy = v1.year_suffix(selection.year)
    for folder in candidate_dirs(Path(args.source_dir), selection.dataset):
        location_path = folder / f"DMTI_SLI_{yy}.csv"
        if not location_path.exists():
            continue
        for value_path in sorted(folder.glob("*.csv")):
            if value_path.name.startswith("DMTI_SLI_") or value_path.name.startswith("._"):
                continue
            header = read_header_path(value_path)
            if not header or header[0].lower() != f"postalcode{yy}":
                continue
            variables = numeric_like_variables_path(value_path, header[2:], v1)
            if variables:
                return SourceMatch(
                    source_path=folder,
                    source_kind="directory",
                    value_member=value_path.name,
                    location_member=location_path.name,
                    variable="allvars",
                    variables=variables,
                    year=selection.year,
                )
    return None


def find_match(v1, selection: DatasetSelection, args: argparse.Namespace):
    unzipped = find_unzipped_match(v1, selection, args)
    if unzipped:
        return unzipped
    match_args = argparse.Namespace(
        source_dir=args.source_dir,
        zip_path=None,
        dataset=selection.dataset,
        year=selection.year,
        variable=None,
        all_variables=True,
    )
    match = v1.find_source(match_args)
    return SourceMatch(
        source_path=match.zip_path,
        source_kind="zip",
        value_member=match.value_member,
        location_member=match.location_member,
        variable=match.variable,
        variables=match.variables,
        year=match.year,
    )


def field_value(row: dict[str, Any], *names: str) -> Any:
    lower = {key.lower(): key for key in row}
    for name in names:
        key = lower.get(name.lower())
        if key is not None:
            return row.get(key)
    return None


def load_locations_path(path: Path, year: int, bbox: tuple[float, float, float, float], v1) -> dict[str, dict[str, Any]]:
    yy = v1.year_suffix(year)
    lon_min, lon_max, lat_min, lat_max = bbox
    locations = {}
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            province = str(field_value(row, f"PROV_{yy}", "prov", "province") or "").upper()
            if province != "BC":
                continue
            lat = v1.to_number(field_value(row, f"LATITUDE_{yy}", "latitude", "lat"))
            lon = v1.to_number(field_value(row, f"LONGITUDE_{yy}", "longitude", "lon", "lng"))
            if lat is None or lon is None:
                continue
            if not (lon_min <= lon <= lon_max and lat_min <= lat <= lat_max):
                continue
            postal_code = v1.normalize_postal(field_value(row, f"POSTALCODE{yy}", "postalcode", "postal_code"))
            if postal_code:
                locations[postal_code] = {"lat": lat, "lon": lon, "community": field_value(row, f"COMM_NAME_{yy}", "community") or ""}
    return locations


def iter_unzipped_rows(match: SourceMatch, bbox: tuple[float, float, float, float], v1):
    yy = v1.year_suffix(match.year)
    folder = match.source_path
    locations = load_locations_path(folder / match.location_member, match.year, bbox, v1)
    with (folder / match.value_member).open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        postal_field = f"postalcode{yy}"
        for row in reader:
            postal_code = v1.normalize_postal(row.get(postal_field))
            location = locations.get(postal_code)
            if not location:
                continue
            values = {
                variable: value
                for variable in match.variables
                if (value := v1.to_number(row.get(variable))) is not None
            }
            if values:
                yield {
                    "postalcode": postal_code,
                    "lon": location["lon"],
                    "lat": location["lat"],
                    "community": location["community"],
                    "value": None,
                    "values": values,
                }


def iter_match_rows(match: SourceMatch, bbox: tuple[float, float, float, float], v1):
    if match.source_kind == "directory":
        yield from iter_unzipped_rows(match, bbox, v1)
        return
    with zipfile.ZipFile(match.source_path) as archive:
        locations = v1.load_locations(archive, match.location_member, match.year, bbox)
        yy = v1.year_suffix(match.year)
        with archive.open(match.value_member) as raw:
            reader = csv.DictReader(line.decode("utf-8-sig", "replace") for line in raw)
            postal_field = f"postalcode{yy}"
            for row in reader:
                postal_code = v1.normalize_postal(row.get(postal_field))
                location = locations.get(postal_code)
                if not location:
                    continue
                values = {
                    variable: value
                    for variable in match.variables
                    if (value := v1.to_number(row.get(variable))) is not None
                }
                if values:
                    yield {
                        "postalcode": postal_code,
                        "lon": location["lon"],
                        "lat": location["lat"],
                        "community": location["community"],
                        "value": None,
                        "values": values,
                    }


def build_family_features(v1, family: str, year: int, selections: list[DatasetSelection], args: argparse.Namespace, ndjson_path: Path) -> dict[str, Any]:
    bbox = bbox_from_args(args)
    lon_min, _, lat_min, _ = bbox
    lon_step, lat_step = grid_steps(args.grid_km, bbox)
    cells: dict[tuple[int, int], dict[str, Any]] = {}
    datasets = []
    variables = []
    missing = []
    source_rows = 0

    for selection in selections:
        try:
            match = find_match(v1, selection, args)
        except SystemExit as error:
            missing.append({
                "dataset": selection.dataset,
                "year": year,
                "family": family,
                "reason": str(error),
            })
            continue

        dataset = source_dataset_id(match.source_path)
        dataset_entry = {
            "dataset": dataset,
            "label": dataset_label(dataset),
            "sourcePath": str(match.source_path),
            "sourceKind": match.source_kind,
            "sourceArchive": match.source_path.name,
            "valueMember": match.value_member,
            "locationMember": match.location_member,
            "metadata": selection.metadata,
            "metadataPdfs": selection.metadata_pdfs,
            "sourceArchives": selection.source_archives,
        }
        datasets.append(dataset_entry)

        for variable in match.variables:
            variables.append({
                "property": property_name(dataset, variable),
                "dataset": dataset,
                "variable": variable,
                "metadataRef": dataset,
            })

        for row in iter_match_rows(match, bbox, v1):
            ix = math.floor((row["lon"] - lon_min) / lon_step)
            iy = math.floor((row["lat"] - lat_min) / lat_step)
            cell = cells.setdefault((ix, iy), {"count": 0, "variables": {}})
            cell["count"] += 1
            source_rows += 1
            for variable, value in row["values"].items():
                prop = property_name(dataset, variable)
                stats = cell["variables"].setdefault(prop, {"count": 0, "sum": 0.0, "min": value, "max": value})
                stats["count"] += 1
                stats["sum"] += value
                stats["min"] = min(stats["min"], value)
                stats["max"] = max(stats["max"], value)

    ndjson_path.parent.mkdir(parents=True, exist_ok=True)
    feature_count = 0
    variable_stats: dict[str, dict[str, Any]] = {
        item["property"]: {
            "dataset": item["dataset"],
            "variable": item["variable"],
            "count": 0,
            "min": None,
            "max": None,
        }
        for item in variables
    }
    with ndjson_path.open("w", encoding="utf-8") as out:
        for (ix, iy), cell in sorted(cells.items()):
            west = lon_min + ix * lon_step
            south = lat_min + iy * lat_step
            east = west + lon_step
            north = south + lat_step
            properties = {}
            if args.include_cell_id:
                properties["cell_id"] = f"{ix}:{iy}"
            if args.include_counts:
                properties["count"] = cell["count"]
            for prop, stats in sorted(cell["variables"].items()):
                value = round(stats["sum"] / stats["count"], 6)
                properties[prop] = value
                global_stats = variable_stats.get(prop)
                if global_stats:
                    global_stats["count"] += stats["count"]
                    global_stats["min"] = stats["min"] if global_stats["min"] is None else min(global_stats["min"], stats["min"])
                    global_stats["max"] = stats["max"] if global_stats["max"] is None else max(global_stats["max"], stats["max"])

            feature = {
                "type": "Feature",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[
                        [west, south], [east, south], [east, north], [west, north], [west, south],
                    ]],
                },
                "properties": properties,
            }
            out.write(json.dumps(feature, separators=(",", ":")) + "\n")
            feature_count += 1

    return {
        "generatedBy": "scripts/build-canue-family-pmtiles.py",
        "family": family,
        "familyLabel": FAMILY_LABELS[family],
        "year": year,
        "view": args.view,
        "mode": args.mode,
        "gridKm": args.grid_km,
        "bbox": {"minLon": bbox[0], "maxLon": bbox[1], "minLat": bbox[2], "maxLat": bbox[3]},
        "grid": {"lonStep": lon_step, "latStep": lat_step},
        "datasets": datasets,
        "datasetIds": sorted({dataset["dataset"] for dataset in datasets}),
        "variables": variables,
        "variableCount": len(variables),
        "sourceRows": source_rows,
        "features": feature_count,
        "missing": missing,
        "variableStats": variable_stats,
        "ndjson": str(ndjson_path),
    }


def require_tool(name: str) -> str:
    path = shutil.which(name)
    if not path:
        raise SystemExit(f"{name} is required")
    return path


def build_tiles(ndjson_path: Path, manifest: dict[str, Any], args: argparse.Namespace) -> None:
    tippecanoe = require_tool("tippecanoe")
    pmtiles = require_tool("pmtiles")
    mbtiles_path = ndjson_path.with_suffix(".mbtiles")
    pmtiles_path = ndjson_path.with_suffix(".pmtiles")
    command = [
        tippecanoe,
        "-o", str(mbtiles_path),
        "-l", args.layer,
        "--force",
        "--minimum-zoom", str(args.minzoom),
        "--maximum-zoom", str(args.maxzoom),
        "--no-feature-limit",
        "--no-tile-size-limit",
        str(ndjson_path),
    ]
    print("+ " + " ".join(command))
    subprocess.run(command, check=True)
    print("+ " + " ".join([pmtiles, "convert", str(mbtiles_path), str(pmtiles_path)]))
    subprocess.run([pmtiles, "convert", str(mbtiles_path), str(pmtiles_path)], check=True)
    manifest["mbtiles"] = str(mbtiles_path)
    manifest["pmtiles"] = str(pmtiles_path)


def add_public_url(manifest: dict[str, Any], args: argparse.Namespace) -> None:
    if not manifest.get("pmtiles"):
        return
    path = Path(manifest["pmtiles"])
    public_path = f"{args.r2_prefix.strip('/')}/{manifest['family']}/{path.name}"
    manifest["publicPath"] = public_path
    manifest["publicUrl"] = f"{args.public_base_url.rstrip('/')}/{public_path}"


def upload_pmtiles(manifest: dict[str, Any], args: argparse.Namespace) -> None:
    if not manifest.get("pmtiles"):
        return
    require_tool("aws")
    path = Path(manifest["pmtiles"])
    dest = f"s3://{args.r2_bucket}/{args.r2_prefix.strip('/')}/{manifest['family']}/{path.name}"
    command = [
        "aws", "s3", "cp", str(path), dest,
        "--profile", args.aws_profile,
        "--endpoint-url", args.r2_endpoint,
        "--content-type", "application/vnd.pmtiles",
        "--cache-control", "public,max-age=31536000,immutable",
    ]
    print("+ " + " ".join(command))
    subprocess.run(command, check=True)


def cleanup_intermediates(manifest: dict[str, Any]) -> None:
    for key in ("ndjson", "mbtiles"):
        value = manifest.get(key)
        if value and Path(value).exists():
            Path(value).unlink()


def build_one(v1, plan: dict[str, Any], family: str, year: int, args: argparse.Namespace) -> dict[str, Any]:
    family_dir = Path(args.output_dir) / family
    stem = f"{family}_{year}_{args.mode}_{args.view}"
    manifest_path = family_dir / f"{stem}.manifest.json"
    pmtiles_path = family_dir / f"{stem}.pmtiles"
    if args.skip_existing and manifest_path.exists() and pmtiles_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        add_public_url(manifest, args)
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        print(f"Skipping existing {pmtiles_path}")
        return manifest

    selections = dataset_selections(plan, family, year)
    if not selections:
        raise RuntimeError(f"No datasets selected for {family} {year}")

    ndjson_path = family_dir / f"{stem}.geojsonseq"
    manifest = build_family_features(v1, family, year, selections, args, ndjson_path)
    if manifest["features"] <= 0:
        raise RuntimeError(f"No features built for {family} {year}")
    build_tiles(ndjson_path, manifest, args)
    add_public_url(manifest, args)
    family_dir.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    if not args.keep_intermediates:
        cleanup_intermediates(manifest)
    if args.upload:
        upload_pmtiles(manifest, args)
    print(json.dumps({
        "family": family,
        "year": year,
        "features": manifest["features"],
        "datasets": len(manifest["datasets"]),
        "variables": manifest["variableCount"],
        "missing": len(manifest["missing"]),
        "pmtiles": manifest.get("pmtiles"),
    }, indent=2))
    return manifest


def write_report(manifests: list[dict[str, Any]], failures: list[dict[str, Any]], args: argparse.Namespace) -> Path:
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    pmtiles = [Path(manifest["pmtiles"]) for manifest in manifests if manifest.get("pmtiles")]
    report = {
        "generatedBy": "scripts/build-canue-family-pmtiles.py",
        "version": 2,
        "view": args.view,
        "mode": args.mode,
        "gridKm": args.grid_km,
        "r2Prefix": args.r2_prefix.strip("/"),
        "layers": len(manifests),
        "families": sorted({manifest["family"] for manifest in manifests}),
        "pmtiles": {
            "count": len(pmtiles),
            "bytes": sum(path.stat().st_size for path in pmtiles if path.exists()),
        },
        "missing": [missing for manifest in manifests for missing in manifest.get("missing", [])],
        "failures": failures,
    }
    path = output_dir / f"canue-{args.view}-{args.mode}-v2-build-report.json"
    path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return path


def main() -> None:
    args = parse_args()
    plan = load_plan(Path(args.plan))
    selections = selected_family_years(plan, args)
    if not selections:
        raise SystemExit("No family/year layers selected")
    print(f"Selected {len(selections)} family-year layer(s)")
    for family, year in selections:
        print(f"- {family} {year}")
    if args.dry_run:
        return

    v1 = load_v1_module()
    manifests = []
    failures = []
    for index, (family, year) in enumerate(selections, start=1):
        print(f"[{index}/{len(selections)}] {family} {year}")
        try:
            manifests.append(build_one(v1, plan, family, year, args))
        except Exception as error:
            failure = {"family": family, "year": year, "error": str(error)}
            failures.append(failure)
            print(f"ERROR: {json.dumps(failure)}", file=sys.stderr)
            if not args.continue_on_error:
                raise

    report_path = write_report(manifests, failures, args)
    print(f"Wrote {report_path}")


if __name__ == "__main__":
    main()
