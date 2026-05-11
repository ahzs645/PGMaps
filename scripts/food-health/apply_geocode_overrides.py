#!/usr/bin/env python3
"""Apply manual geocode overrides to restaurant and water JSON files."""

import argparse
from pathlib import Path

from geocode_google_all import DEFAULT_RESTAURANTS, DEFAULT_WATER_DIR, WATER_FILES, read_json, write_json


def record_name(record):
    return record.get("facility_name") or record.get("name")


def record_city(record):
    return record.get("city") or record.get("location_summary")


def matches(record, override):
    if record_name(record) != override["name"]:
        return False
    expected_city = override.get("city")
    return not expected_city or record_city(record) == expected_city


def apply_override(record, override):
    record["latitude"] = override["latitude"]
    record["longitude"] = override["longitude"]
    record["google_geocoded_address"] = override["formatted_address"]
    record["google_location_type"] = override["location_type"]
    record["google_geocode_quality"] = override["quality"]
    record["google_geocode_quality_issues"] = [] if override["quality"] == "ok" else ["manual_review"]
    record["google_partial_match"] = override["quality"] != "ok"
    record["google_geocode_override"] = {
        "applied": True,
        "notes": override.get("notes"),
        "sources": override.get("sources") or [],
    }
    record.pop("google_expected_city_distance_km", None)


def apply_to_file(path, overrides):
    records = read_json(path)
    count = 0
    for record in records:
        for override in overrides:
            if matches(record, override):
                apply_override(record, override)
                count += 1
                break
    write_json(path, records)
    return count


def main():
    parser = argparse.ArgumentParser(description="Apply manual geocode overrides")
    parser.add_argument("--overrides", default="data/geocoding/geocode_location_overrides.json")
    parser.add_argument("--restaurants", default=DEFAULT_RESTAURANTS)
    parser.add_argument("--water-dir", default=DEFAULT_WATER_DIR)
    args = parser.parse_args()

    overrides = read_json(args.overrides)
    results = {}
    results["restaurants"] = apply_to_file(Path(args.restaurants), overrides)
    water_dir = Path(args.water_dir)
    for dataset, filename in WATER_FILES.items():
        results[f"water_{dataset}"] = apply_to_file(water_dir / filename, overrides)
    print(results)


if __name__ == "__main__":
    main()
