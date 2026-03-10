#!/usr/bin/env python3
"""
Fetch census data for Prince George, BC at ALL geographic hierarchy levels:
  DB (Dissemination Block) -> DA (Dissemination Area) -> CT (Census Tract) ->
  CSD (Census Subdivision) -> CD (Census Division)

Uses CensusMapper API: https://censusmapper.ca/api
"""

import requests
import json
import csv
import os
import time
from io import StringIO

BASE_URL = "https://censusmapper.ca/api/v1"
API_KEY = "CensusMapper_c36f7ab0a43132b3d0b8e83538c4de57"

# Prince George identifiers
PRINCE_GEORGE_CSD = "5953023"   # Census Subdivision (city)
PRINCE_GEORGE_CD = "5953"       # Census Division (Fraser-Fort George)
PRINCE_GEORGE_CMA = "59970"     # CMA/CA code for Prince George

# Census vectors to fetch
VECTORS = [
    "v_CA21_1",    # Population 2021
    "v_CA21_2",    # Population 2016
    "v_CA21_3",    # Population % change 2016-2021
    "v_CA21_4",    # Total private dwellings
    "v_CA21_6",    # Population density per sq km
    "v_CA21_7",    # Land area in sq km
    "v_CA21_8",    # Total - Age
    "v_CA21_434",  # Occupied private dwellings by structural type
]

# Define all levels to fetch, from smallest to largest
# Each entry: (level, regions_dict, description)
LEVELS_TO_FETCH = [
    {
        "level": "DB",
        "regions": {"CSD": [PRINCE_GEORGE_CSD]},
        "description": "Dissemination Block (smallest unit)",
    },
    {
        "level": "DA",
        "regions": {"CSD": [PRINCE_GEORGE_CSD]},
        "description": "Dissemination Area",
    },
    {
        "level": "CT",
        "regions": {"CMA": [PRINCE_GEORGE_CMA]},
        "description": "Census Tract",
    },
    {
        "level": "CSD",
        "regions": {"CD": [PRINCE_GEORGE_CD]},
        "description": "Census Subdivision",
    },
    {
        "level": "CD",
        "regions": {"CD": [PRINCE_GEORGE_CD]},
        "description": "Census Division",
    },
]

OUTPUT_DIR = "/Users/ahmadjalil/Desktop/census"


def fetch_data(level: str, regions: dict, vectors: list) -> dict:
    """Fetch tabular census data."""
    endpoint = f"{BASE_URL}/data.csv"
    payload = {
        "api_key": API_KEY,
        "dataset": "CA21",
        "level": level,
        "regions": json.dumps(regions),
        "vectors": json.dumps(vectors),
        "geo_hierarchy": "true",
    }

    print(f"  Fetching tabular data...")
    response = requests.post(endpoint, data=payload)

    if response.status_code != 200:
        print(f"  ERROR {response.status_code}: {response.text[:300]}")
        return None

    # Parse CSV to list of dicts
    reader = csv.DictReader(StringIO(response.text))
    data = [row for row in reader]
    return {"data": data, "count": len(data)}


def fetch_geojson(level: str, regions: dict) -> dict:
    """Fetch GeoJSON boundaries."""
    endpoint = f"{BASE_URL}/geo.geojson"
    payload = {
        "api_key": API_KEY,
        "dataset": "CA21",
        "level": level,
        "regions": json.dumps(regions),
        "resolution": "simplified",
    }

    print(f"  Fetching GeoJSON boundaries...")
    response = requests.post(endpoint, data=payload)

    if response.status_code != 200:
        print(f"  ERROR {response.status_code}: {response.text[:300]}")
        return None

    return response.json()


def save_json(data, filename):
    """Save data to JSON file."""
    filepath = os.path.join(OUTPUT_DIR, filename)
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"  Saved: {filepath}")


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    print("=" * 70)
    print("Census Data Fetcher - All Levels for Prince George, BC")
    print("=" * 70)
    print(f"\nLevels to fetch: DB -> DA -> CT -> CSD -> CD")
    print(f"Dataset: CA21 (2021 Census)")
    print(f"Output directory: {OUTPUT_DIR}\n")

    summary = {}

    for config in LEVELS_TO_FETCH:
        level = config["level"]
        regions = config["regions"]
        desc = config["description"]

        print(f"\n{'─' * 60}")
        print(f"Level: {level} - {desc}")
        print(f"Region filter: {regions}")
        print(f"{'─' * 60}")

        # Fetch tabular data
        # Note: DB level may not support all vectors
        data = fetch_data(level, regions, VECTORS)
        if data and data.get("data"):
            data_file = f"prince_george_{level.lower()}_data.json"
            save_json(data, data_file)
            record_count = data["count"]
            print(f"  Records: {record_count}")
            summary[level] = {"data_records": record_count}
        else:
            print(f"  No tabular data returned for level {level}")
            # Try without vectors for DB (some levels have limited vector support)
            if level == "DB":
                print(f"  Retrying DB without vectors...")
                data = fetch_data(level, regions, [])
                if data and data.get("data"):
                    data_file = f"prince_george_{level.lower()}_data.json"
                    save_json(data, data_file)
                    record_count = data["count"]
                    print(f"  Records (no vectors): {record_count}")
                    summary[level] = {"data_records": record_count}
                else:
                    summary[level] = {"data_records": 0, "error": "no data"}

        # Brief pause to be nice to the API
        time.sleep(1)

        # Fetch GeoJSON
        geojson = fetch_geojson(level, regions)
        if geojson and geojson.get("features"):
            geo_file = f"prince_george_{level.lower()}_geo.json"
            save_json(geojson, geo_file)
            feature_count = len(geojson["features"])
            print(f"  GeoJSON features: {feature_count}")
            if level in summary:
                summary[level]["geo_features"] = feature_count
        else:
            print(f"  No GeoJSON returned for level {level}")
            if level in summary:
                summary[level]["geo_features"] = 0

        # Brief pause between levels
        time.sleep(2)

    # Print summary
    print(f"\n\n{'=' * 70}")
    print("SUMMARY")
    print(f"{'=' * 70}")
    print(f"{'Level':<8} {'Description':<35} {'Data':>8} {'Geo':>8}")
    print(f"{'─' * 8} {'─' * 35} {'─' * 8} {'─' * 8}")

    for config in LEVELS_TO_FETCH:
        level = config["level"]
        desc = config["description"]
        info = summary.get(level, {})
        data_count = info.get("data_records", "N/A")
        geo_count = info.get("geo_features", "N/A")
        print(f"{level:<8} {desc:<35} {str(data_count):>8} {str(geo_count):>8}")

    # Save summary
    save_json(summary, "fetch_summary.json")
    print(f"\nDone! All files saved to {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
