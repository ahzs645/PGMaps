"""Publish a reviewed metadata-only catalogue and immutable source-image objects.

All real inputs and owner credentials belong outside the repository. The owner
configuration is read from a private file, never from command-line values.
Requires httpx. This command does not create or retain a Worker upload secret.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path
import re
import stat
import time
from urllib.parse import urlsplit

import httpx

from update_image_variants_catalogue import atomic_write, collection_base, prepared_variant

SHA = re.compile(r"^[a-f0-9]{64}$")
KEY = re.compile(r"^(?:raw|previews|sheets)/([a-f0-9]{64})\.[a-z0-9]+$")
ETAG = re.compile(r'^"[^"\r\n]+"$')
DOWNLOAD_METADATA = {"label", "role", "width", "height", "crs", "pixelSize", "mimeType", "sourceVariantId"}


def digest(path: Path) -> str:
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def protected_catalogue(value: dict) -> dict:
    result = copy.deepcopy(value)
    for group in ("items", "featured"):
        for item in result.get(group, []):
            item.pop("imageVariants", None)
            downloads = item.get("downloads", []) + ([item["download"]] if item.get("download") else [])
            for download in downloads:
                for field in DOWNLOAD_METADATA:
                    download.pop(field, None)
    return result


def validate_variant_references(before: dict, after: dict, objects: dict, base: str) -> None:
    """Only publish added sources whose exact files are present in this stage."""
    for group in ("items", "featured"):
        for old, new in zip(before.get(group, []), after.get(group, [])):
            old_variants, new_variants = old.get("imageVariants", []), new.get("imageVariants", [])
            if not isinstance(old_variants, list) or not isinstance(new_variants, list):
                raise ValueError("Image variants must be arrays")
            by_id = {}
            for variant in new_variants:
                if not isinstance(variant, dict) or not isinstance(variant.get("id"), str) or variant["id"] in by_id:
                    raise ValueError("Image variants need unique explicit identifiers")
                by_id[variant["id"]] = variant
            old_ids = set()
            for variant in old_variants:
                if not isinstance(variant, dict) or not isinstance(variant.get("id"), str):
                    raise ValueError("An existing image variant is invalid")
                if variant["id"] in old_ids or by_id.get(variant["id"]) != variant:
                    raise ValueError("Source publication must preserve every existing image variant")
                old_ids.add(variant["id"])
            for variant_id, value in by_id.items():
                if variant_id in old_ids:
                    continue
                variant = prepared_variant(value, base)
                for field in ("image", "thumbnail", "preview", "pyramid"):
                    descriptor = variant.get(field)
                    if descriptor is None:
                        continue
                    url = descriptor["url"]
                    key = url[len(base):] if url.startswith(base) else ""
                    entry = objects.get(key)
                    if (
                        entry is None or descriptor.get("sha256") != entry["sha256"]
                        or descriptor.get("bytes") != entry["bytes"]
                        or ("mimeType" in descriptor and descriptor["mimeType"] != entry["contentType"])
                    ):
                        raise ValueError("Every added source-image file must match a staged immutable object in this collection")
            native_downloads = new.get("downloads", []) + ([new["download"]] if new.get("download") else [])
            for download in native_downloads:
                if "sourceVariantId" in download and download["sourceVariantId"] not in by_id:
                    raise ValueError("A rectified download refers to an unavailable source-image variant")


def validate_stage(stage_path: Path) -> tuple[dict, bytes, list[dict]]:
    stage = json.loads(stage_path.read_text())
    if stage.get("schema") != "pgmaps-image-variant-publication-v1":
        raise ValueError("Unsupported image-variant publication stage")
    base = stage_path.parent
    before_path, after_path = base/stage["beforeCatalogue"], base/stage["afterCatalogue"]
    before_bytes, body = before_path.read_bytes(), after_path.read_bytes()
    if hashlib.sha256(before_bytes).hexdigest() != stage.get("beforeSha256") or hashlib.sha256(body).hexdigest() != stage.get("afterSha256"):
        raise ValueError("A staged catalogue changed after review")
    before, after = json.loads(before_bytes), json.loads(body)
    if before.get("schema") != "raster-catalog-v1" or after.get("schema") != "raster-catalog-v1":
        raise ValueError("Source-image publication requires raster-catalog-v1 catalogues")
    if protected_catalogue(before) != protected_catalogue(after):
        raise ValueError("Source-image publication cannot change geography, maps or saved projects")
    if not 0 < len(body) <= 6_000_000:
        raise ValueError("The catalogue exceeds the viewer's transfer budget")
    objects = {}
    for manifest_name in stage.get("uploadManifests", []):
        manifest_path = base/manifest_name
        manifest = json.loads(manifest_path.read_text())
        for entry in manifest.get("objects", []):
            key, checksum = entry.get("key", ""), entry.get("sha256", "")
            match = KEY.fullmatch(key)
            if not match or not SHA.fullmatch(checksum) or match.group(1) != checksum:
                raise ValueError("Objects must use their exact content-addressed image keys")
            path = (manifest_path.parent/entry["path"]).resolve()
            if not path.is_relative_to(manifest_path.parent.resolve()):
                raise ValueError("An object path escapes its prepared directory")
            if path.stat().st_size != entry["bytes"] or not 0 < entry["bytes"] < 95_000_000 or digest(path) != checksum:
                raise ValueError("A prepared object differs from its verified manifest")
            if key in objects and any(objects[key][field] != entry[field] for field in ("sha256", "bytes", "contentType")):
                raise ValueError("Conflicting immutable objects")
            objects[key] = {**entry, "localPath": path}
    if not objects:
        raise ValueError("The stage has no prepared image objects")
    validate_variant_references(before, after, objects, collection_base(stage.get("collectionBase")))
    return stage, body, list(objects.values())


def owner_base(config: dict) -> tuple[str, str]:
    endpoint = str(config.get("endpoint", "")).rstrip("/")
    parsed = urlsplit(endpoint)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
        raise ValueError("The owner endpoint must be an HTTPS origin")
    if not re.fullmatch(r"[A-Za-z0-9_-]{43}", config.get("shareId", "")) or not config.get("uploadToken"):
        raise ValueError("Invalid owner upload configuration")
    return endpoint, f"{endpoint}/c/{config['shareId']}/"


def checked(response: httpx.Response, operation: str) -> None:
    if not response.is_success:
        raise RuntimeError(f"{operation} failed (HTTP {response.status_code}); no credentials are included in this report")


def publish(stage_path: Path, config: dict, *, client=None, receipt_path: Path | None = None) -> dict:
    stage, body, objects = validate_stage(stage_path)
    endpoint, base = owner_base(config)
    if stage.get("collectionBase") != base:
        raise ValueError("Owner configuration names a different collection")
    if receipt_path:
        inputs = {
            stage_path.resolve(), (stage_path.parent/stage["beforeCatalogue"]).resolve(),
            (stage_path.parent/stage["afterCatalogue"]).resolve(),
            *((stage_path.parent/name).resolve() for name in stage.get("uploadManifests", [])),
            *(entry["localPath"].resolve() for entry in objects),
        }
        if receipt_path.resolve() in inputs:
            raise ValueError("Publication receipt must preserve every staged input")
        receipt_path.parent.mkdir(parents=True, exist_ok=True)
    own_client = client is None
    client = client or httpx.Client(timeout=180, follow_redirects=False, headers={"Accept-Encoding":"identity", "User-Agent":"PGMaps-source-variants/1.0"})
    receipt = {"schema":"pgmaps-image-variant-publication-receipt-v1", "activated":False, "beforeSha256":stage["beforeSha256"], "afterSha256":stage["afterSha256"], "objects":[], "geometryChanged":False, "savedProjectsChanged":False}

    def save():
        if receipt_path:
            atomic_write(receipt_path, (json.dumps(receipt,indent=2)+"\n").encode())

    def current():
        response = client.get(base+"catalog.json", params={"owner_review":time.time_ns()})
        checked(response,"Catalogue read")
        return response

    def verify(entry):
        response = client.head(base+entry["key"],params={"verify":entry["sha256"]})
        checked(response,"Object verification")
        if response.headers.get("X-Content-SHA256") != entry["sha256"] or response.headers.get("Content-Length") != str(entry["bytes"]):
            raise RuntimeError("Published object checksum or byte count does not match")

    def upload(entry, payload, etag=None):
        headers={"Authorization":"Bearer "+config["uploadToken"],"Content-Type":entry["contentType"],"Content-Length":str(entry["bytes"]),"X-Content-SHA256":entry["sha256"]}
        if etag is not None:headers["If-Match"]=etag
        response=client.put(f"{endpoint}/__upload/{config['shareId']}/{entry['key']}",headers=headers,content=payload)
        checked(response,"Owner upload")
        returned=response.json()
        if returned.get("sha256") != entry["sha256"] or returned.get("bytes") != entry["bytes"]:
            raise RuntimeError("Owner upload receipt differs from the staged object")
        verify(entry)

    try:
        initial=current()
        initial_sha=hashlib.sha256(initial.content).hexdigest()
        if initial_sha not in {stage["beforeSha256"],stage["afterSha256"]}:
            raise ValueError("The live catalogue changed; restage against its current revision")
        for entry in objects:
            lookup=client.head(base+entry["key"],params={"verify":entry["sha256"]})
            existed=lookup.status_code != 404
            if existed:
                verify(entry)
            else:
                with entry["localPath"].open("rb") as stream:upload(entry,stream)
            if entry["key"].endswith(".pmtiles"):
                for offset,length in ((0,min(16384,entry["bytes"])),(entry["bytes"]-1,1)):
                    response=client.get(base+entry["key"],headers={"Range":f"bytes={offset}-{offset+length-1}"})
                    if response.status_code!=206 or response.headers.get("Content-Range")!=f"bytes {offset}-{offset+length-1}/{entry['bytes']}":
                        raise RuntimeError("Source-image archive range delivery failed")
                    with entry["localPath"].open("rb") as file:
                        file.seek(offset)
                        if response.content!=file.read(length):raise RuntimeError("Source-image archive range bytes differ")
            receipt["objects"].append({"key":entry["key"],"sha256":entry["sha256"],"bytes":entry["bytes"],"alreadyExisted":existed,"verified":True})
            save()
        latest=current()
        latest_sha=hashlib.sha256(latest.content).hexdigest()
        if latest_sha==stage["afterSha256"]:
            receipt["alreadyActive"]=True
        else:
            if latest_sha!=stage["beforeSha256"]:raise ValueError("The live catalogue changed during upload; restage before activation")
            etag=latest.headers.get("ETag","")
            if not ETAG.fullmatch(etag):raise ValueError("A strong live catalogue ETag is required")
            upload({"key":"catalog.json","sha256":stage["afterSha256"],"bytes":len(body),"contentType":"application/json"},body,etag)
        final=current()
        if hashlib.sha256(final.content).hexdigest()!=stage["afterSha256"]:
            raise RuntimeError("Catalogue readback does not match the published revision")
        receipt.update(activated=True,verifiedObjectCount=len(objects),uploadedObjectCount=sum(not o["alreadyExisted"] for o in receipt["objects"]),totalObjectBytes=sum(o["bytes"] for o in objects),catalogueEtag=final.headers.get("ETag"),verifiedAt=time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()))
        save()
        return receipt
    except httpx.HTTPError:
        raise RuntimeError("Owner HTTP request failed; check connection and temporary upload settings") from None
    finally:
        if own_client:client.close()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage",required=True,type=Path)
    parser.add_argument("--owner-config-file",required=True,type=Path)
    parser.add_argument("--receipt",required=True,type=Path)
    parser.add_argument("--apply",action="store_true")
    args=parser.parse_args()
    if not args.apply:parser.error("Remote publication requires --apply")
    if args.receipt.resolve() == args.owner_config_file.resolve():
        parser.error("Publication receipt must preserve the owner configuration")
    if stat.S_IMODE(args.owner_config_file.stat().st_mode)&0o077:parser.error("Owner configuration must be readable only by its owner")
    result=publish(args.stage,json.loads(args.owner_config_file.read_text()),receipt_path=args.receipt)
    print(json.dumps({key:result[key] for key in ("activated","verifiedObjectCount","uploadedObjectCount","totalObjectBytes","afterSha256")}))


if __name__=="__main__":main()
