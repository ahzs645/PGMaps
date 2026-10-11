#!/usr/bin/env python3
"""Read-only Nechako inventory. Standard library only; never downloads file bodies."""

import argparse
import csv
import datetime
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path


PORTAL = 'https://nechakowatershed-portal.ca/'
RESEARCH = 'https://projects.ahmadjalil.com/nwsviz/data/'
FILES = ('overview.json', 'submissions.cleaned.json', 'locations.cleaned.json', 'decades.cleaned.json')
MAX_JSON_BYTES = 20 * 1024 * 1024


def https_url(value):
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError('Expected an HTTPS URL without embedded credentials')
    return value


class HttpsRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        https_url(newurl)
        redirected = super().redirect_request(req, fp, code, msg, headers, newurl)
        # urllib can change HEAD into GET after a redirect; do not read media bodies.
        if redirected is not None and req.get_method() == 'HEAD':
            redirected.method = 'HEAD'
        return redirected


class Client:
    def __init__(self, timeout=30):
        self.timeout = timeout
        self.opener = urllib.request.build_opener(HttpsRedirects())

    def json(self, url, params=None):
        result = {'url': https_url(url), 'method': 'POST' if params is not None else 'GET'}
        body = urllib.parse.urlencode(params).encode() if params is not None else None
        request = urllib.request.Request(url, data=body, headers={
            'Accept': 'application/json', 'Accept-Encoding': 'identity',
            'User-Agent': 'PGMaps-Nechako-ReadOnly-Audit/1.0', 'Zotero-API-Version': '3',
            **({'Content-Type': 'application/x-www-form-urlencoded'} if body is not None else {}),
        })
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                result.update(http_status=response.status, total_results=response.headers.get('Total-Results'))
                raw = response.read(MAX_JSON_BYTES + 1)
                if len(raw) > MAX_JSON_BYTES:
                    raise ValueError('JSON response exceeds 20 MiB; inventory is incomplete')
                result['json_bytes'] = len(raw)
                data = json.loads(raw)
                if isinstance(data, dict) and (
                    data.get('error') or data.get('success') is False
                    or str(data.get('status', '')).lower() in ('failure', 'failed', 'error')
                ):
                    raise ValueError(str(data.get('error') or data.get('message') or data.get('status')))
                result['ok'] = True
                return data, result, response.headers
        except (urllib.error.URLError, ValueError, TimeoutError, OSError) as error:
            result.update(ok=False, error=str(error))
            if isinstance(error, urllib.error.HTTPError):
                result['http_status'] = error.code
            return None, result, {}

    def head(self, url):
        result = {'method': 'HEAD'}
        try:
            https_url(url)
            request = urllib.request.Request(url, method='HEAD', headers={
                'Accept-Encoding': 'identity', 'User-Agent': 'PGMaps-Nechako-ReadOnly-Audit/1.0',
            })
            with self.opener.open(request, timeout=self.timeout) as response:
                mime = response.headers.get('Content-Type', '').split(';')[0].lower()
                result.update(http_status=response.status, content_type=mime)
                length = byte_size(response.headers.get('Content-Length'))
                is_file = mime not in ('', 'text/html', 'application/json', 'text/json')
                result['status'] = 'file_headers' if is_file else 'landing_page_or_nonfile'
                # A login/landing page's length is not the attachment's file size.
                if is_file and response.headers.get('Content-Encoding', 'identity') == 'identity':
                    result['size_bytes'] = length
        except (urllib.error.URLError, ValueError, TimeoutError, OSError) as error:
            result.update(status='unavailable', error=str(error))
            if isinstance(error, urllib.error.HTTPError):
                result['http_status'] = error.code
        return result


def byte_size(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, int) and value >= 0:
        return value
    if isinstance(value, str) and value.isdigit():
        return int(value)
    return None


def rows(data):
    value = data.get('attributes') if isinstance(data, dict) else data
    if not isinstance(value, list) or not all(isinstance(item, dict) for item in value):
        raise ValueError('Expected an array of objects, or {attributes: [...]}')
    return value


