/** Verified against the BC Data Catalogue and HTTP range responses, 2026-11-02 UTC. */
export const THLB_SOURCES = {
  official: {
    catalogue: 'https://catalogue.data.gov.bc.ca/dataset/8a87abbd-7623-426a-94c4-12e9dfea7cb0',
    download: 'https://www.for.gov.bc.ca/ftp/HTS/external/!publish/DataCatalogue_FAIB_Data/THLB/',
  },
  proxy: {
    catalogue: 'https://catalogue.data.gov.bc.ca/dataset/63756eb9-9e7c-497e-9498-3dee3e080616',
    download: 'https://coms.api.gov.bc.ca/api/v1/object/28d59553-b76c-4c02-86c7-f1c7efe65b26',
    methodology: 'https://coms.api.gov.bc.ca/api/v1/object/6bdb45d9-dd81-4711-95ae-8e9760fde7bc',
  },
}
