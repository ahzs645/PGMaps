// The illustrated map workshop's live hatch (`MapHatchLayer`): `--layer illustrated-live-hatch`.
//   --url 'http://127.0.0.1:42320/dev/illustrated-map?view=live' --center -124.5,52.5 --zoom 6
// The action switches the hatch style, which changes the tile source (`setTiles`, tile by tile).
export async function setup({ page }) {
  await page.waitForSelector('[data-testid="live-hatch-map"] .maplibregl-canvas', { timeout: 120_000 })
  await page.waitForTimeout(1500)
}

export const actions = [
  {
    name: 'page-8-style',
    holdMs: 4000,
    async run({ page }) {
      await page.getByRole('combobox', { name: 'Hatch style' }).click()
      await page.getByRole('option', { name: 'Page 8 · patches' }).click()
    },
  },
]
