# Check research data, projects and attachments

Run from the PGMaps repository. Python 3's standard library is sufficient:

```sh
python3 scripts/nechako-server/audit_data.py --head-links --output /tmp/nechako-data-audit
```

The script writes `report.json` and `attachments.csv`. It measures the four public nwsviz JSON responses, checks the portal's saved-project list, and pages through the linked public Zotero group's attachment metadata. HTTP 200 responses with a portal failure/error are recorded as failures. A page/request bound, denied access or malformed response is reported rather than treated as a complete empty catalogue.

`--head-links` optionally checks HTTPS GET links using HEAD only. It does not download PDFs, audio, video, images or archives. HTML/JSON landing-page lengths and compressed transfer lengths are excluded from file-size totals. HTTP links, unsupported HEAD requests and native portal POST downloads remain unmeasured. The CSV lists each reference's type, download method, available byte size and probe result. Sizes are deduplicated by exact URL; this is an observed subtotal, not total portal storage. Unknown sizes remain unknown, including when no accessible files are found.

For **known portal submission IDs**, repeat `--submission-id`:

```sh
python3 scripts/nechako-server/audit_data.py --submission-id 123 --submission-id 456 --output /tmp/nechako-data-audit
```

These numbers are examples, not verified portal IDs. Use IDs supplied by the portal's search or an authorized export. The script never enumerates IDs and never assumes nwsviz record numbers are portal submission numbers. It uses anonymous reads; protected attachment metadata requires an export obtained through your authorized portal account.

To inspect exported attachment metadata, use `--attachment-manifest /path/to/export.json` (repeatable). Accepts the native attachment array or `{ "attributes": [...] }`. Native fields include `name`, `metadata` and `download`; `download` resolves under the portal's `rest/` directory and requires a POST in the original client, so it is not probed as GET. Generic manifests may use `title`, `url`, `content_type`, and explicitly labeled `size_bytes`. Undocumented `size`/`metadata` units are not added to totals. Do not commit private exports or generated reports to the repository.

Other options: `--skip-zotero`, `--zotero-group ID`, `--max-pages 20` (100 attachment items per page), `--max-probes 100`, and `--timeout 30` (seconds per request). Zotero long backoff or errors stop that inventory; rerun later. The result is a point-in-time audit, not an atomic snapshot while an external catalogue is changing.

## Verified October 11, 2026

- Public nwsviz: **1,408 research records**, 51 location IDs, four JSON files totaling **802,513 bytes**. The research rows have no file URL, DOI, Zotero key or attachment-size field.
- Linked public Zotero group 5510344: **767 top-level items** and **8 attachment entries**, all `linked_url` references with `text/html` content type. No downloadable file enclosure is advertised for these eight entries. This library is a separate live catalogue; a complete mapping to the 1,408-record generated dataset is not established.
- Portal saved-project listing: **“Website not registered”**, even with HTTP 200. No full project count or portal attachment storage total is established.

These results do not establish that PDFs/videos are absent from the full portal, private library or external publishers. They establish what these public endpoints expose. Counting the portal's actual documents/media requires an accessible attachment catalogue, known submission IDs or an authorized export; measuring total storage requires reliable byte sizes or a server-side storage inventory. The script does not authenticate, write portal data, repair registration, or test browser CORS. Existing browser CORS evidence and the deployment steps are in [the server runbook](server-runbook.md).

Offline validation:

```sh
python3 scripts/nechako-server/test_audit_data.py
```
