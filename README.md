# PGMaps

PGMaps is the frontend map app. Data scraper tooling and scraper-related source documentation live in the `bcdatamapper` submodule:

```text
vendor/bcdatamapper
```

Initialize submodules after cloning:

```bash
git submodule update --init --recursive
npm --prefix vendor/bcdatamapper install
```

The PGMaps npm data commands delegate into that submodule while keeping PGMaps as the working directory, so generated app data still lands under `public/data`.

The scraper inventory is documented in [vendor/bcdatamapper/README.md](vendor/bcdatamapper/README.md).

## Data source policy

See [BC Data Catalogue and ArcGIS Live Usage](docs/bc-data-live-usage.md) for guidance on using BC Data Catalogue records and BC-published ArcGIS REST services in PGMaps. In short: licences are often permissive with attribution, but live APIs have operational limits, so large or core datasets should usually be synced and cached instead of queried directly from the browser.
