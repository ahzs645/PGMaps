# Matchers, depth models and reference projects tried on own photos

On 18 November 2026 a set of models and outside projects was tried on the helicopter
flight's photos, to see what could place a photo the skyline does not settle. The hard
case was IMG_9311: a 52 mm frame of an even forested slope with a sliver of sky in one
corner. The photos with known cameras were IMG_9320 and IMG_9319 (about 139°) and
IMG_9297 (about 49°). Three known cameras from one flight is thin evidence; every
figure below is one run.

What came of it in the page: a second matcher in *Match flight photos* and a fix to
the two-view fit (`docs/forestry-visual-quality.md`, **Match flight photos**).

## Left open

- **XFeat against the model view is not built.** It is the one test here that picked
  the true camera sharply (table below), but it needs XFeat's LighterGlue matcher, and
  nobody publishes that as ONNX: it has to be exported from the Apache-2.0 repository
  (`verlab/accelerated_features`, `weights/xfeat-lighterglue.pt`, 11 MB). The page's
  bundled XFeat pairs descriptors by reciprocal nearest neighbour, which was weaker on
  the same test.
- **The learned matcher's models are not deployed.** `npm run photo-match:fetch-models`
  puts ALIKED and its LightGlue (48 MB) in the git-ignored `public/models/photo-match/`.
  No workflow runs it, so on the live site choosing *ALIKED + LightGlue* reports the
  models missing. Serving 48 MB more from the deploy is the owner's decision.
- **XFeat stays the default matcher.** The learned pair was better on both pairs run in
  the browser, and those are two pairs of one flight.
- **Checking an accepted reference against its neighbour and the GPS is not built.** Run
  outside the page, a matched pair fitted the GPS direction of travel only for a narrow
  range of the reference's heading (below).

## Photo against the model view

The photo was matched against the satellite-textured terrain view drawn at the true
camera and at wrong headings. Matches, by heading:

| Photo | True heading | 10° off | Far off |
| --- | --- | --- | --- |
| IMG_9320, XFeat + LighterGlue | 760 | 156, 449 | 6–44 |
| IMG_9319, XFeat + LighterGlue | 388 (518 at 149°) | 33, 518 | 1–36 |
| IMG_9297, XFeat + LighterGlue | 97 | 74, 2 | 0–53 |
| IMG_9320, ALIKED + LightGlue | 9–17 | | up to 29 |

- At 10° off, 444 of IMG_9320's 449 matches agreed on one sideways shift: the shift is
  the correction.
- XFeat with reciprocal descriptors only (what the page bundles) gave 51 homography
  inliers at IMG_9320's true heading against 7–23 elsewhere.
- DINOv2-small similarity ranked the true view 4th, 3rd and 11th of 14.
- On IMG_9311 nothing matched reliably: 33 matches on one patch at best.

## Photo against photo

Verified matches between two photos of the flight, outside the browser:

| Pair | ALIKED + LightGlue | XFeat + LighterGlue |
| --- | --- | --- |
| IMG_9319–IMG_9320, 3 s apart | 926 | 1,414 |
| IMG_9310–IMG_9311, 3.6 s apart, 26 mm then 52 mm | 358 | 0 |
| IMG_9299–IMG_9302 | 213 | 14 |

The fourteen photos overlap in eight pairs, in twos and threes: a whole-flight
reconstruction would not connect.

**A pair and the GPS.** With IMG_9310 accepted at the skyline's unsettled 207.6° the
page offered IMG_9311 nothing, because the camera movement the two photos imply must
agree with the GPS direction of travel. Run over every heading of IMG_9310, the pair
agreed with the GPS only between 290° and 300° (held-out 0.9 px at 294°, 3.9 px at
282°, 4.4 px at 310°), which puts IMG_9311 near 275°, pitched about 10° above
IMG_9310. The aircraft moved 223 m between the two fixes, 4 s apart.

## Depth models

Each model's depth was scored by the page's own comparison (`compareDepthGrids`) against
1,620 cameras a photo (every 10° of heading, nine pitches, five rolls). "Open" is how
many 10° headings scored within `TIED_SCORE` of the best.

| Model | Size, licence | IMG_9320 | IMG_9319 | IMG_9311 |
| --- | --- | --- | --- | --- |
| Depth Anything V2 Small, quantized (the page's) | 27 MB, Apache-2.0 | 140°, 20° open | 150°, 20° open | 250° open |
| Depth Anything 3 Small | 105 MB, Apache-2.0 | 240°, true heading last | 140°, 220° open | 270° open |
| Depth Anything 3 Base | 412 MB, Apache-2.0 | 120° | 140°, 280° open | 50° open |
| Depth Anything 3 Large | 1.4 GB, Apache-2.0 | 220° | 70° | 20° open |
| Depth Anything V2 Base | 389 MB, CC BY-NC | 140°, 30° open | 140°, 20° open | 60° open, best 270° |
| Distill-Any-Depth Base, quantized | 102 MB, MIT | 140°, 10° open | 140°, 70° open | 50° open, best 270° |
| Metric3D v2 Small | 151 MB | wrong | wrong | wrong |

- Depth Anything 3's single-photo depth is blurrier and missed IMG_9320 at every size.
- Metric3D put IMG_9311's ground about 2 m away; it is 500–800 m.
- No model recovered IMG_9297's heading. The terrain's own depth, fed in as the photo's,
  did; it left IMG_9310 open over 230°.
- The page's coarse sweep tries 12 headings at two pitches with the phone's roll. A
  finer sweep and a gate on photos with no sky were not built.

## Other readings of IMG_9311

- **No sky.** The photo is about 99% ground. At the phone's tilt no heading shows more
  than 76%: the camera pitched down at least 10°.
- **Tree stems.** Their directions converge on a point that gives pitch about −21°
  (anywhere from −21° to −39°) and roll +4°. The phone recorded level.
- **Sun.** It stood at 131° and 15° up; the trees are lit from the left, so the heading
  is between 135° and 315°.

## Reference projects

Read and run by separate reviewers where the licence is not compatible (route A,
`docs/forestry-road-design/reference-repo-licensing-and-conversion.md`); their
specifications are kept outside the repository.

| Project | Licence | Finding |
| --- | --- | --- |
| WebSfM | MIT | Source of the ALIKED and LightGlue ONNX exports. Its full reconstruction and its ground control against an orthophoto do not apply to single oblique photos. |
| XFeat (`accelerated_features`) | Apache-2.0 | The matcher of the first table. |
| geo-sleuth | MIT | Its DINOv2 ranking did not help. Its sun and shadow notes prompted the sun reading above. |
| peakviewer | MIT | Its texture skyline reader read cloud edges on the sunset frames, nothing on IMG_9297 and a false skyline on IMG_9311; the page's readers were better. |
| PeakNav | GPL-3.0 | Skyline matching only. It refuses a skyline with under 1° of relief, which rejected IMG_9311. It called IMG_9310 confident at 270°. |
| LandscapeAR | non-commercial research | Its patch descriptors placed IMG_9320 from roads and streams without the skyline (65 agreeing matches against 13 far off) and found nothing on IMG_9311. Its weights carry no licence. |
