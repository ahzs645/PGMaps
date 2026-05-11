#!/usr/bin/env python3
"""
Resumable downloader for Northern Health HealthSpace drinking-water data.

Downloads:
- active boil water / water quality notices
- drinking-water facility lists and optional inspection detail pages
- bacteriological sample histories
- chemical sample histories and optional result detail pages
"""

import argparse
import json
import re
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urljoin, urlparse, urlunparse

import requests
from bs4 import BeautifulSoup, NavigableString, Tag


BASE_URL = "https://www.healthspace.ca/Clients/NHA/NHA_Website.nsf/"
SITE_ROOT = "https://www.healthspace.ca"

DATASETS = {
    "drinking": {
        "city_list": "Water-Drinking-CityList?OpenView&Count=1000",
        "list_prefix": "Water-Drinking-List-ByName",
        "detail_prefix": "Water-Drinking-FacilityHistory",
        "file": "drinking_water_facilities.json",
    },
    "bacteriological": {
        "city_list": "Water-Samples-CityList?OpenView&Count=1000",
        "list_prefix": "Water-Samples-List-ByName",
        "detail_prefix": "Water-Samples-FacilityHistory",
        "file": "bacteriological_samples.json",
    },
    "chemical": {
        "city_list": "Water-Samples-Chemical-CityList?OpenView&Count=1000",
        "list_prefix": "Water-Samples-Chemical-List-ByName",
        "detail_prefix": "Water-Samples-Chemical-FacilityHistory",
        "file": "chemical_samples.json",
    },
}


def safe_name(name):
    return (
        name.lower()
        .replace("&", "and")
        .replace(".", "")
        .replace("'", "")
        .replace("(", "")
        .replace(")", "")
        .replace("-", "_")
        .replace("/", "_")
        .replace(" ", "_")
    )


def normalize_space(value):
    return re.sub(r"\s+", " ", value or "").strip()


def make_session():
    session = requests.Session()
    session.headers.update({
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/142.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Sec-Fetch-Dest": "frame",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin",
        "Referer": urljoin(BASE_URL, "water-drinking-frameset"),
    })
    return session


def fetch(session, url, retries=3):
    last_response = None
    for attempt in range(retries):
        response = session.get(url, timeout=30)
        last_response = response
        if "Let's confirm you are human" in response.text or "Complete the security check" in response.text:
            raise RuntimeError(
                "HealthSpace returned a human-verification challenge. "
                "Wait before retrying and use a larger --delay."
            )
        if response.status_code not in {403, 405, 429, 500, 502, 503, 504}:
            response.raise_for_status()
            return BeautifulSoup(response.text, "html.parser")
        if attempt < retries - 1:
            time.sleep(2 * (attempt + 1))
    last_response.raise_for_status()
    return BeautifulSoup(last_response.text, "html.parser")


def full_url(href):
    if href.startswith("/"):
        return urljoin(SITE_ROOT, href)
    return urljoin(BASE_URL, href)


