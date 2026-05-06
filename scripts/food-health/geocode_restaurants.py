#!/usr/bin/env python3
"""
Geocode restaurant addresses to get lat/lng coordinates.
Uses OpenStreetMap Nominatim (free, no API key needed).
Saves progress incrementally.
"""

import json
import re
import time

PRINCE_GEORGE_BOUNDS = {
    "min_lat": 53.5,
    "max_lat": 54.2,
    "min_lon": -123.4,
    "max_lon": -122.1,
}


def is_in_prince_george_area(location):
    """Reject ambiguous geocoder matches outside the Prince George region."""
    return (
        PRINCE_GEORGE_BOUNDS["min_lat"] <= location.latitude <= PRINCE_GEORGE_BOUNDS["max_lat"]
        and PRINCE_GEORGE_BOUNDS["min_lon"] <= location.longitude <= PRINCE_GEORGE_BOUNDS["max_lon"]
    )


def address_candidates(restaurant):
    """Build geocoding candidates from HealthSpace address formats."""
    raw_address = restaurant.get('full_address') or restaurant.get('address')
    if not raw_address:
        return []

    candidates = []

    def add(value):
        value = re.sub(r'\s+', ' ', value).strip(' ,')
        if value and value not in candidates:
            candidates.append(value)

    address = raw_address.strip()
    add(address)

    if 'BC' not in address and 'British Columbia' not in address:
        add(f"{address}, BC, Canada")
    elif 'Canada' not in address:
        add(f"{address}, Canada")

    base = restaurant.get('address') or address.split(',')[0]
    city_address = f"{base}, Prince George, BC, Canada"
    add(city_address)

    # HealthSpace often formats suites as "403 - 401 3rd Avenue"; Nominatim
    # usually performs better when the unit prefix is removed.
    unitless = re.sub(r'^(?:unit\s+|suite\s+)?[A-Za-z0-9# -]+\s+-\s+', '', base, flags=re.IGNORECASE)
    if unitless != base:
        add(f"{unitless}, Prince George, BC, Canada")

    no_postal = re.sub(r',\s*[A-Z]\d[A-Z]\s*\d[A-Z]\d(?:,\s*Canada)?$', ', Canada', address, flags=re.IGNORECASE)
    if no_postal != address:
        add(no_postal)

    return candidates


def geocode_restaurants(input_file="prince_george_restaurants_full.json", delay=1.5):
    """
    Add latitude/longitude coordinates to each restaurant.

    Args:
        input_file: JSON file with restaurant data
        delay: Seconds between geocoding requests (Nominatim requires 1s minimum)
    """
    # Load data
    with open(input_file, 'r') as f:
        data = json.load(f)

    try:
        from geopy.geocoders import Nominatim
        from geopy.extra.rate_limiter import RateLimiter
    except ImportError as exc:
        raise SystemExit(
            "Missing Python dependency: geopy. "
            "Install scraper dependencies with: "
            "pip install -r scripts/food-health/requirements.txt"
        ) from exc

    # Set up geocoder with rate limiting and longer timeout
    geolocator = Nominatim(user_agent="pg_restaurant_api/1.0", timeout=10)
    geocode = RateLimiter(geolocator.geocode, min_delay_seconds=delay, max_retries=3)

    # Count stats
    already_geocoded = sum(1 for r in data if r.get('latitude'))
    print(f"Loaded {len(data)} restaurants")
    print(f"Already geocoded: {already_geocoded}")
    print(f"Remaining: {len(data) - already_geocoded}")
    print("=" * 60)

    success_count = 0
    fail_count = 0
    skip_count = 0

    for i, restaurant in enumerate(data):
        name = restaurant.get('name', 'Unknown')

        # Skip if already geocoded
        if restaurant.get('latitude') and restaurant.get('longitude'):
            skip_count += 1
            print(f"[{i+1}/{len(data)}] SKIP: {name} (already geocoded)")
            continue

        candidates = address_candidates(restaurant)
        if not candidates:
            print(f"[{i+1}/{len(data)}] SKIP: {name} (no address)")
            fail_count += 1
            continue

        print(f"[{i+1}/{len(data)}] Geocoding: {name}")
        print(f"  Address: {candidates[0]}")

        try:
            location = None
            for candidate in candidates:
                candidate_location = geocode(candidate)
                if candidate_location and is_in_prince_george_area(candidate_location):
                    location = candidate_location
                    restaurant['geocoded_query'] = candidate
                    break
                if candidate_location:
                    print(
                        f"  Rejected out-of-area match: "
                        f"{candidate_location.latitude}, {candidate_location.longitude}"
                    )

            if location:
                restaurant['latitude'] = location.latitude
                restaurant['longitude'] = location.longitude
                restaurant['geocoded_address'] = location.address
                restaurant.pop('geocode_error', None)
                success_count += 1
                print(f"  Found: {location.latitude}, {location.longitude}")
            else:
                restaurant['geocode_error'] = "Address not found"
                fail_count += 1
                print(f"  NOT FOUND")

            # Save progress after each geocode
            save_progress(data, input_file)

        except Exception as e:
            restaurant['geocode_error'] = str(e)
            fail_count += 1
            print(f"  ERROR: {e}")
            save_progress(data, input_file)

    print("\n" + "=" * 60)
    print("COMPLETE!")
    print(f"Successfully geocoded: {success_count}")
    print(f"Failed: {fail_count}")
    print(f"Skipped (already done): {skip_count}")
    print("=" * 60)

    return data


def save_progress(data, filename):
    """Save current progress to file"""
    with open(filename, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


if __name__ == "__main__":
    import sys

    input_file = "prince_george_restaurants_full.json"
    delay = 1.5  # Nominatim requires at least 1 second between requests

    # Parse args
    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == '--file' and i + 1 < len(args):
            input_file = args[i + 1]
            i += 2
        elif args[i] == '--delay' and i + 1 < len(args):
            delay = float(args[i + 1])
            i += 2
        elif args[i] in ['--help', '-h']:
            print("Usage: python geocode_restaurants.py [--file FILE] [--delay SECONDS]")
            print("  --file FILE    Input JSON file (default: prince_george_restaurants_full.json)")
            print("  --delay SECS   Delay between requests (default: 1.5, min 1.0)")
            sys.exit(0)
        else:
            i += 1

    print("=" * 60)
    print("Restaurant Geocoder")
    print(f"Input file: {input_file}")
    print(f"Delay: {delay}s between requests")
    print("=" * 60)
    print("\nThis script saves progress after each restaurant.")
    print("If interrupted, just run again to resume.\n")

    geocode_restaurants(input_file=input_file, delay=delay)
