#!/usr/bin/env python3
"""Inventory CANUE ZIPs for future grid/PMTiles builds.

This script does not generate map layers. It scans source ZIP headers and writes
a build-plan JSON with datasets, years, variables, source archives, metadata,
and optional point-count estimates for a target map view.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import zipfile
from collections import Counter, defaultdict
from pathlib import Path


DEFAULT_SOURCE_DIR = "/Volumes/Main/2026 pull/zip"
DEFAULT_METADATA = "/Users/ahmadjalil/github/canuechrome/canue_metadata/downloaded_datasets_metadata.json"
DEFAULT_VARIABLE_METADATA = "/Users/ahmadjalil/github/canuechrome/canue_metadata/downloaded_dataset_variables.csv"
DEFAULT_OUTPUT = "docs/canue-map-layer-plan.json"

VIEWS = {
    "bc": (-139.5, -113.5, 47.5, 60.5),
    "pg": (-123.35, -122.25, 53.55, 54.25),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", default=DEFAULT_SOURCE_DIR)
    parser.add_argument("--metadata", default=DEFAULT_METADATA)
    parser.add_argument("--variable-metadata", default=DEFAULT_VARIABLE_METADATA)
    parser.add_argument("--output", default=DEFAULT_OUTPUT)
    parser.add_argument("--view", choices=sorted(VIEWS), default="pg")
    parser.add_argument("--bbox", help="Custom bbox as minLon,minLat,maxLon,maxLat")
    parser.add_argument("--estimate-counts", action="store_true", help="Count postal-code locations by year in the selected view")
    parser.add_argument("--max-variables", type=int, default=0, help="Optional cap per dataset for quick planning")
    return parser.parse_args()


def archive_dataset_id(zip_path: Path) -> str:
    return zip_path.name.replace(".zip", "").split("_2026-")[0]


def archive_cadence(zip_path: Path) -> str:
    if zip_path.name.endswith("_monthly.zip"):
        return "monthly"
    if zip_path.name.endswith("_annual.zip"):
        return "annual"
    return "unknown"


def year_from_member(member: str) -> int | None:
    stem = Path(member).stem
    suffix = stem.rsplit("_", 1)[-1]
    if not suffix.isdigit() or len(suffix) != 2:
        return None
    year = int(suffix)
    return 1900 + year if year >= 80 else 2000 + year


def bbox_from_args(args: argparse.Namespace) -> tuple[float, float, float, float]:
    if args.bbox:
        values = [float(part) for part in args.bbox.split(",")]
        if len(values) != 4:
            raise SystemExit("--bbox must be minLon,minLat,maxLon,maxLat")
        min_lon, min_lat, max_lon, max_lat = values
        return min_lon, max_lon, min_lat, max_lat
    return VIEWS[args.view]


def read_header(archive: zipfile.ZipFile, member: str) -> list[str]:
    with archive.open(member) as raw:
        line = raw.readline().decode("utf-8-sig", "replace").strip()
    return next(csv.reader([line])) if line else []


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
            if row_index >= 30 or len(numeric) == len(variables):
                break
    return numeric


def to_number(value: str | None) -> float | None:
    text = str(value or "").strip()
    if text in {"", "NULL", "-9999", "-9999.0", "-9999.00"}:
        return None
    try:
        number = float(text)
    except ValueError:
        return None
    return number if math.isfinite(number) else None


def location_count(archive: zipfile.ZipFile, member: str, year: int, bbox: tuple[float, float, float, float]) -> int:
    yy = str(year)[-2:]
    lon_min, lon_max, lat_min, lat_max = bbox
    count = 0
    with archive.open(member) as raw:
        reader = csv.DictReader(line.decode("utf-8-sig", "replace") for line in raw)
        for row in reader:
            if (row.get(f"PROV_{yy}") or "").upper() != "BC":
                continue
            lat = to_number(row.get(f"LATITUDE_{yy}"))
            lon = to_number(row.get(f"LONGITUDE_{yy}"))
            if lat is None or lon is None:
                continue
            if lon_min <= lon <= lon_max and lat_min <= lat <= lat_max:
                count += 1
    return count


def metadata_by_archive(metadata_path: Path) -> dict[str, dict]:
    try:
        rows = json.loads(metadata_path.read_text())
    except Exception:
        return {}
    result = {}
    for row in rows if isinstance(rows, list) else []:
        for entry in str(row.get("manifest_files") or "").split(";"):
            name = Path(entry.strip()).name
            if name:
                result[name] = row
    return result


def load_variable_metadata(variable_metadata_path: Path) -> list[dict]:
    try:
        with variable_metadata_path.open(newline="", encoding="utf-8-sig") as handle:
            return list(csv.DictReader(handle))
    except Exception:
        return []


def variable_metadata_by_code(rows: list[dict]) -> dict[str, list[dict]]:
    result = defaultdict(list)
    for row in rows:
        code = row.get("variable_code")
        if code:
            result[code].append(row)
    return result


def variable_prefix(variable: str) -> str:
    prefix = variable.split("_", 1)[0]
    return "".join(char for char in prefix if not char.isdigit())


def compact_variable_metadata(rows: list[dict]) -> dict | None:
    if not rows:
        return None
    def unique(field: str) -> list[str]:
        return sorted({str(row[field]) for row in rows if row.get(field)})
    return {
        "categories": unique("category"),
        "datasetNames": unique("dataset_name"),
        "variableCodes": unique("variable_code"),
        "variableNames": unique("variable_name"),
        "variableYears": unique("variable_years"),
        "tableCodes": unique("table_code"),
    }


def compact_metadata(rows: list[dict]) -> dict | None:
    if not rows:
        return None
    def unique(field: str) -> list[str]:
        return sorted({str(row[field]) for row in rows if row.get(field)})
    return {
        "categories": unique("category"),
        "downloadNames": unique("download_name"),
        "portalNames": unique("portal_name"),
        "shortCodes": unique("short_code"),
        "yearCoverage": unique("download_year_coverage"),
        "samplingFrequency": unique("sampling_frequency"),
        "descriptions": unique("description"),
        "sharingRestrictions": unique("sharing_restrictions"),
    }


def metadata_pdf_members(members: list[str]) -> list[str]:
    return sorted(
        member for member in members
        if member.lower().endswith(".pdf") and "metadata" in member.lower()
    )


def scan_zip(zip_path: Path, metadata_lookup: dict[str, dict], bbox: tuple[float, float, float, float], estimate_counts: bool) -> dict:
    dataset_id = archive_dataset_id(zip_path)
    source = {
        "archive": zip_path.name,
        "path": str(zip_path),
        "sizeBytes": zip_path.stat().st_size,
        "cadence": archive_cadence(zip_path),
        "members": [],
    }
    with zipfile.ZipFile(zip_path) as archive:
        members = archive.namelist()
        source["metadataPdfs"] = metadata_pdf_members(members)
        location_members = {member for member in members if member.startswith("DMTI_SLI_") and member.endswith(".csv")}
        for member in members:
            if not member.endswith(".csv") or member.startswith("DMTI_SLI_"):
                continue
            year = year_from_member(member)
            if year is None:
                continue
            header = read_header(archive, member)
            variables = header[2:]
            numeric_variables = numeric_like_variables(archive, member, variables)
            location_member = f"DMTI_SLI_{str(year)[-2:]}.csv"
            source["members"].append({
                "member": member,
                "year": year,
                "variableCount": len(variables),
                "variables": variables,
                "numericVariables": numeric_variables,
                "hasLocationMember": location_member in location_members,
                "locationMember": location_member if location_member in location_members else None,
                "estimatedPointCount": (
                    location_count(archive, location_member, year, bbox)
                    if estimate_counts and location_member in location_members else None
                ),
            })
    metadata = metadata_lookup.get(zip_path.name)
    source["metadata"] = metadata
    source["datasetId"] = dataset_id
    return source


def main() -> None:
    args = parse_args()
    source_dir = Path(args.source_dir)
    output = Path(args.output)
    bbox = bbox_from_args(args)
    metadata_lookup = metadata_by_archive(Path(args.metadata))
    variable_rows = load_variable_metadata(Path(args.variable_metadata))
    variable_lookup = variable_metadata_by_code(variable_rows)
    zip_paths = sorted(p for p in source_dir.glob("*.zip") if not p.name.startswith("._"))

    sources = []
    for index, zip_path in enumerate(zip_paths, start=1):
        print(f"[{index}/{len(zip_paths)}] {zip_path.name}")
        sources.append(scan_zip(zip_path, metadata_lookup, bbox, args.estimate_counts))

    by_dataset = {}
    for source in sources:
        entry = by_dataset.setdefault(source["datasetId"], {
            "datasetId": source["datasetId"],
            "archiveCount": 0,
            "sizeBytes": 0,
            "cadences": Counter(),
            "years": set(),
            "variables": set(),
            "numericVariables": set(),
            "variablesByYear": defaultdict(set),
            "numericVariablesByYear": defaultdict(set),
            "sourceArchives": [],
            "metadataPdfs": set(),
            "metadataRows": [],
            "estimatedPointCountsByYear": defaultdict(list),
        })
        entry["archiveCount"] += 1
        entry["sizeBytes"] += source["sizeBytes"]
        entry["cadences"][source["cadence"]] += 1
        entry["sourceArchives"].append(source["archive"])
        entry["metadataPdfs"].update(source.get("metadataPdfs") or [])
        if source.get("metadata"):
            entry["metadataRows"].append(source["metadata"])
        for member in source["members"]:
            entry["years"].add(member["year"])
            entry["variables"].update(member["variables"])
            entry["numericVariables"].update(member["numericVariables"])
            entry["variablesByYear"][member["year"]].update(member["variables"])
            entry["numericVariablesByYear"][member["year"]].update(member["numericVariables"])
            if member["estimatedPointCount"] is not None:
                entry["estimatedPointCountsByYear"][member["year"]].append(member["estimatedPointCount"])

    datasets = []
    for entry in by_dataset.values():
        estimated = {
            str(year): max(counts)
            for year, counts in sorted(entry["estimatedPointCountsByYear"].items())
        }
        variables = sorted(entry["variables"])
        numeric_variables = sorted(entry["numericVariables"])
        variable_metadata_rows = []
        for prefix in sorted({variable_prefix(variable) for variable in variables}):
            variable_metadata_rows.extend(variable_lookup.get(prefix, []))
        variable_metadata_summary = compact_variable_metadata(variable_metadata_rows)
        metadata_summary = compact_metadata(entry["metadataRows"])
        if metadata_summary:
            metadata_summary["matchSource"] = "download_metadata"
        elif variable_metadata_summary:
            metadata_summary = {
                "categories": variable_metadata_summary["categories"],
                "downloadNames": variable_metadata_summary["datasetNames"],
                "portalNames": variable_metadata_summary["datasetNames"],
                "shortCodes": [],
                "yearCoverage": variable_metadata_summary["variableYears"],
                "samplingFrequency": [],
                "descriptions": [],
                "sharingRestrictions": [],
                "matchSource": "variable_metadata",
            }
        elif entry["metadataPdfs"]:
            metadata_summary = {
                "categories": [],
                "downloadNames": [],
                "portalNames": [],
                "shortCodes": [],
                "yearCoverage": [],
                "samplingFrequency": [],
                "descriptions": [],
                "sharingRestrictions": [],
                "matchSource": "zip_metadata_pdf",
            }
        datasets.append({
            "datasetId": entry["datasetId"],
            "archiveCount": entry["archiveCount"],
            "sizeBytes": entry["sizeBytes"],
            "cadences": dict(entry["cadences"]),
            "years": sorted(entry["years"]),
            "yearCount": len(entry["years"]),
            "variableCount": len(variables),
            "variables": variables[:args.max_variables] if args.max_variables else variables,
            "numericVariableCount": len(numeric_variables),
            "numericVariables": numeric_variables[:args.max_variables] if args.max_variables else numeric_variables,
            "variablesByYear": {
                str(year): sorted(values)[:args.max_variables] if args.max_variables else sorted(values)
                for year, values in sorted(entry["variablesByYear"].items())
            },
            "numericVariablesByYear": {
                str(year): sorted(values)[:args.max_variables] if args.max_variables else sorted(values)
                for year, values in sorted(entry["numericVariablesByYear"].items())
            },
            "sourceArchives": sorted(entry["sourceArchives"]),
            "metadataPdfs": sorted(entry["metadataPdfs"]),
            "metadata": metadata_summary,
            "variableMetadata": variable_metadata_summary,
            "estimatedPointCountsByYear": estimated,
            "recommendedOutput": "grid-pmtiles",
        })
    datasets.sort(key=lambda item: item["datasetId"])

    plan = {
        "generatedAt": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        "sourceDir": str(source_dir),
        "metadataPath": args.metadata,
        "variableMetadataPath": args.variable_metadata,
        "view": args.view,
        "bbox": bbox,
        "archiveCount": len(zip_paths),
        "datasetCount": len(datasets),
        "datasets": datasets,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(plan, indent=2) + "\n")
    print(f"Wrote {output} ({len(datasets)} datasets)")


if __name__ == "__main__":
    main()
