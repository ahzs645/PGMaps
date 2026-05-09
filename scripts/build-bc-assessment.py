#!/usr/bin/env python3
"""
Merge BC Assessment parcel geometries with property data from CSVs,
then spatial-join each property to configured study-area boundaries.

Input:
  - scripts/bc-assessment-source/prince_george_parcels.geojson  (30K parcel polygons)
  - scripts/bc-assessment-source/prince_george_full.csv          (assessment + detail data)
  - public/data/census/prince_george_{ct,da,db}.geo.json         (census boundaries)
  - public/data/boundaries/*                                     (health, school, regional, watershed boundaries)

Output:
  - public/data/bc-assessment/parcels.geojson     (enriched GeoJSON with boundary IDs)
"""

import csv
import json
import os
import re
import sys

from shapely.geometry import GeometryCollection, MultiPolygon, Point, Polygon, shape, mapping
from shapely.errors import ShapelyError
from shapely.validation import explain_validity
from shapely import make_valid
from shapely.strtree import STRtree

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)

SOURCE_DIR = os.path.join(SCRIPT_DIR, "bc-assessment-source")

GEOJSON_PATH = os.path.join(SOURCE_DIR, "prince_george_parcels.geojson")
CSV_PATH = os.path.join(SOURCE_DIR, "prince_george_full.csv")

OUTPUT_DIR = os.path.join(PROJECT_ROOT, "public", "data", "bc-assessment")
OUTPUT_PATH = os.path.join(OUTPUT_DIR, "parcels.geojson")

CENSUS_DIR = os.path.join(PROJECT_ROOT, "public", "data", "census")
BOUNDARY_DIR = os.path.join(PROJECT_ROOT, "public", "data", "boundaries")
BOUNDARY_LEVELS = {
    "ct": {
        "path": os.path.join(CENSUS_DIR, "prince_george_ct.geo.json"),
        "code_props": ["id"],
    },
    "da": {
        "path": os.path.join(CENSUS_DIR, "prince_george_da.geo.json"),
        "code_props": ["id"],
    },
    "db": {
        "path": os.path.join(CENSUS_DIR, "prince_george_db.geo.json"),
        "code_props": ["id"],
    },
    "healthAuthority": {
        "path": os.path.join(BOUNDARY_DIR, "BCMoH", "simplified", "health_authorities.json"),
        "code_props": ["HLTH_AUTHORITY_CODE"],
    },
    "hsda": {
        "path": os.path.join(BOUNDARY_DIR, "BCMoH", "simplified", "health_service_delivery_areas.json"),
        "code_props": ["HLTH_SERVICE_DLVR_AREA_CODE"],
    },
    "lha": {
        "path": os.path.join(BOUNDARY_DIR, "BCMoH", "simplified", "local_health_areas.json"),
        "code_props": ["LOCAL_HLTH_AREA_CODE"],
    },
    "chsa": {
        "path": os.path.join(BOUNDARY_DIR, "BCMoH", "simplified", "community_health_service_areas.json"),
        "code_props": ["CMNTY_HLTH_SERV_AREA_CODE"],
    },
    "regionalDistrict": {
        "path": os.path.join(BOUNDARY_DIR, "BC", "regional_districts.geojson"),
        "code_props": ["ADMIN_AREA_ABBREVIATION", "LGL_ADMIN_AREA_ID"],
    },
    "elementarySchoolCatchment": {
        "path": os.path.join(BOUNDARY_DIR, "CityPG", "elementary_school_catchments.geojson"),
        "code_props": ["OBJECTID"],
    },
    "secondarySchoolCatchment": {
        "path": os.path.join(BOUNDARY_DIR, "CityPG", "secondary_school_catchments.geojson"),
        "code_props": ["OBJECTID"],
    },
    "majorWatershed": {
        "path": os.path.join(BOUNDARY_DIR, "BCFWA", "major_watersheds.geojson"),
        "code_props": ["boundaryCode", "OBJECTID"],
    },
    "watershedGroup": {
        "path": os.path.join(BOUNDARY_DIR, "BCFWA", "watershed_groups.geojson"),
        "code_props": ["boundaryCode", "OBJECTID"],
    },
    "assessmentWatershed": {
        "path": os.path.join(BOUNDARY_DIR, "BCFWA", "assessment_watersheds.geojson"),
        "code_props": ["boundaryCode", "OBJECTID"],
    },
}


