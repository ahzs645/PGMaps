#!/usr/bin/env python3
"""
Process raw census all_vectors data into compact per-category data files
for the PGMaps web application.

Reads from: scripts/census-source/
Writes to:  public/data/census/variables/

Output structure:
  variables/
    catalog.json           - Category tree + variable metadata
    {level}/{category}.json - Data per category per level
"""

import csv
import json
import os
import re
import sys
from pathlib import Path

# Paths
SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
SOURCE_DIR = SCRIPT_DIR / "census-source"
OUTPUT_DIR = PROJECT_ROOT / "public" / "data" / "census" / "variables"
CATEGORIES_FILE = SCRIPT_DIR / "census_categories.json"

LEVELS = ["cd", "csd", "ct", "da", "db"]
LEVEL_CSV_FILES = {
    level: SOURCE_DIR / f"prince_george_{level}_all_vectors.csv"
    for level in LEVELS
}


def slugify(name: str) -> str:
    """Convert category name to a URL-safe slug."""
    slug = name.lower()
    slug = re.sub(r"[^a-z0-9]+", "_", slug)
    slug = slug.strip("_")
    return slug


def collect_all_vectors(node: dict) -> list[str]:
    """Recursively collect all vector IDs from a category node."""
    vectors = list(node.get("vectors", []))
    for child in node.get("children", []):
        vectors.extend(collect_all_vectors(child))
    return vectors


def build_flat_categories(tree: list[dict]) -> list[dict]:
    """
    Flatten the category tree into a list of categories,
    each with a slug, name, and list of vector IDs.

    The tree has 3 roots: "Population and Dwellings", "100% data", "25% Data".
    We flatten the sub-categories under 100% and 25% into top-level categories,
    with the parent's direct vectors becoming their own category.
    """
    categories = []

    for root in tree:
        root_name = root["name"]
        root_vectors = root.get("vectors", [])
        root_children = root.get("children", [])

        if root_name == "Population and Dwellings":
            categories.append({
                "id": "population_dwellings",
                "name": "Population & Dwellings",
                "group": "Basic",
                "vectors": collect_all_vectors(root),
            })
        elif root_name == "100% data":
            # Direct vectors are Age data
            if root_vectors:
                categories.append({
                    "id": "age",
                    "name": "Age",
                    "group": "100% Data",
                    "vectors": root_vectors,
                })
            for child in root_children:
                child_id = slugify(child["name"])
                # Avoid collisions with 25% data categories
                if child_id in ("income", "language"):
                    child_id = child_id + "_100"
                categories.append({
                    "id": child_id,
                    "name": child["name"],
                    "group": "100% Data",
                    "vectors": collect_all_vectors(child),
                })
        elif root_name == "25% Data":
            # Direct vectors are Religion data
            if root_vectors:
                categories.append({
                    "id": "religion",
                    "name": "Religion",
                    "group": "25% Data",
                    "vectors": root_vectors,
                })
            for child in root_children:
                child_id = slugify(child["name"])
                # Avoid collisions with 100% data categories
                if child_id in ("income_100", "language_100"):
                    pass  # won't happen since 25% uses different names
                if child_id == "income":
                    child_id = "income_25"
                elif child_id == "language":
                    child_id = "language_25"
                elif child_id == "total_religion_for_the_population_in_private_households":
                    child_id = "religion_25"
                categories.append({
                    "id": child_id,
                    "name": child["name"],
                    "group": "25% Data",
                    "vectors": collect_all_vectors(child),
                })

    return categories


def build_variable_metadata(categories: list[dict], metadata_file: Path) -> dict:
    """Build a mapping of vector_id -> {label, type, category_id}."""
    # Load the raw metadata
    with open(metadata_file) as f:
        raw_metadata = json.load(f)

    var_meta = {}
    for cat in categories:
        for vec_id in cat["vectors"]:
            meta = raw_metadata.get(vec_id, {})
            var_meta[vec_id] = {
                "label": meta.get("label", vec_id),
                "type": meta.get("type", "Total"),
                "category": cat["id"],
            }

    return var_meta


