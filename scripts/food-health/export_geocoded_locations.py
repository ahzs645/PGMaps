#!/usr/bin/env python3
"""Export a consolidated geocoded location lookup for restaurants and water data."""

import argparse
import json
from pathlib import Path

from geocode_google_all import DEFAULT_RESTAURANTS, DEFAULT_WATER_DIR, WATER_FILES, read_json, write_json


def geocode_fields(record):
    return {
        "latitude": record.get("latitude"),
        "longitude": record.get("longitude"),
        "google_geocode_status": record.get("google_geocode_status"),
        "google_geocode_query": record.get("google_geocode_query"),
        "google_geocoded_address": record.get("google_geocoded_address"),
        "google_place_id": record.get("google_place_id"),
        "google_location_type": record.get("google_location_type"),
        "google_partial_match": record.get("google_partial_match"),
        "google_geocode_error": record.get("google_geocode_error"),
        "google_geocoded_at": record.get("google_geocoded_at"),
    }


def restaurant_row(record, index, source_file):
    return {
        "dataset": "restaurants",
        "source_file": str(source_file),
        "source_index": index,
        "source_name": record.get("name"),
        "source_address": record.get("address"),
        "source_full_address": record.get("full_address"),
        "source_city": record.get("city"),
        "source_facility_location": None,
        "source_location_summary": None,
        "source_details_url": record.get("details_url"),
        **geocode_fields(record),
    }


def water_row(record, dataset, index, source_file):
    return {
        "dataset": f"water_{dataset}",
        "source_file": str(source_file),
        "source_index": index,
        "source_name": record.get("facility_name") or record.get("name"),
        "source_address": None,
        "source_full_address": None,
        "source_city": record.get("city") or record.get("location_summary"),
        "source_facility_location": record.get("facility_location"),
        "source_location_summary": record.get("location_summary"),
        "source_details_url": record.get("details_url"),
        **geocode_fields(record),
    }


def main():
    parser = argparse.ArgumentParser(description="Export consolidated geocoded locations")
    parser.add_argument("--restaurants", default=DEFAULT_RESTAURANTS)
    parser.add_argument("--water-dir", default=DEFAULT_WATER_DIR)
    parser.add_argument("--output", default="data/geocoding/geocoded_locations.json")
    args = parser.parse_args()

    rows = []
    restaurants_path = Path(args.restaurants)
    for index, record in enumerate(read_json(restaurants_path)):
        rows.append(restaurant_row(record, index, restaurants_path))

    water_dir = Path(args.water_dir)
    for dataset, filename in WATER_FILES.items():
        source_file = water_dir / filename
        for index, record in enumerate(read_json(source_file)):
            rows.append(water_row(record, dataset, index, source_file))

    summary = {
        "row_count": len(rows),
        "with_coordinates": sum(row["latitude"] is not None and row["longitude"] is not None for row in rows),
        "partial_matches": sum(bool(row["google_partial_match"]) for row in rows),
        "datasets": {},
    }
    for row in rows:
        dataset = row["dataset"]
        item = summary["datasets"].setdefault(
            dataset,
            {"row_count": 0, "with_coordinates": 0, "partial_matches": 0},
        )
        item["row_count"] += 1
        if row["latitude"] is not None and row["longitude"] is not None:
            item["with_coordinates"] += 1
        if row["google_partial_match"]:
            item["partial_matches"] += 1

    write_json(args.output, {"summary": summary, "locations": rows})
    print(f"Saved {len(rows)} geocoded location rows to {args.output}")


if __name__ == "__main__":
    main()