def categorize(description: str) -> str:
    """Classify property description into a broad category."""
    d = description.lower()

    # Vacant
    if "vacant" in d:
        return "vacant"

    # Multi-family / strata
    if any(k in d for k in ["strata", "multiple residence", "apartment", "4-plex", "triplex"]):
        return "multi-family"

    # Residential
    if any(k in d for k in [
        "house", "duplex", "mh -", "mobile home", "modular",
        "single family", "residential", "dwelling", "cottage",
        "townhouse",  # non-strata townhouse
    ]):
        return "residential"

    # Commercial
    if any(k in d for k in [
        "office", "retail", "restaurant", "hotel", "motel", "store",
        "shopping", "bank", "commercial", "theatre", "cinema",
        "gas station", "car wash", "service station", "food",
        "medical", "dental", "veterinary", "pharmacy",
    ]):
        return "commercial"

    # Industrial
    if any(k in d for k in [
        "warehouse", "industrial", "manufacturing", "mill",
        "service repair", "shop", "plant", "yard", "storage",
        "truck", "freight", "lumber", "gravel", "concrete",
    ]):
        return "industrial"

    # Institutional
    if any(k in d for k in [
        "church", "school", "hospital", "government", "fire hall",
        "community", "library", "arena", "recreation", "civic",
        "daycare", "care facility", "lodge", "seniors",
    ]):
        return "institutional"

    # Farm / forestry
    if any(k in d for k in ["farm", "ranch", "forest", "agricultural", "crop"]):
        return "farm"

    return "other"


def centroid_of(geometry: dict) -> tuple[float, float]:
    """Get the centroid (lng, lat) of a GeoJSON geometry."""
    geom = shape(geometry)
    c = geom.centroid
    return (c.x, c.y)


def extract_polygonal(geom):
    """Return only polygonal members from a repaired geometry."""
    if isinstance(geom, (Polygon, MultiPolygon)):
        return geom
    if isinstance(geom, GeometryCollection):
        polygons = []
        for part in geom.geoms:
            polygonal = extract_polygonal(part)
            if isinstance(polygonal, Polygon):
                polygons.append(polygonal)
            elif isinstance(polygonal, MultiPolygon):
                polygons.extend(polygonal.geoms)
        if len(polygons) == 1:
            return polygons[0]
        if polygons:
            return MultiPolygon(polygons)
    return geom


def group_polygon_rings(rings: list) -> Polygon | MultiPolygon:
    """Convert disjoint ArcGIS-style rings that were serialized as holes."""
    shells: list[dict] = []

    for ring in rings:
        ring_polygon = Polygon(ring)
        if ring_polygon.is_empty:
            continue

        point = ring_polygon.representative_point()
        containers = [
            (shell["polygon"].area, idx)
            for idx, shell in enumerate(shells)
            if shell["polygon"].contains(point)
        ]

        if containers:
            _, idx = min(containers)
            shells[idx]["holes"].append(ring)
        else:
            shells.append({"polygon": ring_polygon, "holes": []})

    polygons = [
        Polygon(shell["polygon"].exterior.coords, shell["holes"])
        for shell in shells
    ]

    if len(polygons) == 1:
        return polygons[0]
    return MultiPolygon(polygons)


def normalize_geometry(geometry: dict):
    """Repair BC Assessment parcel geometry while preserving polygonal shape."""
    geom = shape(geometry)
    reason = None
    action = "unchanged"

    if not geom.is_valid:
        reason = explain_validity(geom)
        if geometry.get("type") == "Polygon" and "Hole lies outside shell" in reason:
            geom = group_polygon_rings(geometry["coordinates"])
            action = "grouped_rings"

        if not geom.is_valid:
            geom = extract_polygonal(make_valid(geom))
            action = "make_valid"

    if geom.is_empty or not isinstance(geom, (Polygon, MultiPolygon)):
        raise ValueError(f"Unable to repair parcel geometry: {reason or geom.geom_type}")

    if not geom.is_valid:
        raise ValueError(f"Geometry remains invalid after repair: {explain_validity(geom)}")

    return mapping(geom), action, reason


def normalize_feature_geometries(features: list[dict]) -> None:
    """Normalize all parcel geometries in-place and print a compact report."""
    grouped = 0
    repaired = 0

    for feature in features:
        normalized, action, _reason = normalize_geometry(feature["geometry"])
        feature["geometry"] = normalized
        if action == "grouped_rings":
            grouped += 1
        elif action == "make_valid":
            repaired += 1

    print(f"  Geometry fixes: grouped rings={grouped}, make_valid={repaired}")


def build_spatial_index(boundary_path: str) -> tuple[STRtree, list[dict]]:
    """Load boundary GeoJSON and build an STRtree spatial index."""
    with open(boundary_path, encoding="utf-8") as f:
        geo = json.load(f)
    polys = []
    features_list = []
    for feat in geo["features"]:
        if not feat.get("geometry"):
            continue
        try:
            geom = shape(feat["geometry"])
        except (IndexError, KeyError, TypeError, ShapelyError):
            continue
        if geom.is_empty or not isinstance(geom, (Polygon, MultiPolygon)):
            continue
        polys.append(geom)
        features_list.append(feat)
    tree = STRtree(polys)
    return tree, features_list


def boundary_code(feature: dict, code_props: list[str]) -> str | None:
    props = feature.get("properties") or {}
    for prop in code_props:
        value = props.get(prop)
        if value is not None and str(value).strip():
            return str(value).strip()
    value = feature.get("id")
    if value is not None and str(value).strip():
        return str(value).strip()
    return None


