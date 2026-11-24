/* global window */
// The block planner's old forest layer, stepped year by year and switched to another schedule: a
// change of choice redrawn by the old forest worker. DataBC is stubbed with a made-up unit beside
// the sample plan, so the run needs no network and repeats exactly.
//   --url 'http://127.0.0.1:42320/dev/forestry/block-planning?interface=guided'
//   --map '[data-testid="block-planning-map"] .maplibregl-map' --journey drag,zoom-out
const W = -122.84
const S = 53.96
const rect = (w, s, dx, dy) => ({
  type: 'Polygon',
  coordinates: [
    [
      [w, s],
      [w + dx, s],
      [w + dx, s + dy],
      [w, s + dy],
      [w, s],
    ],
  ],
})
// Ages chosen so the 200 m edges move as young stands pass 60 and 80 over the projection.
const ages = [
  [200, 30, 200, 160],
  [200, 200, 45, 300],
  [100, 200, 200, 200],
  [20, 150, 200, 70],
]
const stands = ages.flatMap((row, r) =>
  row.map((age, c) => ({
    geometry: rect(W + c * 0.025, S + r * 0.015, 0.025, 0.015),
    properties: {
      FEATURE_ID: r * 4 + c + 1,
      PROJ_AGE_1: age,
      PROJECTED_DATE: '2025-12-31Z',
      BCLCS_LEVEL_2: 'T',
      FOR_MGMT_LAND_BASE_IND: 'Y',
      SPECIES_CD_1: age < 60 ? 'PLI' : ['SX', 'PLI', 'BL', 'SX'][(r + c) % 4],
      BEC_ZONE_CODE: c < 2 ? 'SBS' : 'ESSF',
      BEC_SUBZONE: c < 2 ? 'wk' : 'mv',
      BEC_VARIANT: '1',
      SITE_INDEX: 8 + 3 * ((r * 4 + c) % 5),
    },
  })),
)
const unit = {
  geometry: rect(W, S, 0.1, 0.06),
  properties: {
    LEGAL_FEAT_ATRB_1_NAME: 'BECLABEL',
    LEGAL_FEAT_ATRB_1_VALUE: 'SBS wk 1',
    LEGAL_FEAT_ATRB_3_NAME: 'ORG_CODE',
    LEGAL_FEAT_ATRB_3_VALUE: 'DPG',
    LEGAL_FEAT_ATRB_5_NAME: 'UNIT_IDENT',
    LEGAL_FEAT_ATRB_5_VALUE: 'A10',
    LEGAL_FEAT_ATRB_7_NAME: 'OLD_RETEN',
    LEGAL_FEAT_ATRB_7_VALUE: 0.17,
  },
}
const road = {
  geometry: {
    type: 'LineString',
    coordinates: [
      [W + 0.012, S - 0.01],
      [W + 0.03, S + 0.07],
    ],
  },
  properties: { OBJECTID: 1 },
}

export async function setup({ page }) {
  await page.context().route(/openmaps\.gov\.bc\.ca\/geo\/pub\/wfs/, async (route) => {
    const body = route.request().postData() ?? ''
    const fc = (features) => route.fulfill({ json: { type: 'FeatureCollection', features } })
    if (body.includes('RMP_PLAN_LEGAL_POLY_SVW')) return fc([unit])
    if (body.includes('VEG_COMP_LYR_R1_POLY')) return fc(stands)
    if (body.includes('FTEN_ROAD_SECTION_LINES_SVW')) return fc([road])
    return fc([])
  })
  await page.getByTestId('block-planning-start').getByRole('button', { name: 'Open the sample' }).click()
  await page.getByTestId('block-planning-trend').waitFor({ timeout: 120_000 })
  await page.getByRole('tab', { name: 'Compare' }).click()
  await page
    .getByRole('button', { name: /^Old and old interior forest/ })
    .first()
    .click()
  const unitPicker = page.getByTestId('block-planning-steps').getByRole('combobox', { name: 'Old forest unit (Map 2)' })
  await unitPicker.click()
  await page.getByRole('listbox').last().getByRole('option', { name: /^A10 / }).click()
  await page.getByRole('button', { name: 'Read and calculate', exact: true }).click()
  const result = page.getByTestId('block-planning-old-forest')
  await result.getByText('Year', { exact: true }).first().waitFor({ timeout: 120_000 })
  await result.getByRole('checkbox', { name: 'Draw on the map' }).check()
  await page.getByTestId('block-planning-old-forest-legend').getByText('Old interior').waitFor({ timeout: 120_000 })
  // Centre the drawn unit at a zoom where the drag uncovers ground past it.
  await page.evaluate(({ lng, lat }) => window.__m.jumpTo({ center: [lng, lat], zoom: 12 }), {
    lng: W + 0.05,
    lat: S + 0.03,
  })
  // The toolkit's fill layers have generated ids: follow every layer on the old forest source.
  const layers = await page.evaluate(() =>
    window.__m
      .getStyle()
      .layers.filter((l) => l.source === 'fill-shared-planning-old-forest')
      .map((l) => l.id),
  )
  return { layers }
}

// The header's year picker: the legend names the new year at once, the map follows when drawn.
const year =
  (y) =>
  async ({ page }) => {
    await page.getByRole('combobox', { name: 'Year on the map' }).first().click()
    await page
      .getByRole('listbox')
      .last()
      .getByRole('option', { name: String(y), exact: true })
      .click()
  }

export const actions = [2031, 2036, 2041].map((y) => ({ name: `year-${y}`, run: year(y), holdMs: 4000 }))
