/** Published models; no site-specific accuracy is implied by these presets. */
export const MODEL_SOURCES = {
  dbh: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6849852/',
  volume: 'https://www.for.gov.bc.ca/hfd/pubs/docs/TR/TR106.pdf',
  foresttools: 'https://andrew-plowright.r-universe.dev/ForestTools/doc/manual.html',
  fora: 'https://github.com/fora-platform/fora',
}
// Nigh (2016), equation 2, Tables 4 and 6, INTERIOR region; Table 3 marginal fitting ranges.
// Volume: m³ inside bark; DBH: cm outside bark; height: m. Merchantable: 0.3 m stump, 4 cm inside-bark top.
export const INTERIOR_VOLUME: Record<
  string,
  {
    total: [number, number, number]
    merchant: [number, number, number]
    dbh: [number, number]
    height: [number, number]
  }
> = {
  AC: { total: [-10.507, 1.768, 1.25], merchant: [-10.74, 1.766, 1.312], dbh: [6.6, 136.9], height: [9.1, 48.9] },
  AT: { total: [-10.314, 1.863, 1.135], merchant: [-10.829, 1.86, 1.287], dbh: [3.8, 72.9], height: [4.4, 38.3] },
  BL: { total: [-9.879, 1.843, 1.025], merchant: [-10.132, 1.83, 1.107], dbh: [3.9, 96], height: [3.2, 53.3] },
  CW: { total: [-9.506, 1.728, 1.012], merchant: [-9.75, 1.696, 1.105], dbh: [3.3, 209.6], height: [3.3, 54.9] },
  EP: { total: [-10.21, 1.911, 1.038], merchant: [-10.679, 1.94, 1.147], dbh: [5.1, 53.4], height: [8, 27.2] },
  FDI: { total: [-10.096, 1.755, 1.146], merchant: [-10.388, 1.77, 1.207], dbh: [2.1, 147.6], height: [2.6, 54.3] },
  HW: { total: [-10.174, 1.888, 1.056], merchant: [-10.387, 1.885, 1.114], dbh: [3.8, 135.3], height: [3.2, 50.4] },
  LW: { total: [-9.912, 1.761, 1.069], merchant: [-10.059, 1.748, 1.113], dbh: [4.1, 103.3], height: [4.2, 53.7] },
  PLI: { total: [-9.92, 1.887, 1.018], merchant: [-10.041, 1.88, 1.051], dbh: [3.8, 70], height: [3.1, 40.8] },
  PW: { total: [-9.96, 1.78, 1.12], merchant: [-10.189, 1.755, 1.203], dbh: [7.1, 105.4], height: [6.8, 53.7] },
  PY: { total: [-10.465, 1.98, 1.035], merchant: [-10.809, 2.021, 1.08], dbh: [3.1, 112.7], height: [3.2, 48.7] },
  SX: { total: [-9.951, 1.807, 1.08], merchant: [-10.223, 1.781, 1.178], dbh: [4.1, 122.3], height: [3, 55.8] },
}
export const SPECIES_NAMES: Record<string, string> = {
  UNKNOWN: 'Unknown',
  AC: 'Cottonwood',
  AT: 'Trembling aspen',
  BL: 'Subalpine fir',
  CW: 'Western redcedar',
  EP: 'Paper birch',
  FDI: 'Interior Douglas-fir',
  HW: 'Western hemlock',
  LW: 'Western larch',
  PLI: 'Lodgepole pine',
  PW: 'Western white pine',
  PY: 'Ponderosa pine',
  SX: 'Interior spruce',
  SW: 'White spruce',
  SE: 'Engelmann spruce',
}
export const volumeGroup = (species: string) =>
  ['SW', 'SE', 'S'].includes(species)
    ? 'SX'
    : species === 'PL'
      ? 'PLI'
      : species === 'FD'
        ? 'FDI'
        : species === 'L'
          ? 'LW'
          : species
/** Jucker et al. equation 6, including its stated back-transformation correction. */
export function estimatedDbh(height: number, crownDiameter: number | null, factor = 1) {
  if (
    !Number.isFinite(height) ||
    height <= 0 ||
    crownDiameter === null ||
    !Number.isFinite(crownDiameter) ||
    crownDiameter <= 0 ||
    !Number.isFinite(factor) ||
    factor <= 0
  )
    return null
  return 0.557 * Math.pow(height * crownDiameter, 0.809) * Math.exp(0.056 ** 2 / 2) * factor
}
export function stemVolume(species: string, dbh: number | null, height: number, minDbh = 12.5) {
  const model = INTERIOR_VOLUME[volumeGroup(species)]
  if (!model) return { total: null, merchant: null, status: 'Species has no selected interior equation' }
  if (
    dbh === null ||
    !Number.isFinite(dbh) ||
    !Number.isFinite(height) ||
    dbh < model.dbh[0] ||
    dbh > model.dbh[1] ||
    height < model.height[0] ||
    height > model.height[1]
  )
    return { total: null, merchant: null, status: 'Outside published marginal DBH / height ranges' }
  const f = (b: number[]) => Math.exp(b[0]) * dbh ** b[1] * height ** b[2]
  const total = f(model.total),
    merchant = dbh < minDbh ? 0 : f(model.merchant)
  if (merchant > total)
    return { total: null, merchant: null, status: 'Independent equations give merchantable > total; withheld' }
  return { total, merchant, status: 'Exploratory BC interior volume model' }
}
