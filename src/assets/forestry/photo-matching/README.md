# XFeat browser assets

`xfeat.onnx` is the sparse extractor from
[XFeat-ONNX V1.0.0](https://github.com/DavideCatto/XFeat-ONNX/releases/tag/V1.0.0),
distributed under Apache 2.0. XFeat is by [verlab](https://github.com/verlab/accelerated_features),
also under Apache 2.0. `matching.onnx` is generated locally by `generate-matcher.py`.
It returns the two strongest cosine matches for each descriptor in each direction.
PGMaps runs both files locally with ONNX Runtime Web.
