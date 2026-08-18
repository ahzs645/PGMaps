import { describe, expect, it } from 'vitest'

import { researchLocationDisplayName } from './researchLocationNames'

const SOURCE_LOCATIONS = [
  ['prince_george', 'Prince George', 'Prince George'],
  ['nechako_watershed', 'nechako_watershed', 'Nechako Watershed'],
  ['nechako_river', 'Nechako_River', 'Nechako River'],
  ['takla_lake', 'takla_lake', 'Takla Lake'],
  ['kenney_dam', 'Kenney dam', 'Kenney Dam'],
  ['fraser_river', 'Fraser_River', 'Fraser River'],
  ['fraser_basin_watershed', 'Fraser_Basin_Watershed', 'Fraser Basin Watershed'],
  ['vanderhoof', 'vanderhoof', 'Vanderhoof'],
  ['fort_st_james', 'Fort St James', 'Fort St. James'],
  ['stuart_lake', 'stuart_lake', 'Stuart Lake'],
  ['endako', 'endako', 'Endako'],
  ['fraser_lake', 'fraser_lake', 'Fraser Lake'],
  ['bulkley_nechako_rd', 'bulkley_nechako_RD', 'Regional District of Bulkley-Nechako'],
  ['cheslatta', 'Cheslatta', 'Cheslatta'],
  ['northern_bc', 'northern_BC', 'Northern BC'],
  ['burns_lake', 'burns_lake', 'Burns Lake'],
  ['pinchi_lake', 'pinchi_lake', 'Pinchi Lake'],
  ['bc_soi_wetsuwetennation', 'BC_SOI_WetsuwetenNation', "Wet'suwet'en Nation"],
  ['nechako_reservoir', 'nechako_reservoir', 'Nechako Reservoir'],
  ['francois_lake', 'Francois_lake', 'François Lake'],
  ['trembleur_lake', 'trembleur_lake', 'Trembleur Lake'],
  ['kemano', 'Kemano', 'Kemano'],
  ['ootsa_lake', 'Ootsa_Lake', 'Ootsa Lake'],
  ['cheslatta_carrier_nation_community', 'Cheslatta Carrier Nation Community', 'Cheslatta Carrier Nation Community'],
  [
    'carrier_sekani_tribal_nations_territory',
    'Carrier Sekani Tribal Nations Territory',
    'Carrier Sekani Tribal Nations Territory',
  ],
  ['burns_lake_community', 'Burns Lake community', 'Burns Lake Community'],
  ['smithers', 'Smithers', 'Smithers'],
  ['fraser_fort_george_rd', 'fraser_fort-george_RD', 'Regional District of Fraser-Fort George'],
  ['williams_lake', 'Williams_Lake', 'Williams Lake'],
  ['nulki_lake', 'Nulki_lake', 'Nulki Lake'],
  ['mackenzie', 'Mackenzie', 'Mackenzie'],
  ['caribou_rd', 'caribou_RD', 'Cariboo Regional District'],
  ['sd_91', 'SD 91', 'School District 91'],
  ['fraser_lake_water', 'fraser_lake_water', 'Fraser Lake Water'],
  ['kemess_mine', 'Kemess_Mine', 'Kemess Mine'],
  ['bc_soi_carriersekanitribalcouncil', 'BC_SOI_CarrierSekaniTribalCouncil', 'Carrier Sekani Tribal Council'],
  ['tezzeron_lake', 'Tezzeron_Lake', 'Tezzeron Lake'],
  ['bc_soi_lheidlitennehfirstnation', 'BC_SOI_LheidliTennehFirstNation', "Lheidli T'enneh First Nation"],
  ['cheslatta_lake', 'cheslatta_lake', 'Cheslatta Lake'],
  ['burns_lake_first_nation', 'Burns Lake First Nation', 'Burns Lake First Nation'],
  ['tweedsmuir_park', 'Tweedsmuir_Park', 'Tweedsmuir Park'],
  ['capoose_lake', 'Capoose Lake', 'Capoose Lake'],
  ['omineca_resource_region', 'Omineca_Resource_Region', 'Omineca Resource Region'],
  ['mcbride', 'McBride', 'McBride'],
  ['saikuz', 'saikuz', "Saik'uz First Nation"],
  ['tetachuk_lake', 'Tetachuk_lake', 'Tetachuck Lake'],
  ['irs_locations_lejac', 'IRS_Locations_Lejac', 'Lejac Residential School'],
  ['bc_soi_gitxsanhereditarychiefs', 'BC_SOI_GitxsanHereditaryChiefs', 'Gitxsan Hereditary Chiefs'],
  ['bc_soi_cheslattacarriernation', 'BC_SOI_CheslattaCarrierNation', 'Cheslatta Carrier Nation'],
  ['bc_soi_lakebabinenation', 'BC_SOI_LakeBabineNation', 'Lake Babine Nation'],
  ['decker_lake', 'Decker_lake', 'Decker Lake'],
] as const

describe('researchLocationDisplayName', () => {
  it.each(SOURCE_LOCATIONS)('normalizes %s', (id, name, expected) => {
    expect(researchLocationDisplayName({ id, name })).toBe(expected)
  })

  it('humanizes new source names that are not in the reviewed vocabulary', () => {
    expect(researchLocationDisplayName({ id: 'new_place', name: 'newPlace_name' })).toBe('New Place Name')
  })
})
