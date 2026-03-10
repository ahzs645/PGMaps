#!/usr/bin/env python3
"""
Fetch ALL available census vectors for Prince George, BC at all geographic levels.

Step 1: Discover all vectors from CensusMapper API vector_info endpoint
Step 2: Batch vectors into manageable chunks (API has per-request limits)
Step 3: Fetch data for each batch at each geographic level
Step 4: Merge batch results into single files per level

Uses CensusMapper API: https://censusmapper.ca/api
"""

import requests
import json
import csv
import os
import time
import sys
import re
from io import StringIO
from datetime import datetime

BASE_URL = "https://censusmapper.ca/api/v1"
API_KEY = "CensusMapper_c36f7ab0a43132b3d0b8e83538c4de57"

# Prince George identifiers
PRINCE_GEORGE_CSD = "5953023"   # Census Subdivision (city)
PRINCE_GEORGE_CD = "5953"       # Census Division (Fraser-Fort George)
PRINCE_GEORGE_CMA = "59970"     # CMA/CA code for Prince George

DATASET = "CA21"

# Vectors per API request — CensusMapper rejects >1600 vectors per call
BATCH_SIZE = 1500

# Pause between API calls (seconds) to respect rate limits
PAUSE_BETWEEN_CALLS = 1.5
PAUSE_BETWEEN_LEVELS = 3

# Define all levels to fetch, from smallest to largest
LEVELS_TO_FETCH = [
    {
        "level": "DB",
        "regions": {"CSD": [PRINCE_GEORGE_CSD]},
        "description": "Dissemination Block (smallest unit)",
    },
    {
        "level": "DA",
        "regions": {"CSD": [PRINCE_GEORGE_CSD]},
        "description": "Dissemination Area",
    },
    {
        "level": "CT",
        "regions": {"CMA": [PRINCE_GEORGE_CMA]},
        "description": "Census Tract",
    },
    {
        "level": "CSD",
        "regions": {"CD": [PRINCE_GEORGE_CD]},
        "description": "Census Subdivision",
    },
    {
        "level": "CD",
        "regions": {"CD": [PRINCE_GEORGE_CD]},
        "description": "Census Division",
    },
]

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "all_vectors_data")


def discover_vectors():
    """
    Fetch the full list of available vectors for CA21 from CensusMapper.
    The API returns Ruby hash syntax, not JSON, so we parse it specially.
    """
    url = f"https://censusmapper.ca/api/v1/vector_info/{DATASET}.json"
    print(f"Discovering vectors from: {url}")

    response = requests.get(url)
    if response.status_code != 200:
        print(f"ERROR fetching vector list: {response.status_code}")
        print(f"Response: {response.text[:500]}")
        return None

    # The response is Ruby hash syntax — extract vector codes with regex
    raw_text = response.text
    return raw_text


def extract_vector_codes_from_ruby(raw_text):
    """
    Extract all vector codes (v_CA21_XXXX) from the Ruby hash response.
    Only extracts vectors that appear inside "key"=>[...] arrays,
    ignoring formula references in "add"=>"..." fields.
    """
    key_sections = re.findall(r'"key"=>\[([^\]]+)\]', raw_text)
    all_key_vectors = []
    for section in key_sections:
        vecs = re.findall(r'v_CA21_\d+', section)
        all_key_vectors.extend(vecs)
    # Deduplicate while preserving order
    seen = set()
    unique = []
    for v in all_key_vectors:
        if v not in seen:
            seen.add(v)
            unique.append(v)
    return unique