def spatial_join_level(
    features: list[dict], level_key: str, boundary_path: str, code_props: list[str]
) -> int:
    """Assign boundary ID for a configured level to each parcel feature."""
    print(f"  Spatial join: {level_key} from {os.path.basename(boundary_path)}...")
    tree, boundary_features = build_spatial_index(boundary_path)
    boundary_geoms = [shape(f["geometry"]) for f in boundary_features]

    assigned = 0
    for feature in features:
        lng, lat = centroid_of(feature["geometry"])
        pt = Point(lng, lat)

        # Query the STRtree for candidate boundaries
        candidate_idxs = tree.query(pt)
        for idx in candidate_idxs:
            if boundary_geoms[idx].contains(pt):
                bid = boundary_code(boundary_features[idx], code_props)
                if bid is not None:
                    feature["properties"][level_key] = str(bid)
                    assigned += 1
                break

    print(f"    Assigned {assigned}/{len(features)} properties")
    return assigned


def parse_int(val: str) -> int | None:
    """Parse a string as int, return None if empty or invalid."""
    val = val.strip()
    if not val:
        return None
    try:
        return int(val)
    except ValueError:
        # Try removing commas, dollar signs
        cleaned = re.sub(r"[,$]", "", val)
        try:
            return int(float(cleaned))
        except ValueError:
            return None


def parse_hist_values(val: str) -> list[int] | None:
    """Parse the historical values JSON string from CSV."""
    val = val.strip()
    if not val:
        return None
    try:
        parsed = json.loads(val)
        return [int(v) for v in parsed]
    except (json.JSONDecodeError, ValueError):
        return None


def main():
    if not os.path.exists(GEOJSON_PATH):
        print(f"Error: GeoJSON not found at {GEOJSON_PATH}")
        sys.exit(1)
    if not os.path.exists(CSV_PATH):
        print(f"Error: CSV not found at {CSV_PATH}")
        sys.exit(1)

    # 1. Load CSV data keyed by OID_EVBC
    print(f"Loading CSV from {CSV_PATH}...")
    csv_data: dict[str, dict] = {}
    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            oid = row["OID_EVBC"].strip()
            csv_data[oid] = row
    print(f"  Loaded {len(csv_data)} property records")

    # 2. Load GeoJSON
    print(f"Loading GeoJSON from {GEOJSON_PATH}...")
    with open(GEOJSON_PATH, encoding="utf-8") as f:
        geojson = json.load(f)
    features = geojson["features"]
    print(f"  Loaded {len(features)} parcel features")

    # 3. Normalize geometry before spatial joins and MapLibre rendering.
    print("Normalizing parcel geometries...")
    normalize_feature_geometries(features)

    # 4. Enrich features
    print("Merging data...")
    matched = 0
    unmatched = 0

    for feature in features:
        props = feature["properties"]
        oid = props.get("oid_evbc", "")
        row = csv_data.get(oid)

        if row:
            matched += 1
            desc = row.get("DESCRIPTION", "").strip()
            total_assessed = parse_int(row.get("TOTAL_ASSESSED", ""))
            total_land = parse_int(row.get("TOTAL_LAND", ""))
            total_building = parse_int(row.get("TOTAL_BUILDING", ""))

            # Use compact property names to reduce file size
            props["desc"] = desc
            props["cat"] = categorize(desc)
            if total_assessed is not None:
                props["val"] = total_assessed
            if total_land is not None:
                props["land"] = total_land
            if total_building is not None:
                props["bldg"] = total_building

            yr = parse_int(row.get("YEAR_BUILT", ""))
            if yr:
                props["yr"] = yr

            bed = parse_int(row.get("BEDROOMS", ""))
            if bed:
                props["bed"] = bed

            bath = parse_int(row.get("BATHROOMS", ""))
            if bath:
                props["bath"] = bath

            sz = row.get("LAND_SIZE", "").strip()
            if sz:
                props["sz"] = sz

            tfa = parse_int(row.get("TOTAL_FINISHED_AREA", ""))
            if tfa:
                props["tfa"] = tfa

            pid = row.get("PID", "").strip()
            if pid:
                props["pid"] = pid

            sale_price = parse_int(row.get("SALE_PRICE", ""))
            if sale_price:
                props["sale"] = sale_price

            sale_date = row.get("LAST_SALE_DATE", "").strip()
            if sale_date:
                props["saleDate"] = sale_date

            hist = parse_hist_values(row.get("HIST_VALUES_10Y", ""))
            if hist:
                props["hist"] = hist
        else:
            unmatched += 1

    print(f"  Matched: {matched}, Unmatched: {unmatched}")

    # 5. Spatial join — assign study-area boundary IDs
    print("Running spatial joins...")
    for level_key, config in BOUNDARY_LEVELS.items():
        boundary_path = config["path"]
        if os.path.exists(boundary_path):
            spatial_join_level(features, level_key, boundary_path, config["code_props"])
        else:
            print(f"  Skipping {level_key}: {boundary_path} not found")

    # 6. Write output
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    print(f"Writing enriched GeoJSON to {OUTPUT_PATH}...")
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(geojson, f, separators=(",", ":"))

    size_mb = os.path.getsize(OUTPUT_PATH) / (1024 * 1024)
    print(f"  Output size: {size_mb:.1f} MB")
    print("Done!")


if __name__ == "__main__":
    main()