def save_json(data, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def load_json_list(path):
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def set_query_param(url, key, value):
    parsed = urlparse(url)
    query = parse_qs(parsed.query, keep_blank_values=True)
    query[key] = [str(value)]
    return urlunparse(parsed._replace(query=urlencode(query, doseq=True)))


def extract_city_links(session, dataset):
    soup = fetch(session, urljoin(BASE_URL, DATASETS[dataset]["city_list"]))
    city_links = []
    for link in soup.find_all("a", href=True):
        href = link["href"]
        if DATASETS[dataset]["list_prefix"] not in href:
            continue
        city_links.append({
            "city": normalize_space(link.get_text(" ", strip=True)),
            "url": full_url(href),
        })
    return city_links


def parse_key_value_table(table):
    data = {}
    for row in table.find_all("tr"):
        cells = [normalize_space(cell.get_text(" ", strip=True)) for cell in row.find_all("td")]
        cells = [cell for cell in cells if cell]
        if not cells:
            continue
        if len(cells) == 1 and ":" in cells[0]:
            key, value = cells[0].split(":", 1)
            data[normalize_space(key).lower().replace(" ", "_")] = normalize_space(value)
        elif len(cells) >= 2:
            key = cells[0].rstrip(":").lower().replace(" ", "_").replace("-", "_")
            data[key] = cells[1]
    return data


def parse_table_rows(table):
    rows = []
    headers = []
    for row_index, row in enumerate(table.find_all("tr")):
        cells = [normalize_space(cell.get_text(" ", strip=True)) for cell in row.find_all(["th", "td"])]
        if row_index == 0:
            headers = [cell.lower().replace(".", "").replace(" ", "_") for cell in cells if cell]
            continue
        if not any(cells):
            continue
        rows.append(cells)
    return headers, rows


def parse_facility_list(soup, dataset, city):
    table = soup.find("table")
    if not table:
        return []

    facilities = []
    for row in table.find_all("tr")[1:]:
        cells = row.find_all("td")
        if not cells:
            continue
        link = row.find("a", href=True)
        if not link:
            continue

        non_empty = [normalize_space(cell.get_text(" ", strip=True)) for cell in cells]
        non_empty = [value for value in non_empty if value]
        if not non_empty:
            continue

        name = normalize_space(link.get_text(" ", strip=True))
        values = [value for value in non_empty if value != name]

        facility = {
            "dataset": dataset,
            "city": city,
            "name": name,
            "details_url": full_url(link["href"]),
            "scraped_at": datetime.now().isoformat(),
        }
        if values:
            facility["last_inspection"] = values[0]
        if len(values) >= 2:
            facility["hazard_rating"] = values[1]
        if len(values) >= 3:
            facility["advisory"] = values[2]

        facilities.append(facility)
    return facilities


def paginate_facility_list(session, first_url, dataset, city, delay):
    all_facilities = []
    start = 0
    count = 30

    while True:
        page_url = set_query_param(first_url, "Count", count)
        if start:
            page_url = set_query_param(page_url, "start", start)

        soup = fetch(session, page_url)
        page_facilities = parse_facility_list(soup, dataset, city)
        all_facilities.extend(page_facilities)

        if len(page_facilities) < count:
            break
        start += count
        time.sleep(delay)

    return all_facilities


def parse_drinking_detail(session, facility, fetch_inspections, delay):
    soup = fetch(session, facility["details_url"])
    detail = {}

    h2 = soup.find("h2")
    if h2:
        detail["facility_name"] = normalize_space(h2.get_text(" ", strip=True))

    text = soup.get_text("\n", strip=True)
    if "Facility Location:" in text:
        lines = [normalize_space(line) for line in text.splitlines()]
        location_lines = []
        capture = False
        for line in lines:
            if line == "Facility Location:":
                capture = True
                continue
            if capture and line.startswith("Facility Information"):
                break
            if capture and line:
                location_lines.append(line)
        if location_lines:
            detail["facility_location"] = ", ".join(location_lines)

    tables = soup.find_all("table")
    if tables:
        detail.update(parse_key_value_table(tables[0]))

    for table in tables:
        if "Underlying Problems:" in table.get_text(" ", strip=True):
            detail["notice_details"] = parse_key_value_table(table)
            break

    inspections = []
    for table in tables:
        if "Document Type" not in table.get_text(" ", strip=True):
            continue
        for row in table.find_all("tr")[1:]:
            cells = [normalize_space(cell.get_text(" ", strip=True)) for cell in row.find_all("td")]
            cells = [cell for cell in cells if cell]
            link = row.find("a", href=True)
            if not cells:
                continue
            inspection = {
                "document_type": cells[0],
                "details_url": full_url(link["href"]) if link else None,
            }
            if len(cells) >= 2:
                inspection["date"] = cells[1]
            if len(cells) >= 3:
                inspection["hazard_rating"] = cells[2]
            if fetch_inspections and inspection.get("details_url"):
                time.sleep(delay)
                inspection["details"] = parse_drinking_inspection(session, inspection["details_url"])
            inspections.append(inspection)
        break

    detail["inspections"] = inspections
    detail["details_fetched_at"] = datetime.now().isoformat()
    return detail


def parse_drinking_inspection(session, url):
    soup = fetch(session, url)
    inspection = {}
    h2 = soup.find("h2")
    if h2:
        inspection["title"] = normalize_space(h2.get_text(" ", strip=True))
    table = soup.find("table")
    if table:
        inspection.update(parse_key_value_table(table))
    page_text = soup.get_text(" ", strip=True)
    if "No violations were found" in page_text:
        inspection["violations"] = []
    return inspection


def parse_bacteriological_detail(session, facility, delay):
    samples = []
    next_url = facility["details_url"]
    current_start = 0
    page_size = 30

    while next_url:
        soup = fetch(session, next_url)
        tables = soup.find_all("table")

        for table in tables:
            if "Current Hazard Rating:" in table.get_text(" ", strip=True):
                facility.update(parse_key_value_table(table))

        sample_table = None
        for table in tables:
            if "Total Coliform" in table.get_text(" ", strip=True):
                sample_table = table
                break
        page_rows = []
        if sample_table:
            _, rows = parse_table_rows(sample_table)
            page_rows = rows
            for row in page_rows:
                if len(row) >= 5:
                    samples.append({
                        "location": row[0],
                        "date": row[1],
                        "total_coliform": row[2],
                        "fecal_coliform": row[3],
                        "e_coli": row[4],
                    })

        if len(page_rows) < page_size:
            break

        next_link = None
        for link in soup.find_all("a", href=True):
            href = full_url(link["href"])
            query = parse_qs(urlparse(href).query)
            start_values = query.get("start") or query.get("Start")
            if not start_values:
                continue
            try:
                link_start = int(start_values[0])
            except ValueError:
                continue
            if link_start > current_start:
                next_link = href
                current_start = link_start
                break
        if not next_link or next_link == next_url:
            break
        next_url = next_link
        time.sleep(delay)

    return {
        "samples": samples,
        "details_fetched_at": datetime.now().isoformat(),
    }


def parse_chemical_detail(session, facility, fetch_results, delay):
    soup = fetch(session, facility["details_url"])
    result_packages = []

    table = soup.find("table")
    if table:
        for row in table.find_all("tr")[1:]:
            cells = [normalize_space(cell.get_text(" ", strip=True)) for cell in row.find_all("td")]
            link = row.find("a", href=True)
            if len(cells) < 2:
                continue
            package = {
                "name": cells[0],
                "date": cells[1],
                "details_url": full_url(link["href"]) if link else None,
            }
            if fetch_results and package.get("details_url"):
                time.sleep(delay)
                package["results"] = parse_chemical_results(session, package["details_url"])
            result_packages.append(package)

    return {
        "chemical_result_packages": result_packages,
        "details_fetched_at": datetime.now().isoformat(),
    }


def parse_chemical_results(session, url):
    soup = fetch(session, url)
    results = []
    table = soup.find("table")
    if not table:
        return results
    for row in table.find_all("tr")[1:]:
        cells = [normalize_space(cell.get_text(" ", strip=True)) for cell in row.find_all("td")]
        if not cells:
            continue
        result = {"type": cells[0]}
        if len(cells) >= 2:
            result["value"] = cells[1]
        results.append(result)
    return results


def parse_notice_blocks(soup):
    card_notices = parse_notice_cards(soup)
    if card_notices:
        return card_notices

    notices = []
    for heading in soup.find_all("h5"):
        link = heading.find("a", href=True)
        if not link:
            continue

        notice_type = None
        previous = heading.find_previous("h6")
        if previous and not normalize_space(previous.get_text()).lower().startswith("start date"):
            notice_type = normalize_space(previous.get_text(" ", strip=True))

        location_bits = []
        details_table = None
        start_date = None

        next_heading = None
        for sibling in heading.next_siblings:
            if isinstance(sibling, NavigableString):
                text = normalize_space(str(sibling))
                if text:
                    location_bits.append(text)
                continue
            if not isinstance(sibling, Tag):
                continue
            if sibling.name == "table":
                details_table = sibling
                continue
            if sibling.name == "h6":
                text = normalize_space(sibling.get_text(" ", strip=True))
                if text.lower().startswith("start date"):
                    start_date = text.split(":", 1)[-1].strip()
                break
            if sibling.name in {"h5"}:
                next_heading = sibling
                break
            text = normalize_space(sibling.get_text(" ", strip=True))
            if text:
                location_bits.append(text)

        if not start_date:
            search_node = next_heading or heading
            for previous in search_node.find_all_previous("h6", limit=4):
                text = normalize_space(previous.get_text(" ", strip=True))
                if text.lower().startswith("start date"):
                    start_date = text.split(":", 1)[-1].strip()
                    break

        notice = {
            "notice_type": notice_type,
            "name": normalize_space(link.get_text(" ", strip=True)),
            "details_url": full_url(link["href"]),
            "scraped_at": datetime.now().isoformat(),
        }
        if location_bits:
            notice["location_summary"] = location_bits[0]
            if len(location_bits) >= 2:
                notice["connections"] = location_bits[1]
        if details_table:
            notice.update(parse_key_value_table(details_table))
        if start_date:
            notice["start_date"] = start_date
        notices.append(notice)
    return notices


def parse_notice_cards(soup):
    notices = []
    for card in soup.select("div.card"):
        link = card.find("a", href=True)
        if not link:
            continue
        header = card.find("h6", class_=re.compile(r"\bcard-header\b"))
        notice_type = normalize_space(header.get_text(" ", strip=True)) if header else None

        body = card.find("div", class_=re.compile(r"\bcard-body\b"))
        location_summary = None
        connections = None
        if body:
            body_text = body.get_text("\n", strip=True)
            body_lines = [normalize_space(line) for line in body_text.splitlines()]
            body_lines = [line for line in body_lines if line and line != normalize_space(link.get_text(" ", strip=True))]
            if body_lines:
                location_summary = body_lines[0]
            if len(body_lines) >= 2:
                connections = body_lines[1]

        start_date = None
        for footer in card.select(".card-footer h6, .card-footer"):
            text = normalize_space(footer.get_text(" ", strip=True))
            if text.lower().startswith("start date"):
                start_date = text.split(":", 1)[-1].strip()
                break

        notice = {
            "notice_type": notice_type,
            "name": normalize_space(link.get_text(" ", strip=True)),
            "details_url": full_url(link["href"]),
            "scraped_at": datetime.now().isoformat(),
        }
        if location_summary:
            notice["location_summary"] = location_summary
        if connections:
            notice["connections"] = connections

        table = card.find("table")
        if table:
            notice.update(parse_key_value_table(table))
        if start_date:
            notice["start_date"] = start_date
        notices.append(notice)
    return notices


def download_notices(session, output_dir):
    print("Downloading active water notices")
    soup = fetch(session, urljoin(BASE_URL, "Water-List-Boil?OpenView&count=1000"))
    notices = parse_notice_blocks(soup)
    output_path = output_dir / "active_water_notices.json"
    save_json(notices, output_path)
    print(f"Saved {len(notices)} notices to {output_path}")
    return {"dataset": "notices", "file": str(output_path), "count": len(notices)}


def merge_by_url(existing_records):
    return {record.get("details_url") or record.get("name"): record for record in existing_records}


def download_dataset(session, dataset, output_dir, city_filter, include_details, fetch_nested_details, delay, force):
    output_path = output_dir / DATASETS[dataset]["file"]
    existing = merge_by_url(load_json_list(output_path))
    city_links = extract_city_links(session, dataset)
    if city_filter:
        wanted = {city.lower() for city in city_filter}
        city_links = [item for item in city_links if item["city"].lower() in wanted]

    print(f"Downloading {dataset}: {len(city_links)} city/cities")
    all_records = dict(existing)

    for city_index, city_link in enumerate(city_links, start=1):
        city = city_link["city"]
        print(f"[{city_index}/{len(city_links)}] {city}")
        facilities = paginate_facility_list(session, city_link["url"], dataset, city, delay)

        for index, facility in enumerate(facilities, start=1):
            key = facility.get("details_url") or facility.get("name")
            current = dict(all_records.get(key, {}))
            current.update(facility)

            if include_details and (force or not current.get("details_fetched_at")):
                print(f"  [{index}/{len(facilities)}] {facility['name']}")
                try:
                    if dataset == "drinking":
                        current.update(parse_drinking_detail(session, current, fetch_nested_details, delay))
                    elif dataset == "bacteriological":
                        current.update(parse_bacteriological_detail(session, current, delay))
                    elif dataset == "chemical":
                        current.update(parse_chemical_detail(session, current, fetch_nested_details, delay))
                    current.pop("fetch_error", None)
                except Exception as exc:
                    current["fetch_error"] = str(exc)
                    current["fetch_error_at"] = datetime.now().isoformat()
                    print(f"    ERROR: {exc}")
                time.sleep(delay)

            all_records[key] = current
            save_json(list(all_records.values()), output_path)

    print(f"Saved {len(all_records)} {dataset} records to {output_path}")
    return {"dataset": dataset, "file": str(output_path), "count": len(all_records)}


def parse_args():
    parser = argparse.ArgumentParser(description="Download HealthSpace water datasets.")
    parser.add_argument(
        "--dataset",
        choices=["all", "notices", "drinking", "bacteriological", "chemical"],
        default="all",
        help="Dataset to download",
    )
    parser.add_argument("--city", action="append", help="Limit city datasets to this city; repeatable")
    parser.add_argument("--output-dir", default="data/water", help="Directory for output JSON files")
    parser.add_argument("--basic-only", action="store_true", help="Skip facility/sample detail pages")
    parser.add_argument(
        "--nested-details",
        action="store_true",
        help="Also fetch drinking inspection details and chemical result values",
    )
    parser.add_argument("--delay", type=float, default=2.0, help="Delay between requests")
    parser.add_argument("--force", action="store_true", help="Refetch records already marked complete")
    return parser.parse_args()


def main():
    args = parse_args()
    session = make_session()
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    selected = ["notices", "drinking", "bacteriological", "chemical"]
    if args.dataset != "all":
        selected = [args.dataset]

    manifest = []
    if "notices" in selected:
        try:
            manifest.append(download_notices(session, output_dir))
        except Exception as exc:
            print(f"ERROR downloading notices: {exc}")
            manifest.append({"dataset": "notices", "status": "error", "error": str(exc)})

    for dataset in selected:
        if dataset == "notices":
            continue
        try:
            manifest.append(
                download_dataset(
                    session=session,
                    dataset=dataset,
                    output_dir=output_dir,
                    city_filter=args.city,
                    include_details=not args.basic_only,
                    fetch_nested_details=args.nested_details,
                    delay=args.delay,
                    force=args.force,
                )
            )
        except Exception as exc:
            print(f"ERROR downloading {dataset}: {exc}")
            manifest.append({"dataset": dataset, "status": "error", "error": str(exc)})

    save_json(manifest, output_dir / "water_download_manifest.json")
    print(f"Manifest: {output_dir / 'water_download_manifest.json'}")


if __name__ == "__main__":
    main()
