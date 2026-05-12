#!/usr/bin/env python3
"""Build and optionally upload CANUE PMTiles layers.

This is the batch wrapper around build-canue-map-layer.py. It reads the CANUE
layer plan, chooses dataset/year/variable combinations, builds grid layers, and
can upload the generated PMTiles plus a small catalog to Cloudflare R2.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path


DEFAULT_PLAN = "docs/canue-map-layer-plan.json"
DEFAULT_SOURCE_DIR = "/Volumes/Main/2026 pull/zip"
DEFAULT_OUTPUT_DIR = "build/canue-pmtiles"
DEFAULT_R2_ENDPOINT = "https://479e77f49d4ac5d7498529ee360f194b.r2.cloudflarestorage.com"
DEFAULT_R2_BUCKET = "maps"
DEFAULT_R2_PREFIX = "canue/pmtiles"
DEFAULT_PUBLIC_BASE_URL = "https://data.map.ahmad.sh"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", default=DEFAULT_PLAN)
    parser.add_argument("--source-dir", default=DEFAULT_SOURCE_DIR)
    parser.add_argument("--output-dir", default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--dataset", action="append", help="Dataset id to build. Can be repeated.")
    parser.add_argument("--year", type=int, action="append", help="Year to build. Can be repeated.")
    parser.add_argument("--variable", action="append", help="Variable to build. Can be repeated.")
    parser.add_argument("--view", choices=["pg", "bc"], default="pg")
    parser.add_argument("--mode", choices=["grid", "points"], default="grid")
    parser.add_argument("--all-years", action="store_true", help="Build every valid year instead of the latest year")
    parser.add_argument("--all-variables", action="store_true", help="Build every valid numeric variable instead of the first variable")
    parser.add_argument("--wide", action="store_true", help="Build one PMTiles per dataset/year with all variables as properties")
    parser.add_argument("--grid-km", type=float, default=1.0)
    parser.add_argument("--minzoom", type=int, default=5)
    parser.add_argument("--maxzoom", type=int, default=12)
    parser.add_argument("--limit", type=int, default=0, help="Limit selected layer count for test runs")
    parser.add_argument("--offset", type=int, default=0, help="Skip this many selected layers before applying --limit")
    parser.add_argument("--skip-existing", action="store_true", help="Reuse existing local manifests/PMTiles when present")
    parser.add_argument("--continue-on-error", action="store_true", help="Keep building later layers if one layer fails")
    parser.add_argument("--keep-intermediates", action="store_true", help="Keep GeoJSONSeq and MBTiles intermediates")
    parser.add_argument("--dry-run", action="store_true", help="Print selected builds without creating files")
    parser.add_argument("--failures-file", help="Retry only the layers listed in a previous failures JSON")
    parser.add_argument("--no-catalog", action="store_true", help="Build selected layers without writing a catalog or failure report")
    parser.add_argument("--upload", action="store_true", help="Upload PMTiles and catalog to R2")
    parser.add_argument("--r2-endpoint", default=DEFAULT_R2_ENDPOINT)
    parser.add_argument("--r2-bucket", default=DEFAULT_R2_BUCKET)
    parser.add_argument("--r2-prefix", default=DEFAULT_R2_PREFIX)
    parser.add_argument("--public-base-url", default=DEFAULT_PUBLIC_BASE_URL)
    parser.add_argument("--aws-profile", default="r2")
    return parser.parse_args()


def require_tool(name: str) -> str:
    path = shutil.which(name)
    if not path:
        raise SystemExit(
            f"{name} is required. Install it first, e.g. `brew install {name}` "
            "for local builds on macOS."
        )
    return path


def load_plan(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise SystemExit(f"Plan not found: {path}. Run `npm run canue:map-plan` first.")


def selected_layers(plan: dict, args: argparse.Namespace) -> list[dict]:
    if args.failures_file:
        return selected_failure_layers(Path(args.failures_file))

    requested_datasets = set(args.dataset or [])
    requested_years = set(args.year or [])
    requested_variables = set(args.variable or [])
    layers = []

    for dataset in plan.get("datasets", []):
        dataset_id = dataset["datasetId"]
        if requested_datasets and dataset_id not in requested_datasets:
            continue

        years = sorted(set(dataset.get("years") or []))
        if requested_years:
            years = [year for year in years if year in requested_years]
        elif years and not args.all_years:
            years = [max(years)]

        for year in years:
            by_year = (
                dataset.get("numericVariablesByYear", {}).get(str(year))
                or dataset.get("variablesByYear", {}).get(str(year))
                or dataset.get("numericVariables")
                or dataset.get("variables")
                or []
            )
            if args.wide:
                if by_year:
                    layers.append({
                        "dataset": dataset_id,
                        "year": year,
                        "variable": "allvars",
                        "wide": True,
                        "metadata": dataset.get("metadata"),
                        "metadataPdfs": dataset.get("metadataPdfs") or [],
                    })
                continue
            if requested_variables:
                variables = [variable for variable in sorted(requested_variables) if variable in by_year]
                if not variables:
                    variables = sorted(requested_variables)
            elif args.all_variables:
                variables = list(by_year)
            else:
                variables = list(by_year[:1])

            for variable in variables:
                layers.append({
                    "dataset": dataset_id,
                    "year": year,
                    "variable": variable,
                    "metadata": dataset.get("metadata"),
                    "metadataPdfs": dataset.get("metadataPdfs") or [],
                })

    if args.offset:
        layers = layers[args.offset:]
    if args.limit:
        layers = layers[:args.limit]
    return layers


def selected_failure_layers(path: Path) -> list[dict]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise SystemExit(f"Failures file not found: {path}")

    failures = payload.get("failures")
    if not isinstance(failures, list):
        raise SystemExit(f"Failures file does not contain a failures list: {path}")

    layers = []
    seen = set()
    for failure in failures:
        dataset = failure.get("dataset")
        year = failure.get("year")
        variable = failure.get("variable")
        if not dataset or not year or not variable:
            continue
        key = (dataset, int(year), variable)
        if key in seen:
            continue
        seen.add(key)
        layers.append({
            "dataset": dataset,
            "year": int(year),
            "variable": variable,
            "wide": variable == "allvars",
            "metadata": None,
            "metadataPdfs": [],
        })
    return layers


def run(command: list[str]) -> None:
    print("+ " + " ".join(command))
    subprocess.run(command, check=True)


def build_layer(layer: dict, args: argparse.Namespace) -> dict:
    output_dir = Path(args.output_dir)
    stem = f"{layer['dataset']}_{layer['year']}_{safe_name(layer['variable'])}_{args.mode}_{args.view}"
    manifest_path = output_dir / f"{stem}.manifest.json"
    pmtiles_path = output_dir / f"{stem}.pmtiles"
    if args.skip_existing and manifest_path.exists() and pmtiles_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["metadata"] = layer.get("metadata")
        manifest["metadataPdfs"] = layer.get("metadataPdfs") or []
        add_public_urls(manifest, args)
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        print(f"Skipping existing {pmtiles_path}")
        return manifest

    command = [
        sys.executable,
        "scripts/build-canue-map-layer.py",
        "--source-dir", args.source_dir,
        "--dataset", layer["dataset"],
        "--year", str(layer["year"]),
        "--mode", args.mode,
        "--view", args.view,
        "--grid-km", str(args.grid_km),
        "--output-dir", args.output_dir,
        "--minzoom", str(args.minzoom),
        "--maxzoom", str(args.maxzoom),
        "--pmtiles",
    ]
    if layer.get("wide"):
        command.append("--all-variables")
    else:
        command.extend(["--variable", layer["variable"]])
    run(command)

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["metadata"] = layer.get("metadata")
    manifest["metadataPdfs"] = layer.get("metadataPdfs") or []
    add_public_urls(manifest, args)
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    if not args.keep_intermediates:
        cleanup_intermediates(manifest)
    return manifest


def cleanup_intermediates(manifest: dict) -> None:
    for key in ("ndjson", "mbtiles"):
        path_value = manifest.get(key)
        if not path_value:
            continue
        path = Path(path_value)
        if path.exists():
            path.unlink()
            print(f"Removed intermediate {path}")


def add_public_urls(manifest: dict, args: argparse.Namespace) -> None:
    if manifest.get("pmtiles"):
        public_path = f"{args.r2_prefix.strip('/')}/{Path(manifest['pmtiles']).name}"
        manifest["publicPath"] = public_path
        manifest["publicUrl"] = f"{args.public_base_url.rstrip('/')}/{public_path}"
    else:
        manifest["publicPath"] = None
        manifest["publicUrl"] = None


def safe_name(value: str) -> str:
    return "".join(char if char.isalnum() or char in "-_" else "-" for char in value).strip("-")


def write_catalog(manifests: list[dict], args: argparse.Namespace) -> Path:
    output_dir = Path(args.output_dir)
    catalog = {
        "generatedBy": "scripts/build-canue-pmtiles-batch.py",
        "view": args.view,
        "mode": args.mode,
        "gridKm": args.grid_km if args.mode == "grid" else None,
        "r2Prefix": args.r2_prefix.rstrip("/"),
        "layers": [catalog_layer(manifest) for manifest in manifests],
    }
    path = output_dir / f"canue-{args.view}-{args.mode}-catalog.json"
    path.write_text(json.dumps(catalog, indent=2) + "\n", encoding="utf-8")
    return path


def write_failures(failures: list[dict], args: argparse.Namespace) -> Path | None:
    if not failures:
        return None
    output_dir = Path(args.output_dir)
    path = output_dir / f"canue-{args.view}-{args.mode}-failures.json"
    path.write_text(json.dumps({
        "generatedBy": "scripts/build-canue-pmtiles-batch.py",
        "view": args.view,
        "mode": args.mode,
        "failures": failures,
    }, indent=2) + "\n", encoding="utf-8")
    return path


def catalog_layer(manifest: dict) -> dict:
    source_zip = manifest.get("sourceZip")
    return {
        "dataset": manifest.get("dataset"),
        "sourceArchive": Path(source_zip).name if source_zip else None,
        "valueMember": manifest.get("valueMember"),
        "locationMember": manifest.get("locationMember"),
        "year": manifest.get("year"),
        "variable": manifest.get("variable"),
        "variables": manifest.get("variables") or [],
        "variableCount": manifest.get("variableCount"),
        "mode": manifest.get("mode"),
        "view": manifest.get("view"),
        "gridKm": manifest.get("gridKm"),
        "sourceRows": manifest.get("sourceRows"),
        "features": manifest.get("features"),
        "min": manifest.get("min"),
        "max": manifest.get("max"),
        "variableStats": manifest.get("variableStats"),
        "metadata": manifest.get("metadata"),
        "metadataPdfs": manifest.get("metadataPdfs") or [],
        "publicPath": manifest.get("publicPath"),
        "publicUrl": manifest.get("publicUrl"),
    }


def upload_file(path: Path, dest: str, args: argparse.Namespace, content_type: str, cache_control: str) -> None:
    command = [
        "aws", "s3", "cp", str(path), dest,
        "--profile", args.aws_profile,
        "--endpoint-url", args.r2_endpoint,
        "--content-type", content_type,
        "--cache-control", cache_control,
    ]
    run(command)


def upload_outputs(manifests: list[dict], catalog_path: Path, args: argparse.Namespace) -> None:
    require_tool("aws")
    prefix = args.r2_prefix.strip("/")
    base = f"s3://{args.r2_bucket}/{prefix}"
    for manifest in manifests:
        pmtiles = manifest.get("pmtiles")
        if not pmtiles:
            continue
        path = Path(pmtiles)
        upload_file(path, f"{base}/{path.name}", args, "application/vnd.pmtiles", "public,max-age=31536000,immutable")
    upload_file(catalog_path, f"{base}/{catalog_path.name}", args, "application/json", "public,max-age=300,must-revalidate")


def main() -> None:
    args = parse_args()

    plan = load_plan(Path(args.plan))
    layers = selected_layers(plan, args)
    if not layers:
        raise SystemExit("No layers selected. Try --dataset, --year, or --variable with values from the plan.")

    print(f"Selected {len(layers)} layer(s)")
    for layer in layers:
        print(f"- {layer['dataset']} {layer['year']} {layer['variable']}")

    if args.dry_run:
        return

    require_tool("tippecanoe")
    require_tool("pmtiles")

    manifests = []
    failures = []
    for index, layer in enumerate(layers, start=1):
        print(f"[{index}/{len(layers)}] {layer['dataset']} {layer['year']} {layer['variable']}")
        try:
            manifests.append(build_layer(layer, args))
        except Exception as error:
            failure = {
                "dataset": layer.get("dataset"),
                "year": layer.get("year"),
                "variable": layer.get("variable"),
                "error": str(error),
            }
            failures.append(failure)
            print(f"ERROR: {json.dumps(failure)}", file=sys.stderr)
            if not args.continue_on_error:
                raise

    catalog_path = None
    if not args.no_catalog:
        catalog_path = write_catalog(manifests, args)
        print(f"Wrote {catalog_path}")
        failures_path = write_failures(failures, args)
        if failures_path:
            print(f"Wrote {failures_path}")

    if args.upload:
        if catalog_path is None:
            raise SystemExit("--upload requires catalog output; remove --no-catalog")
        upload_outputs(manifests, catalog_path, args)

    if failures and not args.continue_on_error:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
