#!/usr/bin/env python3
"""Validate a CANUE v2 family-year PMTiles catalog against local outputs."""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path
from typing import Any


FORBIDDEN_FEATURE_FIELDS = {"dataset", "year", "variable", "grid_km"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", required=True)
    parser.add_argument("--output-dir", help="Local v2 output dir. Defaults to catalog parent.")
    parser.add_argument("--inspect-tiles", action="store_true", help="Run pmtiles show --metadata for field checks when available.")
    return parser.parse_args()


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def local_pmtiles_path(output_dir: Path, pmtiles: dict[str, Any]) -> Path:
    remote_path = pmtiles.get("path") or ""
    parts = Path(remote_path).parts
    if len(parts) >= 2:
        return output_dir / parts[-2] / parts[-1]
    return output_dir / Path(remote_path).name


def manifest_variables(output_dir: Path) -> dict[str, set[str]]:
    variables = {}
    for path in output_dir.rglob("*.manifest.json"):
        if path.name.startswith("._"):
            continue
        manifest = read_json(path)
        key = str(Path(manifest.get("pmtiles", path.with_suffix(".pmtiles"))).resolve())
        variables[key] = {item["property"] for item in manifest.get("variables", [])}
    return variables


def inspect_tile_metadata(path: Path) -> set[str]:
    try:
        result = subprocess.run(
            ["pmtiles", "show", "--metadata", str(path)],
            check=True,
            text=True,
            capture_output=True,
        )
    except (FileNotFoundError, subprocess.CalledProcessError):
        return set()
    text = result.stdout
    return {field for field in FORBIDDEN_FEATURE_FIELDS if f'"{field}"' in text}


def main() -> None:
    args = parse_args()
    catalog_path = Path(args.catalog)
    output_dir = Path(args.output_dir) if args.output_dir else catalog_path.parent
    catalog = read_json(catalog_path)
    errors = []
    warnings = []
    manifest_props = manifest_variables(output_dir)

    if catalog.get("version") != 2:
        errors.append("catalog version is not 2")
    if not catalog.get("families"):
        errors.append("catalog has no families")

    seen_families = 0
    for family in catalog.get("families", []):
        layers = family.get("layers") or []
        if not layers:
            errors.append(f"family {family.get('id')} has no layers")
            continue
        seen_families += 1
        for layer in layers:
            pmtiles = layer.get("pmtiles") or {}
            for key in ("path", "url"):
                value = pmtiles.get(key, "")
                if "._" in value:
                    errors.append(f"macOS sidecar path in {family.get('id')} {layer.get('year')}: {value}")
            local_path = local_pmtiles_path(output_dir, pmtiles)
            if not local_path.exists():
                errors.append(f"missing local pmtiles for {pmtiles.get('url')}: {local_path}")
                continue
            local_props = manifest_props.get(str(local_path.resolve()), set())
            for variable in layer.get("variables", []):
                missing_keys = [key for key in ("property", "dataset", "variable", "metadataRef") if not variable.get(key)]
                if missing_keys:
                    errors.append(f"variable entry missing {missing_keys}: {variable}")
                prop = variable.get("property")
                if local_props and prop not in local_props:
                    errors.append(f"catalog property {prop} missing from manifest for {local_path}")
            if args.inspect_tiles:
                forbidden = inspect_tile_metadata(local_path)
                if forbidden:
                    errors.append(f"{local_path} metadata includes forbidden feature fields: {sorted(forbidden)}")

    if seen_families == 0:
        errors.append("no populated families found")

    result = {"ok": not errors, "errors": errors, "warnings": warnings}
    print(json.dumps(result, indent=2))
    if errors:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
