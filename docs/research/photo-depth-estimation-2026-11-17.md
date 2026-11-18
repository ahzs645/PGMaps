# Depth estimates for aligning aircraft photos

Depth from a single photo can help compare camera candidates by testing whether
near slopes, valley floors and distant ridges fall in the same parts of the
frame. On the 14-photo archive it helped distinguish a few scenes. The
experiment supports using depth as an extra cue during review. Geographic
scale and camera accuracy still need terrain and mapped checkpoints.

## Archive experiment

Depth Anything V2 Small ran locally on CPU using the quantized ONNX export.
Inference took a median of 0.80 s per photo on the test machine, excluding
image preparation, model startup and terrain rendering. The model returns
relative inverse depth, where a larger value generally means closer. [Model and
paper](https://github.com/DepthAnything/Depth-Anything-V2) · [ONNX
export](https://huggingface.co/onnx-community/depth-anything-v2-small)

The comparison covered the 56 camera options already shown in the gallery.
Each camera had its own bare-earth Terrarium depth image from PGMaps' ray
caster at 96 px across. Both inverse-depth images were compared only on
pixels visibly on the ground across all four camera options. This excluded
sky, parts of the aircraft and rays without terrain. Rank correlation can
compare depth ordering without assuming the model's output has a metric
scale. A second score subtracts each row's median, so lateral terrain shape
can help distinguish candidates that all look near at the bottom of the
frame.

| Method | Reviewer pick first | Reviewer pick in first two |
| --- | ---: | ---: |
| Original gallery order | 8 / 13 | 12 / 13 |
| Model depth against terrain depth | 8 / 13 | 9 / 13 |
| Model depth against terrain depth after row centering | 8 / 13 | 10 / 13 |

One photo had an uncertain review and was excluded from the agreement counts.
Full-frame depth recovered three of the reviewer's alternative B picks and
preferred other cameras for three original A picks. Row centering recovered
the preferred candidate on a steep forest frame with almost no skyline. On
another forest slope both scores put the reviewer's choice last. These counts
measure agreement with visual feedback, with no surveyed pose or landmark
validation.

## Depth Anything 3 and resolution

The single-view sweep ran DA2 Small and DA3 Small and Base on all 14 photos at
252, 378, 504 and 672 px on the long edge. Inputs roughly preserved the aspect
ratio and rounded each dimension to a multiple of 14. CPU inference used two
threads. DA2 used the quantized ONNX graph above. DA3 used the FP32 ONNX
exports of the official checkpoints. All settings used the same terrain
candidate grids and common pixel masks. [ByteDance repository and
paper](https://github.com/bytedance-seed/depth-anything-3) · [DA3 Small ONNX
export](https://huggingface.co/onnx-community/depth-anything-v3-small) ·
[DA3 Base ONNX export](https://huggingface.co/onnx-community/depth-anything-v3-base)

Each cell lists the number of reviewer choices ranked first out of 13 for
global and row-centered depth, followed by median CPU inference time.

| Long edge | DA2 Small | DA3 Small | DA3 Base |
| --- | ---: | ---: | ---: |
| 252 px | 8 / 6 · 0.07 s | 6 / 6 · 0.13 s | 6 / 7 · 0.44 s |
| 378 px | 8 / 6 · 0.17 s | 7 / 8 · 0.29 s | 6 / 6 · 0.85 s |
| 504 px | 8 / 8 · 0.35 s | 7 / 7 · 0.59 s | 8 / 6 · 1.69 s |
| 672 px | 8 / 8 · 0.79 s | 7 / 6 · 1.14 s | 8 / 6 · 3.57 s |

DA3 Small at 378 px matched eight reviewer choices with row centering and
put nine in the first two. DA2 Small at 504 px put ten in the first two.
DA3 Base at 504 and 672 px matched eight choices with global depth. Increasing
resolution beyond 504 px improved none of these counts. On the uncertain
photo, DA3 Small at 378 px ranked option D first with row centering and
second with global depth. A landmark check is still needed.

DA3 Small also ran at 504 px on three overlapping groups comprising seven
photos, feeding each group to one inference. Row-centered first-choice
agreement rose from 4 of 7 to 5 of 7, with 6 of 7 in the first two in
both runs. Global first-choice agreement rose from 2 of 7 to 3 of 7. This
pilot used the joint model's depth predictions to score the existing
cameras. It did not solve geographic poses from the predicted cameras.

## What to try next

- **Rank with relative shape.** Let skyline, landmarks, sun and overlap
  remain visible as separate evidence. Use depth to show when a near slope and
  far ridge support the same candidate. Dense canopy, haze, reflections and
  aircraft windows can change the photo's apparent depth relative to a
  bare-earth DEM. A verified canopy surface can be tested separately.
- **Generate map distances from a checked pose.** Čadík and colleagues
  matched outdoor photographs to terrain, rendered synthetic depth, and
  aligned its edges to the photo. PGMaps already ray-casts terrain distances.
  Preserve the geographic geometry and measure offsets against held-out
  landmarks before showing those distances as evidence. [Automated Outdoor
  Depth-Map Generation and Alignment](https://cphoto.fit.vutbr.cz/depth/)
- **Validate any metric model on this flight scale.** Depth Anything V2's
  outdoor metric checkpoint is configured for up to 80 m. Apple's Depth
  Pro estimates distance and focal length from one photo. Verify any
  estimates against known distances spanning the foreground and far ridges
  before using them to move a camera. [Depth Anything V2 outdoor
  configuration](https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-Outdoor-Small-hf/blob/main/config.json)
  · [Apple Depth Pro](https://github.com/apple-aiml-research/ml-depth-pro)
- **Use multiple views for overlapping frames.** MapAnything can take
  images and optional camera parameters or depth. An anchored trial could
  test whether it jointly refines a burst, using known GPS and several
  reserved checkpoints for evaluation. [MapAnything
  project and paper](https://map-anything.github.io/)
