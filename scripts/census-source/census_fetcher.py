#!/usr/bin/env python3
"""
CensusMapper API Python Script
Fetches Dissemination Area (DA) level census data for Prince George, BC
and saves it as JSON.

You need an API key from https://censusmapper.ca/api
"""

import requests
import json
import os
from typing import Optional

# CensusMapper API base URL
BASE_URL = "https://censusmapper.ca/api/v1"

# Prince George Census Subdivision (CSD) code
PRINCE_GEORGE_CSD = "5953023"

# Prince George Census Division (CD) code - includes surrounding area
PRINCE_GEORGE_CD = "5953"

# BC Province code
BC_PROVINCE = "59"


def get_census_data(
    api_key: str,
    dataset: str = "CA21",
    regions: dict = None,
    level: str = "DA",
    vectors: list = None,
    geo_format: Optional[str] = None,
    resolution: str = "simplified",
) -> dict:
    """
    Fetch census data from CensusMapper API.

    Args:
        api_key: Your CensusMapper API key
        dataset: Census dataset (e.g., 'CA21' for 2021 census)
        regions: Dictionary of region type to region code(s)
                 e.g., {'CMA': ['59933']} or {'CA': ['970']}
        level: Aggregation level ('PR', 'CMA', 'CD', 'CSD', 'CT', 'DA')
        vectors: List of census variable codes (e.g., ['v_CA21_1'])
        geo_format: 'geojson' for geographic data, None for data only
        resolution: 'simplified' or 'high' for geographic resolution

    Returns:
        Dictionary containing census data
    """
    if regions is None:
        regions = {"CSD": [PRINCE_GEORGE_CSD]}

    # Ensure region values are lists
    formatted_regions = {}
    for region_type, region_codes in regions.items():
        if isinstance(region_codes, list):
            formatted_regions[region_type] = region_codes
        else:
            formatted_regions[region_type] = [region_codes]

    if vectors is None:
        # Default vectors: population, dwellings, density
        vectors = [
            "v_CA21_1",   # Population 2021
            "v_CA21_2",   # Population 2016
            "v_CA21_3",   # Population % change
            "v_CA21_4",   # Total private dwellings
            "v_CA21_6",   # Population density per sq km
            "v_CA21_7",   # Land area in sq km
        ]

    # Choose endpoint based on whether geo data is requested
    if geo_format == "geojson":
        endpoint = f"{BASE_URL}/geo.geojson"
        # Build the API request payload for geojson (POST with form data)
        payload = {
            "api_key": api_key,
            "dataset": dataset,
            "level": level,
            "regions": json.dumps(formatted_regions),
            "resolution": resolution,
        }
    else:
        endpoint = f"{BASE_URL}/data.csv"
        # Build the API request payload for data (POST with form data)
        payload = {
            "api_key": api_key,
            "dataset": dataset,
            "level": level,
            "regions": json.dumps(formatted_regions),
            "vectors": json.dumps(vectors),
            "geo_hierarchy": "true",
        }

    print(f"Fetching data from: {endpoint}")
    print(f"Payload: {payload}")

    # Use POST request with form data
    response = requests.post(endpoint, data=payload)

    if response.status_code != 200:
        print(f"Error: {response.status_code}")
        print(f"Response: {response.text[:500]}")
        return {"error": response.text, "status_code": response.status_code}

    if geo_format == "geojson":
        return response.json()
    else:
        # Parse CSV response to JSON
        return parse_csv_to_json(response.text)


def parse_csv_to_json(csv_text: str) -> dict:
    """Convert CSV response to JSON format."""
    lines = csv_text.strip().split("\n")
    if not lines:
        return {"data": []}

    # Handle CSV with potential quoted fields
    import csv
    from io import StringIO

    reader = csv.DictReader(StringIO(csv_text))
    data = [row for row in reader]

    return {"data": data, "count": len(data)}


def list_regions(api_key: str, dataset: str = "CA21") -> dict:
    """List available regions for a dataset."""
    endpoint = f"{BASE_URL}/list_regions"
    params = {
        "api_key": api_key,
        "dataset": dataset,
    }

    response = requests.get(endpoint, params=params)

    if response.status_code != 200:
        return {"error": response.text}

    return response.json()


