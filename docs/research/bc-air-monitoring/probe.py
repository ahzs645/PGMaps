#!/usr/bin/env python3
"""Read-only HTTPS/CORS diagnostic; no measurements are published by this probe.

Requires Python 3.10+ and curl. Optional --browser requires Python Playwright and
Chromium (system chromium is used when present, otherwise Playwright's install).
"""

import argparse
import asyncio
import concurrent.futures
import csv
import datetime
import http.server
import io
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import urllib.parse


def targets():
    entries = [
        {"name": name, "source": f"https://envistaweb.env.gov.bc.ca/aqo/csv/AQHIWeb-{name}.csv"}
        for name in ["Smithers", "Kamloops", "Comox-Valley"]
    ] + [{
        "name": "Station-E315110",
        "source": "https://www.env.gov.bc.ca/epd/bcairquality/aqo/csv/Hourly_Raw_Air_Data/Station/E315110.csv",
    }]
    for entry in entries:
        entry["url"] = "https://csv-parser.api.gov.bc.ca/?" + urllib.parse.urlencode({
            "source": entry["source"], "format": "json",
        })
    return entries


def recover(text):
    """Diagnostic for the observed PHP-prefix/JSON-array format only."""
    start = text.find('[{"')
    if start < 0:
        raise ValueError("Expected JSON array was not found")
    rows = json.loads(text[start:])
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        raise ValueError("Expected an array of record objects")
    return rows


def compare(name, rows, source_rows):
    identity = "DATE_PST" if name.startswith("Station-") else "AQHI_AREA"
    useful = [row for row in rows if row.get(identity)]
    normalize = lambda row: {key: "" if value is None else str(value) for key, value in row.items()}
    return {
        "recovered_rows": len(rows),
        "usable_rows": len(useful),
        "empty_rows_removed": len(rows) - len(useful),
        "direct_csv_rows": len(source_rows),
        "matches_direct_csv": [normalize(row) for row in useful] == [normalize(row) for row in source_rows],
    }


def fetch(url, origin):
    with tempfile.TemporaryDirectory() as directory:
        body_path, header_path = directory + "/body", directory + "/headers"
        result = subprocess.run([
            "curl", "-sS", "-L", "--connect-timeout", "8", "--max-time", "25",
            "--max-filesize", "5242880", "-H", "Origin: " + origin,
            "-D", header_path, "-o", body_path, url,
        ], capture_output=True, text=True, timeout=29)
        if result.returncode:
            raise RuntimeError(result.stderr.strip())
        with open(header_path, encoding="utf-8") as handle:
            blocks = [block for block in re.split(r"\r?\n\r?\n", handle.read()) if block.startswith("HTTP/")]
        lines = blocks[-1].splitlines()
        headers = {line.split(":", 1)[0].lower(): line.split(":", 1)[1].strip() for line in lines[1:] if ":" in line}
        with open(body_path, encoding="utf-8-sig") as handle:
            text = handle.read()
        return text, {
            "status": lines[0],
            "content_type": headers.get("content-type"),
            "allow_origin": headers.get("access-control-allow-origin"),
        }


def check(entry):
    result = dict(entry)
    source_rows = []
    try:
        source_text, result["source_http"] = fetch(entry["source"], "http://localhost:3000")
        source_rows = list(csv.DictReader(io.StringIO(source_text)))
        text, result["parser_http"] = fetch(entry["url"], "http://localhost:3000")
        result["php_deprecations"] = text.count("<b>Deprecated</b>")
        result["response_prefix"] = text[:180]
        try:
            json.loads(text)
            result["strict_json_succeeded"] = True
        except json.JSONDecodeError as error:
            result["strict_json_succeeded"] = False
            result["strict_json_error"] = str(error)
        result.update(compare(entry["name"], recover(text), source_rows))
    except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as error:
        result["error"] = str(error)
    return result, source_rows


class ProbePage(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        body = b"<!doctype html><title>HTTPS parser probe</title>"
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


async def browser_checks(entries, source_rows):
    from playwright.async_api import async_playwright

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), ProbePage)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://localhost:{server.server_address[1]}"
    try:
        async with async_playwright() as playwright:
            launch = {"headless": True, "args": ["--no-sandbox"]}
            chromium = shutil.which("chromium")
            if chromium:
                launch["executable_path"] = chromium
            proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("HTTP_PROXY")
            if proxy:
                launch["proxy"] = {"server": proxy, "bypass": "localhost,127.0.0.1"}
            async with await playwright.chromium.launch(**launch) as browser:
                context = await browser.new_context(ignore_https_errors=False)
                page = await context.new_page()
                await page.goto(origin)
                rows = await page.evaluate(r'''async entries => Promise.all(entries.map(async entry => {
                    const result = { name: entry.name };
                    try {
                        const response = await fetch(entry.url, {signal: AbortSignal.timeout(25000)});
                        const text = await response.clone().text();
                        result.status = response.status;
                        result.response_type = response.type;
                        try {
                            await response.json();
                            result.response_json_succeeded = true;
                        } catch (error) {
                            result.response_json_succeeded = false;
                            result.response_json_error = error.message;
                        }
                        const start = text.indexOf('[{"');
                        if (start < 0) throw new Error('Expected JSON array was not found');
                        result.data = JSON.parse(text.slice(start));
                    } catch (error) {
                        result.error = error.message;
                    }
                    return result;
                }))''', entries)
                for row in rows:
                    data = row.pop("data", None)
                    if data is not None:
                        row.update(compare(row["name"], data, source_rows[row["name"]]))
                return {"origin": origin, "browser": browser.version, "tls_verified": True, "cors_enforced": True, "tests": rows}
    finally:
        server.shutdown()
        server.server_close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser", action="store_true", help="Also test real browser fetch/JSON parsing")
    parser.add_argument("--out", help="Write the JSON diagnostic summary to this path")
    args = parser.parse_args()
    entries = targets()
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        checks = list(pool.map(check, entries))
    report = {
        "checked_at_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "http_origin": "http://localhost:3000",
        "http_tests": [result for result, _ in checks],
    }
    if args.browser:
        report["browser"] = asyncio.run(browser_checks(entries, {entry["name"]: rows for entry, rows in checks}))
    summary = json.dumps(report, indent=2) + "\n"
    if args.out:
        with open(args.out, "w", encoding="utf-8") as handle:
            handle.write(summary)
    print(summary, end="")
    # A network/payload/compare failure fails the probe. Raw JSON failure is an observed result.
    tests = report["http_tests"] + report.get("browser", {}).get("tests", [])
    return 0 if all(test.get("matches_direct_csv") is True for test in tests) else 1


if __name__ == "__main__":
    raise SystemExit(main())
