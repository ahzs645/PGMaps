# Matching nearby photos from a flight

An accepted camera gives shared points a starting orientation and a position on
the map. Capture time and camera distance shortlist reference photos. XFeat
descriptors, reciprocal matches and robust two-view geometry determine whether
there is enough overlap to attempt a camera solve. The matcher runs locally
in a browser worker and loads a 2.68 MB feature model when requested.

The terrain solve projects the reference points onto the elevation model and
holds out entire regions while fitting the target camera. When that check fails,
a calibrated two-view solve can offer an orientation, retaining the target's
starting position and lens. Its held-out error measures the distance to
epipolar lines in the photos. Terrain error measures reprojection against the
elevation model. The candidate shows which check was used. The terrain result
has priority when both kinds are available, and only terrain overlap contributes
geographic feature evidence in Combined camera search. A suggestion can be
adjusted and checked in the usual camera tools. Once accepted, it can be used as
another reference on the next run.

## Archive replay

The 14 original HEICs were decoded in Chromium through PGMaps' HEIC decoder.
The feature worker checked 41 pairs within 2.5 km. Five passed its image-overlap
gate. The app's narrower flight, time and distance rules shortlisted 11 distinct
pairs and 20 directed transfers in a leave-one-out replay. The reviewer’s
provisional camera selections supplied the reference poses, with a marked
uncertain selection excluded from the references.

| Measure | Value |
| --- | ---: |
| Photos with a starting camera | 5 of 14 |
| Directed suggestions passing the image-geometry check | 6 |
| Directed suggestions passing the terrain check | 0 |
| Median held-out 90th-percentile error, best proposal per photo | 3.91 px |
| Median absolute heading difference from the reviewer’s provisional choices | 5.53° |
| Median matcher time over the 41 nearby pairs | 0.85 s |
| Median matcher time over 20 directed comparisons using the app's shortlist | 0.97 s |

Pixel errors are normalized to a 1,050-pixel-wide frame. The nearest-reference
baseline found the same five photos in this replay. Trying multiple references
gave one photo a second option. Independent map landmarks are needed to measure
absolute camera accuracy. The earlier offline RootSIFT replay identified seven
overlapping pairs. A browser-capable scale-invariant detector remains a candidate
for improving match coverage across large zoom and viewpoint changes.

## Browser verification

1. Open *Line up photos of my own* from Field records. Add overlapping originals
   and open one photo in the *Camera* tab.
2. Line up the first camera, draw its checks and accept it in *Use*. Return to
   *Camera*, open *Match flight photos* and select *Find shared features*.
3. Open a suggestion and select *Adjust*. Compare common landmarks or drag the
   overlay. Draw the new camera's checks before accepting it.
4. Run *Find shared features* again. The newly accepted photo is now eligible
   as a reference for other photos in that flight.

A three-photo Chromium run exercised that chain. With one accepted reference,
the first run found one suggestion from two pairs. It had 309 shared features
and a 3.8 px held-out 90th-percentile error. The new camera still required its
own check and review. After acceptance, a second run used that photo as a
reference and reached the third photo, with a 10.8 px held-out error. The same
browser check exercised cancellation and restart. Inference ran in workers and
the archive inputs stayed in the local browser.

## Related experiments

- The [alignment scorecard](photo-alignment-scorecard-2026-11-17.md) compares
  SIFT, RootSIFT, contrast normalization and ORB, with the same archive and
  spatial checks.
- The [depth experiments](photo-depth-estimation-2026-11-17.md) test Depth
  Anything V2 Small, V3 Small and V3 Base at several input resolutions.
- The [combined search experiments](photo-combined-camera-2026-11-17.md)
  report browser runtime, storage, and how rankings change when the skyline,
  depth or feature geometry is withheld.

Methods and implementations include [XFeat](https://github.com/verlab/accelerated_features),
its [ONNX export](https://github.com/DavideCatto/XFeat-ONNX/releases/tag/V1.0.0),
[COLMAP's feature matching and geometric verification](https://colmap.github.io/tutorial.html#feature-matching-geometric-verification),
and [OpenSfM's use of GPS and ground control](https://opensfm.readthedocs.io/en/latest/gcp.html).
