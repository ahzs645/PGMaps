#!/usr/bin/env python3
"""Bounded, loopback-only development conversion service. Requires GDAL CLI.

Production deployment requirements are in docs/nechako/server-runbook.md.
No portal proxy, credentials, remote source URLs or publishing operations.
"""
import base64
import binascii
import http.server
import io
import json
import os
import pathlib
import re
import sqlite3
import subprocess
import tempfile
import time
import zipfile

MAX_BODY = 28 * 1024 * 1024
MAX_FILE = 20 * 1024 * 1024
MAX_OUTPUT = 30 * 1024 * 1024
SUFFIXES = {'.json', '.geojson', '.shp', '.gml', '.gpx', '.kml', '.kmz', '.db', '.sqlite', '.gpkg', '.gpap', '.zip'}
ENV = {**os.environ, 'OGR_SKIP': 'VRT LIBKML', 'GML_SKIP_RESOLVE_ELEMS': 'ALL', 'GDAL_HTTP_TIMEOUT': '5', 'CPL_TMPDIR': tempfile.gettempdir()}


def run(arguments, deadline=None):
    timeout = min(45, max(0.1, deadline - time.monotonic())) if deadline else 45
    if deadline and time.monotonic() >= deadline:
        raise ValueError('Conversion exceeded the 120 second dataset time limit.')
    result = subprocess.run(arguments, capture_output=True, timeout=timeout, env=ENV, check=False)
    if result.returncode:
        raise ValueError(result.stderr.decode(errors='replace')[-2000:] or 'GDAL could not read this file.')
    return result.stdout.decode(errors='replace')


def write_inputs(directory, files):
    if not isinstance(files, list) or not 1 <= len(files) <= 16:
        raise ValueError('Upload one dataset or up to 16 matching shapefile sidecars.')
    names = set()
    written = []
    total = 0
    for item in files:
        name = item.get('name', '')
        if not isinstance(name, str) or not re.fullmatch(r'[\w .()-]{1,160}', name) or name.startswith('.') or pathlib.Path(name).name != name or name.casefold() in names:
            raise ValueError('Use distinct, simple file names without paths.')
        names.add(name.casefold())
        try:
            data = base64.b64decode(item.get('base64', ''), validate=True)
        except (binascii.Error, TypeError):
            raise ValueError('Invalid file encoding.') from None
        total += len(data)
        if total > MAX_FILE:
            raise ValueError('Uploaded data exceeds 20 MB.')
        path = directory / name
        path.write_bytes(data)
        written.append(path)
    return written


def unpack_archive(path, directory):
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        if len(entries) > 200 or sum(item.file_size for item in entries) > 60 * 1024 * 1024:
            raise ValueError('Archive exceeds 200 entries or 60 MB expanded size.')
        files = []
        seen = set()
        for item in entries:
            parts = pathlib.PurePosixPath(item.filename)
            if parts.is_absolute() or '..' in parts.parts or '\\' in item.filename or ((item.external_attr >> 16) & 0o170000) == 0o120000:
                raise ValueError('Archive contains an unsafe path or symbolic link.')
            if item.is_dir():
                continue
            name = parts.name
            if name.casefold() in seen:
                raise ValueError('Archive has duplicate basenames; split the datasets before importing.')
            seen.add(name.casefold())
            if pathlib.Path(name).suffix.lower() not in SUFFIXES | {'.shx', '.dbf', '.prj', '.cpg', '.xsd'}:
                continue
            output = directory / name
            output.write_bytes(archive.read(item))
            files.append(output)
        return files, [item.filename for item in entries]


