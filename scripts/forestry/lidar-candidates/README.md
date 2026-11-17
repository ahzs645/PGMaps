# LiDAR test-block screening

These scripts find BC cutblocks whose LidarBC LiDAR was flown at a useful time. The output is
`src/pages/dev-forestry-roads/lidarTestBlocks.ts`, and the guide is
[LiDAR test blocks](../../../docs/forestry-road-design/lidar-test-blocks.md).

The scripts write their output to a working folder outside the repository. They use only the
Python standard library. Run them with `python3 -I`.

| Script | Reads | Writes |
| --- | --- | --- |
| `planned_blocks.py <dir>` | FTEN cutblocks (`mpcm/bcgwpub` 340) with no opening, no reported harvest and a planned harvest date in 2025 or later; `<dir>/extent.geojson` | `<dir>/screen-planned.json`: each block with the LiDAR years over its centre |
| `between_flights.py <dir>` | FTEN cutblocks with harvest started 2017–2024, one year at a time, paged by key; `<dir>/extent.geojson` | `<dir>/between-<year>.json`: blocks with a flight before the harvest and another after it |
| `confirm_dem.py <dir>` | the two outputs above, plus the LidarBC point-cloud and DEM tile indexes (layers 4, 5 and 6) | `<dir>/confirmed.json`: one pick per Interior district, with DEM tiles of the right years at the block, from forestry acquisitions (flood-mapping surveys excluded) |
| `reference_pairs.py <pairs-dir> <out.json>` | `examples/forestry/access-history/reference-pairs` and the point-cloud index | each reference block and its built road, with every flight's coverage and timing |

Fetch `extent.geojson` first. It is LidarBC's yearly data extent, layer 0, simplified:

```sh
curl -G 'https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services/LiDAR_BC_S3_Public/FeatureServer/0/query' \
  --data-urlencode f=geojson --data-urlencode 'where=1=1' --data-urlencode outFields=YEAR_ \
  --data-urlencode outSR=4326 --data-urlencode geometryPrecision=4 --data-urlencode maxAllowableOffset=0.002 \
  -o "$DIR/extent.geojson"
```

## Caveats

- **Centres are a screen, not proof.** The yearly extents are simplified to about 200 m, and a
  block's centre is not its road. In a spot check, 7 of 12 between-flight blocks had point-cloud
  tiles for both years. `confirm_dem.py` and the designer's own checks settle each one.
- **Harvest dates stand in for road construction.** No public record dates a road.
- **The BC service is unreliable.** It resets connections and returns HTTP 500 on deep offset
  pages. The scripts retry with backoff and page by key, and `between_flights.py` saves each year
  as it finishes.
