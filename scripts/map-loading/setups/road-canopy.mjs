// The road designer's canopy height layer: `--layer road-canopy-height --host source.coop`.
//   --url 'http://127.0.0.1:42320/dev/forestry/road-design?interface=ribbon&example=training'
//   --map '[data-testid="road-plan-view"] .maplibregl-map' --center -122.6,54.0 --zoom 14
export async function setup({ page }) {
  await page.waitForFunction(
    () => document.querySelector('[data-testid="road-map-ready"]')?.getAttribute('data-ready') === 'true',
    null,
    { timeout: 120_000 },
  )
  const ribbon = page.getByRole('region', { name: 'Command ribbon' })
  await ribbon.getByRole('tablist', { name: 'Ribbon tabs' }).getByRole('tab', { name: 'View', exact: true }).click()
  await ribbon.getByRole('button', { name: 'Canopy height (CHM v2)', exact: true }).click()
  await page.getByRole('button', { name: 'Fullscreen Plan · alignment & terrain', exact: true }).click()
  await page.waitForTimeout(500)
}