def gpap_inventory(path):
    # Read-only inventory only. Field-form/photo semantics require a real portal sample.
    with sqlite3.connect(f'file:{path}?mode=ro', uri=True) as database:
        database.execute('PRAGMA query_only=ON')
        deadline = time.monotonic() + 5
        database.set_progress_handler(lambda: int(time.monotonic() > deadline), 1000)
        tables = [row[0] for row in database.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
        output = []
        for name in tables[:100]:
            quoted = '"' + name.replace('"', '""') + '"'
            columns = [row[1] for row in database.execute(f'PRAGMA table_info({quoted})')]
            count = database.execute(f'SELECT COUNT(*) FROM {quoted}').fetchone()[0]
            output.append({'name': name, 'columns': columns, 'rows': count})
        return {'layers': [], 'tables': output, 'warnings': ['GeoPaparazzi database inventory only. Notes/forms, media and track publishing need a validated GeoPaparazzi sample and portal mapping. Original file retained in the browser.']}


def export_dataset(payload):
    formats = {'gpkg': ('GPKG', '.gpkg'), 'sqlite': ('SQLite', '.sqlite'), 'spatialite': ('SQLite', '.sqlite'), 'gml': ('GML', '.gml'), 'kml': ('KML', '.kml'), 'kmz': ('KML', '.kml'), 'gpx': ('GPX', '.gpx'), 'shapefile': ('ESRI Shapefile', '')}
    kind = payload.get('format')
    if kind not in formats:
        raise ValueError('Unknown GIS export format.')
    data = payload.get('data')
    if not isinstance(data, dict) or data.get('type') != 'FeatureCollection' or not isinstance(data.get('features'), list) or len(data['features']) > 100000:
        raise ValueError('Export expects a bounded WGS84 GeoJSON FeatureCollection.')
    driver, extension = formats[kind]
    with tempfile.TemporaryDirectory(prefix='nechako-export-') as name:
        directory = pathlib.Path(name)
        source = directory / 'source.geojson'
        source.write_text(json.dumps(data))
        destination = directory / ('export' + extension)
        arguments = ['ogr2ogr', '-f', driver, '-s_srs', 'EPSG:4326', '-t_srs', 'EPSG:4326']
        if kind == 'spatialite':
            arguments.extend(['-dsco', 'SPATIALITE=YES'])
        if kind == 'gpx':
            arguments.extend(['-dsco', 'GPX_USE_EXTENSIONS=YES'])
        arguments.extend([str(destination), str(source)])
        run(arguments)
        produced = [path for path in directory.rglob('*') if path.is_file() and path != source]
        if not produced or sum(path.stat().st_size for path in produced) > MAX_OUTPUT:
            raise ValueError('Export is empty or exceeds 30 MB.')
        if len(produced) == 1 and kind != 'kmz':
            content = produced[0].read_bytes()
            filename = produced[0].name
        else:
            buffer = io.BytesIO()
            with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as archive:
                for path in produced:
                    archive.write(path, path.relative_to(directory))
            content = buffer.getvalue()
            filename = 'export.kmz' if kind == 'kmz' else 'export-' + kind + '.zip'
        return {'name': filename, 'base64': base64.b64encode(content).decode(), 'warnings': ['Exported properties and geometry follow this format\'s limits. Keep the original source and GeoJSON workspace for lossless provenance.']}


def convert(payload):
    deadline = time.monotonic() + 120
    with tempfile.TemporaryDirectory(prefix='nechako-convert-') as name:
        directory = pathlib.Path(name)
        files = write_inputs(directory, payload.get('files'))
        archive_entries = []
        if len(files) == 1 and files[0].suffix.lower() in {'.zip', '.kmz'}:
            files, archive_entries = unpack_archive(files[0], directory)
        primary = [path for path in files if path.suffix.lower() in SUFFIXES - {'.zip', '.kmz'}]
        if not primary:
            raise ValueError('No supported GIS dataset in these files.')
        if any(path.suffix.lower() == '.shp' for path in primary):
            primary = [path for path in primary if path.suffix.lower() == '.shp']
        outputs, warnings = [], []
        for path in primary:
            if path.suffix.lower() == '.gpap':
                return gpap_inventory(path)
            if path.suffix.lower() in {'.gml', '.gpx', '.kml', '.json', '.geojson'}:
                if re.search(br'<!\s*(DOCTYPE|ENTITY)', path.read_bytes(), re.IGNORECASE):
                    raise ValueError('External XML entities and document types are not accepted.')
            info = run(['ogrinfo', '-ro', '-so', '-al', str(path)], deadline)
            layers = re.findall(r'^Layer name: (.+)$', info, re.MULTILINE)
            if not layers or len(layers) > 50:
                raise ValueError('No readable layers, or more than 50 layers in one dataset.')
            for layer in layers:
                if len(outputs) >= 50:
                    raise ValueError('Import at most 50 dataset layers at a time.')
                if layer.startswith('-'):
                    raise ValueError('Layer names starting with a dash are not accepted.')
                output = directory / f'converted-{len(outputs)}.geojson'
                arguments = ['ogr2ogr', '-f', 'GeoJSON', '-t_srs', 'EPSG:4326', '-lco', 'RFC7946=YES', str(output), str(path), layer]
                source_crs = payload.get('sourceCrs')
                if source_crs:
                    if not isinstance(source_crs, str) or not re.fullmatch(r'EPSG:\d{4,6}', source_crs):
                        raise ValueError('Source CRS must be an EPSG code.')
                    arguments[1:1] = ['-s_srs', source_crs]
                run(arguments, deadline)
                if output.stat().st_size > MAX_OUTPUT:
                    raise ValueError('Converted layer exceeds 30 MB. Split the source.')
                data = json.loads(output.read_text())
                if len(data.get('features', [])) > 100000:
                    raise ValueError('Converted layer exceeds 100,000 features.')
                outputs.append({'name': f'{path.name}: {layer}', 'data': data, 'sourceInfo': info})
        if sum(len(json.dumps(item)) for item in outputs) > MAX_OUTPUT:
            raise ValueError('Total converted data exceeds 30 MB.')
        if archive_entries:
            warnings.append('Referenced media and original styling remain in the original archive; only geometries/attributes are converted.')
        return {'layers': outputs, 'warnings': warnings, 'archiveEntries': archive_entries}


class Handler(http.server.BaseHTTPRequestHandler):
    def reply(self, status, value):
        body = json.dumps(value).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == '/api/nechako/health':
            self.reply(200, {'service': 'nechako-converter', 'gdal': run(['ogr2ogr', '--version']).strip()})
        else:
            self.reply(404, {'error': 'Unknown conversion endpoint.'})

    def do_POST(self):
        # Vite reverse proxy preserves the browser Origin. Only local dev origins allowed.
        origin = self.headers.get('Origin', '')
        if origin and not re.fullmatch(r'http://(localhost|127\.0\.0\.1):\d+', origin):
            return self.reply(403, {'error': 'Only local development origins are accepted.'})
        if self.path not in {'/api/nechako/convert', '/api/nechako/export'}:
            return self.reply(404, {'error': 'Unknown conversion endpoint.'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= MAX_BODY:
                return self.reply(413, {'error': 'Request must be within 28 MB.'})
            if not self.headers.get('Content-Type', '').startswith('application/json'):
                return self.reply(415, {'error': 'Send an application/json conversion request.'})
            payload = json.loads(self.rfile.read(length))
            self.reply(200, convert(payload) if self.path.endswith('/convert') else export_dataset(payload))
        except (ValueError, KeyError, TypeError, AttributeError, sqlite3.Error, zipfile.BadZipFile) as error:
            self.reply(400, {'error': str(error)})
        except subprocess.TimeoutExpired:
            self.reply(422, {'error': 'Conversion exceeded the 45 second time limit.'})
        except (OSError, RuntimeError):
            self.reply(500, {'error': 'Conversion service could not process the file. Check GDAL installation and server logs.'})

    def log_message(self, *_args):
        pass


if __name__ == '__main__':
    # Serial requests bound CPU/memory; never expose this dev server publicly.
    server = http.server.HTTPServer(('127.0.0.1', 42174), Handler)
    print('Nechako GDAL conversion: http://127.0.0.1:42174', flush=True)
    server.serve_forever()
