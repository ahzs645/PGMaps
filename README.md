# PGMaps

## CANUE BC Extracts

CANUE archives should stay outside the repo. The sync script reads the local Google Drive
CANUE folder, filters annual postal-code records to BC, joins DMTI postal-code latitude,
longitude, and community fields, and writes derived CSVs plus a manifest to
`public/data/canue/bc/`.

```bash
npm run canue:bc:sync
npm run canue:bc:gzip
```

By default, the script uses the local CANUE path under Google Drive and extracts the latest
available year from each annual archive. Override the source or year selection when needed:

```bash
PG_CANUE_DIR="/path/to/Canue" npm run canue:bc:sync
node scripts/sync-canue-bc.mjs --years 2016,2019,2021
node scripts/sync-canue-bc.mjs --all-years
```

The uncompressed generated CSVs under `public/data/canue/bc/annual/` are local
working files and are ignored by git. The gzip step writes app-ready compressed
files to `public/data/canue/bc/annual-gzip/`.

## Food Safety Data

Northern Health Authority HealthSpace food inspection data can be refreshed from this repo.

```bash
python3 -m venv .venv-food-health
source .venv-food-health/bin/activate
pip install -r scripts/food-health/requirements.txt
npm run food-health:refresh
npm run food-health:geocode
```

The refresh command updates `public/data/restaurants.json` incrementally and saves progress after each restaurant. The geocode command fills missing coordinates in the same file.

Manual restaurant categories and researched coordinates are kept outside the scraped file:

- `public/data/restaurant-classifications.json`
- `public/data/restaurant-location-overrides.json`

The app merges both files at load time, so future scrape refreshes do not remove category or location corrections.