def read_csv_data(csv_path: Path) -> tuple[list[str], list[dict]]:
    """Read a census CSV file and return (headers, rows)."""
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        headers = reader.fieldnames or []
        rows = list(reader)
    return headers, rows


def extract_vector_id_from_header(header: str) -> str | None:
    """Extract vector ID like 'v_CA21_123' from CSV column header."""
    match = re.match(r"(v_CA21_\d+)", header)
    return match.group(1) if match else None


def build_header_to_vector_map(headers: list[str]) -> dict[str, str]:
    """Map CSV column headers to vector IDs."""
    mapping = {}
    for header in headers:
        vec_id = extract_vector_id_from_header(header)
        if vec_id:
            mapping[header] = vec_id
    return mapping


def process_level(
    level: str,
    csv_path: Path,
    categories: list[dict],
    output_dir: Path,
) -> dict:
    """Process a single geographic level's CSV data."""
    print(f"  Processing {level.upper()}...")

    headers, rows = read_csv_data(csv_path)
    header_to_vec = build_header_to_vector_map(headers)

    # Build reverse: vector_id -> csv_header
    vec_to_header = {v: h for h, v in header_to_vec.items()}

    level_dir = output_dir / level
    level_dir.mkdir(parents=True, exist_ok=True)

    stats = {"records": len(rows), "categories": 0, "vectors": 0}

    for cat in categories:
        # Find which vectors from this category exist in the CSV
        available_vectors = []
        for vec_id in cat["vectors"]:
            if vec_id in vec_to_header:
                available_vectors.append(vec_id)

        if not available_vectors:
            continue

        # Build compact data: { vectors: [...], data: { GeoUID: [val, val, ...] } }
        data_by_geo = {}
        for row in rows:
            geo_uid = row.get("GeoUID", "").strip()
            if not geo_uid:
                continue

            values = []
            for vec_id in available_vectors:
                header = vec_to_header[vec_id]
                raw_val = row.get(header, "").strip()
                if raw_val == "" or raw_val == "x" or raw_val == "F":
                    values.append(None)
                else:
                    try:
                        val = float(raw_val.replace(",", ""))
                        # Store as int if it's a whole number
                        if val == int(val):
                            values.append(int(val))
                        else:
                            values.append(round(val, 2))
                    except ValueError:
                        values.append(None)

            data_by_geo[geo_uid] = values

        # Write category data file
        cat_data = {
            "vectors": available_vectors,
            "data": data_by_geo,
        }

        cat_file = level_dir / f"{cat['id']}.json"
        with open(cat_file, "w") as f:
            json.dump(cat_data, f, separators=(",", ":"))

        file_size = cat_file.stat().st_size
        size_str = (
            f"{file_size / 1024 / 1024:.1f} MB"
            if file_size > 1024 * 1024
            else f"{file_size / 1024:.0f} KB"
        )
        print(f"    {cat['id']}: {len(available_vectors)} vectors, {len(data_by_geo)} records ({size_str})")

        stats["categories"] += 1
        stats["vectors"] += len(available_vectors)

    return stats


def build_catalog(
    categories: list[dict],
    var_metadata: dict,
    csv_headers_by_level: dict[str, list[str]],
) -> dict:
    """Build the catalog.json with category tree and variable info."""
    # For each category, build a tree of variables using the metadata
    catalog_categories = []

    for cat in categories:
        # Build variable entries with label info from CSV headers
        variables = []
        for vec_id in cat["vectors"]:
            meta = var_metadata.get(vec_id, {})
            variables.append({
                "id": vec_id,
                "label": meta.get("label", vec_id),
                "type": meta.get("type", "Total"),
            })

        catalog_categories.append({
            "id": cat["id"],
            "name": cat["name"],
            "group": cat["group"],
            "variableCount": len(cat["vectors"]),
            "variables": variables,
        })

    return {
        "totalVariables": sum(len(c["vectors"]) for c in categories),
        "categories": catalog_categories,
        "levels": LEVELS,
    }


