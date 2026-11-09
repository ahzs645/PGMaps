# Synthetic source-image fixture

This is a generated 2,049 × 1,025 pixel grid with coloured corner and centre markers, not a real map or private collection image. `source.png` is the exact original; the smaller WebP files and image-coordinate PMTiles archive were prepared with `scripts/shared-maps-worker/prepare_image_variants.py` at tile size 512, preview side 640, thumbnail side 320 and WebP quality 92. `variant.json` records each file's dimensions, bytes and SHA-256.

The 24-tile archive has a native level of 3 and deliberately odd image edges. Its metadata declares `pgmaps-image-pyramid-v1` and binds the archive to the original PNG hash. It exercises real ranged PMTiles reads and image decoding in `source-image-variants.spec.ts`; no live source data or credentials are used.

Run the journey through the repository's manual Playwright command:

```sh
PGMAPS_E2E_BASE_URL=http://127.0.0.1:42173 npx playwright test tests/e2e/source-image-variants.spec.ts --project=chromium --workers=1
```