def list_vectors(api_key: str, dataset: str = "CA21") -> dict:
    """List available census vectors/variables for a dataset."""
    endpoint = f"{BASE_URL}/list_vectors"
    params = {
        "api_key": api_key,
        "dataset": dataset,
    }

    response = requests.get(endpoint, params=params)

    if response.status_code != 200:
        return {"error": response.text}

    return response.json()


def save_to_json(data: dict, filename: str):
    """Save data to a JSON file."""
    with open(filename, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"Data saved to {filename}")


def main():
    # Get API key from environment or prompt
    api_key = os.environ.get("CM_API_KEY")

    if not api_key:
        print("=" * 60)
        print("CensusMapper API Key Required")
        print("=" * 60)
        print("\nTo get an API key:")
        print("1. Go to https://censusmapper.ca/api")
        print("2. Sign up or log in")
        print("3. Copy your API key")
        print("\nThen either:")
        print("  - Set environment variable: export CM_API_KEY='your_key'")
        print("  - Or enter it below")
        print()
        api_key = input("Enter your API key (or press Enter to skip): ").strip()

        if not api_key:
            print("\nNo API key provided. Creating sample structure...")
            create_sample_output()
            return

    print("\n" + "=" * 60)
    print("Fetching DA-level Census Data for Prince George, BC")
    print("=" * 60)

    # Define vectors to fetch (population and dwelling data)
    vectors = [
        "v_CA21_1",    # Population 2021
        "v_CA21_2",    # Population 2016
        "v_CA21_3",    # Population % change 2016-2021
        "v_CA21_4",    # Total private dwellings
        "v_CA21_6",    # Population density per sq km
        "v_CA21_7",    # Land area in sq km
        "v_CA21_8",    # Total - Age
        "v_CA21_434",  # Occupied private dwellings by structural type
    ]

    # Fetch data for Prince George CSD (Census Subdivision = city boundaries)
    # CSD code 5953023 is Prince George city
    print("\nFetching census data...")

    # Fetch tabular data (more reliable)
    print("\nFetching tabular data for Prince George city (CSD)...")
    tabular_data = get_census_data(
        api_key=api_key,
        dataset="CA21",
        regions={"CSD": "5953023"},  # Prince George Census Subdivision
        level="DA",
        vectors=vectors,
        geo_format=None,
    )

    # Save tabular data
    save_to_json(tabular_data, "prince_george_da_data.json")

    # Try to get GeoJSON data (includes geometry)
    print("\nFetching geographic boundaries...")
    geojson_data = get_census_data(
        api_key=api_key,
        dataset="CA21",
        regions={"CSD": "5953023"},
        level="DA",
        vectors=vectors,
        geo_format="geojson",
    )

    # Save GeoJSON (with geometry)
    save_to_json(geojson_data, "prince_george_da_geo.json")

    print("\n" + "=" * 60)
    print("Done!")
    print("=" * 60)
    print("\nOutput files:")
    print("  - prince_george_da_geo.json  (with geographic boundaries)")
    print("  - prince_george_da_data.json (tabular data only)")


def create_sample_output():
    """Create a sample output structure to show expected format."""
    sample_data = {
        "description": "Sample structure - replace with actual API data",
        "dataset": "CA21",
        "region": {
            "type": "CA",
            "code": "970",
            "name": "Prince George"
        },
        "level": "DA",
        "vectors": {
            "v_CA21_1": "Population, 2021",
            "v_CA21_2": "Population, 2016",
            "v_CA21_3": "Population percentage change, 2016 to 2021",
            "v_CA21_4": "Total private dwellings",
            "v_CA21_6": "Population density per square kilometre",
            "v_CA21_7": "Land area in square kilometres",
        },
        "sample_record": {
            "GeoUID": "59530001",
            "Type": "DA",
            "Region Name": "Dissemination Area 59530001",
            "v_CA21_1": 523,
            "v_CA21_2": 498,
            "v_CA21_3": 5.02,
            "v_CA21_4": 215,
            "v_CA21_6": 1245.6,
            "v_CA21_7": 0.42,
        },
        "note": "To get real data, provide your CensusMapper API key",
        "api_signup": "https://censusmapper.ca/api"
    }

    save_to_json(sample_data, "prince_george_da_sample.json")
    print("\nCreated: prince_george_da_sample.json")
    print("This shows the expected data structure.")


if __name__ == "__main__":
    main()
