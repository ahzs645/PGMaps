# BC forDRAT data notice

Copyright 2024 Province of British Columbia.

This folder redistributes the published forDRAT CSV from [bcgov/forDRAT](https://github.com/bcgov/forDRAT), commit `ac51aafe7b66d039c990964a9acd809a2ea73848`. The source repository is licensed under the Apache License, Version 2.0; the complete licence is retained in [LICENSE-fordrat.md](LICENSE-fordrat.md).

The upstream file `data/forDrat.csv` is stored as `fordrat.csv` without changing any bytes. Git blob SHA: `29fcf5e9207802e3516b809418bbbe73ab96ff12`. SHA-256: `abdb1a26645d6d24e6d45380f55aa555a5f69ffdad79c5f7fb47627003f0d2df`.

PG Maps adds a browser parser, source manifest, selection interface and downloads. Those additions do not recalculate the published AET/PET values or species risk ratings. The separate experimental legacy calculator ports `bcgov/forestDroughtTool`; it does not reproduce this newer dataset's climate-data preparation.

## Interpretation

The data concern drought-related mortality in mature forest stands and interior tree species. Soil moisture regimes wetter than subhygric are outside the model. The source gives a value for every listed species in every BGC unit, including outside a species' range. A rating does not establish species occurrence, planting suitability or regeneration success.

BGC identifiers refer to BEC v11. A matching identifier in another map release does not establish matching boundaries. Relative soil moisture regime needs an independent site assessment.

The table contains three historical periods and three projections. The 2020 projection spans 2011–2040; it is not current drought monitoring. The upstream README omits 1971–2000 and inconsistently labels the final projection 2070; this snapshot preserves all six CSV labels, including 2080. The catalogue metadata supplies the period intervals and dataset-specific species names.

## References

- [Pinned upstream README](https://github.com/bcgov/forDRAT/blob/ac51aafe7b66d039c990964a9acd809a2ea73848/README.md)
- [BC Data Catalogue — Forest Drought Risk Assessment Tool](https://catalogue.data.gov.bc.ca/dataset/forest-drought-risk-assessment-tool)
- [BC metadata on Canada's Open Government Portal](https://open.canada.ca/data/en/dataset/ab4dea99-9827-46de-a240-5c22af506564)
- DeLong, S.C., H. Griesbauer, C.R. Nitschke, V. Foord and B. Rogers. 2019. [Development of a drought risk assessment tool for British Columbia forests using a stand-level water-balance approach](https://www.for.gov.bc.ca/hfd/pubs/Docs/Tr/TR125.pdf). Technical Report 125.