def extract_vector_metadata_from_ruby(raw_text):
    """
    Extract vector codes with their labels from the Ruby hash response.
    Parses the tree structure to map vector codes to descriptions.
    """
    metadata = {}

    # Match patterns like: "name"=>"Some Label" ... "key"=>["v_CA21_1", "v_CA21_2"]
    # The structure has nodes with "name" and "key" fields
    # Strategy: find each node's key array and the nearest preceding name

    # Find all node blocks with their name and key arrays
    # Pattern: "name"=>"...", ... "key"=>["v_CA21_X", ...]
    # or: "key"=>["v_CA21_X", ...], "type"=>["Total", ...], "name"=>"..."

    # Simple approach: find all "key"=>[...] with the closest "name"
    # Split by node boundaries (look for {"key" or {"name" patterns)

    # Find all key arrays and their associated names and types
    node_pattern = re.compile(
        r'\{[^{}]*?"name"=>"?([^"}\]]+?)"?\s*,'
        r'[^{}]*?"key"=>\[([^\]]+)\]'
        r'(?:[^{}]*?"type"=>\[([^\]]+)\])?',
        re.DOTALL
    )
    # Also try reverse order (key before name)
    node_pattern2 = re.compile(
        r'\{[^{}]*?"key"=>\[([^\]]+)\]'
        r'[^{}]*?"type"=>\[([^\]]*?)\]'
        r'[^{}]*?"name"=>"?([^"}\]]+?)"?\s*[,}]',
        re.DOTALL
    )

    # Simple but effective: find every "key"=>["v_CA21_X"...] and the closest "name"
    key_positions = []
    for m in re.finditer(r'"key"=>\[([^\]]+)\]', raw_text):
        keys_str = m.group(1)
        vectors_in_key = re.findall(r'v_CA21_\d+', keys_str)
        types_in_key = []

        # Look for "type"=>[...] near this key
        nearby = raw_text[max(0, m.start() - 300):m.end() + 300]
        type_match = re.search(r'"type"=>\[([^\]]+)\]', nearby)
        if type_match:
            types_in_key = [t.strip().strip('"') for t in type_match.group(1).split(',')]

        # Look for "name"=>"..." near this key
        name_match = re.search(r'"name"=>"?([^"}\],=>]+)', nearby)
        name = name_match.group(1).strip() if name_match else ""

        for i, vec in enumerate(vectors_in_key):
            vec_type = types_in_key[i] if i < len(types_in_key) else ""
            label = f"{name}"
            if vec_type and vec_type != "Total":
                label = f"{name} ({vec_type})"
            metadata[vec] = {"label": label, "type": vec_type}

    return metadata


def batch_vectors(vectors, batch_size):
    """Split vector list into batches."""
    for i in range(0, len(vectors), batch_size):
        yield vectors[i:i + batch_size]


def fetch_data_batch(level, regions, vectors):
    """Fetch tabular census data for a batch of vectors."""
    endpoint = f"{BASE_URL}/data.csv"
    payload = {
        "api_key": API_KEY,
        "dataset": DATASET,
        "level": level,
        "regions": json.dumps(regions),
        "vectors": json.dumps(vectors),
        "geo_hierarchy": "true",
    }

    response = requests.post(endpoint, data=payload)

    if response.status_code != 200:
        return None, f"HTTP {response.status_code}: {response.text[:200]}"

    reader = csv.DictReader(StringIO(response.text))
    data = [row for row in reader]
    return data, None


def fetch_geojson(level, regions):
    """Fetch GeoJSON boundaries."""
    endpoint = f"{BASE_URL}/geo.geojson"
    payload = {
        "api_key": API_KEY,
        "dataset": DATASET,
        "level": level,
        "regions": json.dumps(regions),
        "resolution": "simplified",
    }

    response = requests.post(endpoint, data=payload)

    if response.status_code != 200:
        return None, f"HTTP {response.status_code}: {response.text[:200]}"

    return response.json(), None


