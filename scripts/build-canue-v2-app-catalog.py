#!/usr/bin/env python3
"""Build the CANUE v2 family-year PMTiles app catalog and metadata lookup."""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path
from typing import Any


DEFAULT_OUTPUT_DIR = "/Volumes/Main/canue-pmtiles-bc-v2"
DEFAULT_V1_OUTPUT_DIR = "/Volumes/Main/canue-pmtiles-bc"
DEFAULT_PLAN = "docs/canue-map-layer-plan-bc.json"
DEFAULT_PUBLIC_BASE_URL = "https://data.map.ahmad.sh"
DEFAULT_R2_PREFIX = "canue/pmtiles-v2"

FAMILY_LABELS = {
    "air-quality": "Air Quality",
    "weather-thermal": "Weather and Thermal Exposure",
    "weather-biometeorology": "Weather Biometeorology",
    "greenness": "Greenness and Vegetation",
    "built-environment": "Built Environment",
    "neighborhood": "Neighborhood Context",
    "other": "Other CANUE Layers",
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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--v1-output-dir", default=DEFAULT_V1_OUTPUT_DIR)
    parser.add_argument("--plan", default=DEFAULT_PLAN)
    parser.add_argument("--view", default="bc")
    parser.add_argument("--mode", default="grid")
    parser.add_argument("--grid-km", type=float, default=1.0)
    parser.add_argument("--public-base-url", default=DEFAULT_PUBLIC_BASE_URL)
    parser.add_argument("--r2-prefix", default=DEFAULT_R2_PREFIX)
    return parser.parse_args()


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def file_count_bytes(root: Path, pattern: str = "*.pmtiles") -> dict[str, int]:
    files = [path for path in root.rglob(pattern) if path.is_file() and not path.name.startswith("._")]
    return {"pmtiles": len(files), "bytes": sum(path.stat().st_size for path in files)}


def plan_metadata(plan_path: Path) -> dict[str, dict[str, Any]]:
    if not plan_path.exists():
        return {}
    plan = read_json(plan_path)
    datasets = {}
    for dataset in plan.get("datasets", []):
        dataset_id = dataset.get("datasetId")
        if not dataset_id:
            continue
        datasets[dataset_id] = dataset
    return datasets


def manifest_paths(output_dir: Path) -> list[Path]:
    return sorted(
        path for path in output_dir.rglob("*.manifest.json")
        if path.is_file() and not path.name.startswith("._")
    )


def pmtiles_info(output_dir: Path, manifest: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    pmtiles_path = Path(manifest["pmtiles"])
    if not pmtiles_path.is_absolute():
        pmtiles_path = output_dir / pmtiles_path
    family = manifest["family"]
    public_path = f"{args.r2_prefix.strip('/')}/{family}/{pmtiles_path.name}"
    return {
        "path": public_path,
        "url": f"{args.public_base_url.rstrip('/')}/{public_path}",
        "bytes": pmtiles_path.stat().st_size if pmtiles_path.exists() else 0,
    }


def build_catalog(manifests: list[dict[str, Any]], output_dir: Path, args: argparse.Namespace) -> dict[str, Any]:
    by_family: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for manifest in manifests:
        if manifest.get("pmtiles"):
            by_family[manifest["family"]].append(manifest)

    families = []
    for family_id in sorted(by_family, key=lambda item: (FAMILY_ORDER.get(item, 99), item)):
        layers = []
        all_datasets = set()
        for manifest in sorted(by_family[family_id], key=lambda item: item["year"]):
            variable_stats = manifest.get("variableStats") or {}
            variables = [
                {
                    "property": variable["property"],
                    "dataset": variable["dataset"],
                    "variable": variable["variable"],
                    "metadataRef": variable.get("metadataRef") or variable["dataset"],
                    "count": variable_stats.get(variable["property"], {}).get("count"),
                    "min": variable_stats.get(variable["property"], {}).get("min"),
                    "max": variable_stats.get(variable["property"], {}).get("max"),
                }
                for variable in manifest.get("variables", [])
            ]
            dataset_ids = sorted({variable["dataset"] for variable in variables})
            all_datasets.update(dataset_ids)
            layers.append({
                "year": manifest["year"],
                "pmtiles": pmtiles_info(output_dir, manifest, args),
                "datasets": dataset_ids,
                "variables": variables,
                "features": manifest.get("features", 0),
                "sourceRows": manifest.get("sourceRows", 0),
            })
        families.append({
            "id": family_id,
            "label": FAMILY_LABELS.get(family_id, family_id.replace("-", " ").title()),
            "years": [layer["year"] for layer in layers],
            "datasetCount": len(all_datasets),
            "layerCount": len(layers),
            "variableCount": sum(len(layer["variables"]) for layer in layers),
            "layers": layers,
        })

    return {
        "version": 2,
        "view": args.view,
        "mode": args.mode,
        "gridKm": args.grid_km,
        "vectorLayer": "canue",
        "r2Prefix": args.r2_prefix.strip("/"),
        "metadataLookup": f"canue-{args.view}-{args.mode}-v2-metadata.json",
        "families": families,
    }


def build_metadata(manifests: list[dict[str, Any]], plan_datasets: dict[str, dict[str, Any]]) -> dict[str, Any]:
    datasets: dict[str, dict[str, Any]] = {}
    variables_by_dataset: dict[str, set[str]] = defaultdict(set)
    family_by_dataset: dict[str, str] = {}

    for manifest in manifests:
        for variable in manifest.get("variables", []):
            variables_by_dataset[variable["dataset"]].add(variable["variable"])
            family_by_dataset[variable["dataset"]] = manifest["family"]
        for dataset in manifest.get("datasets", []):
            dataset_id = dataset["dataset"]
            plan_entry = plan_datasets.get(dataset_id, {})
            datasets[dataset_id] = {
                "label": dataset.get("label") or dataset_id,
                "family": manifest["family"],
                "metadata": dataset.get("metadata") or plan_entry.get("metadata") or {},
                "metadataPdfs": dataset.get("metadataPdfs") or plan_entry.get("metadataPdfs") or [],
                "sourceArchives": dataset.get("sourceArchives") or plan_entry.get("sourceArchives") or [],
            }

    for dataset_id, variables in variables_by_dataset.items():
        entry = datasets.setdefault(dataset_id, {
            "label": dataset_id,
            "family": family_by_dataset.get(dataset_id, "other"),
            "metadata": {},
            "metadataPdfs": [],
            "sourceArchives": [],
        })
        entry["variables"] = sorted(variables)

    return {"version": 2, "datasets": dict(sorted(datasets.items()))}


def build_report(manifests: list[dict[str, Any]], output_dir: Path, args: argparse.Namespace) -> dict[str, Any]:
    v1 = file_count_bytes(Path(args.v1_output_dir))
    v2 = file_count_bytes(output_dir)
    missing = [item for manifest in manifests for item in manifest.get("missing", [])]
    failures = []
    existing_report = output_dir / f"canue-{args.view}-{args.mode}-v2-build-report.json"
    if existing_report.exists():
        previous = read_json(existing_report)
        failures = previous.get("failures", [])
    byte_savings = v1["bytes"] - v2["bytes"]
    file_savings = v1["pmtiles"] - v2["pmtiles"]
    return {
        "version": 2,
        "view": args.view,
        "mode": args.mode,
        "gridKm": args.grid_km,
        "v1": v1,
        "v2": v2,
        "savings": {
            "files": file_savings,
            "filePercent": round((file_savings / v1["pmtiles"]) * 100, 2) if v1["pmtiles"] else None,
            "bytes": byte_savings,
            "bytePercent": round((byte_savings / v1["bytes"]) * 100, 2) if v1["bytes"] else None,
        },
        "layers": len(manifests),
        "families": sorted({manifest["family"] for manifest in manifests}),
        "missing": missing,
        "failures": failures,
    }


def main() -> None:
    args = parse_args()
    output_dir = Path(args.output_dir)
    manifests = [read_json(path) for path in manifest_paths(output_dir)]
    if not manifests:
        raise SystemExit(f"No v2 manifests found under {output_dir}")

    catalog = build_catalog(manifests, output_dir, args)
    metadata = build_metadata(manifests, plan_metadata(Path(args.plan)))
    report = build_report(manifests, output_dir, args)

    catalog_path = output_dir / f"canue-{args.view}-{args.mode}-v2-app-catalog.json"
    metadata_path = output_dir / f"canue-{args.view}-{args.mode}-v2-metadata.json"
    report_path = output_dir / f"canue-{args.view}-{args.mode}-v2-build-report.json"
    catalog_path.write_text(json.dumps(catalog, indent=2) + "\n", encoding="utf-8")
    metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "catalog": str(catalog_path),
        "metadata": str(metadata_path),
        "report": str(report_path),
        "families": len(catalog["families"]),
        "layers": report["layers"],
        "v2Pmtiles": report["v2"]["pmtiles"],
        "v2Bytes": report["v2"]["bytes"],
    }, indent=2))


if __name__ == "__main__":
    main()
