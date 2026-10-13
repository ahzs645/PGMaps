#!/usr/bin/env python3
"""Capture public Nechako metadata as an app-owned, reproducible dev showcase."""

import argparse
import concurrent.futures
import datetime
import hashlib
import json
import tempfile
import shutil
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

from audit_data import Client, FILES, PORTAL, RESEARCH, rows, zotero_inventory
from check_showcase import check, validate_public_projects


ROOT = Path(__file__).resolve().parents[2]


def reviewed_public_projects(source):
    """Read and validate every reviewed input before any copy or network request."""
    try:
        manifest = json.loads((source / 'manifest.json').read_text())
        index = validate_public_projects(source, manifest)
        entries = [entry for entry in manifest['files']
                   if entry['kind'] in ('public_saved_project', 'public_project_catalogue')]
        bodies = []
        for entry in entries:
            body = (source / entry['path']).read_bytes()
            if len(body) != entry['bytes'] or hashlib.sha256(body).hexdigest() != entry['sha256']:
                raise ValueError(f"Preserved-file manifest mismatch: {entry['path']}")
            bodies.append((entry, body))
    except (OSError, json.JSONDecodeError, KeyError, TypeError, ValueError) as error:
        raise ValueError(f'Cannot preserve reviewed public projects from {source}: {error}') from error
    return index, entries, bodies


def select_public_project_source(output, explicit_source=None, repository_source=None):
    """Prefer an output's existing review; new/legacy outputs can use a reviewed seed."""
    repository_source = repository_source or ROOT / 'public/data/nechako-showcase'
    has_review = (output / 'public-projects').exists()
    if explicit_source is None and (output / 'manifest.json').is_file():
        try:
            existing = json.loads((output / 'manifest.json').read_text())
            has_review = has_review or bool(existing.get('counts', {}).get('public_saved_projects')) or any(
                entry.get('kind') in ('public_saved_project', 'public_project_catalogue')
                for entry in existing.get('files', []))
        except (OSError, ValueError, AttributeError, TypeError) as error:
            raise ValueError(f'Cannot inspect existing snapshot review at {output}: {error}') from error
    if explicit_source is not None:
        source = explicit_source
    elif has_review:
        source = output
    else:
        source = repository_source
    # A corrupt existing review must fail rather than silently fall back to another date.
    reviewed_public_projects(source)
    return source


def preserve_public_projects(source, output):
    """Copy reviewed public evidence byte-for-byte, retaining its original date."""
    index, entries, bodies = reviewed_public_projects(source)
    # Validate every input before copying any of them into the staging directory.
    for entry, body in bodies:
        target = output / entry['path']
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(body)
    return {'files': entries, 'count': len(index['projects']), 'captured_at_utc': index['capturedAt']}


