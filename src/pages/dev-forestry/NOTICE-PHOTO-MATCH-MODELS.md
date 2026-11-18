# Optional photo-matching models

_Match flight photos_ can pair two photos with a learned detector and matcher in place of the bundled XFeat
(`photoMatchers.ts`, `photoFeatures.worker.ts`). The two model files are not in this repository and are not part of a
build. `npm run photo-match:fetch-models` downloads them into the git-ignored `public/models/photo-match/` and checks
each against the size and SHA-256 sum in `photoMatchModels.json`.

| File                    | What                         | From                                                                                                           | Licence                                       |
| ----------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `aliked.onnx`           | ALIKED detector (aliked-n16) | Shiaoming/ALIKED weights through cvg/LightGlue, exported to ONNX by WebSfM (`scripts/models/export-aliked.py`) | BSD-3-Clause (ALIKED), Apache-2.0 (LightGlue) |
| `lightglue_aliked.onnx` | LightGlue matcher for ALIKED | cvg/LightGlue `aliked_lightglue` weights, exported to ONNX by WebSfM                                           | Apache-2.0                                    |

Both come from the `models-v1` release of [WebSfM](https://github.com/fdahle/websfm) (MIT, Felix Dahle). A GitHub
release sends no CORS headers, so a browser cannot read them there: the site serves its own copy.

No code was taken from WebSfM. The worker's use of the models follows their published interface: an RGB picture scaled
to 0–1 in, keypoints, scores and 128-number descriptors out; LightGlue takes keypoints measured from the picture's
centre in half its longer side. PGMaps runs them locally with ONNX Runtime Web; the photos stay on the device.
