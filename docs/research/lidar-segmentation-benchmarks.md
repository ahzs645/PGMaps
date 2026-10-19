# Bounded original-return tree segmentation comparison

The workbench can now compare actual executions of the existing CHM watershed membership, **lidR 4.3.3 Dalponte 2016**, **lidR 4.3.3 Li 2012**, and **PointTree 1.0.1 treeX with its ULS preset** on three buffered plots from the user's tile. The browser loads a compact snapshot; these Python/R algorithms do not run in the browser.

This is a method-disagreement experiment, **not a validation or accuracy ranking**. No reviewed tree-instance reference exists for these plots. More instances or more assigned points do not imply a better result. In particular, Li 2012 produces many more instances near the structure-review candidate; a reviewer needs to check whether these are distinct trees, fragments, or structures.

| Plot                              | Examined original EPT returns | Screened input returns | Current watershed core instances | Dalponte core instances | Li core instances | treeX core instances |
| --------------------------------- | ----------------------------: | ---------------------: | -------------------------------: | ----------------------: | ----------------: | -------------------: |
| 20 m north of crown-3146          |                       606,712 |                 65,019 |                                3 |                       5 |                15 |                    0 |
| crown-85 vicinity                 |                       736,157 |                 83,843 |                                8 |                       9 |                19 |                    0 |
| crown-1 structure-review vicinity |                       544,725 |                 65,258 |                                5 |                       6 |                31 |                    0 |

treeX executed successfully but found **zero supported stems in all three plots**, leaving the returns unassigned. Its ULS preset targets denser UAV scanning; this airborne sample does not supply the dense low-stem neighborhoods that the preset requires. This result does not establish that there are no trees, and changing the UI cannot restore missing stem observations. No stem diameters from this experiment are published.

## Common input and provenance

- Source LAS SHA256: `f5246f351e8d5923bf8a5dfddc0753032dbe8cb6e687ae58818cc701cb398ecf`.
- The existing complete original EPT octree supplies the returns, with at most **750,000 decoded input returns per plot**. No intersecting node is omitted to meet the budget. The crown-3146 crop had 778,432 intersecting returns at the requested center, so the plot was moved 20 m north before extraction. The original crown remains recorded as an anchor and lies outside that plot's 25 m core.
- Each plot has a 25 × 25 m core and a 10 m buffer on every side (45 × 45 m processing footprint). All algorithms process every accepted return in that same buffered footprint. The baseline uses its previously computed exact source-cell membership rather than rerunning the entire tile.
- Horizontal analysis is EPSG:3157. Original EPT node coordinates are EPSG:3857 and are transformed with PROJ before cropping. `z_m` is the source orthometric elevation; `height_m` subtracts the existing 1 m source DTM at that point's cell.
- Withheld flags and overlap flags are converted to Boolean arrays **before** logical negation. Classes 7, 12 and 18 are removed; missing DTM, nonfinite heights and heights outside −0.5–80 m are removed. Class 2 and returns below 2 m remain in the common input, allowing a real stem-oriented method to examine low returns. The baseline preserves its existing class-2 exclusion when assigning crown labels.
- Original identity is **EPT node key + decoded node point index**. These are not point offsets into the original single LAS file. Input hashes cover the exact node LAZ bytes, processing footprint, DTM bytes and accepted coordinate/identity array. Output hashes cover each full aligned instance-label array.
- lidR receives source-DTM-normalized height (negative height is clamped to zero). TreeX receives original local XYZ and performs its own CSF terrain classification and DTM interpolation. The display always uses source-DTM height, so TreeX's internal normalization must not be represented as identical to the other methods.
- Existing baseline height, support and roof masks remain part of that baseline's segmentation. New methods receive the common screened raw points without importing baseline crown/roof masks. This is another reason disagreement is not accuracy.

## Methods and measurement definitions

**Dalponte 2016:** `rasterize_canopy(p2r(subcircle=0.2), res=1)` followed by a 3 × 3 focal mean; local maxima use a 3 m window and a 5 m minimum. Crown growth uses `th_tree=2`, `th_seed=0.45`, `th_cr=0.55`, `max_cr=10`.

**Li 2012:** `dt1=1.5`, `dt2=2`, `R=2`, `Zu=15`, `hmin=2`, `speed_up=10`. The R worker proves that a stable `SourceRow` attribute remains aligned after segmentation before returning instance labels to original EPT identities.

**PointTree treeX:** the package's complete `TreeXPresetULS`, `num_workers=1`, `random_seed=42`; full constructor parameters are embedded in the snapshot. Intensities are not used because an airborne intensity threshold is not calibrated here. This algorithm still has dependencies whose randomness is not fully controlled by its seed; the package explicitly documents that limitation.

`instances_core` counts instances whose highest source-DTM-normalized return is inside the half-open core bounds. `instances_buffer` counts all instances in the processing footprint. This top-based core convention limits edge double counting; it does not prove a stem is rooted inside the core. Edge effects can remain even with a buffer.

`assigned_points` and `unassigned_points` refer to **all core returns with source-DTM height ≥2 m**. Their sum is the eligible core count. Low returns remain in the computation and display but are not included in this canopy-assignment denominator. Instance IDs are independent labels per method: label 1 from one method is not automatically the same tree as label 1 from another.