def portal_attachment(item, submission_id='', source='portal'):
    download = item.get('download')
    url = item.get('url') or item.get('href') or ''
    method = 'GET'
    if download:
        url = urllib.parse.urljoin(PORTAL + 'rest/', str(download))
        method = 'POST'  # Native SubmissionViewer submits a form, not a direct GET.
    return {
        'source': source, 'id': str(item.get('id', '')), 'parent_id': str(submission_id),
        'title': str(item.get('name') or item.get('title') or item.get('filename') or ''),
        'content_type': str(item.get('contentType') or item.get('content_type') or ''),
        'link_mode': 'portal_download' if download else 'linked_url', 'url': str(url), 'method': method,
        # Unqualified "size"/"metadata" fields have undocumented units. Keep them out of totals.
        'size_bytes': byte_size(item.get('size_bytes', item.get('sizeBytes'))),
        'size_source': 'explicit_byte_field' if byte_size(item.get('size_bytes', item.get('sizeBytes'))) is not None else '',
    }


def zotero_inventory(client, group, max_pages):
    checks, attachments = [], []
    base = f'https://api.zotero.org/groups/{group}/items'
    _, count_check, _ = client.json(base + '/top?limit=1')
    checks.append(count_check)
    expected = None
    complete = False
    for page in range(max_pages):
        data, check, headers = client.json(base + '?' + urllib.parse.urlencode({
            'itemType': 'attachment', 'limit': 100, 'start': page * 100, 'sort': 'dateAdded', 'direction': 'asc',
        }))
        checks.append(check)
        if not check['ok']:
            break
        if not isinstance(data, list):
            check.update(ok=False, error='Unexpected Zotero attachment list shape')
            break
        expected = byte_size(check.get('total_results'))
        for item in data:
            entry = item.get('data', {})
            enclosure = item.get('links', {}).get('enclosure', {})
            size = byte_size(enclosure.get('length'))
            attachments.append({
                'source': f'zotero_group_{group}', 'id': item.get('key', ''),
                'parent_id': entry.get('parentItem', ''), 'title': entry.get('title', ''),
                'content_type': entry.get('contentType', ''), 'link_mode': entry.get('linkMode', ''),
                'url': enclosure.get('href') or entry.get('url', ''), 'method': 'GET',
                'size_bytes': size, 'size_source': 'zotero_enclosure_length' if size is not None else '',
            })
        if len(data) < 100 or (expected is not None and len(attachments) >= expected):
            complete = True
            break
        # Observe Zotero's successful-response backoff, or stop if it is too long.
        delay = byte_size(headers.get('Backoff')) or 1
        if delay > 60:
            checks.append({'ok': False, 'error': f'Zotero asks for {delay}s backoff; retry later'})
            break
        time.sleep(delay)
    return {'top_level_items': byte_size(count_check.get('total_results')),
            'advertised_attachments': expected, 'catalogue_complete': complete, 'checks': checks}, attachments


def attachment_summary(attachments):
    # Deduplicate files by exact URL (or source/id when no URL); do not infer record relationships.
    unique = {}
    for item in attachments:
        key = item['url'] or (item['source'], item['id'], item['parent_id'], item['title'])
        if key not in unique or (unique[key]['size_bytes'] is None and item['size_bytes'] is not None):
            unique[key] = item
    known = [item for item in unique.values() if item['size_bytes'] is not None]
    return {
        'attachment_references': len(attachments), 'unique_resources': len(unique),
        'resources_with_known_size': len(known), 'resources_with_unknown_size': len(unique) - len(known),
        'known_bytes_subtotal': sum(item['size_bytes'] for item in known),
        'total_storage_bytes': None,
        'note': 'Known bytes are a subtotal of observed resources, never total portal storage. Linked websites are not stored files.',
        'content_types': dict(Counter(item['content_type'] or 'unknown' for item in attachments)),
        'link_modes': dict(Counter(item['link_mode'] or 'unknown' for item in attachments)),
    }


