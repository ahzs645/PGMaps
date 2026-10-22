# Preliminary SegmentAnyTree / ForAINet snapshot

The comparison workspace at `/dev/lidar/compare/?family=neural` displays a frozen partial snapshot of the ongoing full-source CPU runs. It includes coverage maps, seven matched 3D samples, rotating side profiles and model-specific point-class colours. The JSON download contains the coverage and displayed source-point labels.

## Observations

The snapshot has 416 shared completed 50 m cores, containing 39,346,491 original returns (46.5% of the 84,608,005-return source). SegmentAnyTree assigns 25,149,492 returns (63.9%) to accepted local candidates; ForAINet assigns 22,016,451 (56.0%). Their assigned/unassigned status differs for 6,360,525 returns (16.2%). Both classify about 72.1% of matched returns as tree-related, before instance acceptance.

These are return shares, not canopy-area coverage or accuracy. The completed western part of the tile is not a representative sample of the entire forest. No reviewed tree labels establish which model is better. Local instance IDs can duplicate trees along chunk boundaries; final counts require the full seam merge. The UI does not sum local candidates into a global tree total.

## Processing and display

Official SegmentAnyTree and original ForAINet weights run through the shared PGMaps CPU inference/merge adapter, rather than the ForestSens application or an exact reproduction of each upstream tracker. Inference uses 0.2 m voxel representatives in overlapping 8 m radius windows; predicted labels are transferred to every original return. Both models use the same source windows and representative source identities, verified for this snapshot.

The builder reads only completed chunk pairs, verifies checkpoint hashes and matching original rows, excludes halo duplicates, and aggregates core returns. It samples up to 6,000 original returns per displayed core, preserving original LAZ row IDs and identical display points for both models. Five cores span quantiles of the completed ordered cores with at least 20,000 returns; two additional cores have high assignment disagreement. The map shows all shared completed cells, with the unprocessed original-tile remainder left empty. Point heights use the existing 1 m DTM. Original LAS classifications are omitted from the display samples, rather than confused with predicted classes.

The frozen asset has its own UTC snapshot timestamp; it is not a live progress feed. The full-source workers continue independently. Rebuild a later snapshot with `scripts/lidar/build_preliminary_pointgroup.py` after more chunks complete. The existing full-tile exporter remains responsible for final outputs.

Source SHA256: `f5246f351e8d5923bf8a5dfddc0753032dbe8cb6e687ae58818cc701cb398ecf`.

## Individual candidate inspection

`/dev/lidar/compare/?family=neural&inspect=trees` opens the individual-tree inspector. A location map selects candidates; the 3D pane and rotatable side profile show the same original core returns, with a silhouette preset and optional predicted point classes. Nearby points are optional, sampled context and appear grey. Individual point CSV downloads preserve original source-row IDs and model classes.

`export_neural_tree_examples.py` exports 147 examples (74 SegmentAnyTree, 73 ForAINet), containing 210,336 original returns. For each of the seven cached chunks and each model it selects up to 12 candidates with at least 100 core returns and a 95th-percentile height of at least 5 m, preferring candidates clear of the core boundary and then larger return counts. This is a bounded example gallery, not a representative forest inventory or a final tree count. It retains every assigned core return of each selected candidate, with no display thinning; halo points are excluded and boundary examples are flagged.

All 147 exported source-row sets were independently checked against their original core shard and saved model labels; their coordinates match the original shard within export precision. Heights are relative to the existing DTM. Observed maximum height, p95 height and horizontal diagonal describe the candidate points, not measured DBH, surveyed crown size or verified tree identity. Multiple crowns and sparse stems remain possible.