Pairwise adjusted Rand index (ARI) compares partitions **only on full-resolution core returns assigned by both methods**. The common-assigned count and eligible count are published beside it; a method leaving many points unassigned can otherwise appear misleadingly agreeable. TreeX pairs have no common assigned returns and therefore report `null`, not zero or perfect agreement. ARI can be negative; one means matching partitions, not verified trees.

Runtime measures the method call and raster/seed preparation inside the worker, excluding interpreter/package startup. Baseline runtime measures membership lookup only, not the earlier tile-wide watershed calculation; these timings must not be used as an equal-work speed ranking. `peak_rss_mb` comes from the OS's child-process resource usage in a fresh wrapper for each method, including interpreter/package startup, and is not GPU memory.

## Browser snapshot

[`treeBenchmarks.generated.json`](../../src/pages/dev-lidar/treeBenchmarks.generated.json) contains version/source hashes, polygon boundaries, full-input counts and statistics, per-method parameters, versions, runtime and peak RSS, detected top candidates, pairwise agreement, and **2,800 display returns per plot**. A deterministic evenly spaced selection in original node/index order is used only after segmentation. It is not a random sample or a full-resolution point download.

Each display point row is `[dx_m, dy_m, z_m, height_m, node, index, classification]`. `dx_m`/`dy_m` are local offsets from `centre_utm`; `node` indexes `sample.nodes`; `index` is the decoded point's original index within that EPT node. Coordinates round to 1 mm for the display snapshot. Each method's `labels` is exactly aligned with those rows; **−1 means unassigned** and must remain visibly distinct. Reported counts and ARIs use full inputs, not the display sample.

Tree-like/merged/structure labels in the review queue remain reviewer judgments. This experiment does not infer species, DBH, complete stems, carbon, volume or validated individual tree counts.

## Reproduce

Use a separate environment for PointTree so the existing scientific environment is unchanged. This run used R 4.5.3, lidR 4.3.3, PointTree 1.0.1, pointtorch 1.1.0, CPU Torch 2.8.0 and torch-scatter 2.1.2+pt28cpu. PointTree does not automatically install its optional Torch dependencies. The initial install selected Torch 2.14, for which a matching torch-scatter wheel was unavailable; pinning the compatible CPU pair below resolved it.

```bash
micromamba create -y -p /workspace/scratch/lidar-r -c conda-forge r-base=4.5.3 r-lidr=4.3.3
uv venv /workspace/scratch/pointtree-venv --python 3.12
uv pip install --python /workspace/scratch/pointtree-venv/bin/python pointtree==1.0.1
uv pip install --python /workspace/scratch/pointtree-venv/bin/python 'torch==2.8.0+cpu' --index-url https://download.pytorch.org/whl/cpu
uv pip install --python /workspace/scratch/pointtree-venv/bin/python 'torch-scatter==2.1.2+pt28cpu' --find-links https://data.pyg.org/whl/torch-2.8.0+cpu.html

# From the PGMaps checkout containing the complete original EPT and source DTM:
/workspace/scratch/lidar-venv/bin/python scripts/lidar/benchmark_tree_methods.py --prepare --run
/workspace/scratch/lidar-venv/bin/python -m unittest discover -s scripts/lidar -p 'test_tree_benchmarks.py'
```

The source scientific Python environment needs NumPy, laspy with LAZ support, rasterio, pyproj and scikit-learn. `--root`, `--work`, `--rscript`, `--pointtree-python` and `--output` support other local paths. `--prepare` decodes the bounded plots, writes original coordinate/identity arrays and hashes them. `--run` **executes every method afresh**, writes per-method logs and original-order labels to the work directory, and replaces the small snapshot. Each subprocess has a 165 s inner deadline and 180 s outer deadline; CPU concurrency is one. Failures are recorded with the method status rather than silently replaced by another algorithm.

Tests check the uint8 flag pitfall, bounded deterministic sampling, source and segmentation provenance, original-node identity uniqueness, all four actual method results, unassigned accounting, aligned method label arrays, and equality to full processing arrays when those local arrays are present. Ordinary checkouts can validate the tracked snapshot without downloading the 84-million-point tile.

## Sources and next validation

- [lidR individual tree segmentation](https://r-lidar.github.io/lidRbook/itd.html).
- [lidR Dalponte implementation and parameters](https://r-lidar.github.io/lidR/reference/its_dalponte2016.html).
- [lidR Li implementation and parameters](https://r-lidar.github.io/lidR/reference/its_li2012.html).
- [PointTree treeX implementation](https://github.com/ai4trees/pointtree/blob/main/src/pointtree/instance_segmentation/_tree_x_algorithm.py) and [ULS preset](https://github.com/ai4trees/pointtree/blob/main/src/pointtree/instance_segmentation/tree_x_presets.py).

Before adopting a replacement method, review several complete representative plots, including suppressed trees, overlapping crowns, gaps and roof edges. Record split/merge/unassigned errors against independently reviewed instances and compare on held-out plots. Parameter tuning on these three displayed plots alone is not validation. Preserve raw labels and review history so a change in method does not silently turn prior review decisions into new assertions.
