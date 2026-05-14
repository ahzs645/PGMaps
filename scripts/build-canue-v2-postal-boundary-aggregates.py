#!/usr/bin/env python3
"""Build CANUE v2 boundary aggregates directly from postal-code source rows.

This writes the same app-facing aggregate JSON shape as
build-canue-v2-boundary-aggregates.mjs, but it reads CANUE ZIP/directories and
DMTI_SLI postal-code coordinates instead of decoding already-gridded PMTiles.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import sys
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

try:
    from shapely.geometry import Point, shape
    from shapely.prepared import prep
except ImportError:  # pragma: no cover - local build environment should have shapely.
    Point = None
    prep = None
    shape = None


DEFAULT_CATALOG = "/Volumes/Main/canue-pmtiles-bc-v2/canue-bc-grid-v2-app-catalog.json"
DEFAULT_PLAN = "docs/canue-map-layer-plan-bc.json"
DEFAULT_SOURCE_DIR = "/Volumes/Main/2026 pull/zip"
DEFAULT_OUTPUT_DIR = "/Volumes/Main/canue-aggregates-v2"
DEFAULT_R2_PREFIX = "canue/aggregates-v2"
DEFAULT_PUBLIC_BASE_URL = "https://data.map.ahmad.sh"

BOUNDARY_LEVELS = [
    ("bcHealth", "healthAuthority", "public/data/boundaries/BCMoH/simplified/health_authorities.json", "HLTH_AUTHORITY_CODE", "HLTH_AUTHORITY_NAME"),
    ("bcHealth", "hsda", "public/data/boundaries/BCMoH/simplified/health_service_delivery_areas.json", "HLTH_SERVICE_DLVR_AREA_CODE", "HLTH_SERVICE_DLVR_AREA_NAME"),
    ("bcHealth", "lha", "public/data/boundaries/BCMoH/simplified/local_health_areas.json", "LOCAL_HLTH_AREA_CODE", "LOCAL_HLTH_AREA_NAME"),
    ("bcHealth", "chsa", "public/data/boundaries/BCMoH/simplified/community_health_service_areas.json", "CMNTY_HLTH_SERV_AREA_CODE", "CMNTY_HLTH_SERV_AREA_NAME"),
    ("regionalDistrict", "regionalDistrict", "public/data/boundaries/BC/regional_districts.geojson", "LGL_ADMIN_AREA_ID", "ADMIN_AREA_NAME"),
    ("census", "cd", "public/data/census/prince_george_cd.geo.json", "id", "name"),
    ("census", "csd", "public/data/census/prince_george_csd.geo.json", "id", "name"),
    ("census", "ct", "public/data/census/prince_george_ct.geo.json", "id", "name"),
    ("census", "da", "public/data/census/prince_george_da.geo.json", "id", "name"),
    ("census", "db", "public/data/census/prince_george_db.geo.json", "id", "name"),
    ("cityPG", "elementarySchoolCatchment", "public/data/boundaries/CityPG/elementary_school_catchments.geojson", "OBJECTID", "SchoolName"),
    ("cityPG", "secondarySchoolCatchment", "public/data/boundaries/CityPG/secondary_school_catchments.geojson", "OBJECTID", "SchoolNam"),
    ("watershed", "majorWatershed", "public/data/boundaries/BCFWA/major_watersheds_province_simplified.geojson", "boundaryCode", "boundaryName"),
    ("watershed", "watershedGroup", "public/data/boundaries/BCFWA/watershed_groups_province_simplified.geojson", "boundaryCode", "boundaryName"),
    ("watershed", "assessmentWatershed", "public/data/boundaries/BCFWA/assessment_watersheds.geojson", "boundaryCode", "boundaryName"),
    ("nrAdmin", "nrArea", "public/data/boundaries/BCNR/nr_areas.geojson", "boundaryCode", "boundaryName"),
    ("nrAdmin", "nrRegion", "public/data/boundaries/BCNR/nr_regions.geojson", "boundaryCode", "boundaryName"),
    ("nrAdmin", "nrDistrict", "public/data/boundaries/BCNR/nr_districts.geojson", "boundaryCode", "boundaryName"),
]


@dataclass
class Boundary:
    index: int
    id: str
    name: str
    geometry: dict[str, Any]
    bbox: tuple[float, float, float, float]
    prepared: Any = None


@dataclass
class BoundarySet:
    source: str
    level: str
    file: str
    id_field: str
    name_field: str
    boundaries: list[Boundary]
    bounds: tuple[float, float, float, float]
    index: dict[tuple[int, int], list[Boundary]]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", default=DEFAULT_CATALOG)
    parser.add_argument("--plan", default=DEFAULT_PLAN)
    parser.add_argument("--source-dir", default=DEFAULT_SOURCE_DIR)
    parser.add_argument("--output-dir", default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--public-base-url", default=DEFAULT_PUBLIC_BASE_URL)
    parser.add_argument("--r2-prefix", default=DEFAULT_R2_PREFIX)
    parser.add_argument("--family")
    parser.add_argument("--year", type=int)
    parser.add_argument("--source")
    parser.add_argument("--level")
    parser.add_argument("--skip-existing", action="store_true")
    parser.add_argument("--continue-on-error", action="store_true")
    parser.add_argument("--match-mode", choices=["all", "first"], default="all")
    parser.add_argument("--view", choices=["bc", "pg"], default="bc")
    return parser.parse_args()


def load_family_builder():
    path = Path(__file__).with_name("build-canue-family-pmtiles.py")
    spec = importlib.util.spec_from_file_location("canue_family_pmtiles", path)
    if spec is None or spec.loader is None:
        raise SystemExit(f"Could not load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def geometry_bbox(geometry: dict[str, Any]) -> tuple[float, float, float, float]:
    coords: list[tuple[float, float]] = []

    def visit(value: Any) -> None:
        if isinstance(value, list) and len(value) >= 2 and all(isinstance(item, (int, float)) for item in value[:2]):
            coords.append((float(value[0]), float(value[1])))
        elif isinstance(value, list):
            for child in value:
                visit(child)

    visit(geometry.get("coordinates", []))
    if geometry.get("type") == "GeometryCollection":
        for child in geometry.get("geometries", []):
            child_bbox = geometry_bbox(child)
            coords.extend([(child_bbox[0], child_bbox[1]), (child_bbox[2], child_bbox[3])])
    if not coords:
        return (math.inf, math.inf, -math.inf, -math.inf)
    xs = [coord[0] for coord in coords]
    ys = [coord[1] for coord in coords]
    return (min(xs), min(ys), max(xs), max(ys))


def point_in_ring(point: tuple[float, float], ring: list[list[float]]) -> bool:
    x, y = point
    inside = False
    previous = len(ring) - 1
    for index, current in enumerate(ring):
        xi, yi = current[:2]
        xj, yj = ring[previous][:2]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / ((yj - yi) or sys.float_info.epsilon) + xi):
            inside = not inside
        previous = index
    return inside


def point_in_polygon(point: tuple[float, float], polygon: list[list[list[float]]]) -> bool:
    return bool(polygon) and point_in_ring(point, polygon[0]) and not any(point_in_ring(point, hole) for hole in polygon[1:])


def point_in_geometry(point: tuple[float, float], geometry: dict[str, Any]) -> bool:
    if geometry["type"] == "Polygon":
        return point_in_polygon(point, geometry["coordinates"])
    if geometry["type"] == "MultiPolygon":
        return any(point_in_polygon(point, polygon) for polygon in geometry["coordinates"])
    return False


def index_key(lon: float, lat: float, cell_size: float = 0.25) -> tuple[int, int]:
    return (math.floor(lon / cell_size), math.floor(lat / cell_size))


def build_boundary_index(boundaries: list[Boundary], cell_size: float = 0.25) -> dict[tuple[int, int], list[Boundary]]:
    index: dict[tuple[int, int], list[Boundary]] = defaultdict(list)
    for boundary in boundaries:
        min_lon, min_lat, max_lon, max_lat = boundary.bbox
        min_key = index_key(min_lon, min_lat, cell_size)
        max_key = index_key(max_lon, max_lat, cell_size)
        for x in range(min_key[0], max_key[0] + 1):
            for y in range(min_key[1], max_key[1] + 1):
                index[(x, y)].append(boundary)
    return dict(index)


def load_boundary_set(config: tuple[str, str, str, str, str]) -> BoundarySet:
    source, level, file, id_field, name_field = config
    collection = json.loads(Path(file).read_text(encoding="utf-8"))
    boundaries = []
    for index, feature in enumerate(collection.get("features", [])):
        geometry = feature.get("geometry")
        if not geometry:
            continue
        props = feature.get("properties") or {}
        bounds = geometry_bbox(geometry)
        if not all(math.isfinite(value) for value in bounds):
            continue
        try:
            prepared = prep(shape(geometry)) if prep and shape else None
        except Exception:
            prepared = None
        boundaries.append(Boundary(
            index=index,
            id=str(props.get(id_field, feature.get("id", index))),
            name=str(props.get(name_field, props.get("name", feature.get("id", index)))),
            geometry=geometry,
            bbox=bounds,
            prepared=prepared,
        ))
    all_bounds = (
        min(boundary.bbox[0] for boundary in boundaries),
        min(boundary.bbox[1] for boundary in boundaries),
        max(boundary.bbox[2] for boundary in boundaries),
        max(boundary.bbox[3] for boundary in boundaries),
    )
    return BoundarySet(source, level, file, id_field, name_field, boundaries, all_bounds, build_boundary_index(boundaries))


def find_boundaries(boundary_set: BoundarySet, point: tuple[float, float], match_mode: str) -> list[Boundary]:
    matches = []
    lon, lat = point
    shapely_point = Point(lon, lat) if Point else None
    for boundary in boundary_set.index.get(index_key(lon, lat), []):
        min_lon, min_lat, max_lon, max_lat = boundary.bbox
        if lon < min_lon or lon > max_lon or lat < min_lat or lat > max_lat:
            continue
        inside = boundary.prepared.covers(shapely_point) if boundary.prepared and shapely_point is not None else point_in_geometry(point, boundary.geometry)
        if inside:
            matches.append(boundary)
            if match_mode == "first":
                break
    return matches


def create_buckets(boundary_set: BoundarySet, variables: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {
        boundary.id: {
            "boundary": boundary,
            "values": {
                variable["property"]: {"sum": 0.0, "count": 0, "min": None, "max": None}
                for variable in variables
            },
        }
        for boundary in boundary_set.boundaries
    }


def aggregate_to_bucket(bucket: dict[str, Any], prop: str, value: float) -> None:
    stats = bucket["values"][prop]
    stats["sum"] += value
    stats["count"] += 1
    stats["min"] = value if stats["min"] is None else min(stats["min"], value)
    stats["max"] = value if stats["max"] is None else max(stats["max"], value)


def aggregate_layer(
    family_builder: Any,
    v1: Any,
    plan: dict[str, Any],
    family: dict[str, Any],
    layer: dict[str, Any],
    boundary_sets: list[BoundarySet],
    membership_cache: dict[tuple[int, str], dict[str, list[Boundary]]],
    args: argparse.Namespace,
) -> list[dict[str, Any]]:
    variables = layer["variables"]
    wanted = {variable["property"]: variable for variable in variables}
    buckets_by_level = {boundary_set.level: create_buckets(boundary_set, variables) for boundary_set in boundary_sets}
    source_stats = {
        boundary_set.level: {"sourceRowCount": 0, "matchedRowCount": 0}
        for boundary_set in boundary_sets
    }

    selection_by_dataset = {
        selection.dataset: selection
        for selection in family_builder.dataset_selections(plan, family["id"], layer["year"])
    }
    match_args = argparse.Namespace(source_dir=args.source_dir, zip_path=None)

    for dataset_id in layer.get("datasets", []):
        selection = selection_by_dataset.get(dataset_id)
        if selection is None:
            print(f"Missing plan selection for {family['id']} {layer['year']} {dataset_id}", file=sys.stderr)
            continue
        try:
            match = family_builder.find_match(v1, selection, match_args)
        except SystemExit as error:
            print(f"Missing source for {family['id']} {layer['year']} {dataset_id}: {error}", file=sys.stderr)
            continue

        dataset = family_builder.source_dataset_id(match.source_path)
        row_bbox = family_builder.VIEWS[args.view]
        for row in family_builder.iter_match_rows(match, row_bbox, v1):
            values = {
                family_builder.property_name(dataset, variable): value
                for variable, value in row["values"].items()
                if family_builder.property_name(dataset, variable) in wanted
            }
            if not values:
                continue
            cache_key = (layer["year"], row["postalcode"])
            matches_by_level = membership_cache.get(cache_key)
            if matches_by_level is None:
                point = (float(row["lon"]), float(row["lat"]))
                matches_by_level = {
                    boundary_set.level: find_boundaries(boundary_set, point, args.match_mode)
                    for boundary_set in boundary_sets
                }
                membership_cache[cache_key] = matches_by_level
            for boundary_set in boundary_sets:
                source_stats[boundary_set.level]["sourceRowCount"] += 1
                matches = matches_by_level[boundary_set.level]
                if not matches:
                    continue
                source_stats[boundary_set.level]["matchedRowCount"] += len(matches)
                buckets = buckets_by_level[boundary_set.level]
                for boundary in matches:
                    bucket = buckets[boundary.id]
                    for prop, value in values.items():
                        aggregate_to_bucket(bucket, prop, value)

    outputs = []
    for boundary_set in boundary_sets:
        outputs.append(write_aggregate(args, family, layer, boundary_set, variables, buckets_by_level[boundary_set.level], source_stats[boundary_set.level]))
    return outputs


def write_aggregate(args: argparse.Namespace, family: dict[str, Any], layer: dict[str, Any], boundary_set: BoundarySet, variables: list[dict[str, Any]], buckets: dict[str, dict[str, Any]], source_stats: dict[str, int]) -> dict[str, Any]:
    rows = []
    for bucket in buckets.values():
        values = {}
        counts = {}
        mins = {}
        maxes = {}
        for variable in variables:
            prop = variable["property"]
            stats = bucket["values"][prop]
            if stats["count"] <= 0:
                continue
            values[prop] = stats["sum"] / stats["count"]
            counts[prop] = stats["count"]
            mins[prop] = stats["min"]
            maxes[prop] = stats["max"]
        if values:
            rows.append({
                "boundaryId": bucket["boundary"].id,
                "boundaryName": bucket["boundary"].name,
                "values": values,
                "counts": counts,
                "min": mins,
                "max": maxes,
            })

    relative_path = f"{boundary_set.source}/{boundary_set.level}/{family['id']}_{layer['year']}_aggregate.json"
    public_url = f"{args.public_base_url.rstrip('/')}/{args.r2_prefix.strip('/')}/{relative_path}"
    aggregate = {
        "version": 2,
        "generatedAt": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        "method": "postal-code-point",
        "caveat": "Aggregated directly from CANUE postal-code rows by DMTI_SLI point-in-boundary membership. Postal points in overlapping polygons contribute to each containing boundary unless --match-mode first is used.",
        "family": family["id"],
        "familyLabel": family["label"],
        "year": layer["year"],
        "view": "bc",
        "mode": "postal",
        "source": boundary_set.source,
        "level": boundary_set.level,
        "idField": boundary_set.id_field,
        "nameField": boundary_set.name_field,
        "boundaryCount": len(boundary_set.boundaries),
        "validBoundaryCount": len(rows),
        "variables": [
            {
                "property": variable["property"],
                "dataset": variable["dataset"],
                "variable": variable["variable"],
                "metadataRef": variable.get("metadataRef"),
            }
            for variable in variables
        ],
        "sourceStats": source_stats,
        "rows": rows,
        "publicUrl": public_url,
    }

    out_path = Path(args.output_dir) / relative_path
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(aggregate, separators=(",", ":")) + "\n", encoding="utf-8")
    return {
        "source": boundary_set.source,
        "level": boundary_set.level,
        "family": family["id"],
        "year": layer["year"],
        "path": relative_path,
        "url": public_url,
        "bytes": out_path.stat().st_size,
        "boundaryCount": len(boundary_set.boundaries),
        "validBoundaryCount": len(rows),
        "variables": len(variables),
        **source_stats,
    }


def main() -> None:
    args = parse_args()
    family_builder = load_family_builder()
    v1 = family_builder.load_v1_module()
    catalog = json.loads(Path(args.catalog).read_text(encoding="utf-8"))
    plan = json.loads(Path(args.plan).read_text(encoding="utf-8"))
    boundary_configs = [
        config for config in BOUNDARY_LEVELS
        if (not args.source or config[0] == args.source) and (not args.level or config[1] == args.level)
    ]
    boundary_sets = [load_boundary_set(config) for config in boundary_configs]
    membership_cache: dict[tuple[int, str], dict[str, list[Boundary]]] = {}
    outputs = []
    errors = []

    for family in catalog.get("families", []):
        if args.family and family["id"] != args.family:
            continue
        for layer in family.get("layers", []):
            if args.year is not None and layer["year"] != args.year:
                continue
            if args.skip_existing and all((Path(args.output_dir) / boundary_set.source / boundary_set.level / f"{family['id']}_{layer['year']}_aggregate.json").exists() for boundary_set in boundary_sets):
                continue
            try:
                layer_outputs = aggregate_layer(family_builder, v1, plan, family, layer, boundary_sets, membership_cache, args)
                outputs.extend(layer_outputs)
                for item in layer_outputs:
                    print(f"{family['id']} {layer['year']} {item['source']}/{item['level']}: {item['validBoundaryCount']}/{item['boundaryCount']} boundaries, {item['matchedRowCount']}/{item['sourceRowCount']} postal matches")
            except Exception as error:  # noqa: BLE001
                failure = {"family": family["id"], "year": layer["year"], "error": str(error)}
                errors.append(failure)
                print(f"FAILED {family['id']} {layer['year']}: {error}", file=sys.stderr)
                if not args.continue_on_error:
                    raise

    aggregate_catalog = {
        "version": 2,
        "generatedAt": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        "method": "postal-code-point",
        "sourceCatalog": str(Path(args.catalog).resolve()),
        "sourcePlan": str(Path(args.plan).resolve()),
        "r2Prefix": args.r2_prefix,
        "publicBaseUrl": args.public_base_url,
        "matchMode": args.match_mode,
        "boundaryLevels": [
            {
                "source": boundary_set.source,
                "level": boundary_set.level,
                "path": boundary_set.file,
                "idField": boundary_set.id_field,
                "nameField": boundary_set.name_field,
                "boundaryCount": len(boundary_set.boundaries),
            }
            for boundary_set in boundary_sets
        ],
        "files": outputs,
        "errors": errors,
    }
    Path(args.output_dir).mkdir(parents=True, exist_ok=True)
    (Path(args.output_dir) / "canue-bc-aggregates-v2-catalog.json").write_text(json.dumps(aggregate_catalog, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(outputs)} postal aggregate files with {len(errors)} errors to {args.output_dir}")


if __name__ == "__main__":
    main()
