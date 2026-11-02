#!/usr/bin/env python3
"""Generate independent SQLite reference cases from pinned Castor R/SQL sources.

This does not execute R/SpaDES. SQL constraint ordering/limits and growth queries
are checked independently from the TypeScript engine; see README.md for limits.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
DATA = ROOT / "public/data/forestry-castor"
PINNED = {
    "upstream-forestryCastor.R": "a670ff8fc86ff88082bf1b6d7437760f4415439903c65da0f9e64e5459d034c8",
    "upstream-growingStockCastor.R": "48d9cd4cf1e2134f834ec18bb02be208f3e0e10c8698f0dba5f8438d9c739e67",
}
SAMPLE_SHA = "8d19a48acba51de568d6994b8b41c0d9b6d3533aa6ea8c7a0e3cd95afe23535d"


def read_verified(path: Path, sha: str) -> bytes:
    content = path.read_bytes()
    if hashlib.sha256(content).hexdigest() != sha:
        raise ValueError(f"Pinned source checksum differs: {path}")
    return content


def rows(connection: sqlite3.Connection, query: str, parameters=()) -> list[dict]:
    return [dict(row) for row in connection.execute(query, parameters)]


def generate() -> dict:
    sources = {
        name: read_verified(HERE / name, sha).decode()
        for name, sha in PINNED.items()
    }
    read_verified(DATA / "simple_castordb.sqlite", SAMPLE_SHA)
    sample = sqlite3.connect(f"file:{DATA / 'simple_castordb.sqlite'}?mode=ro", uri=True)
    sample.row_factory = sqlite3.Row

    # These order fragments are the literal, resolved SQL templates in
    # forestryCastor.R lines 257-414, with field/denominator names substituted.
    # No TypeScript implementation or output is used in generating expectations.
    cases = [
        dict(id="ge-age", type="ge", variable="age", threshold=120, percentage=50,
             order="CASE WHEN age >= :threshold THEN 0 ELSE 1 END, thlb, zone_const DESC, age DESC",
             sourceLines="302-319"),
        dict(id="le-age", type="le", variable="age", threshold=50, percentage=40,
             order="CASE WHEN age <= :threshold THEN 1 ELSE 0 END, thlb, zone_const DESC, age",
             sourceLines="398-415"),
        dict(id="ge-distance", type="ge", variable="dist", threshold=300, percentage=50,
             order="CASE WHEN dist >= :threshold THEN 0 ELSE 1 END, dist DESC, age DESC",
             sourceLines="257-272"),
        dict(id="le-distance", type="le", variable="dist", threshold=100, percentage=60,
             order="CASE WHEN dist <= :threshold THEN 1 ELSE 0 END, thlb, zone_const DESC, dist DESC",
             sourceLines="358-374"),
        dict(id="ge-multi", type="ge", variable="multi", threshold=0, percentage=50,
             condition="age >= 120 AND crownclosure >= 60",
             order="CASE WHEN age >= 120 AND crownclosure >= 60 THEN 0 ELSE 1 END, thlb, zone_const DESC, age DESC",
             sourceLines="276-298"),
        dict(id="le-multi", type="le", variable="multi", threshold=0, percentage=60,
             condition="age <= 50 OR crownclosure < 40",
             order="CASE WHEN age <= 50 OR crownclosure < 40 THEN 1 ELSE 0 END, thlb, zone_const DESC, age",
             sourceLines="377-394"),
        dict(id="ge-denominator", type="ge", variable="age", threshold=120, percentage=50,
             denominator="thlb > 0",
             order="CASE WHEN age >= :threshold THEN 0 ELSE 1 END, thlb, zone_const DESC, age DESC",
             sourceLines="239-249,302-319"),
        dict(id="le-eca", type="le", variable="eca", threshold=65, percentage=100,
             order="thlb, zone_const DESC, eca DESC", sourceLines="324-354"),
        dict(id="ge-zero", type="ge", variable="age", threshold=120, percentage=0,
             order="CASE WHEN age >= :threshold THEN 0 ELSE 1 END, thlb, zone_const DESC, age DESC",
             sourceLines="302-319"),
        dict(id="ge-existing-reservation", type="ge", variable="age", threshold=120, percentage=50,
             initialProtected=[3],
             order="CASE WHEN age >= :threshold THEN 0 ELSE 1 END, thlb, zone_const DESC, age DESC",
             sourceLines="302-319"),
    ]
    pixels = [
        dict(pixelid=1, own=1, zone1=1, age=200, thlb=1, dist=500, eca=0.1, crownclosure=80),
        dict(pixelid=2, own=1, zone1=1, age=160, thlb=0, dist=600, eca=0.1, crownclosure=20),
        dict(pixelid=3, own=1, zone1=1, age=130, thlb=1, dist=400, eca=0.2, crownclosure=70),
        dict(pixelid=4, own=1, zone1=1, age=90, thlb=1, dist=100, eca=0.6, crownclosure=65),
        dict(pixelid=5, own=1, zone1=1, age=40, thlb=1, dist=40, eca=1, crownclosure=35),
        dict(pixelid=6, own=1, zone1=1, age=15, thlb=1, dist=10, eca=1, crownclosure=25),
        dict(pixelid=7, own=0, zone1=1, age=150, thlb=1, dist=800, eca=0.05, crownclosure=90),
        dict(pixelid=8, own=1, zone1=2, age=180, thlb=1, dist=900, eca=0.1, crownclosure=75),
    ]
    for pixel in pixels:
        pixel["zone_const"] = 0

    reference_cases = []
    for case in cases:
        connection = sqlite3.connect(":memory:")
        connection.row_factory = sqlite3.Row
        connection.execute("CREATE TABLE pixels (pixelid INTEGER PRIMARY KEY, own INTEGER, zone1 INTEGER, age NUMERIC, thlb NUMERIC, dist NUMERIC, eca NUMERIC, crownclosure NUMERIC, zone_const INTEGER)")
        connection.executemany("INSERT INTO pixels VALUES (:pixelid,:own,:zone1,:age,:thlb,:dist,:eca,:crownclosure,:zone_const)", pixels)
        for pixel_id in case.get("initialProtected", []):
            connection.execute("UPDATE pixels SET zone_const = 1 WHERE pixelid = ?", (pixel_id,))
        denominator = (case.get("denominator", "1") + " AND zone1 = 1")
        t_area = connection.execute("SELECT COUNT(*) FROM pixels WHERE " + denominator).fetchone()[0]
        if case["variable"] == "eca":
            # R as.integer truncates toward zero, unlike SQLite ROUND.
            current = connection.execute("SELECT SUM(eca*thlb) FROM pixels WHERE zone1 = 1").fetchone()[0]
            limit = int((1 - (case["threshold"] / 100 - current / t_area)) * t_area)
            actual = current / t_area * 100
        else:
            fraction = case["percentage"] / 100 if case["type"] == "ge" else 1 - case["percentage"] / 100
            limit = connection.execute("SELECT CAST(ROUND(?,0) AS INTEGER)", (fraction * t_area,)).fetchone()[0]
            predicate = case.get("condition", f"{case['variable']} {'>=' if case['type'] == 'ge' else '<='} :threshold")
            actual = connection.execute("SELECT AVG(CASE WHEN " + predicate + " THEN 1 ELSE 0 END)*100 FROM pixels WHERE own = 1 AND " + denominator, {"threshold": case["threshold"]}).fetchone()[0]
        query = "SELECT pixelid FROM pixels WHERE own = 1 AND " + denominator + " ORDER BY " + case["order"] + " LIMIT :limits"
        selected = [r[0] for r in connection.execute(query, {"threshold": case["threshold"], "limits": limit})]
        reference_cases.append({**case, "zoneId": 1, "tAreaCells": t_area, "limitCells": limit,
                                "actualPercent": actual, "selectedPixelIds": selected,
                                "protectedPixelIds": sorted(set(selected) | set(case.get("initialProtected", []))),
                                "sql": query})

    # Execute the actual SQL string extracted from pinned growingStockCastor.R.
    growth_source = sources["upstream-growingStockCastor.R"]
    match = re.search(r'tab1<-data.table\(dbGetQuery\(sim\$castordb, "(WITH t as .*?;)"\)\)', growth_source, re.S)
    if not match:
        raise ValueError("Pinned growth query was not found")
    growth_sql = match.group(1)
    growth_db = sqlite3.connect(":memory:")
    sample.backup(growth_db)
    growth_db.row_factory = sqlite3.Row
    growth_db.execute("DELETE FROM pixels")
    ages = [0, 5, 10, 15.5, 20, 25, 35, 95, 141, 245, 250, 255, 350, 351]
    growth_inputs = []
    for index, age in enumerate(ages):
        values = dict(pixelid=index + 1, yieldid=1, age=age, height=10, crownclosure=60,
                      dec_pcnt=0, basalarea=0, qmd=0, eca=0.5, vol=None)
        growth_db.execute("INSERT INTO pixels (pixelid,yieldid,age,height,crownclosure,dec_pcnt,basalarea,qmd,eca,vol) VALUES (:pixelid,:yieldid,:age,:height,:crownclosure,:dec_pcnt,:basalarea,:qmd,:eca,:vol)", values)
        growth_inputs.append(values)
    growth_expected = rows(growth_db, growth_sql)

    # Source cumulative-prefix selection: an over-budget pixel does not get
    # skipped to admit later small pixels. Targets are period totals.
    queue_db = sqlite3.connect(":memory:")
    queue_db.row_factory = sqlite3.Row
    queue_db.execute("CREATE TABLE queue (pixelid INTEGER PRIMARY KEY, seqid INTEGER, vol_h NUMERIC, salvage_vol NUMERIC)")
    queue_rows = [(1, 1, 80, 5), (2, 2, 70, 10), (3, 3, 30, 20), (4, 4, 20, 5)]
    queue_db.executemany("INSERT INTO queue VALUES (?,?,?,?)", queue_rows)
    queue_cases = []
    for target in [0, 49, 80, 100, 149, 150, 180, 200]:
        query = "SELECT pixelid FROM (SELECT pixelid,seqid,SUM(vol_h) OVER(ORDER BY seqid ROWS UNBOUNDED PRECEDING) AS cvalue FROM queue) WHERE cvalue <= ? ORDER BY seqid"
        queue_cases.append(dict(targetM3=target, pixelIds=[r[0] for r in queue_db.execute(query, (target,))]))

    return {
        "schema": "pgmaps-castor-sql-reference-v1",
        "method": "Python standard-library SQLite executing resolved source SQL; no R/SpaDES execution or whole-model equivalence claimed.",
        "upstream": {
            "forestryCastor": "e2a580eb1fcc634780bb3599da7265a1e871484f",
            "growingStockCastor": "8ea945a91b4ec71d0ddd28714641b6dcae229c5c",
            "dataCastor": "884ce9d726942b3d2eae7b88120bd1b7ad863a19",
            "sourceSha256": PINNED, "sampleSha256": SAMPLE_SHA,
        },
        "constraintPixels": pixels, "constraints": reference_cases,
        "sqliteRounding": [dict(value=v, rounded=int(sample.execute("SELECT ROUND(?,0)", (v,)).fetchone()[0])) for v in [0, 0.5, 1.5, 2.5, 3.5, 4.49, 4.5]],
        "rMidpointRounding": [dict(periodLength=n, initialIncrement=max(1, round(n / 2))) for n in range(1, 11)],
        "growth": {"sql": growth_sql, "yieldRows": rows(sample, "SELECT * FROM yields ORDER BY yieldid,age"),
                   "pixels": growth_inputs, "expected": growth_expected,
                   "deliberateBrowserCorrection": "At or beyond the last yield knot, browser interpolation holds the endpoint. Upstream keeps the pre-existing value when the upper knot is absent, including a NULL initial volume at age 250."},
        "queue": {"rows": [dict(zip(["pixelid", "seqid", "vol_h", "salvage_vol"], row)) for row in queue_rows],
                  "cases": queue_cases, "sourceLines": "611-629", "note": "Checks cumulative-prefix selection after candidate construction. The upstream target/50 candidate cap is separately documented, not reproduced here."},
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="Verify the committed fixture without writing it")
    arguments = parser.parse_args()
    output = HERE / "sql-reference.json"
    content = json.dumps(generate(), indent=2, allow_nan=False) + "\n"
    if arguments.check:
        if output.read_text() != content:
            raise SystemExit("SQLite reference fixture differs; run generate.py and inspect the change")
        print("Verified pinned sources, original SQLite sample, and independent SQL fixture")
    else:
        output.write_text(content)
        print(f"Wrote {output.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
