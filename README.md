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
