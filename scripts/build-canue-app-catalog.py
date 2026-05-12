#!/usr/bin/env python3
"""Build compact app-facing CANUE PMTiles catalogs.

The batch PMTiles catalog is intentionally rich and layer-centric. This script
turns existing layer manifests into two smaller web artifacts:

- an app catalog grouped by map-friendly families
- a metadata lookup keyed by dataset id
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path
from typing import Any


DEFAULT_OUTPUT_DIR = "/Volumes/Main/canue-pmtiles-bc"
DEFAULT_PLAN = "docs/canue-map-layer-plan-bc.json"
DEFAULT_R2_PREFIX = "canue/pmtiles"
DEFAULT_PUBLIC_BASE_URL = "https://data.map.ahmad.sh"


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
    parser.add_argument("--plan", default=DEFAULT_PLAN)
    parser.add_argument("--view", default="bc")
    parser.add_argument("--mode", default="grid")
    parser.add_argument("--r2-prefix", default=DEFAULT_R2_PREFIX)
    parser.add_argument("--public-base-url", default=DEFAULT_PUBLIC_BASE_URL)
    parser.add_argument("--app-catalog-name", default=None)
    parser.add_argument("--metadata-name", default=None)
    parser.add_argument("--include-stats", action="store_true", help="Include per-layer variable min/max/count stats")
    return parser.parse_args()


def load_json(path: Path) -> dict[str, Any] | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def load_plan_metadata(path: Path) -> dict[str, dict[str, Any]]:
    plan = load_json(path) or {}
    by_dataset = {}
    for dataset in plan.get("datasets", []):
        dataset_id = dataset.get("datasetId")
        if not dataset_id:
            continue
        by_dataset[dataset_id] = {
            "dataset": dataset_id,
            "metadata": dataset.get("metadata"),
            "metadataPdfs": dataset.get("metadataPdfs") or [],
            "sourceArchives": dataset.get("sourceArchives") or [],
            "years": dataset.get("years") or [],
            "variables": dataset.get("variables") or [],
            "numericVariables": dataset.get("numericVariables") or [],
        }
    return by_dataset


def read_manifests(output_dir: Path, view: str, mode: str) -> list[dict[str, Any]]:
    manifests = []
    seen = set()
    for path in sorted(output_dir.glob("*.manifest.json")):
        if path.name.startswith("._"):
            continue
        manifest = load_json(path)
        if not manifest:
            continue
        if manifest.get("view") != view or manifest.get("mode") != mode:
            continue
        pmtiles = manifest.get("pmtiles")
        if not pmtiles or not Path(pmtiles).exists():
            continue
        key = (manifest.get("dataset"), manifest.get("year"), manifest.get("variable"), manifest.get("view"), manifest.get("mode"))
        if key in seen:
            continue
        seen.add(key)
        manifests.append(manifest)
    return manifests


def family_for(dataset: str) -> tuple[str, str]:
    if dataset.startswith(("aq", "pm25", "no2", "o3", "so2")):
        return "air-quality", "Air Quality"
    if dataset.startswith("wtwbm_"):
        return "weather-biometeorology", "Weather Biometeorology"
    if dataset.startswith(("wtutv_", "wthnrc", "wbnrc", "wtfsi", "wtlst", "dtr_", "dtw_")):
        return "weather-thermal", "Weather and Thermal Exposure"
    if dataset.startswith(("grlan_", "grmod_", "gravh_", "grtcc_", "grump_")):
        return "greenness", "Greenness and Vegetation"
    if dataset.startswith(("ale_", "cmg_", "indmsd_", "lcz_", "gen_", "nae_")):
        return "built-environment", "Built Environment"
    if dataset.startswith("nh"):
        return "neighborhood", "Neighborhood Context"
    return "other", "Other CANUE Layers"


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


def compact_layer(manifest: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    pmtiles_path = Path(manifest["pmtiles"])
    public_path = manifest.get("publicPath") or f"{args.r2_prefix.strip('/')}/{pmtiles_path.name}"
    public_url = manifest.get("publicUrl") or f"{args.public_base_url.rstrip('/')}/{public_path}"
    layer = {
        "dataset": manifest.get("dataset"),
        "year": manifest.get("year"),
        "variable": manifest.get("variable"),
        "variables": manifest.get("variables") or [],
        "variableCount": manifest.get("variableCount") or len(manifest.get("variables") or []),
        "features": manifest.get("features"),
        "sourceRows": manifest.get("sourceRows"),
        "metadataRef": manifest.get("dataset"),
        "pmtiles": {
            "path": public_path,
            "url": public_url,
            "bytes": pmtiles_path.stat().st_size if pmtiles_path.exists() else None,
        },
    }
    if args.include_stats:
        stats = manifest.get("variableStats") or {}
        layer["stats"] = {
            variable: {
                "count": value.get("count"),
                "min": value.get("min"),
                "max": value.get("max"),
            }
            for variable, value in stats.items()
        }
    return layer


def append_unique(target: list[Any], values: list[Any]) -> None:
    seen = set(json.dumps(value, sort_keys=True) for value in target)
    for value in values:
        key = json.dumps(value, sort_keys=True)
        if key not in seen:
            target.append(value)
            seen.add(key)


def build_metadata_lookup(manifests: list[dict[str, Any]], plan_metadata: dict[str, dict[str, Any]]) -> dict[str, Any]:
    lookup: dict[str, Any] = {}
    for manifest in manifests:
        dataset = manifest.get("dataset")
        if not dataset:
            continue
        entry = lookup.setdefault(dataset, {
            "dataset": dataset,
            "label": dataset_label(dataset),
            "family": family_for(dataset)[0],
            "metadata": None,
            "metadataPdfs": [],
            "sourceArchives": [],
            "valueMembers": [],
            "locationMembers": [],
            "variables": [],
        })
        plan_entry = plan_metadata.get(dataset) or {}
        entry["metadata"] = entry["metadata"] or manifest.get("metadata") or plan_entry.get("metadata")
        append_unique(entry["metadataPdfs"], manifest.get("metadataPdfs") or plan_entry.get("metadataPdfs") or [])
        append_unique(entry["sourceArchives"], [manifest.get("sourceArchive")] if manifest.get("sourceArchive") else [])
        append_unique(entry["sourceArchives"], plan_entry.get("sourceArchives") or [])
        append_unique(entry["valueMembers"], [manifest.get("valueMember")] if manifest.get("valueMember") else [])
        append_unique(entry["locationMembers"], [manifest.get("locationMember")] if manifest.get("locationMember") else [])
        append_unique(entry["variables"], manifest.get("variables") or [])
    return dict(sorted(lookup.items()))


def build_app_catalog(manifests: list[dict[str, Any]], args: argparse.Namespace) -> dict[str, Any]:
    dataset_layers: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for manifest in manifests:
        dataset_layers[manifest["dataset"]].append(compact_layer(manifest, args))

    families: dict[str, dict[str, Any]] = {}
    for dataset, layers in dataset_layers.items():
        family_id, family_label = family_for(dataset)
        family = families.setdefault(family_id, {
            "id": family_id,
            "label": family_label,
            "order": FAMILY_ORDER.get(family_id, 99),
            "datasets": [],
        })
        years = sorted({layer["year"] for layer in layers if layer.get("year") is not None})
        variables = sorted({variable for layer in layers for variable in layer.get("variables", [])})
        family["datasets"].append({
            "id": dataset,
            "label": dataset_label(dataset),
            "years": years,
            "yearRange": [years[0], years[-1]] if years else None,
            "variables": variables,
            "variableCount": len(variables),
            "layerCount": len(layers),
            "layers": sorted(layers, key=lambda layer: (layer.get("year") or 0, layer.get("variable") or "")),
        })

    family_list = []
    for family in families.values():
        family["datasets"] = sorted(family["datasets"], key=lambda dataset: dataset["id"])
        family["datasetCount"] = len(family["datasets"])
        family["layerCount"] = sum(dataset["layerCount"] for dataset in family["datasets"])
        family_list.append(family)

    return {
        "generatedBy": "scripts/build-canue-app-catalog.py",
        "view": args.view,
        "mode": args.mode,
        "r2Prefix": args.r2_prefix.strip("/"),
        "metadataLookup": args.metadata_name or f"canue-{args.view}-{args.mode}-metadata.json",
        "datasetCount": len(dataset_layers),
        "layerCount": len(manifests),
        "families": sorted(family_list, key=lambda family: (family["order"], family["id"])),
    }


def main() -> None:
    args = parse_args()
    output_dir = Path(args.output_dir)
    app_name = args.app_catalog_name or f"canue-{args.view}-{args.mode}-app-catalog.json"
    metadata_name = args.metadata_name or f"canue-{args.view}-{args.mode}-metadata.json"
    args.metadata_name = metadata_name

    manifests = read_manifests(output_dir, args.view, args.mode)
    if not manifests:
        raise SystemExit(f"No {args.view}/{args.mode} manifests found in {output_dir}")

    plan_metadata = load_plan_metadata(Path(args.plan))
    app_catalog = build_app_catalog(manifests, args)
    metadata_lookup = {
        "generatedBy": "scripts/build-canue-app-catalog.py",
        "view": args.view,
        "mode": args.mode,
        "datasets": build_metadata_lookup(manifests, plan_metadata),
    }

    app_path = output_dir / app_name
    metadata_path = output_dir / metadata_name
    app_path.write_text(json.dumps(app_catalog, indent=2) + "\n", encoding="utf-8")
    metadata_path.write_text(json.dumps(metadata_lookup, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {app_path}")
    print(f"Wrote {metadata_path}")
    print(f"Families: {len(app_catalog['families'])}")
    print(f"Datasets: {app_catalog['datasetCount']}")
    print(f"Layers: {app_catalog['layerCount']}")


if __name__ == "__main__":
    main()
