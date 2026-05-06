#!/usr/bin/env python3
"""
Incremental fetcher for Prince George restaurant data.
Saves progress after each restaurant so it can be resumed if interrupted.
"""

import json
import os
import time
from datetime import datetime
from healthspace_pg_restaurants import HealthSpaceAPI


def fetch_incremental(city="Prince George", output_file=None, max_inspections=None, delay=5):
    """
    Fetch restaurant data incrementally, saving after each restaurant.

    Args:
        city: City to fetch data for
        output_file: Output JSON file (default: {city}_restaurants_full.json)
        max_inspections: Max inspections per restaurant (None for all)
        delay: Seconds to wait between restaurants (default 5, increase if rate limited)
    """
    if output_file is None:
        safe_city = city.lower().replace(' ', '_').replace('.', '')
        output_file = f'{safe_city}_restaurants_full.json'

    api = HealthSpaceAPI(city=city)

    # Load existing data if resuming - use dict to preserve ALL data
    all_data = {}  # name -> restaurant dict (preserves ALL existing data)
    if os.path.exists(output_file):
        with open(output_file, 'r') as f:
            data = json.load(f)
            for r in data:
                all_data[r.get('name')] = r
        # Count successfully fetched (for display)
        success_count = sum(1 for r in all_data.values()
                          if r.get('details_fetched_at') and not r.get('fetch_error'))
        print(f"Loaded {len(all_data)} restaurants from {output_file}")
        print(f"  ({success_count} successfully fetched, {len(all_data) - success_count} need retry)")

    # Get full restaurant list
    print(f"\nFetching restaurant list for {city}...")
    all_restaurants = api.get_all_restaurants()

    if not all_restaurants:
        print("Failed to fetch restaurant list")
        return None

    # Count how many we need to fetch
    already_fetched = sum(1 for r in all_restaurants
                         if r.get('name') in all_data
                         and all_data[r.get('name')].get('details_fetched_at')
                         and not all_data[r.get('name')].get('fetch_error'))

    print(f"Found {len(all_restaurants)} restaurants total")
    print(f"Already fetched: {already_fetched}")
    print(f"Remaining: {len(all_restaurants) - already_fetched}")
    print("=" * 60)

    # Process each restaurant
    fetched_count = 0
    skipped_count = 0

    for i, restaurant in enumerate(all_restaurants):
        name = restaurant.get('name', 'Unknown')

        # Check if already successfully fetched
        if name in all_data:
            existing = all_data[name]
            if existing.get('details_fetched_at') and not existing.get('fetch_error'):
                skipped_count += 1
                print(f"[{i+1}/{len(all_restaurants)}] SKIP: {name} (already fetched)")
                continue

        print(f"\n[{i+1}/{len(all_restaurants)}] Fetching: {name}")

        try:
            # Fetch full details
            api.get_restaurant_full_details(
                restaurant,
                fetch_inspections=True,
                max_inspections=max_inspections
            )
            restaurant['city'] = city
            all_data[name] = restaurant  # Update in our master dict
            fetched_count += 1

            # Save ALL data after each successful fetch (never lose data!)
            save_progress(list(all_data.values()), output_file)
            print(f"  Saved progress ({len(all_data)} restaurants total)")

            # Be respectful - use longer delay to avoid rate limiting
            print(f"  Waiting {delay}s...")
            time.sleep(delay)

        except Exception as e:
            print(f"  ERROR: {e}")
            # Still add basic info
            restaurant['city'] = city
            restaurant['fetch_error'] = str(e)
            all_data[name] = restaurant
            save_progress(list(all_data.values()), output_file)

    print("\n" + "=" * 60)
    print("COMPLETE!")
    print(f"Total restaurants: {len(all_data)}")
    print(f"Newly fetched: {fetched_count}")
    print(f"Skipped (already had): {skipped_count}")
    print(f"Output file: {output_file}")
    print("=" * 60)

    return list(all_data.values())


def save_progress(data, filename):
    """Save current progress to file"""
    with open(filename, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


if __name__ == "__main__":
    import sys

    city = "Prince George"
    output_file = "public/data/restaurants.json"
    delay = 5  # seconds between restaurants

    # Parse args
    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == '--city' and i + 1 < len(args):
            city = args[i + 1]
            i += 2
        elif args[i] == '--output' and i + 1 < len(args):
            output_file = args[i + 1]
            i += 2
        elif args[i] == '--delay' and i + 1 < len(args):
            delay = int(args[i + 1])
            i += 2
        elif args[i] in ['--help', '-h']:
            print("Usage: python fetch_incremental.py [--city NAME] [--output FILE] [--delay SECONDS]")
            print("  --city NAME    City to fetch (default: Prince George)")
            print("  --output FILE  Output JSON file (default: public/data/restaurants.json)")
            print("  --delay SECS   Delay between restaurants (default: 5)")
            sys.exit(0)
        else:
            # Assume first positional arg is city for backwards compat
            city = args[i]
            i += 1

    print("=" * 60)
    print(f"Incremental Restaurant Data Fetcher")
    print(f"City: {city}")
    print(f"Output file: {output_file}")
    print(f"Delay: {delay}s between restaurants")
    print("=" * 60)
    print("\nThis script saves progress after each restaurant.")
    print("If interrupted, just run again to resume.\n")

    fetch_incremental(city=city, output_file=output_file, delay=delay)
