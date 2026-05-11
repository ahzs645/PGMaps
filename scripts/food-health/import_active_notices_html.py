#!/usr/bin/env python3
"""Import HealthSpace active water notices from a saved HTML fragment/page."""

import argparse
from pathlib import Path

from bs4 import BeautifulSoup

from download_water_data import load_json_list, parse_notice_blocks, save_json


PRESERVE_FIELDS = {
    "facility_name",
    "facility_location",
    "facility_type",
    "current_hazard_rating",
    "notice_details",
    "inspections",
    "details_fetched_at",
    "latitude",
    "longitude",
    "google_geocode_query",
    "google_geocode_status",
    "google_geocoded_at",
    "google_geocoded_address",
    "google_place_id",
    "google_location_type",
    "google_partial_match",
    "google_geocode_error",
    "google_geocode_quality",
    "google_geocode_quality_issues",
    "google_expected_city_distance_km",
    "google_geocode_override",
}


def merge_notice(existing_by_url, notice):
    existing = existing_by_url.get(notice.get("details_url")) or {}
    merged = dict(notice)
    for field in PRESERVE_FIELDS:
        if field in existing and field not in merged:
            merged[field] = existing[field]
    return merged


def main():
    parser = argparse.ArgumentParser(description="Import active notices from saved HealthSpace HTML")
    parser.add_argument("html_file", help="Saved HealthSpace Water-List-Boil HTML file")
    parser.add_argument(
        "--output",
        default="data/water/active_water_notices.json",
        help="Output active notices JSON path",
    )
    args = parser.parse_args()

    html = Path(args.html_file).read_text(encoding="utf-8")
    notices = parse_notice_blocks(BeautifulSoup(html, "html.parser"))
    output_path = Path(args.output)
    existing = load_json_list(output_path)
    existing_by_url = {record.get("details_url"): record for record in existing}
    merged = [merge_notice(existing_by_url, notice) for notice in notices]
    save_json(merged, output_path)

    print(f"Parsed {len(notices)} notices from {args.html_file}")
    print(f"Saved {len(merged)} notices to {output_path}")
    print(f"With start_date: {sum(1 for notice in merged if notice.get('start_date'))}")


if __name__ == "__main__":
    main()