def build_enhanced_catalog(
    categories: list[dict],
    csv_headers_by_level: dict[str, list[str]],
) -> dict:
    """
    Build catalog using CSV column headers for accurate labels.
    The CSV headers have format: 'v_CA21_N: Label Text'
    Only includes variables that actually exist in the CSV data.
    """
    # Use DA-level headers as reference (most complete)
    ref_headers = csv_headers_by_level.get("da", [])
    header_labels = {}
    available_vec_ids = set()
    for header in ref_headers:
        match = re.match(r"(v_CA21_\d+):\s*(.+)", header)
        if match:
            header_labels[match.group(1)] = match.group(2).strip()
            available_vec_ids.add(match.group(1))
        elif re.match(r"v_CA21_\d+$", header):
            # Header is just the vector ID with no label
            available_vec_ids.add(header)

    # Load vector metadata for type info
    metadata_file = SOURCE_DIR / "vector_metadata.json"
    with open(metadata_file) as f:
        raw_metadata = json.load(f)

    catalog_categories = []
    for cat in categories:
        variables = []
        for vec_id in cat["vectors"]:
            if vec_id not in available_vec_ids:
                continue
            meta = raw_metadata.get(vec_id, {})
            label = header_labels.get(vec_id, meta.get("label", vec_id))
            var_type = meta.get("type", "Total")

            variables.append({
                "id": vec_id,
                "label": label,
                "type": var_type,
            })

        if not variables:
            continue

        catalog_categories.append({
            "id": cat["id"],
            "name": cat["name"],
            "group": cat["group"],
            "variableCount": len(variables),
            "variables": variables,
        })

    return {
        "totalVariables": sum(c["variableCount"] for c in catalog_categories),
        "categories": catalog_categories,
        "levels": LEVELS,
    }


def main():
    print("Building census variable data files...")
    print(f"Source: {SOURCE_DIR}")
    print(f"Output: {OUTPUT_DIR}")

    # Verify source files exist
    for level, csv_file in LEVEL_CSV_FILES.items():
        if not csv_file.exists():
            print(f"ERROR: Missing CSV file: {csv_file}")
            sys.exit(1)

    if not CATEGORIES_FILE.exists():
        print(f"ERROR: Missing categories file: {CATEGORIES_FILE}")
        sys.exit(1)

    # Load category tree
    with open(CATEGORIES_FILE) as f:
        tree = json.load(f)

    categories = build_flat_categories(tree)
    print(f"\n{len(categories)} categories defined:")
    for cat in categories:
        print(f"  [{cat['group']}] {cat['name']} ({len(cat['vectors'])} vectors)")

    # Create output directory
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Collect CSV headers for catalog building
    csv_headers_by_level = {}
    for level, csv_file in LEVEL_CSV_FILES.items():
        with open(csv_file, newline="", encoding="utf-8") as f:
            reader = csv.reader(f)
            csv_headers_by_level[level] = next(reader)

    # Process each level
    print("\nProcessing levels:")
    total_stats = {"records": 0, "categories": 0, "vectors": 0}
    for level in LEVELS:
        stats = process_level(level, LEVEL_CSV_FILES[level], categories, OUTPUT_DIR)
        for k in total_stats:
            total_stats[k] += stats[k]

    # Build and write catalog
    print("\nBuilding catalog...")
    catalog = build_enhanced_catalog(categories, csv_headers_by_level)

    catalog_file = OUTPUT_DIR / "catalog.json"
    with open(catalog_file, "w") as f:
        json.dump(catalog, f, indent=2)

    catalog_size = catalog_file.stat().st_size
    print(f"  catalog.json: {catalog_size / 1024:.0f} KB")

    # Summary
    total_vectors = catalog["totalVariables"]
    print(f"\nDone! {total_vectors} variables across {len(categories)} categories and {len(LEVELS)} levels")
    print(f"Output directory: {OUTPUT_DIR}")

    # Print file size summary
    print("\nFile sizes by level:")
    for level in LEVELS:
        level_dir = OUTPUT_DIR / level
        if level_dir.exists():
            total_size = sum(f.stat().st_size for f in level_dir.glob("*.json"))
            print(f"  {level.upper()}: {total_size / 1024 / 1024:.1f} MB total")


if __name__ == "__main__":
    main()
