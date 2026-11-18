/**
 * The optional depth models the camera comparison can run in this browser, pinned to a revision, and the Cache Storage
 * their weights are kept in once downloaded. Shared by the worker that runs them and the page that asks whether one is
 * already here.
 *
 * Free of DOM and network access.
 */
export type PhotoDepthModel = 'da2-small' | 'da3-small'

export const PHOTO_DEPTH_CACHE = 'pgmaps-photo-depth-v1'

export const PHOTO_DEPTH_MODELS: Record<
  PhotoDepthModel,
  { root: string; files: ReadonlyArray<{ path: string; size: number }>; longEdge: number }
> = {
  'da2-small': {
    root: 'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/4472b7362082ad9968fee890ca0f1e5aca36b93d/onnx/',
    files: [{ path: 'model_quantized.onnx', size: 27_258_801 }],
    longEdge: 504,
  },
  'da3-small': {
    root: 'https://huggingface.co/onnx-community/depth-anything-v3-small/resolve/0b6a7f3bf5595f9950b91389e0da3a0de130324c/onnx/',
    files: [
      { path: 'model.onnx', size: 640_691 },
      { path: 'model.onnx_data', size: 104_702_464 },
    ],
    longEdge: 378,
  },
}

/** The addresses a model's weights are fetched from, and kept under. */
export const depthModelUrls = (model: PhotoDepthModel): string[] =>
  PHOTO_DEPTH_MODELS[model].files.map(({ path }) => PHOTO_DEPTH_MODELS[model].root + path)
