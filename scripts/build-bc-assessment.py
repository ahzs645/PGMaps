#!/usr/bin/env python3
"""
Merge BC Assessment parcel geometries with property data from CSVs.

Input:
  - scripts/bc-assessment-source/prince_george_parcels.geojson  (30K parcel polygons)
  - scripts/bc-assessment-source/prince_george_full.csv          (assessment + detail data)

Output:
  - public/data/bc-assessment/parcels.geojson     (enriched GeoJSON)
"""

import csv
import json
import os
import re
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)

SOURCE_DIR = os.path.join(SCRIPT_DIR, "bc-assessment-source")

GEOJSON_PATH = os.path.join(SOURCE_DIR, "prince_george_parcels.geojson")
CSV_PATH = os.path.join(SOURCE_DIR, "prince_george_full.csv")

OUTPUT_DIR = os.path.join(PROJECT_ROOT, "public", "data", "bc-assessment")
OUTPUT_PATH = os.path.join(OUTPUT_DIR, "parcels.geojson")


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

    # 3. Enrich features
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

    # 4. Write output
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    print(f"Writing enriched GeoJSON to {OUTPUT_PATH}...")
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(geojson, f, separators=(",", ":"))

    size_mb = os.path.getsize(OUTPUT_PATH) / (1024 * 1024)
    print(f"  Output size: {size_mb:.1f} MB")
    print("Done!")


if __name__ == "__main__":
    main()
