# Synthetic GPAP import fixture

`local-field-project.gpap` is a generated 40 KiB SQLite database containing no source portal records or user data. Its ordinary table/column names follow the official Geopaparazzi and SMASH project models:

- [Geopaparazzi TableDescriptions.java, d84a48fd](https://github.com/geopaparazzi/geopaparazzi/blob/d84a48fd31e4fa12f43d320ec7d48df7a6d52a37/geopaparazzi_library/src/main/java/eu/geopaparazzi/library/database/TableDescriptions.java)
- [SMASH project database models, 9ba8a719](https://github.com/geopaparazzi/smashlibs/tree/9ba8a7195e5cc45e77b3476820dfa7a4073cc6c3/lib/com/hydrologis/flutterlibs/projectdb)
- [SMASH form/media reference parsing, 9ba8a719](https://github.com/geopaparazzi/smashlibs/blob/9ba8a7195e5cc45e77b3476820dfa7a4073cc6c3/lib/com/hydrologis/flutterlibs/forms/forms.dart)

The fixture deliberately contains review issues: repeated form keys, dangling image references, one missing image body, one invalid track position, and an orphan track point. It also contains ID `0`, the exact 64-bit integer ID `9007199254740993`, false/zero form values, zero coordinates/elevation/timestamps, original and filtered track coordinates, a parent/child log relationship, a small PNG image and thumbnail, note extension metadata, and an unknown table retained through the original database. It is for import validation, not a claim that these artificial records were collected in the field.

`geopaparazzi.test.ts` checks SQLite parsing and exact native values. `localIngestion.test.ts` checks persistence of originals and mapped records. `nechako-local-ingestion.spec.ts` reads the same binary through the actual browser WebAssembly SQLite build and exercises the local UI. The independent GDAL browser test generates native GIS files in the browser and reads them back without an app API.
