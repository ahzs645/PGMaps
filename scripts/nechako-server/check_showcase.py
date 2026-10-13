#!/usr/bin/env python3
"""Validate the committed showcase's hashes, counts and cross-file consistency offline."""

import hashlib
import json
import datetime
import xml.etree.ElementTree as ET
from pathlib import Path


PUBLIC_PROJECT_IDS = (4, 6, 9, 10, 12, 14, 15, 21, 27)
PUBLIC_PROJECT_SOURCE = 'https://nechakowatershed-portal.ca/rest/openmap/savedProjects.php'


def validate_public_projects(root, manifest=None):
    """Validate the reviewed anonymous capture without loading authenticated records."""
    def require(condition, message):
        if not condition:
            raise ValueError(f'Invalid reviewed public projects: {message}')

    index_path = root / 'public-projects/index.json'
    require(index_path.is_file(), 'missing public-projects/index.json')
    require(index_path.resolve().is_relative_to(root.resolve()), 'index path escapes snapshot')
    try:
        index = json.loads(index_path.read_text())
        require(isinstance(index, dict), 'index must be an object')
        require(index.get('schema') == 'nechako-public-projects-v1', 'unsupported index schema')
        require(index.get('access') == 'anonymous', 'capture must declare anonymous access')
        require(index.get('source') == PUBLIC_PROJECT_SOURCE, 'unexpected source endpoint')
        captured = index.get('capturedAt')
        require(isinstance(captured, str), 'missing original capture date')
        try:
            datetime.datetime.fromisoformat(captured.replace('Z', '+00:00'))
        except ValueError as error:
            raise ValueError('Invalid reviewed public projects: invalid original capture date') from error
        projects = index.get('projects')
        require(isinstance(projects, list), 'projects must be a list')
        require(len(projects) == len(PUBLIC_PROJECT_IDS), 'expected nine reviewed project IDs')
        require(all(isinstance(item, dict) and type(item.get('id')) is int for item in projects), 'invalid project IDs')
        require(sorted(item['id'] for item in projects) == list(PUBLIC_PROJECT_IDS), 'reviewed project IDs differ or repeat')
        expected = {'public-projects/index.json'}
        for item in projects:
            relative = f"public-projects/project-{item['id']}.json"
            require(item.get('file') == relative, f"unexpected file path for project {item['id']}")
            path = (root / relative).resolve()
            require(path.is_relative_to(root.resolve()), f'path escapes snapshot: {relative}')
            body = path.read_bytes()
            require(type(item.get('bytes')) is int and len(body) == item['bytes'], f'size mismatch: {relative}')
            require(hashlib.sha256(body).hexdigest() == item.get('sha256'), f'hash mismatch: {relative}')
            envelope = json.loads(body)
            require(isinstance(envelope, dict), f'envelope must be an object: {relative}')
            require(envelope.get('success') is True and envelope.get('status') == 'success', f'unsuccessful envelope: {relative}')
            require(envelope.get('loggedIn') is False, f'not an anonymous envelope: {relative}')
            attributes = envelope.get('attributes')
            require(isinstance(attributes, dict), f'missing attributes: {relative}')
            project_id = attributes.get('projectId')
            require(type(project_id) in (int, str) and str(project_id) == str(item['id']), f'project ID mismatch: {relative}')
            layers = attributes.get('layers')
            require(isinstance(layers, list), f'layers must be a list: {relative}')
            require(type(item.get('layerCount')) is int and len(layers) == item['layerCount'], f'layer count mismatch: {relative}')
            require(item.get('name') == attributes.get('projectName'), f'project name mismatch: {relative}')
            require(item.get('savedAt') == attributes.get('projectSaveTimestamp'), f'save timestamp mismatch: {relative}')
            expected.add(relative)
        actual = {str(path.relative_to(root)) for path in (root / 'public-projects').rglob('*') if path.is_file()}
        require(actual == expected, 'unexpected or missing files in public-projects')
        if manifest is not None:
            require(manifest.get('counts', {}).get('public_saved_projects') == len(projects), 'manifest public project count differs')
            require(manifest.get('public_projects_captured_at_utc') == captured, 'manifest capture date differs')
            entries = [entry for entry in manifest['files'] if entry['kind'] in ('public_saved_project', 'public_project_catalogue')]
            require({entry['path'] for entry in entries} == expected and len(entries) == len(expected), 'manifest does not register each public project file exactly once')
            for entry in entries:
                kind = 'public_project_catalogue' if entry['path'].endswith('/index.json') else 'public_saved_project'
                require(entry['kind'] == kind, f"wrong manifest kind: {entry['path']}")
                require(entry['source_url'] == PUBLIC_PROJECT_SOURCE, f"wrong manifest source: {entry['path']}")
        return index
    except (OSError, json.JSONDecodeError, KeyError, TypeError) as error:
        raise ValueError(f'Invalid reviewed public projects: {error}') from error


