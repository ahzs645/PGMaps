# Drainage conditioning bench

Compares the road designer's depression policies (`conditionDrainageSurface` in
`src/pages/dev-forestry-roads/hydrology.ts`: fill-all, preserve, depth-limited) with
WhiteboxTools' `fill_depressions`, `breach_depressions_least_cost` (Lindsay 2016) and
`burn_streams_at_roads`, on real 1 m LiDAR tiles with mapped roads. It was written to decide
whether a least-cost breaching policy belongs in the road designer. Findings:
[`docs/research/drainage-breaching-2026-11-18.md`](../../../docs/research/drainage-breaching-2026-11-18.md).

Whitebox runs through the `whitebox-wasm` dependency (`whitebox.ts`), in Node, over WASI. Nothing
here is part of the app.

## Inputs

`fetch-inputs.ts` downloads one tile into a folder **outside the repository**: the LidarBC
1:2,500 bare-earth DEM (or a GeoTIFF already on disk), and over its box the FTEN road sections,
Digital Road Atlas roads and FWA streams from DataBC's WFS. The road lines are licensee tenure
records: never commit them, and never name a licensee's road or block in results.

```sh
OUT=/path/outside/repo/drainage-inputs
for t in 093g089_3_4_3 093g099_1_3_3 093j004_2_3_2 093j015_2_3_4; do
  node --import tsx scripts/forestry/drainage-bench/fetch-inputs.ts $OUT --maptile $t
done
# The deployed LiDAR analysis tile (npm run lidar:fetch-analysis first):
node --import tsx scripts/forestry/drainage-bench/fetch-inputs.ts $OUT \
  --dem public/data/lidar-analysis/bc-093g086/dtm-1m.tif --name 093g086-dtm
```

## Runs

```sh
# Whole tiles: every policy and Whitebox method, PGMaps' D8 on each conditioned surface.
node --import tsx scripts/forestry/drainage-bench/bench.ts $OUT out/ --breach-dist 20,100,1000 --context
# The road check itself: a road pegged along mapped roads, crossings and cross-drain candidates.
node --import tsx scripts/forestry/drainage-bench/road-runs.ts $OUT out/road-runs.json --roads 3 --png out/
```

`bench.ts` writes `results.json` and, per tile, `<tile>-ponds-cuts.png` (blue: full-fill ponding
deeper than 5 cm; red: cells breaching lowered more than 5 cm; yellow: mapped road centrelines),
`<tile>-streams.png` (1 ha streams: blue fill-all only, red breach only, purple both) and close-ups
of the three largest fill ponds that touch a road. `road-runs.ts` writes one PNG per road: the
existing-ground streams under fill and breach, the footprint, FWA streams (cyan) and each run's
crossings and cross-drain sites. Five tiles take about 3 minutes and 1 minute respectively.

What each run measures is described in the scripts' headers and in the research note.

## Whitebox arguments

`whitebox-wasm` 0.6.1 runs the next-generation WhiteboxTools, whose parameter names differ from
classic WhiteboxTools, and **ignores unknown arguments silently**. For
`breach_depressions_least_cost` the classic `--dist` and `--fill` do nothing (the output is
byte-identical to no arguments); the parameters are `--max_dist` (cells, default 100),
`--max_cost`, `--fill_deps`, `--minimize_dist` and `--flat_increment`. `d8_pointer` takes `--dem`,
`d8_flow_accum` `--input` and `--out_type=cells|ca|sca`, `slope` `--input`. Check an argument by
changing it and comparing outputs, not by the exit code.

Whitebox D8 pointers are 1 NE, 2 E, 4 SE, 8 S, 16 SW, 32 W, 64 NW, 128 N (0 no flow); PGMaps'
directions are 0 E … 7 NE, so PGMaps = (log2(pointer) + 7) mod 8.
