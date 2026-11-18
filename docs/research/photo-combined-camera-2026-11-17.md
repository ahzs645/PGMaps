# Browser depth and combined camera search

## Browser runtime and storage

All three models generated finite depth maps for an archive photo in Chromium
with ONNX Runtime Web and single-threaded WebAssembly. The times are from
one 378 px long-edge input after session creation. Model weights and runtime
download time are separate. [ONNX Runtime Web deployment](https://onnxruntime.ai/docs/tutorials/web/deploy.html)

| Checkpoint | Model files in MB | 378 px CPU inference |
| --- | ---: | ---: |
| Depth Anything V2 Small, quantized | 27.26 | 1.39–1.50 s |
| Depth Anything 3 Small, FP32 | 105.34 | 1.64–1.75 s |
| Depth Anything 3 Base, FP32 | 412.72 | 5.70–5.77 s |

The two Small checkpoints share an 11.91 MB WASM asset, so storing both
models plus the runtime takes about 145 MB before terrain and imagery
caches. DA3 uses a separate ONNX graph and weight file. File sizes
describe disk storage. Runtime memory also holds the decoded graph,
intermediate tensors, and the photo and terrain data.

PGMaps loads the selected Small model in a worker only when the reviewer
runs the comparison. It requests the pinned weights from the model host
and keeps successful downloads in the browser's Cache Storage. The model
cache was reused after a reload. Cache retention depends on quotas,
eviction and private-browsing settings. A site or object store can serve
the same versioned files, with CORS for the PGMaps origin if required.
Satellite imagery, terrain and map layers have their own network and cache
paths. [Handling large ONNX models](https://onnxruntime.ai/docs/tutorials/web/large-models.html)
· [Browser storage quotas](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)
· [V2 Small weights](https://huggingface.co/onnx-community/depth-anything-v2-small/tree/main/onnx)
· [V3 Small weights](https://huggingface.co/onnx-community/depth-anything-v3-small/tree/main/onnx)

The reliability check used WebAssembly. In the software GPU environment
the FP16 exports required a device feature the adapter lacked. The DA3
WebGPU trial did not complete within 55 s, so its GPU latency is unknown.

## Combining the cues

The replay used the existing 56 camera candidates and 13 reviewer
preferences. The combined score blends V2 Small at 504 px with terrain
appearance, useful skyline support, photo overlap and mapped cues such as
sun direction where observed. Depth compares near-to-far ordering and
side-to-side shape with terrain at the camera. An unavailable cue contributes
no score. The most useful geometry in the archive came from overlapping
shots, checked with held-out image regions where available.

| Ranking | First, out of 13 | In the first two, out of 13 | First on little or no ridge, out of 3 |
| --- | ---: | ---: | ---: |
| Original gallery order | 8 | 12 | 2 |
| Side-to-side depth alone | 8 | 10 | 1 |
| Depth and terrain appearance | 8 | 9 | 1 |
| Combined with the skyline withheld | 12 | 12 | 3 |
| Combined with all available cues | 13 | 13 | 3 |

The weights were explored on this archive and the same archive provided
the visual preferences. The counts measure rankings on a fixed shortlist.
They do not measure how often the system finds the right camera from
scratch or whether the camera is geographically correct. The three
limited-ridge photos had photo overlap available. Depth plus appearance
alone moved only one of their preferred cameras to first place.

### Effect of photo features and depth

Re-scoring the saved candidates on common ground for V2 Small and V3 Small
gave the same first-choice count of 13 of 13 with all cues. Both fell to
12 of 13 when depth was withheld. Removing photo-feature geometry reduced
first-choice agreement to 9 of 13 for V2 and 8 of 13 for V3. Depth moved
the preferred camera to first on one forest frame with no usable ridge.
On another photo, both depth models alone ranked the preferred camera
last. A two-view fit retaining 92 of 98 image matches moved it to first.
These are within-archive comparisons of the same set of candidates.

## What the browser can do with a weak skyline

- **Distinct skyline and foreground.** Compare both. A ridge can constrain
  orientation, and nearby roads, water or cutblock edges can expose an
  offset in position. A short ridge contributes less than a wide one.
- **Short or repeated skyline.** Try coarse headings near the GPS position
  and compare the ground. The browser can score terrain-checked overlap
  from flight matching, imported overlap fits and paired points along with
  depth and appearance.
- **No skyline.** Turn off the skyline cue. A photo that looks steeply down
  can still contain a distinctive valley, shore or clearing. Another
  overlapping frame or a landmark on the map helps narrow the options.
  A uniform flat surface can generate similar depth for several directions.
  Scenes like that still need a point the reviewer can identify.

The browser's optional search ranks starting cameras, including orientation
suggestions from *Match flight photos*. Image-only overlap supplies a camera
to compare. A terrain-checked transfer can also supply a feature score.
An end-to-end browser check used an archive HEIC with no useful ridge.
Both Small checkpoints returned a shortlist and the imported starting pose
ranked first. The run used local copies of the pinned weights and cached
map tiles. The reviewer could apply a different option.
Flight matching runs automatically after a reviewer accepts a reference
and starts the search. The current flight tool uses XFeat. The joint DA3
trial measured three small overlapping groups offline. [Flight matching
and browser verification](photo-flight-matching-2026-11-17.md) · [Prior depth
experiments](photo-depth-estimation-2026-11-17.md) · [CrossLocate
paper](https://openaccess.thecvf.com/content/WACV2022/html/Tomesek_CrossLocate_Cross-Modal_Large-Scale_Visual_Geo-Localization_in_Natural_Environments_Using_Rendered_WACV_2022_paper.html)