def merge_batches(all_batches):
    """
    Merge multiple batch results into a single dataset.
    Each batch has the same rows (same GeoUIDs) but different vector columns.
    API returns column names like "v_CA21_1: Population, 2021".
    """
    if not all_batches:
        return []

    merged = {}
    # Base columns returned by the API (may have trailing spaces)
    base_key_prefixes = {"GeoUID", "Type", "Region Name", "Area", "Population",
                         "Dwellings", "Households", "rpid", "rgid", "ruid", "rguid"}

    def is_base_key(k):
        return any(k.strip().startswith(prefix) for prefix in base_key_prefixes)

    for batch in all_batches:
        for row in batch:
            geo_uid = row.get("GeoUID", "")
            if geo_uid not in merged:
                merged[geo_uid] = {}
                # Copy base columns
                for k, v in row.items():
                    if is_base_key(k):
                        merged[geo_uid][k] = v

            # Add vector columns (anything starting with v_)
            for k, v in row.items():
                if k.startswith("v_"):
                    merged[geo_uid][k] = v

    return list(merged.values())


def save_json(data, filename):
    """Save data to JSON file."""
    filepath = os.path.join(OUTPUT_DIR, filename)
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    size_mb = os.path.getsize(filepath) / (1024 * 1024)
    print(f"    Saved: {filename} ({size_mb:.2f} MB)")
    return filepath


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    print("=" * 70)
    print("Census Data Fetcher - ALL VECTORS for Prince George, BC")
    print("=" * 70)
    print(f"Dataset: {DATASET} (2021 Census)")
    print(f"Output directory: {OUTPUT_DIR}")
    print(f"Timestamp: {datetime.now().isoformat()}\n")

    # Step 1: Discover all vectors
    print("STEP 1: Discovering all available vectors...")
    print("-" * 50)
    raw_text = discover_vectors()

    if raw_text is None:
        print("FATAL: Could not fetch vector list from API.")
        sys.exit(1)

    # Save raw response for reference
    raw_path = os.path.join(OUTPUT_DIR, "vector_tree_raw.txt")
    with open(raw_path, "w", encoding="utf-8") as f:
        f.write(raw_text)
    print(f"    Saved raw vector tree: vector_tree_raw.txt ({len(raw_text)} bytes)")

    all_vectors = extract_vector_codes_from_ruby(raw_text)
    vector_metadata = extract_vector_metadata_from_ruby(raw_text)

    print(f"  Total vectors discovered: {len(all_vectors)}")
    print(f"  Vectors with metadata: {len(vector_metadata)}")
    if all_vectors:
        print(f"  Range: {all_vectors[0]} ... {all_vectors[-1]}")

    if not all_vectors:
        print("FATAL: No vectors found in the API response.")
        print("Saving raw response for debugging...")
        sys.exit(1)

    # Save vector metadata
    save_json(vector_metadata, "vector_metadata.json")

    # Save flat vector list
    save_json(all_vectors, "vector_list.json")

    # Calculate batches
    batches = list(batch_vectors(all_vectors, BATCH_SIZE))
    print(f"  Batch size: {BATCH_SIZE}")
    print(f"  Number of batches: {len(batches)}")

    # Step 2: Fetch data for each level
    print(f"\nSTEP 2: Fetching data for all levels...")
    print("=" * 70)

    summary = {
        "timestamp": datetime.now().isoformat(),
        "dataset": DATASET,
        "total_vectors": len(all_vectors),
        "batch_size": BATCH_SIZE,
        "num_batches": len(batches),
        "levels": {},
    }

    for config in LEVELS_TO_FETCH:
        level = config["level"]
        regions = config["regions"]
        desc = config["description"]

        print(f"\n{'─' * 60}")
        print(f"Level: {level} - {desc}")
        print(f"Region filter: {regions}")
        print(f"{'─' * 60}")

        level_summary = {
            "description": desc,
            "batches_attempted": len(batches),
            "batches_succeeded": 0,
            "batches_failed": 0,
            "vectors_fetched": 0,
            "data_records": 0,
            "geo_features": 0,
        }

        # Fetch data in batches
        all_batch_data = []
        failed_batches = []

        for i, batch in enumerate(batches):
            batch_num = i + 1
            print(f"  Batch {batch_num}/{len(batches)} ({len(batch)} vectors): "
                  f"{batch[0]}...{batch[-1]}", end="")

            data, error = fetch_data_batch(level, regions, batch)

            if error:
                print(f" FAILED: {error}")
                failed_batches.append({"batch": batch_num, "error": error, "vectors": batch})
                level_summary["batches_failed"] += 1
            elif data:
                print(f" OK ({len(data)} records)")
                all_batch_data.append(data)
                level_summary["batches_succeeded"] += 1
                level_summary["vectors_fetched"] += len(batch)
            else:
                print(f" EMPTY")
                level_summary["batches_failed"] += 1

            time.sleep(PAUSE_BETWEEN_CALLS)

        # Merge batches
        if all_batch_data:
            print(f"\n  Merging {len(all_batch_data)} batches...")
            merged_data = merge_batches(all_batch_data)
            level_summary["data_records"] = len(merged_data)

            data_file = f"prince_george_{level.lower()}_all_vectors.json"
            save_json({"data": merged_data, "count": len(merged_data)}, data_file)

            # Also save as CSV for easier analysis
            if merged_data:
                csv_file = f"prince_george_{level.lower()}_all_vectors.csv"
                csv_path = os.path.join(OUTPUT_DIR, csv_file)
                # Collect all fieldnames across all rows
                all_fields = {}
                for row in merged_data:
                    for k in row:
                        all_fields[k] = True
                fieldnames = list(all_fields.keys())
                with open(csv_path, "w", newline="", encoding="utf-8") as f:
                    writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
                    writer.writeheader()
                    writer.writerows(merged_data)
                size_mb = os.path.getsize(csv_path) / (1024 * 1024)
                print(f"    Saved: {csv_file} ({size_mb:.2f} MB)")
        else:
            print(f"  No data collected for level {level}")

        # Save failed batches info if any
        if failed_batches:
            fail_file = f"prince_george_{level.lower()}_failed_batches.json"
            save_json(failed_batches, fail_file)

        # Fetch GeoJSON (only once per level, not per batch)
        print(f"\n  Fetching GeoJSON boundaries...")
        geojson, geo_error = fetch_geojson(level, regions)
        if geo_error:
            print(f"    GeoJSON FAILED: {geo_error}")
        elif geojson and geojson.get("features"):
            feature_count = len(geojson["features"])
            level_summary["geo_features"] = feature_count
            geo_file = f"prince_george_{level.lower()}_geo.json"
            save_json(geojson, geo_file)
            print(f"    GeoJSON features: {feature_count}")
        else:
            print(f"    No GeoJSON returned")

        summary["levels"][level] = level_summary
        print(f"\n  Level {level} complete: {level_summary['vectors_fetched']} vectors, "
              f"{level_summary['data_records']} records, "
              f"{level_summary['geo_features']} geo features")

        time.sleep(PAUSE_BETWEEN_LEVELS)

    # Final summary
    print(f"\n\n{'=' * 70}")
    print("FINAL SUMMARY")
    print(f"{'=' * 70}")
    print(f"Total vectors available: {len(all_vectors)}")
    print(f"\n{'Level':<8} {'Description':<35} {'Vectors':>8} {'Records':>8} {'Geo':>8} {'Failed':>8}")
    print(f"{'─' * 8} {'─' * 35} {'─' * 8} {'─' * 8} {'─' * 8} {'─' * 8}")

    for config in LEVELS_TO_FETCH:
        level = config["level"]
        desc = config["description"]
        info = summary["levels"].get(level, {})
        print(f"{level:<8} {desc:<35} "
              f"{info.get('vectors_fetched', 0):>8} "
              f"{info.get('data_records', 0):>8} "
              f"{info.get('geo_features', 0):>8} "
              f"{info.get('batches_failed', 0):>8}")

    # Save summary
    save_json(summary, "fetch_all_vectors_summary.json")
    print(f"\nAll files saved to: {OUTPUT_DIR}")
    print("Done!")


if __name__ == "__main__":
    main()
