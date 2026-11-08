#!/usr/bin/env python3
"""Register recovered editor projects without replacing any raster or review.

Private manifests and staged output belong outside the public repository. The
publisher uses the existing authenticated Worker and its atomic catalogue ETag
condition; it never writes directly to R2 or changes Worker configuration.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import shutil
import sys
import time
from urllib.parse import urlsplit

import httpx
from PIL import Image

_spec = importlib.util.spec_from_file_location('pgmaps_owner_georeference', Path(__file__).with_name('georeference.py'))
owner = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(owner)

MANIFEST_SCHEMA = 'pgmaps-georeference-recovery-manifest-v1'
REGISTRATION_SCHEMA = 'pgmaps-georeference-project-registration-v1'
SHA = re.compile(r'^[a-f0-9]{64}$')
USER_AGENT = 'PGMaps-owner-georeference/1.0'
MAX_OBJECT_BYTES = 95_000_000
MAX_PROJECT_BYTES = 1_000_000
STRONG_ETAG = re.compile(r'^"[\x21\x23-\x7e\x80-\xff]+"$')
KINDS = {
    'source': ('raw', '.png', 'image/png'),
    'evidence': ('reviews/evidence', '.json', 'application/json'),
    'project': ('reviews/projects', '.json', 'application/json'),
}


def digest_file(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n').encode('utf-8')


def load_json(path):
    try:
        return json.loads(Path(path).read_text(encoding='utf-8'))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError('A local input is not valid UTF-8 JSON') from exc


def write_private(path, payload):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with path.open('xb') as stream:
        path.chmod(0o600)
        stream.write(payload)


def require_sha(value, label):
    if not isinstance(value, str) or not SHA.fullmatch(value):
        raise ValueError(f'{label} must be a lowercase SHA-256')
    return value


def public_https(value, label='Published URL'):
    if not isinstance(value, str) or not value or len(value) > 8192:
        raise ValueError(f'{label} must be public HTTPS without credentials')
    try:
        parsed = urlsplit(value)
        host = parsed.hostname or ''
        if (parsed.scheme != 'https' or not host or parsed.username or parsed.password
                or host == 'localhost' or host.endswith(('.localhost', '.local'))
                or ':' in host or re.fullmatch(r'[\d.]+', host) or parsed.fragment
                or any(ord(char) <= 32 for char in value)):
            raise ValueError()
        parsed.port
    except ValueError:
        raise ValueError(f'{label} must be public HTTPS without credentials') from None
    return value


def validate_base(base):
    public_https(base, 'Collection base')
    parsed = urlsplit(base)
    if parsed.query or not re.fullmatch(r'/c/[A-Za-z0-9_-]{43}/', parsed.path):
        raise ValueError('Collection base must name one existing Worker collection')
    return base


def bundle_file(root, relative):
    if not isinstance(relative, str) or not relative or Path(relative).is_absolute():
        raise ValueError('Manifest files must use paths inside their private bundle')
    path = (Path(root) / relative).resolve()
    if not path.is_relative_to(Path(root).resolve()) or not path.is_file():
        raise ValueError('A manifest file is missing or outside its private bundle')
    return path


def validate_reference(reference):
    if not isinstance(reference, dict) or set(reference) - {'url', 'sha256', 'sourceSha256', 'nativeSha256', 'label', 'summary'}:
        raise ValueError('Project registration contains invalid reference fields')
    public_https(reference.get('url'), 'Project URL')
    for field in ('sha256', 'sourceSha256', 'nativeSha256'):
        require_sha(reference.get(field), field)
    for field, maximum in (('label', 1000), ('summary', 6000)):
        if field in reference and (not isinstance(reference[field], str) or len(reference[field]) > maximum):
            raise ValueError(f'Project {field} is invalid')


def register_projects(catalogue, registrations):
    """Pure update of native items' project pointers, with stable ID/SHA guards.

    Featured/composite records, geometry, files, review status and all other
    catalogue metadata are copied unchanged. Reapplying the same pointer is safe.
    """
    if not isinstance(catalogue, dict) or not isinstance(catalogue.get('items'), list):
        raise ValueError('Catalogue must contain native items')
    if not isinstance(registrations, list) or not registrations:
        raise ValueError('At least one project registration is required')
    result = copy.deepcopy(catalogue)
    seen = set()
    for registration in registrations:
        item_id = registration.get('id')
        if not isinstance(item_id, str) or not item_id or item_id in seen:
            raise ValueError('Project registrations need unique stable native IDs')
        seen.add(item_id)
        expected = require_sha(registration.get('expectedNativeSha256'), 'Current native hash')
        reference = registration.get('georeferenceProject')
        validate_reference(reference)
        if reference['nativeSha256'] != expected:
            raise ValueError('Project reference and native precondition disagree')
        matches = [item for item in result['items'] if item.get('id') == item_id]
        if len(matches) != 1 or matches[0].get('download', {}).get('sha256', '').lower() != expected:
            raise ValueError('A native item changed or is ambiguous; restage against the current catalogue')
        item = matches[0]
        if 'expectedPreviousProject' not in registration:
            raise ValueError('Project registration lacks its previous-pointer precondition')
        if item.get('georeferenceProject') not in (registration['expectedPreviousProject'], reference):
            raise ValueError('A saved project pointer changed; restage against the current catalogue')
        item['georeferenceProject'] = copy.deepcopy(reference)
    return result


def collection_base(catalogue, entries):
    bases = set()
    for entry in entries:
        matches = [item for item in catalogue.get('items', []) if item.get('id') == entry.get('nativeItemId')]
        if len(matches) != 1:
            raise ValueError('Recovery manifest must identify exactly one native catalogue item per project')
        url = matches[0].get('download', {}).get('url')
        public_https(url, 'Native download URL')
        parsed = urlsplit(url)
        match = re.match(r'(/c/[A-Za-z0-9_-]{43}/)raw/', parsed.path)
        if not match or parsed.query:
            raise ValueError('Native files must belong to the existing owner Worker collection')
        bases.add(f'{parsed.scheme}://{parsed.netloc}{match[1]}')
    if len(bases) != 1:
        raise ValueError('All recovered projects must belong to one collection')
    return validate_base(bases.pop())


def artifact(kind, checksum, size):
    prefix, suffix, mime = KINDS[kind]
    if not isinstance(size, int) or isinstance(size, bool) or not 1 <= size <= MAX_OBJECT_BYTES:
        raise ValueError('An artifact exceeds the existing bounded owner upload size')
    if kind == 'project' and size > MAX_PROJECT_BYTES:
        raise ValueError('A published project exceeds the editor 1 MB limit')
    key = f'{prefix}/{require_sha(checksum, "Artifact hash")}{suffix}'
    return {'kind': kind, 'key': key, 'path': key, 'sha256': checksum, 'bytes': size, 'mime': mime}


def validate_png(path, dimensions):
    if not isinstance(dimensions, list) or len(dimensions) != 2:
        raise ValueError('Source dimensions must match the exact project pixel frame')
    with Image.open(path) as source:
        if source.format != 'PNG' or list(source.size) != dimensions:
            raise ValueError('Source PNG dimensions do not match the project pixel frame')
        source.verify()


def validate_recovery(project):
    if (project.get('schema') != owner.RECOVERY_SCHEMA
            or project.get('recoveredPlacement', {}).get('active') is not True):
        raise ValueError('Registration requires an active recovered v2 placement')
    owner.validate_project(copy.deepcopy(project))
    if project['source'].get('geotiff'):
        raise ValueError('Recovered registrations must use their verified original-image source')


def stage_manifest(manifest_path, catalogue, output_dir, base=None):
    """Validate private recovery inputs and stage immutable objects, without HTTP."""
    manifest_path = Path(manifest_path).resolve()
    manifest = load_json(manifest_path)
    if manifest.get('schema') != MANIFEST_SCHEMA or not isinstance(manifest.get('projects'), list) or not manifest['projects']:
        raise ValueError('Unsupported or empty recovered-project manifest')
    entries = manifest['projects']
    detected_base = collection_base(catalogue, entries)
    base = validate_base(base or detected_base)
    if base != detected_base:
        raise ValueError('Staging destination differs from the current native collection')
    output = Path(output_dir).resolve()
    if output.exists() and (not output.is_dir() or any(output.iterdir())):
        raise ValueError('Staging output must be an empty private directory')
    registrations, staged, rewritten = [], {}, copy.deepcopy(manifest)
    for entry, updated_entry in zip(entries, rewritten['projects']):
        paths = {}
        for kind in ('source', 'evidence', 'project'):
            path = bundle_file(manifest_path.parent, entry.get(kind + 'File'))
            expected = require_sha(entry.get(kind + 'Sha256'), f'{kind} hash')
            if digest_file(path) != expected:
                raise ValueError(f'Recovered {kind} bytes differ from the manifest')
            paths[kind] = path
        if paths['source'].stat().st_size != entry.get('sourceBytes'):
            raise ValueError('Recovered source byte count differs from the manifest')
        project = load_json(paths['project'])
        validate_recovery(project)
        if project['source']['id'] != entry.get('nativeItemId') or project['source']['sha256'] != entry['sourceSha256']:
            raise ValueError('Recovered project is bound to a different native ID or original source')
        dimensions = [project['source']['width'], project['source']['height']]
        if dimensions != entry.get('sourceDimensions'):
            raise ValueError('Manifest and project pixel frames disagree')
        validate_png(paths['source'], dimensions)
        source_artifact = artifact('source', entry['sourceSha256'], entry['sourceBytes'])
        evidence_artifact = artifact('evidence', entry['evidenceSha256'], paths['evidence'].stat().st_size)
        evidence = project['recoveredPlacement']['evidence']
        if len(evidence) != 1 or evidence[0].get('sha256') != entry['evidenceSha256']:
            raise ValueError('Recovered project evidence differs from the manifest')
        project['source']['url'] = base + source_artifact['key']
        evidence[0]['url'] = base + evidence_artifact['key']
        body = json_bytes(project)
        project_artifact = artifact('project', hashlib.sha256(body).hexdigest(), len(body))
        for item, payload in ((source_artifact, paths['source']), (evidence_artifact, paths['evidence']), (project_artifact, body)):
            staged[item['key']] = (item, payload)
        reference = {
            'url': base + project_artifact['key'], 'sha256': project_artifact['sha256'],
            'sourceSha256': entry['sourceSha256'],
            'nativeSha256': require_sha(entry.get('expectedCurrentNativeSha256'), 'Current native hash'),
            'label': entry.get('title', 'Recovered alignment project'),
            'summary': project['recoveredPlacement']['summary'],
        }
        previous = next(item for item in catalogue['items'] if item['id'] == entry['nativeItemId'])
        registrations.append({
            'id': entry['nativeItemId'], 'expectedNativeSha256': reference['nativeSha256'],
            'expectedPreviousProject': copy.deepcopy(previous.get('georeferenceProject')),
            'georeferenceProject': reference,
        })
        updated_entry.update(
            sourceFile=source_artifact['path'], evidenceFile=evidence_artifact['path'],
            projectFile=project_artifact['path'], projectSha256=project_artifact['sha256'],
            publication={'sourceUrl': project['source']['url'], 'evidenceUrl': evidence[0]['url'], 'projectUrl': reference['url']},
        )
    preview = register_projects(catalogue, registrations)
    registration = {
        'schema': REGISTRATION_SCHEMA, 'collectionBase': base,
        'registrations': registrations, 'artifacts': [item for item, _ in staged.values()],
    }
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    output.chmod(0o700)
    for item, payload in staged.values():
        path = output / item['path']
        if isinstance(payload, bytes):
            write_private(path, payload)
        else:
            path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            shutil.copyfile(payload, path)
            path.chmod(0o600)
        if digest_file(path) != item['sha256'] or path.stat().st_size != item['bytes']:
            raise ValueError('An input changed while staging; discard this stage and retry')
    write_private(output / 'registration.json', json_bytes(registration))
    write_private(output / 'catalogue.preview.json', json_bytes(preview))
    write_private(output / 'recovery-manifest.json', json_bytes(rewritten))
    write_private(output / 'publication-manifest.json', json_bytes({
        'schema': REGISTRATION_SCHEMA, 'metadataOnly': True,
        'projects': rewritten['projects'], 'registrations': registrations,
    }))
    return registration


def validate_stage(registration_path):
    registration_path = Path(registration_path).resolve()
    registration = load_json(registration_path)
    if registration.get('schema') != REGISTRATION_SCHEMA:
        raise ValueError('Unsupported staged project registration')
    base = validate_base(registration.get('collectionBase'))
    artifacts = registration.get('artifacts')
    if not isinstance(artifacts, list) or not artifacts:
        raise ValueError('Registration has no immutable artifacts')
    by_key = {}
    for item in artifacts:
        if not isinstance(item, dict) or item.get('kind') not in KINDS:
            raise ValueError('Registration has an unknown artifact kind')
        expected = artifact(item['kind'], item.get('sha256'), item.get('bytes'))
        if item != expected or item['key'] in by_key:
            raise ValueError('Artifact paths must be unique immutable content-addressed keys')
        path = bundle_file(registration_path.parent, item['path'])
        if path.stat().st_size != item['bytes'] or digest_file(path) != item['sha256']:
            raise ValueError('A staged artifact changed; restage before publication')
        by_key[item['key']] = (item, path)
    used = set()
    for entry in registration.get('registrations', []):
        reference = entry.get('georeferenceProject')
        validate_reference(reference)
        project_key = f'reviews/projects/{reference["sha256"]}.json'
        source_key = f'raw/{reference["sourceSha256"]}.png'
        if reference['url'] != base + project_key or project_key not in by_key or source_key not in by_key:
            raise ValueError('Registration references an unstaged project or source')
        project = load_json(by_key[project_key][1])
        validate_recovery(project)
        if (project['source']['id'] != entry.get('id') or project['source']['sha256'] != reference['sourceSha256']
                or project['source']['url'] != base + source_key
                or entry.get('expectedNativeSha256') != reference['nativeSha256']):
            raise ValueError('Staged project identity disagrees with its registration')
        validate_png(by_key[source_key][1], [project['source']['width'], project['source']['height']])
        used.update((source_key, project_key))
        evidence = project['recoveredPlacement']['evidence']
        if len(evidence) != 1:
            raise ValueError('Staged recovery requires its single verified evidence bundle')
        key = f'reviews/evidence/{require_sha(evidence[0].get("sha256"), "Evidence hash")}.json'
        if key not in by_key or evidence[0].get('url') != base + key:
            raise ValueError('Registration references unstaged recovery evidence')
        used.add(key)
    if used != set(by_key):
        raise ValueError('Registration contains unused artifacts')
    return registration, by_key


def owner_base(config):
    if not isinstance(config, dict):
        raise ValueError('Invalid owner upload configuration')
    endpoint = public_https(config.get('endpoint'), 'Owner endpoint').rstrip('/')
    parsed = urlsplit(endpoint)
    token = config.get('uploadToken')
    if (parsed.path or parsed.query or not isinstance(config.get('shareId'), str)
            or not re.fullmatch(r'[A-Za-z0-9_-]{43}', config['shareId'])
            or not isinstance(token, str) or not token or '\n' in token or '\r' in token):
        raise ValueError('Invalid owner upload configuration')
    return endpoint, validate_base(f'{endpoint}/c/{config["shareId"]}/')


def response_ok(response, operation):
    if response.status_code == 412:
        raise ValueError('Live catalogue changed during activation; reload and restage before retrying')
    if not 200 <= response.status_code < 300:
        raise RuntimeError(f'{operation} returned HTTP {response.status_code}')


def publish_registration(registration_path, config, *, client=None):
    """Validate, upload immutable objects, atomically activate, and verify readback."""
    registration, artifacts = validate_stage(registration_path)
    endpoint, base = owner_base(config)
    if registration['collectionBase'] != base:
        raise ValueError('Owner configuration names a different staged collection')
    own_client = client is None
    client = client or httpx.Client(timeout=180, follow_redirects=False, headers={
        'Accept-Encoding': 'identity', 'User-Agent': USER_AGENT,
    })
    try:
        def get_current():
            response = client.get(base + 'catalog.json', params={'owner_review': time.time_ns()})
            response_ok(response, 'Catalogue read')
            try:
                return response, response.json()
            except ValueError:
                raise ValueError('Live catalogue is not valid JSON') from None

        def verify_head(key, checksum, length):
            check = client.head(base + key, params={'verify': checksum})
            response_ok(check, 'Immutable object verification')
            if (check.headers.get('X-Content-SHA256') != checksum
                    or check.headers.get('Content-Length') != str(length)):
                raise RuntimeError('Uploaded object checksum or byte count verification failed')

        def upload(key, mime, payload, checksum, length, etag=None):
            headers = {
                'Authorization': 'Bearer ' + config['uploadToken'], 'Content-Type': mime,
                'Content-Length': str(length), 'X-Content-SHA256': checksum,
            }
            if etag is not None:
                headers['If-Match'] = etag
            response = client.put(f'{endpoint}/__upload/{config["shareId"]}/{key}', headers=headers, content=payload)
            response_ok(response, 'Owner upload')
            try:
                receipt = response.json()
            except ValueError:
                raise RuntimeError('Owner upload returned an invalid receipt') from None
            if receipt.get('sha256') != checksum or receipt.get('bytes') != length:
                raise RuntimeError('Upload receipt did not match the staged artifact')
            verify_head(key, checksum, length)

        _, current = get_current()
        register_projects(current, registration['registrations'])
        uploaded = 0
        for key, (item, path) in artifacts.items():
            check = client.head(base + key, params={'verify': item['sha256']})
            if check.status_code == 404:
                with path.open('rb') as stream:
                    upload(key, item['mime'], stream, item['sha256'], item['bytes'])
                uploaded += 1
            else:
                response_ok(check, 'Immutable object lookup')
                if (check.headers.get('X-Content-SHA256') != item['sha256']
                        or check.headers.get('Content-Length') != str(item['bytes'])):
                    raise RuntimeError('An existing content-addressed object differs; refusing to overwrite it')
        latest_response, latest = get_current()
        updated = register_projects(latest, registration['registrations'])
        etag = latest_response.headers.get('ETag', '')
        if not STRONG_ETAG.fullmatch(etag):
            raise ValueError('Live catalogue has no strong ETag; refusing activation without its concurrency condition')
        body = (json.dumps(updated, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n').encode('utf-8')
        checksum = hashlib.sha256(body).hexdigest()
        if len(body) > MAX_OBJECT_BYTES:
            raise ValueError('Updated catalogue exceeds the owner upload limit')
        upload('catalog.json', 'application/json', body, checksum, len(body), etag)
        readback, _ = get_current()
        if hashlib.sha256(readback.content).hexdigest() != checksum:
            raise RuntimeError('Catalogue readback differs from the activated catalogue')
        return {
            'activated': True, 'metadataOnly': True,
            'registeredIds': [entry['id'] for entry in registration['registrations']],
            'catalogueSha256': checksum, 'uploadedObjects': uploaded,
            'verifiedObjects': len(artifacts), 'rasterGeometryChanged': False, 'reviewsPreserved': True,
        }
    except httpx.HTTPError:
        raise RuntimeError('Owner HTTP request failed; check collection access and upload settings') from None
    finally:
        if own_client:
            client.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    stage = commands.add_parser('stage', help='Validate private assets and create a metadata-only preview without network writes')
    stage.add_argument('--manifest', required=True)
    stage.add_argument('--catalogue', required=True)
    stage.add_argument('--output', required=True)
    verify = commands.add_parser('verify', help='Recheck all staged immutable files without network access')
    verify.add_argument('--registration', required=True)
    publish = commands.add_parser('publish', help='Use hidden owner settings to upload and atomically activate project pointers')
    publish.add_argument('--registration', required=True)
    publish.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    try:
        if args.command == 'stage':
            staged = stage_manifest(args.manifest, load_json(args.catalogue), args.output)
            result = {'staged': True, 'metadataOnly': True, 'projects': len(staged['registrations']), 'objects': len(staged['artifacts']), 'bytes': sum(item['bytes'] for item in staged['artifacts'])}
        elif args.command == 'verify':
            staged, artifacts = validate_stage(args.registration)
            result = {'verified': True, 'projects': len(staged['registrations']), 'objects': len(artifacts)}
        else:
            if not args.apply:
                raise ValueError('Live activation requires the explicit owner command publish --apply')
            # Same hidden-stdin settings contract as the existing raster publisher.
            result = publish_registration(args.registration, owner.hidden_config())
        print(json.dumps(result))
        return 0
    except (ValueError, RuntimeError, OSError) as error:
        # URLs and tokens never belong in terminal logs, including parser errors.
        message = re.sub(r'https?://\S+', '[URL]', str(error))
        print(json.dumps({'error': type(error).__name__, 'message': message}), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
