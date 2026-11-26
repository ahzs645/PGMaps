/**
 * The map themes that come with PGMaps. Their fonts are committed under `public/illustrated-map/
 * fonts/` and fetched by path; a theme imported from a ZIP carries its own. No DOM or network
 * access here: `fontPath` is joined to the app's base URL by the caller.
 */
import { DEFAULT_CHANNEL_GAP, VANCOUVER_ISLAND_HIGHWAY_1 } from './geographic'
import { DEFAULT_HATCH_OPTIONS, DEFAULT_PAGE8_HATCH_OPTIONS } from './hatching'
import { MAP_PALETTE } from './layout'
import {
  hatchRecipeFromSettings,
  MAP_THEME_TYPE,
  MAP_THEME_VERSION,
  type MapTheme,
  type MapThemeFont,
} from './mapTheme'

const GREAT_FOREST_LICENCE =
  'Great Forest, Destination British Columbia. Copyright 2015 Adobe Systems Incorporated / 2021 Destination British Columbia, all rights reserved; embedding flag: preview and print. Included for testing only.'
const BC_SANS_LICENCE =
  'BC Sans. Copyright 2015 Google Inc., Copyright Province of B.C. 2019. SIL Open Font License, Version 1.1 (https://scripts.sil.org/OFL).'

/** A built-in theme's font: the theme entry less its checksum (worked out when saved), and where it lives. */
export type PresetFont = Omit<MapThemeFont, 'sha256'> & { fontPath: string }
export interface MapThemePreset {
  id: string
  theme: Omit<MapTheme, 'fonts'>
  fonts: PresetFont[]
}

const font = (
  id: string,
  family: string,
  fontPath: string,
  licence: string,
  capitalAlternates?: boolean,
): PresetFont => ({
  id,
  family,
  file: `fonts/${fontPath.split('/').pop()!}`,
  fontPath,
  licence,
  ...(capitalAlternates ? { capitalAlternates } : {}),
})

const WEBSITE_SMALL_CAPS = font(
  'great-forest-small-caps',
  'Great Forest Small Caps',
  'illustrated-map/fonts/great-forest/GreatForest-SmallCaps-website.ttf',
  GREAT_FOREST_LICENCE,
)
const V2_SIMPLIFIED = font(
  'great-forest-v2-simplified',
  'Great Forest v2 Simplified',
  'illustrated-map/fonts/great-forest/GreatForestv2-Simplified.ttf',
  GREAT_FOREST_LICENCE,
  true,
)
const BC_SANS = font('bc-sans', 'BC Sans', 'illustrated-map/fonts/bc-sans/BCSans-Regular.ttf', BC_SANS_LICENCE)
const VIN_SMALL_CAPS = font(
  'great-forest-small-caps-2015',
  'Great Forest Small Caps 2015',
  'illustrated-map/fonts/great-forest/GreatForest-SmallCaps-v1.000-VancouverIslandNorth.decompressed.ttf',
  GREAT_FOREST_LICENCE,
)
const VIN_SIMPLIFIED = font(
  'great-forest-simplified-2015',
  'Great Forest Simplified 2015',
  'illustrated-map/fonts/great-forest/GreatForest-Simplified-v1.000-VancouverIslandNorth.decompressed.ttf',
  GREAT_FOREST_LICENCE,
  true,
)

const base = { type: MAP_THEME_TYPE, version: MAP_THEME_VERSION } as const
const page8Map = {
  coverage: 'page8',
  labelSet: 'page8',
  channelGap: DEFAULT_CHANNEL_GAP,
  lakes: true,
  minIslandKm2: 1,
  minLakeKm2: 2,
  hiddenRoads: [VANCOUVER_ISLAND_HIGHWAY_1],
  compassLettering: 'smallcaps',
  vectorMasks: true,
} as const satisfies MapTheme['map']
const page8Hatch = hatchRecipeFromSettings(
  'patch',
  DEFAULT_HATCH_OPTIONS,
  DEFAULT_PAGE8_HATCH_OPTIONS,
  MAP_PALETTE.hatch.toLowerCase(),
)

export const MAP_THEME_PRESETS: readonly MapThemePreset[] = [
  {
    id: 'page8-great-forest',
    theme: {
      ...base,
      name: 'Page 8 · Great Forest',
      description:
        'Page 8 as the guide prints it: northern BC hatched patch by patch, the journey region white, page 8’s names in the current Great Forest Small Caps and v2 Simplified, the footer in BC Sans. Islands under 1 km² and lakes under 2 km² are left out.',
      hatch: page8Hatch,
      map: page8Map,
      lettering: { places: WEBSITE_SMALL_CAPS.id, regions: V2_SIMPLIFIED.id, body: BC_SANS.id },
    },
    fonts: [WEBSITE_SMALL_CAPS, V2_SIMPLIFIED, BC_SANS],
  },
  {
    id: 'page8-great-forest-2015',
    theme: {
      ...base,
      name: 'Page 8 · Great Forest 2015',
      description:
        'The page 8 edition lettered in the 2015 Great Forest Small Caps and Simplified (the Vancouver Island North webfont builds).',
      hatch: page8Hatch,
      map: page8Map,
      lettering: { places: VIN_SMALL_CAPS.id, regions: VIN_SIMPLIFIED.id },
    },
    fonts: [VIN_SMALL_CAPS, VIN_SIMPLIFIED],
  },
  {
    id: 'coastal-contour',
    theme: {
      ...base,
      name: 'Coastal · continuous bands',
      description:
        'The first geographic edition: the coast hatched in continuous bands, every place named, the built-in lettering.',
      hatch: hatchRecipeFromSettings(
        'contour',
        DEFAULT_HATCH_OPTIONS,
        DEFAULT_PAGE8_HATCH_OPTIONS,
        MAP_PALETTE.hatch.toLowerCase(),
      ),
      map: { coverage: 'coastal', labelSet: 'all', channelGap: DEFAULT_CHANNEL_GAP, lakes: true },
      lettering: {},
    },
    fonts: [],
  },
]
