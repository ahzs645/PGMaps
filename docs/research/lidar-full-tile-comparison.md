# Full-sample SegmentAnyTree / ForAINet comparison

The earlier completed tests covered 19,585 original returns in three 8 m radius crops, about 0.023% of the sample's 84,608,005 returns. They were not a full-tile comparison. Both full-source CPU jobs were started on **21 October 2026 at 06:45 UTC**. They are asynchronous and were still running when this record was written; no completed full-tile counts or accuracy results are claimed here.

## Running job

- Coordinator PID at launch: `54619`.
- Live status: `/workspace/scratch/full-tile-pointgroup/production/job-status.json`.
- Individual progress: `production/sat/progress.json` and `production/forainet/progress.json` beneath that directory's parent.
- Logs: `production/coordinator.log`, `production/sat.log`, `production/forainet.log`.
- Initial status snapshot: [initial-job-status.json](hf-tree-model-tests/full-tile-start/initial-job-status.json). This is a historical snapshot, not a live status endpoint.

The processes run in the current workspace, with lower scheduling priority than foreground work. Work advances while this workspace remains running. Completed chunks persist and can be resumed with the same code, weights and parameters; stopping/replacing the environment can interrupt computation. No paid cloud job was submitted. Hugging Face Jobs still returned `UNAVAILABLE: MCP tool hf_jobs was not returned by tools/list`.

## What is being processed

The complete source LAZ, SHA-256 `f5246f351e8d5923bf8a5dfddc0753032dbe8cb6e687ae58818cc701cb398ecf`, was streamed into **969 nonempty 50 m core shards**. Every original return was retained, including source-classified ground, structures, noise and withheld returns; the networks receive XYZ features. An independent source-row audit found **84,608,005 unique rows, no missing rows and no duplicate owners**. See [source-row-audit.json](hf-tree-model-tests/full-tile-start/source-row-audit.json).

Both official checkpoints use the same inputs, 0.2 m voxel sampling, 8 m radius windows at 8 m spacing, a 16 m input halo around each core, and fixed sampling seeds. Halos supply the complete context for windows centred outside the core. Each window checks that the network's output coordinates match its source representatives. Predicted representative labels are expanded to the original returns by a separately recorded nearest-neighbour step. Every core return must receive a prediction before its tile can be marked complete. Window input identity hashes are compared between models before final export.

The saved `latest` checkpoint state is loaded strictly. The network architecture and learned weights are unchanged. MeanShift's identical worker function runs serially within each model process, eliminating CPU fork deadlocks and per-window process startup. Two model processes run concurrently, each with two PyTorch/OpenMP threads. OpenBLAS uses one internal thread to avoid nested oversubscription.

This is a **PGMaps tiled inference adapter around the official networks**, not an execution of the ForestSens application or either repository's complete original tracker. It uses shared window placement, semantic voting, within-tile IoU matching, cross-tile source-point IoU matching at 0.3, and one unambiguous core owner per raw return. Semantic output comes from that owner; halo predictions stitch instance identities. Final non-tree semantic classes remain unassigned to tree candidates. Using a shared postprocessing policy makes the two outputs comparable, but does not reproduce the repositories' differing merge rules. Some split or merged crowns can remain and need review.

Each tile's NPZ is written atomically before its completion metadata. Resumption validates configuration/code fingerprints and completed tile checksums. Final merging refuses missing tiles, duplicate core owners, missing core predictions and source mismatches. Counts are published only after every original row is accounted for.

## Throughput evidence

The representative forest chunk `27-6` contains **103,663 core returns**, 275,802 buffered returns and 72 overlapping windows. Both models covered every core return. All 72 windows used identical source representatives across models.

| Model | Reference BLAS | OpenBLAS 0.3.29 | Saved label arrays compared |
| --- | ---: | ---: | --- |
| SegmentAnyTree | 199.3 s | 88.2 s | Identical |
| Original ForAINet | 213.9 s | 102.6 s | Identical |

[SegmentAnyTree pilot metadata](hf-tree-model-tests/full-tile-start/sat-pilot.json) · [ForAINet pilot metadata](hf-tree-model-tests/full-tile-start/forainet-pilot.json). Original-row label NPZs are beside those files. Their IDs are local to the buffered pilot and are not full-tile tree counts.

The initial estimate is approximately **24–30 hours for both full runs concurrently**, plus final merging/export, if the workspace stays available. Density, candidate complexity and CPU contention vary across the tile. This is an estimate from a representative chunk, not a measured whole-tile throughput guarantee. The coordinator has an explicit 72-hour wall-time limit; completed tiles remain resumable if that limit is reached.

## Outputs after completion

The coordinator automatically merges and exports after both inference workers succeed. Until then these are expected artifacts, not completed results:

- `production/<model>/merged/{instance,semantic}.npy`: one label row for every original LAZ return, preserving original row order and unassigned/background values.
- `production/<model>/merged/summary.json`: verified coverage, candidate counts, class counts, output hashes and merge-code fingerprint.
- `production/comparison/source-with-model-labels.laz`: original LAS dimensions, coordinates and order plus separate instance/semantic fields for both models.
- `production/comparison/coverage-grid.geojson`: 50 m cell comparisons of assigned-return shares and disagreement. These shares measure points, not area canopy cover.
- `production/comparison/<model>-candidate-centroids.geojson.gz`: candidate locations calculated from assigned returns; these are not measured stem locations.
- `production/comparison/summary.json`: coverage and assignment agreement across the same entire input. No ground-truth accuracy is inferred from agreement or candidate counts.

No new results have been published to the live site by this processing start. The completed artifacts can feed its map, point-cloud and side-profile comparisons once processing and inspection finish. This run does not estimate DBH or replace the VRI-based volume baseline with unvalidated neural tree counts.

## Maintain and resume

Sources are modular: `prepare_full_tile.py`, `pointgroup_full_runtime.py`, `run_full_pointgroup.py`, `merge_full_pointgroup.py`, `export_full_pointgroup_comparison.py` and `run_full_pointgroup_comparison.py` under `scripts/lidar/`. The last script orchestrates both workers and their exports. Six tests in `test_full_pointgroup.py` cover edge/corner window coverage, overlapping/disjoint objects, transitive tile stitching, full source-row preservation, duplicate-owner rejection, and preservation of original LAS fields and prediction joins through compressed LAZ export.

After the running coordinator and its workers have stopped, resume from PGMaps with the same source checkout and runtime:

```bash
/workspace/scratch/hf-model-tests/cpu-venv/bin/python scripts/lidar/run_full_pointgroup_comparison.py \
  --input /workspace/scratch/full-tile-pointgroup/input \
  --output /workspace/scratch/full-tile-pointgroup/production \
  --models /workspace/scratch/hf-model-tests \
  --blas /workspace/scratch/hf-model-tests/openblas/usr/lib/x86_64-linux-gnu/openblas-pthread
```

Do not launch another coordinator against the same output directory while this one is running. Large source shards, model weights and full-source results remain outside Git; the small pilot outputs and provenance record are retained for review. The earlier [bounded CPU run](lidar-pointgroup-cpu-results.md) documents checkpoint sources, pinned upstream revisions and compatibility patches.
