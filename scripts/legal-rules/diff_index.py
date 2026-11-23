#!/usr/bin/env python3
"""Diff two section inventories made by import_bclaws.py. No compliance interpretation."""
import argparse
import json
from pathlib import Path

def compare(before: dict, after: dict) -> dict:
    if before["sourceId"] != after["sourceId"]:
        raise ValueError("Cannot compare different statutes/regulations")
    old = {s["id"]: s for s in before["sections"]}
    new = {s["id"]: s for s in after["sections"]}
    return {
      "sourceId": before["sourceId"],
      "fromRetrievedAt": before["retrievedAt"],
      "toRetrievedAt": after["retrievedAt"],
      "added": sorted(set(new)-set(old)),
      "removed": sorted(set(old)-set(new)),
      "changed": sorted(k for k in set(old)&set(new)
                        if old[k]["canonicalTextSha256"] != new[k]["canonicalTextSha256"]),
      "note": "A text hash change is an investigation trigger; not proof of a change in legal effect."
    }

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("before",type=Path)
    p.add_argument("after",type=Path)
    args=p.parse_args()
    a=json.loads(args.before.read_text(encoding="utf-8"))
    b=json.loads(args.after.read_text(encoding="utf-8"))
    print(json.dumps(compare(a,b),indent=2))
if __name__=="__main__":
    main()