def audit(args):
    client = Client(args.timeout)
    report = {'checked_at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'access': 'anonymous; no login, cookies or writes', 'research': {}, 'portal': {},
              'scope': 'Public research files, saved project catalogue and public Zotero attachment metadata. Portal attachments only for supplied known IDs/exports.',
              'limitations': ['Not a browser CORS test: Python is not subject to browser CORS.',
                              'Research IDs, Zotero keys and portal submission IDs have no verified crosswalk.',
                              'File bodies are never downloaded. HEAD failures do not prove that a file is missing.']}
    research_checks = []
    for filename in FILES:
        data, check, _ = client.json(RESEARCH + filename)
        check['file'] = filename
        if check['ok']:
            if isinstance(data, list):
                check['records'] = len(data)
            if filename == 'submissions.cleaned.json' and isinstance(data, list):
                report['research']['record_count'] = len(data)
                report['research']['fields'] = sorted({key for item in data for key in item})
        research_checks.append(check)
    report['research'].update(files=research_checks,
                              observed_json_bytes=sum(check.get('json_bytes', 0) for check in research_checks if check['ok']),
                              complete=all(check['ok'] for check in research_checks))
    data, check, _ = client.json(PORTAL + 'rest/openmap/savedProjects.php', {'mode': 'list'})
    report['portal']['projects'] = check
    if check['ok']:
        try:
            projects = rows(data)
            check['visible_project_count'] = len(projects)
            check['catalogue'] = projects
        except ValueError as error:
            check.update(ok=False, error=str(error))
    attachments = []
    if args.zotero_group:
        report['zotero'], zotero_attachments = zotero_inventory(client, args.zotero_group, args.max_pages)
        attachments.extend(zotero_attachments)
    submission_checks = []
    for submission_id in dict.fromkeys(args.submission_id):
        data, check, _ = client.json(PORTAL + 'rest/portal/getSubmissionAttachments.php', {'submissionId': submission_id})
        check['submission_id'] = submission_id
        if check['ok']:
            try:
                listed = rows(data)
                attachments.extend(portal_attachment(item, submission_id) for item in listed)
                check['attachment_count'] = len(listed)
            except ValueError as error:
                check.update(ok=False, error=str(error))
        submission_checks.append(check)
    report['portal']['submission_checks'] = submission_checks
    for filename in args.attachment_manifest:
        data = json.loads(Path(filename).read_text())
        attachments.extend(portal_attachment(item, source='export') for item in rows(data))
    if args.head_links:
        probes = {}
        for attachment in attachments:
            url = attachment['url']
            if attachment['method'] != 'GET':
                attachment['probe'] = {'status': 'post_download_not_probed'}
            elif not url:
                attachment['probe'] = {'status': 'no_download_url'}
            else:
                if url not in probes:
                    if len(probes) >= args.max_probes:
                        attachment['probe'] = {'status': 'probe_limit_reached'}
                        continue
                    probes[url] = client.head(url)
                attachment['probe'] = probes[url]
                if attachment['size_bytes'] is None and attachment['probe'].get('size_bytes') is not None:
                    attachment.update(size_bytes=attachment['probe']['size_bytes'], size_source='HEAD_Content-Length')
    report['attachments'] = attachments
    report['attachment_summary'] = attachment_summary(attachments)
    return report


def positive(value):
    if not value.isdigit() or int(value) <= 0:
        raise argparse.ArgumentTypeError('Expected a positive integer')
    return int(value)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path('/tmp/nechako-data-audit'))
    parser.add_argument('--submission-id', action='append', type=positive, default=[], help='Known portal ID; repeat as needed. Never use research IDs.')
    parser.add_argument('--attachment-manifest', action='append', default=[], help='Portal attachment export array or {attributes:[...]}; repeat as needed')
    parser.add_argument('--zotero-group', type=positive, default=5510344)
    parser.add_argument('--skip-zotero', action='store_true')
    parser.add_argument('--max-pages', type=positive, default=20, help='Zotero attachment pagination bound (100/page)')
    parser.add_argument('--head-links', action='store_true', help='Probe HTTPS GET links with HEAD; no file-body downloads or POST download calls')
    parser.add_argument('--max-probes', type=positive, default=100)
    parser.add_argument('--timeout', type=positive, default=30)
    args = parser.parse_args()
    if args.skip_zotero:
        args.zotero_group = None
    report = audit(args)
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
    columns = ['source', 'id', 'parent_id', 'title', 'content_type', 'link_mode', 'url', 'method', 'size_bytes', 'size_source', 'probe_status']
    with (args.output / 'attachments.csv').open('w', newline='') as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        for attachment in report['attachments']:
            row = {column: attachment.get(column, '') for column in columns}
            row['probe_status'] = attachment.get('probe', {}).get('status', 'not_requested')
            # Avoid executable formulas when this inventory is opened in a spreadsheet.
            writer.writerow({key: "'" + value if isinstance(value, str) and value.startswith(('=', '+', '-', '@', '\t', '\r')) else value for key, value in row.items()})
    print(json.dumps({'research': {'records': report['research'].get('record_count'),
                                 'observed_json_bytes': report['research']['observed_json_bytes']},
                      'projects': {key: value for key, value in report['portal']['projects'].items() if key in ('ok', 'error', 'visible_project_count')},
                      'zotero': {key: value for key, value in report.get('zotero', {}).items() if key != 'checks'},
                      'attachments': report['attachment_summary'], 'output': str(args.output)}, indent=2))


if __name__ == '__main__':
    main()
