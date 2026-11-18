# How many landmarks does a photo need?

Use the automatic options first. On a photo that needs a little help, open
*Camera* → *Guide with landmarks*. Select *Pair a landmark*, click a recognizable
spot in the photo, click the same spot on the plan, and choose the resulting
starting camera. This is four actions once the photo is open. A road bend, shore
corner or cutblock corner is easier to place than a broad ridge.

| Input | What PGMaps fits | What the reviewer checks |
| --- | --- | --- |
| None | Skyline, combined cues or a flight match | Compare the suggested camera against mapped features |
| One landmark | Heading and pitch with position, lens and roll held | Check a different feature on the overlay before accepting |
| Two spread landmarks | Heading, pitch and roll with the position held | Add a landmark if the overlay misses or the position needs refinement |
| Three spread landmarks with a recorded position | Angles and a position adjustment near the starting fix | Review each landmark's held-out error, then draw and check the camera |
| Four landmarks when the position is a guess | A fit with horizontal position free and a point available to hold out | Review the held-out error and the position on the plan |

The one-landmark starting camera requires the usual camera check and a reviewer
note. Solves from two or more points keep the paired-point acceptance gate,
including a held-out point. A camera reached with these steps can become a
reference for the rest of its flight after the reviewer accepts it.

## Controlled replay using the archive

The replay used all 14 photos. The table summarizes 13 with provisional visual
camera picks. The uncertain photo was kept as a separate exploratory result.
To measure how much input the geometry needs, clicks were synthesized by
projecting DEM ground points through the provisional cameras. The exercise
added 2 px of click jitter on the recorded position and 3 px in a stress test
with the position displaced 55 m east. A spread set used a point near the
centre and two well-separated points. A clustered set chose the three grid
points nearest the first click. Other ground points were held out of the fit.

Success for this experiment means a 90th-percentile error of at most 40 px
on the held-out ground points, at a working width of 1,050 px. This is a
comparison threshold for the replay. Acceptance in the app checks the
worst held-out pair and still requires visual review.

| Method | Recorded position | 55 m offset, spread points | Median error with offset |
| --- | ---: | ---: | ---: |
| Recorded heading | 0 / 13 | 0 / 13 | 19,660 px |
| Skyline fit | 6 / 13 | 0 / 13 | 3,235 px |
| One point, level roll | 7 / 13 | 4 / 13 | 79.6 px |
| One point, skyline roll | 9 / 13 | 1 / 13 | 69.7 px |
| One distant point, level roll | 6 / 13 | 2 / 13 | 125.7 px |
| Two points, position held | 13 / 13 | 3 / 13 | 55.5 px |
| Three points, position held | 13 / 13 | 4 / 13 | 63.0 px |
| Three points, position adjusted near GPS | 13 / 13 | 13 / 13 | 7.8 px |
| Three clustered points, position adjusted near GPS | — | 10 / 13 | 25.7 px |

One point with level roll brought the heading within 5° of the provisional pick
on 12 of 13 photos at the recorded position and 11 of 13 with the offset. The
whole-frame errors show why a good heading alone can still leave an offset
road or shoreline. Keeping the current roll gives the reviewer a predictable
starting camera. With two landmarks the app solves roll, and with three it can
adjust the recorded position using a prior. A distant point by itself and
clustered points were weaker on this sample.

These are controlled perturbations around provisional cameras. They measure
how the solver responds to known inputs. Field accuracy still needs
independently paired landmarks and a repeat on another flight. The useful
next measurement is the percentage of photos reaching a checked camera at
zero, one, two and three reviewer-placed landmarks on that separate flight.

In Chromium, an original HEIC opened the landmark guide and moved between
the photo and plan for each pick. The one-landmark result appeared in the
camera options and kept the acceptance gate. The two-landmark solve led
to the three-landmark held-out check in the same guide. These interface
checks exercised the controls, alongside the controlled geometry replay.

See [flight matching](photo-flight-matching-2026-11-17.md) for the browser
matching replay and [combined scoring](photo-combined-camera-2026-11-17.md)
for the depth and appearance experiments.
