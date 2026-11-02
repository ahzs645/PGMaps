# BEC representation story data

This directory contains an adaptation of **Will MacKenzie's _Representation of
BEC units in Protected Areas of BC_**, dated 28 November 2023.

- Original repository: <https://github.com/whmacken/BEC_representation_PAS>
- Pinned revision: `0066648b02db082fded8ce9cf242c56d9a8ec22f`
- Upstream repository licence: Apache License 2.0; the original licence is
  retained at `source/LICENSE`.
- The six files in `source/` are unmodified copies. `manifest.json` records their
  Git blob identities and SHA-256 hashes.
- `representation.json` is a PGMaps adaptation: CSV parsing, explicit missing
  values, quality flags, class summaries, and per-unit park contributors. It
  does not rerun the spatial intersections or revise the published numbers.

The original workflow uses Province of British Columbia geographic datasets.
Their catalogue records and applicable Open Government Licence — British
Columbia are distinct from the upstream repository's software licence. See
`docs/bec-representation-story.md` for methods, sources, limitations, and the
separate provenance of any display geometry.