def check(root):
    manifest = json.loads((root / 'manifest.json').read_text())
    assert manifest['schema'] == 'nechako-showcase-v1'
    expected = {'manifest.json'}
    for entry in manifest['files']:
        path = (root / entry['path']).resolve()
        assert path.is_relative_to(root.resolve()), 'Snapshot path escapes the data directory'
        assert entry['path'] not in expected, 'Duplicate manifest file'
        expected.add(entry['path'])
        body = path.read_bytes()
        assert len(body) == entry['bytes'], f"Size mismatch: {entry['path']}"
        assert hashlib.sha256(body).hexdigest() == entry['sha256'], f"Hash mismatch: {entry['path']}"
    assert {str(path.relative_to(root)) for path in root.rglob('*') if path.is_file()} == expected
    assert sum(entry['bytes'] for entry in manifest['files']) == manifest['snapshot_file_bytes']
    assert sum(entry['bytes'] for entry in manifest['files'] if entry['kind'] == 'research') == manifest['research_bytes']
    load = lambda name: json.loads((root / name).read_text())
    overview = load('overview.json')
    records = load('submissions.cleaned.json')
    locations = load('locations.cleaned.json')
    counts = manifest['counts']
    assert len(records) == overview['submissionsTotal'] == counts['research_records']
    assert len({record['id'] for record in records}) == len(records)
    location_ids = {location['id'] for location in locations}
    assert len(locations) == len(location_ids) == overview['locationsTotal'] == counts['location_ids']
    assert all(set(record['locationIds']) <= location_ids for record in records)
    assert sum(not record['locationIds'] for record in records) == overview['submissionsWithoutLocations'] == counts['unmapped_records']
    assert len(load('decades.cleaned.json')) == counts['decades']
    services = load('services.json')
    assert len(services) == len({item['source']['resource'] for item in services}) == counts['wms_services']
    for service in services:
        assert service['source']['resource'].startswith('https://')
        xml = ET.fromstring((root / service['capabilities_file']).read_bytes())
        named = sum(1 for layer in xml.iter() if layer.tag.split('}')[-1] == 'Layer'
                    and any(child.tag.split('}')[-1] == 'Name' and child.text for child in layer))
        assert named == service['named_layers']
    assert sum(item['named_layers'] for item in services) == counts['named_layers']
    assert len(load('attachments.json')) == counts['attachment_links']
    geojson = load('research-locations.geojson')
    assert geojson['type'] == 'FeatureCollection'
    assert len(geojson['features']) == counts['mapped_locations']
    by_id = {location['id']: location for location in locations}
    for feature in geojson['features']:
        location = by_id[feature['id']]
        assert feature['geometry'] == {'type': 'Point', 'coordinates': [location['coordinates']['lon'], location['coordinates']['lat']]}
        assert feature['properties']['total_publications'] == location['totalPublications']
    workspace = load('research-workspace.json')
    assert workspace['schema'] == 'nechako-workspace-v1'
    assert workspace['vectors'][0]['data'] == geojson
    public_projects = validate_public_projects(root, manifest)
    print(f"Showcase verified: {len(manifest['files'])} files, {len(records)} records, {len(services)} WMS services, {counts['named_layers']} named layers, {len(public_projects['projects'])} anonymous saved projects (captured {public_projects['capturedAt']}).")


if __name__ == '__main__':
    check(Path(__file__).resolve().parents[2] / 'public/data/nechako-showcase')
