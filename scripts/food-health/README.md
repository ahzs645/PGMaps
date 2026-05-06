# Food Health Scrapers

These scripts were brought over from `PGFoodHealth` so `PGMaps` can refresh its Northern Health Authority HealthSpace restaurant inspection dataset directly.

## Setup

```bash
python3 -m venv .venv-food-health
source .venv-food-health/bin/activate
pip install -r scripts/food-health/requirements.txt
```

## Refresh Prince George Inspection Data

```bash
npm run food-health:refresh
```

This runs the incremental scraper for Prince George and writes directly to `public/data/restaurants.json`. The scraper resumes from existing records and saves progress after each restaurant.

## Geocode Missing Restaurant Coordinates

```bash
npm run food-health:geocode
```

This uses OpenStreetMap Nominatim, skips restaurants that already have coordinates, and saves progress back to `public/data/restaurants.json`.

## Useful Direct Commands

```bash
python3 scripts/food-health/healthspace_pg_restaurants.py --list-cities
python3 scripts/food-health/fetch_incremental.py --city "Prince George" --output public/data/restaurants.json --delay 5
python3 scripts/food-health/geocode_restaurants.py --file public/data/restaurants.json --delay 1.5
```

The HealthSpace scraper writes `healthspace_response.html` and `healthspace_debug.html` while debugging parser responses; those files are ignored by git.
