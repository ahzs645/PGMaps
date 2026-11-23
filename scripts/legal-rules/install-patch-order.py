"""Install the PGMaps package's C/Table 7 transcription into the versioned order."""
import argparse
import hashlib
import json
from pathlib import Path
import tempfile
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[2]
ORDER = ROOT / 'packages/legal-rules/rules/bc/prince-george/2004-biodiversity-order.json'
PREFIX = 'PGMaps_Landscape_Rules_Research_Package/data/'
KEYS = {'under50': 'under50ha', 'from51to100': 'between51and100ha',
        'from101to1000': 'between101and1000ha', 'over1000': 'over1000ha'}


def install(archive, check):
    current = json.loads(ORDER.read_text())
    with ZipFile(archive) as package:
        raw = package.read(PREFIX + 'prince-george-objective-c.json')
        table = json.loads(raw)
        sources = json.loads(package.read(PREFIX + 'sources.json'))['sources']
    if (table['sourceId'], table['signedOn'], table['provision']) != ('pgorder', current['source']['signedOn'], 'C/Table 7'):
        raise ValueError('Unsupported instrument or provision')
    if not any(s['id'] == table['sourceId'] and s['url'] == current['source']['url'] for s in sources):
        raise ValueError('Order citation differs from the registered source')
    patch = current['youngForestPatchDistribution']
    rows = []
    for row in table['targets']:
        p = row['percent']
        if set(p) != set(KEYS) or any(type(v) is not int or not 0 <= v <= 100 for v in p.values()) or sum(p.values()) != 100:
            raise ValueError('Invalid percentages for ' + row['ndu'])
        rows.append({'ndu': row['ndu'], 'percent': {k: p[src] for src, k in KEYS.items()}})
    if len(rows) != 9 or sorted(r['ndu'] for r in rows) != sorted(r['ndu'] for r in patch['targets']):
        raise ValueError('Unexpected reporting units')
    if table['binKeys'] != list(KEYS) or len(table['binLabels']) != len(KEYS):
        raise ValueError('Unexpected patch classes')
    patch.update(bins=list(KEYS.values()), labels=table['binLabels'], targets=rows,
                 packageMember='data/prince-george-objective-c.json', sha256=hashlib.sha256(raw).hexdigest())
    current['implementationPolicy']['spatialAlgorithmStatus'] = 'planning implementation v1; historical GIS replay pending'
    result = json.dumps(current, indent=2, ensure_ascii=False) + '\n'
    if check:
        if result != ORDER.read_text():
            raise SystemExit('Installed order differs from package')
    else:
        with tempfile.NamedTemporaryFile('w', dir=ORDER.parent, delete=False) as output:
            output.write(result)
        Path(output.name).replace(ORDER)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    install(args.archive, args.check)
