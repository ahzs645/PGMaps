/**
 * Synthetic class rasters as JPEG, for the coefficient reader and the palette decoder. Generated
 * with Pillow (quality 15, 4:2:0, standard IJG tables) from `syntheticClassLabels`; the expected
 * coefficients were read back with jpeglib. No source sheet data.
 */
export const SYNTHETIC_PALETTE: [number, number, number][] = [
  [255, 255, 115],
  [163, 255, 115],
  [115, 223, 255],
  [223, 115, 255],
  [255, 170, 0],
  [255, 127, 127],
  [255, 0, 0],
]
export const SYNTHETIC_SIZE = { width: 120, height: 88 }
/** Class per pixel (legend index) and whether it is drawn; transparent pixels are black in the JPEG. */
export function syntheticClassLabels() {
  const { width, height } = SYNTHETIC_SIZE,
    K = SYNTHETIC_PALETTE.length
  const labels = new Uint8Array(width * height),
    drawn = new Uint8Array(width * height)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      labels[y * width + x] = ((x >> 4) * 3 + (y >> 3) * 5 + ((x * y) >> 7)) % K
      drawn[y * width + x] = ((x >> 2) + (y >> 2)) % 7 !== 0 ? 1 : 0
    }
  return { labels, drawn }
}
export const SYNTHETIC_JPEGS = {
  plain: {
    b64: '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDADUlKC8oITUvKy88OTU/UIVXUElJUKN1e2GFwarLyL6qurfV8P//1eL/5re6////////////zv//////////////2wBDATU8PFBGUJ1XV53/3Lrc////////////////////////////////////////////////////////////////////wAARCABYAHgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCxZ2n2Xf8APu3Y7YqzVSoJZSDtXj1NYOPVm6pXJqp4+3f7Gz8c5/8A1UpP2/8A6Z7Pxzn/APVV3JNdUm2r3sjNNy6DPsP/AE1/8d/+vTlsowPmdifbihbKNfvsTz24plzLFaBQIFfdnqen865Fd7Gkqj2UvwG3F0YNvyBt2e+KLaD7Pu+YNux2psEK227c+d3tipBIG+4rN64HStXUZKpLsSeQ3/Pf/wAcpPIb/nv/AOO1L5vpWezHUMZ+Ty/xzn/9VLla3J9pN/8ADAzfb/8Apns/HOf/ANVXDLjqQPrR5cu7lkC/iaPKO7LSnHoFpczey/Adqa0bF8s/89V/75/+vVe6ma32YIbdntjFLcXnlbcAPn0P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',
    len: 2548,
    y_0_0: [8, -12, 0, 3, 0, -1, 0, 0, -11, -10],
    y_5_7: [5, 0, 2, 0, 0, 0, 0, 0, 1, 2],
    cb_3_4: [-4, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    cr_5_7: [3, -2, -1, 0, 0, 0, 0, 0, -2, 1],
    qy: [53, 37, 33, 53, 80, 133, 170, 203],
    blocks: [
      [11, 15],
      [6, 8],
    ],
  },
  restart: {
    b64: '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDADUlKC8oITUvKy88OTU/UIVXUElJUKN1e2GFwarLyL6qurfV8P//1eL/5re6////////////zv//////////////2wBDATU8PFBGUJ1XV53/3Lrc////////////////////////////////////////////////////////////////////wAARCABYAHgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/90ABAAD/9oADAMBAAIRAxEAPwCxZ2n2Xf8APu3Y7YqzVSoJZSDtXj1NYOPVm6pXJqp4+3f7Gz8c5/8A1UpP2/8A6Z7Pxzn/APVV3JNdUm2r3sjNNy6DPsP/AE1/8d/+vTlsowPmdifbihbKNfvsTz24plzLFaBQIFfdnqen865Fd7Gkqj2UvwP/0FuLowbfkDbs98UW0H2fd8wbdjtTYIVtt2587vbFSCQN9xWb1wOlQ6jNVSXYk8hv+e//AI5SeQ3/AD3/APHal830rPZjqGM/J5f45z/+qlytbk+0m/8AhgZvt/8A0z2fjnP/AOqrhlx1IH1o8uXdyyBfxNHlHdlpTj0C0uZvZfgO1NaNn//RseWf+eq/98//AF6r3UzW+zBD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',
    len: 2601,
    y_0_0: [8, -12, 0, 3, 0, -1, 0, 0, -11, -10],
    y_5_7: [5, 0, 2, 0, 0, 0, 0, 0, 1, 2],
    cb_3_4: [-4, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    cr_5_7: [3, -2, -1, 0, 0, 0, 0, 0, -2, 1],
    qy: [53, 37, 33, 53, 80, 133, 170, 203],
    blocks: [
      [11, 15],
      [6, 8],
    ],
  },
} as const