def capture(output, previous=None):
    # Public-project evidence was separately reviewed; refreshing metadata does not recapture it.
    preserved = preserve_public_projects(previous, output) if previous is not None else None
    client = Client()
    captured = datetime.datetime.now(datetime.timezone.utc).isoformat()
    files = list(preserved['files']) if preserved else []

    def save(path, body, source, kind):
        target = output / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(body)
        files.append({'path': path, 'source_url': source, 'kind': kind,
                      'bytes': len(body), 'sha256': hashlib.sha256(body).hexdigest()})

    def save_json(path, data, source, kind):
        save(path, (json.dumps(data, indent=2, ensure_ascii=False) + '\n').encode(), source, kind)

    def read(url):
        request = urllib.request.Request(url, headers={'Accept-Encoding': 'identity',
                                                       'User-Agent': 'PGMaps-Nechako-Showcase/1.0'})
        with client.opener.open(request, timeout=30) as response:
            body = response.read(20 * 1024 * 1024 + 1)
            if len(body) > 20 * 1024 * 1024:
                raise ValueError('Metadata response exceeds 20 MiB')
            return body

    research = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        downloaded = list(executor.map(lambda name: (name, read(RESEARCH + name)), FILES))
    for name, body in downloaded:
        data = json.loads(body)
        if name == 'overview.json' and not isinstance(data, dict):
            raise ValueError('Invalid research overview')
        if name != 'overview.json':
            rows(data)
        research[name] = data
        save(name, body, RESEARCH + name, 'research')
    records = research['submissions.cleaned.json']
    locations = research['locations.cleaned.json']
    if len(records) != research['overview.json']['submissionsTotal']:
        raise ValueError('Research overview and record count differ; retry the snapshot')

    sources = {}
    for mode in ('notbase', 'default'):
        data, check, _ = client.json(PORTAL + 'rest/openmap/getBaseLayers.php', {'mode': mode})
        if not check['ok']:
            raise ValueError(check['error'])
        for item in rows(data):
            if item.get('type') in ('capabilities', 'wms') and str(item.get('resource', '')).startswith('https://'):
                sources.setdefault(item['resource'], item)
    ordered = sorted(sources.values(), key=lambda item: item['name'])

    def capabilities(item):
        parts = urllib.parse.urlsplit(item['resource'])
        query = dict(urllib.parse.parse_qsl(parts.query, keep_blank_values=True))
        query.update(SERVICE='WMS', VERSION='1.1.1', REQUEST='GetCapabilities')
        url = urllib.parse.urlunsplit(parts._replace(query=urllib.parse.urlencode(query)))
        body = read(url)
        root = ET.fromstring(body)
        if root.tag.split('}')[-1] not in ('WMT_MS_Capabilities', 'WMS_Capabilities'):
            raise ValueError(f"Invalid capabilities: {item['name']}")
        count = sum(1 for layer in root.iter() if layer.tag.split('}')[-1] == 'Layer'
                    and any(child.tag.split('}')[-1] == 'Name' and child.text for child in layer))
        return body, url, count

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        capabilities_data = list(executor.map(capabilities, ordered))
    catalogue = []
    for index, (source, (body, url, count)) in enumerate(zip(ordered, capabilities_data), 1):
        path = f'capabilities/service-{index:02d}.xml'
        save(path, body, url, 'wms_capabilities')
        catalogue.append({'source': source, 'capabilities_file': path, 'named_layers': count})
    save_json('services.json', catalogue, PORTAL + 'rest/openmap/getBaseLayers.php', 'wms_catalogue')

    registry, check, _ = client.json(PORTAL + 'rest/portal/getSpatialFormats.php')
    if not check['ok']:
        raise ValueError(check['error'])
    formats = rows(registry)
    save_json('spatial-formats.json', formats, check['url'], 'format_registry')

    zotero, attachments = zotero_inventory(client, 5510344, 20)
    if not zotero['catalogue_complete']:
        raise ValueError('Public Zotero attachment inventory is incomplete')
    save_json('attachments.json', attachments, 'https://api.zotero.org/groups/5510344/items?itemType=attachment', 'attachment_links')
    _, project_check, _ = client.json(PORTAL + 'rest/openmap/savedProjects.php', {'mode': 'list'})
    save_json('access-checks.json', {'projects': project_check, 'zotero': zotero}, PORTAL, 'access_checks')

    project = json.loads((ROOT / 'public/data/projects/nechako-watershed-research-portal.json').read_text())
    aggregate_ids = set(project['workspace']['data']['aggregateLocationIds'])
    features = []
    for location in locations:
        coordinates = location.get('coordinates')
        if not coordinates or location['id'] in aggregate_ids:
            continue
        features.append({'type': 'Feature', 'id': location['id'],
                         'geometry': {'type': 'Point', 'coordinates': [coordinates['lon'], coordinates['lat']]},
                         'properties': {'name': location['name'], 'location_id': location['id'],
                                        'total_publications': location['totalPublications'],
                                        'coordinate_source': location['coordinateSource'],
                                        'resource_types': location['resourceTypes']}})
    geojson = {'type': 'FeatureCollection', 'features': features}
    save_json('research-locations.geojson', geojson, RESEARCH + 'locations.cleaned.json', 'derived_locations')
    workspace = {'schema': 'nechako-workspace-v1',
                 'camera': {'center': [-124.2, 54.1], 'zoom': 6.2, 'bearing': 0, 'pitch': 0},
                 'layers': [], 'tiles': [],
                 'vectors': [{'id': 'nechako-research-locations', 'name': 'Nechako research locations',
                              'data': geojson, 'color': '#2563eb', 'visible': True}],
                 'warnings': ['Research locations are source reference points, not study footprints. Regional aggregate tags are excluded from this point layer.']}
    save_json('research-workspace.json', workspace, RESEARCH + 'locations.cleaned.json', 'showcase_workspace')
    manifest = {'schema': 'nechako-showcase-v1', 'captured_at_utc': captured,
                'attribution': 'Research: UNBC IWRG / nwsviz. Map services: Nechako Stewardship Portal and DataBC. Attachment links: public Zotero group 5510344. Source ownership is retained.',
                'counts': {'research_records': len(records), 'location_ids': len(locations),
                           'mapped_locations': len(features), 'unmapped_records': sum(not row['locationIds'] for row in records),
                           'decades': len(research['decades.cleaned.json']), 'wms_services': len(catalogue),
                           'named_layers': sum(entry['named_layers'] for entry in catalogue),
                           'attachment_links': len(attachments), 'zotero_top_level_items': zotero['top_level_items']},
                'research_bytes': sum(item['bytes'] for item in files if item['kind'] == 'research'),
                'snapshot_file_bytes': sum(item['bytes'] for item in files),
                'limitations': ['WMS capabilities are metadata; map tiles and identify still use live services.',
                                'Attachment entries are links, not downloaded PDFs/videos.',
                                'No private submissions, private saved portal projects or source GIS databases are included.',
                                'The bundled workspace is derived from research locations, not a saved portal project.',
                                'Research record IDs, Zotero keys and portal submission IDs have no verified crosswalk.'],
                'files': files}
    if preserved:
        manifest['counts']['public_saved_projects'] = preserved['count']
        manifest['public_projects_captured_at_utc'] = preserved['captured_at_utc']
        manifest['attribution'] += ' Public saved maps: anonymous Nechako Stewardship Portal responses.'
        manifest['limitations'].append(
            f"Reviewed anonymous saved-project responses were preserved from {preserved['captured_at_utc']}; "
            'the general snapshot capture timestamp does not describe a new project capture.')
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n')
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'public/data/nechako-showcase')
    parser.add_argument('--public-projects-from', type=Path,
                        help='Existing showcase with reviewed anonymous projects to preserve; defaults to the output review, or repository showcase for a new/legacy output')
    args = parser.parse_args()
    if args.output.exists():
        manifest_file = args.output / 'manifest.json'
        try:
            valid_snapshot = manifest_file.is_file() and json.loads(manifest_file.read_text()).get('schema') == 'nechako-showcase-v1'
        except (OSError, ValueError, AttributeError):
            valid_snapshot = False
        if not valid_snapshot:
            parser.error('Refusing to replace a directory that is not a Nechako showcase snapshot')
    try:
        public_project_source = select_public_project_source(args.output, args.public_projects_from)
    except ValueError as error:
        parser.error(f'No valid reviewed public-project seed; output retained: {error}')
    # Fetch and validate everything before replacing the previous working snapshot.
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='nechako-showcase-', dir=args.output.parent) as staging:
        try:
            manifest = capture(Path(staging), previous=public_project_source)
            check(Path(staging))
        except (ValueError, AssertionError, OSError) as error:
            parser.error(f'Snapshot refresh failed; previous output retained: {error}')
        if args.output.exists():
            shutil.rmtree(args.output)
        shutil.copytree(staging, args.output)
    print(json.dumps({'output': str(args.output), 'counts': manifest['counts'],
                      'snapshot_file_bytes': manifest['snapshot_file_bytes']}, indent=2))


if __name__ == '__main__':
    main()
