#!/usr/bin/env python3
"""Validate the committed showcase's hashes, counts and cross-file consistency offline."""

import hashlib
import json
import xml.etree.ElementTree as ET
from pathlib import Path


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
    print(f"Showcase verified: {len(manifest['files'])} files, {len(records)} records, {len(services)} WMS services, {counts['named_layers']} named layers.")


if __name__ == '__main__':
    check(Path(__file__).resolve().parents[2] / 'public/data/nechako-showcase')
