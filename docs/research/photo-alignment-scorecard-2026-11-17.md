# Photo alignment scorecard for the 14-photo archive

The skyline search found one photo ready for visual review. Overlap-based camera
transfer added three provisional candidates, bringing review coverage to **4 of
14 photos (28.6%)**. The other ten still need camera evidence.

## What the score measures

| Measure | Archive result |
| --- | ---: |
| Skyline search | 1 passed, 12 ambiguous, 1 weak |
| Provisional overlap candidates | 3 of 14 |
| Review coverage from either method | 4 of 14 (28.6%) |
| Photos with three independent landmark checks | 0 of 14 |
| Median held-out overlap error across those three cameras | 2.14 px |
| Largest camera-level 90th-percentile overlap error | 7.93 px |

The overlap check holds out spatial regions of the frame while fitting the camera.
Each photo contributes one median and one 90th-percentile error at 1,050 px
width. The scorecard reports the median of the photo medians and the
90th percentile of the photo 90th percentiles. The latter is the highest value
with three photos. Overlap errors are relative to the reference cameras and DEM.

To compare geographic accuracy, mark at least three distinct mapped features per
photo, using landmarks that were excluded from the fit. Use the largest pixel
error in each feature group and the 90th percentile across groups. The scorecard
reports which photos have enough checks, the median and 90th percentile across
those photos, and any cameras with unprojectable landmarks. Review imagery or map
layer dates when identifying features. A recently harvested clearing may be
visible in only one of the sources.

On the skyline pass, the rendered view shows the lake, small pond and fen in
the same parts of the frame. The near shoreline is visibly offset. There were
too few unambiguous point correspondences to calculate a geographic error,
so the scorecard leaves that field empty.

## Descriptor and camera search results

Each descriptor ran on the same 91 pairs. A pair passed the image geometry check
when a fundamental matrix or homography supported at least 20 matches and 60%
of reciprocal matches. Pair times exclude feature extraction and terrain fitting.

| Descriptor | Pairs passed | Verified matches across passing pairs | Median pair time | Cameras from overlap, 8 × 6 sampling |
| --- | ---: | ---: | ---: | ---: |
| SIFT | 3 | 733 | 220 ms | 3 |
| RootSIFT | 4 | 801 | 220 ms | 3 |
| Contrast-normalized RootSIFT | 4 | 1,046 | 227 ms | 2 |
| ORB | 3 | 631 | 109 ms | 3 |

Contrast normalization increased the match count on the three shared pairs by 39%
and recovered one additional pair with 24 verified matches. The pass graph still
left seven photos with no strong overlap. The additional pair produced no
provisional camera.

The terrain sweep ran 224 fits across four sampling grids from 8 × 6 through
16 × 12, both transfer directions, and two skyline hypotheses for each reference.
It held the lens fixed and used Terrarium terrain at zoom 11 within 25 km, with
zoom 9 terrain out to 90 km.
Several settings recovered the same three photos. With SIFT, the densest grid
reduced the largest photo-level overlap p90 from 7.93 to 6.92 px. The grids
leave out different sampled matches, so this result needs a common evaluation
set to compare camera accuracy. Another 144 fits searched 12 heading sectors
for the two unresolved pairs and produced no additional candidates. SIFT remains
the default. RootSIFT and ORB are available as experimental options.

## Apps and repositories worth using as references

| Project | What PGMaps can try |
| --- | --- |
| [Smapshot](https://heig-vd.ch/recherche/projets/smapshot-la-machine-a-remonter-le-temps-participative) and the [WSL Monoplotting Tool](https://www.wsl.ch/en/services-produkte/monoplotting-tool/) | Use photo-to-map landmarks and a clear review step. Add a way to reserve checkpoints while placing controls in PGMaps' existing photo and map view. |
| [LandscapeAR](https://github.com/brejchajan/LandscapeAR) and [CrossLocate](https://cphoto.fit.vutbr.cz/crosslocate/) | Match photos to rendered terrain, including silhouettes and depth. Try ranked render candidates near the photo's GPS fix for isolated shots. |
| [LightGlue](https://github.com/cvg/LightGlue) and [XFeat](https://openaccess.thecvf.com/content/CVPR2024/html/Potje_XFeat_Accelerated_Features_for_Lightweight_Image_Matching_CVPR_2024_paper.html) | Benchmark learned matches using the same pair geometry and independently mapped checkpoints. Their published results use other datasets. |
| [COLMAP](https://colmap.github.io/faq.html) and [OpenSfM](https://opensfm.org/docs/gcp.html) | Use shared tracks, GPS priors and ground control to refine a connected group jointly. Additional overlapping frames or independent anchors would help link the current groups. |
| [PeakFinder](https://www.peakfinder.com/mobile/camera/) | Give users a direct way to drag a rendered skyline into position using a distinctive peak. In PGMaps, a ground landmark can serve the same purpose when the ridge is indistinct. |

The first experiment to run after collecting independent checks is ranking
the existing heading candidates using mapped water and distinctive landforms.
It targets the ambiguous skyline results and works on single photos. The overlap
benchmark can then compare any learned matcher against SIFT on the same pairs
using camera coverage and geographic error.
