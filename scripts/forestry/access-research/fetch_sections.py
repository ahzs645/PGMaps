"""Download attributes of every FTEN road-permit section (no geometry) into the cache.

Usage: python3 -I fetch_sections.py
Writes $ACCESS_RESEARCH_CACHE/sections_b01.json (default /tmp/pgmaps-access-research).
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from wfs import all_features

CACHE = os.environ.get('ACCESS_RESEARCH_CACHE', '/tmp/pgmaps-access-research')
os.makedirs(CACHE, exist_ok=True)
rows = all_features('WHSE_FOREST_TENURE.FTEN_ROAD_SECTION_LINES_SVW', "FILE_TYPE_CODE='B01'",
                    ['FOREST_FILE_ID', 'ROAD_SECTION_ID', 'ROAD_SECTION_NAME', 'GEOGRAPHIC_DISTRICT_CODE', 'AWARD_DATE',
                     'RETIREMENT_DATE', 'LIFE_CYCLE_STATUS_CODE', 'CLIENT_NUMBER', 'AMENDMENT_ID', 'LOCATION', 'OBJECTID'])
props = [r['properties'] for r in rows]
json.dump(props, open(os.path.join(CACHE, 'sections_b01.json'), 'w'))
print(f'{len(props)} road-permit sections -> {CACHE}/sections_b01.json')
