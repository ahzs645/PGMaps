const RESEARCH_LOCATION_NAMES: Readonly<Record<string, string>> = {
  prince_george: 'Prince George',
  nechako_watershed: 'Nechako Watershed',
  nechako_river: 'Nechako River',
  takla_lake: 'Takla Lake',
  kenney_dam: 'Kenney Dam',
  fraser_river: 'Fraser River',
  fraser_basin_watershed: 'Fraser Basin Watershed',
  vanderhoof: 'Vanderhoof',
  fort_st_james: 'Fort St. James',
  stuart_lake: 'Stuart Lake',
  endako: 'Endako',
  fraser_lake: 'Fraser Lake',
  bulkley_nechako_rd: 'Regional District of Bulkley-Nechako',
  cheslatta: 'Cheslatta',
  northern_bc: 'Northern BC',
  burns_lake: 'Burns Lake',
  pinchi_lake: 'Pinchi Lake',
  bc_soi_wetsuwetennation: "Wet'suwet'en Nation",
  nechako_reservoir: 'Nechako Reservoir',
  francois_lake: 'François Lake',
  trembleur_lake: 'Trembleur Lake',
  kemano: 'Kemano',
  ootsa_lake: 'Ootsa Lake',
  cheslatta_carrier_nation_community: 'Cheslatta Carrier Nation Community',
  carrier_sekani_tribal_nations_territory: 'Carrier Sekani Tribal Nations Territory',
  burns_lake_community: 'Burns Lake Community',
  smithers: 'Smithers',
  fraser_fort_george_rd: 'Regional District of Fraser-Fort George',
  williams_lake: 'Williams Lake',
  nulki_lake: 'Nulki Lake',
  mackenzie: 'Mackenzie',
  caribou_rd: 'Cariboo Regional District',
  sd_91: 'School District 91',
  fraser_lake_water: 'Fraser Lake Water',
  kemess_mine: 'Kemess Mine',
  bc_soi_carriersekanitribalcouncil: 'Carrier Sekani Tribal Council',
  tezzeron_lake: 'Tezzeron Lake',
  bc_soi_lheidlitennehfirstnation: "Lheidli T'enneh First Nation",
  cheslatta_lake: 'Cheslatta Lake',
  burns_lake_first_nation: 'Burns Lake First Nation',
  tweedsmuir_park: 'Tweedsmuir Park',
  capoose_lake: 'Capoose Lake',
  omineca_resource_region: 'Omineca Resource Region',
  mcbride: 'McBride',
  saikuz: "Saik'uz First Nation",
  tetachuk_lake: 'Tetachuck Lake',
  irs_locations_lejac: 'Lejac Residential School',
  bc_soi_gitxsanhereditarychiefs: 'Gitxsan Hereditary Chiefs',
  bc_soi_cheslattacarriernation: 'Cheslatta Carrier Nation',
  bc_soi_lakebabinenation: 'Lake Babine Nation',
  decker_lake: 'Decker Lake',
}

export function researchLocationDisplayName(location: { id: string; name: string }): string {
  return RESEARCH_LOCATION_NAMES[location.id] ?? humanizeLocationName(location.name)
}

function humanizeLocationName(name: string): string {
  return name
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase())
}
