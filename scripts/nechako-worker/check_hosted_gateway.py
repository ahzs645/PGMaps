#!/usr/bin/env python3
"""Bounded, read-only live acceptance of the hosted Nechako connection.

Run ONLY after deployment is confirmed. This does not upload, edit, or save
source records. Only our own ephemeral sessions are created/signed in/revoked.
Downloads stay in RAM; output contains labels, counts and sizes, never bodies,
cookies, capabilities or credentials. Optional authentication uses
NECHAKO_CHECK_USERNAME and NECHAKO_CHECK_PASSWORD (both required together).

    python3 scripts/nechako-worker/check_hosted_gateway.py --self-test
    python3 scripts/nechako-worker/check_hosted_gateway.py
    python3 scripts/nechako-worker/check_hosted_gateway.py --idle-only --idle-seconds 35
"""

import argparse
import csv
import io
import json
import os
import re
import socket
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from dataclasses import dataclass

DEFAULT_BASE = "https://pgmaps-nechako-portal.ahzs645.workers.dev/api/nechako-portal"
ORIGIN = "https://pgmaps.ahmadjalil.com"
JSON_LIMIT = 20 * 1024 * 1024
FILE_LIMIT = 32 * 1024 * 1024
TOTAL_LIMIT = 96 * 1024 * 1024
EXPANDED_ZIP_LIMIT = 128 * 1024 * 1024
TOKEN = re.compile(r"[A-Za-z0-9_-]{43}\Z")


class CheckFailure(Exception):
    """Messages must be authored locally, never interpolated source content."""


def require(condition, message):
    if not condition:
        raise CheckFailure(message)


@dataclass
class Reply:
    status: int
    headers: dict
    body: bytes

    def json(self):
        try:
            value = json.loads(self.body)
        except (ValueError, UnicodeError):
            raise CheckFailure("Response is not valid JSON") from None
        require(isinstance(value, dict), "Response envelope is not an object")
        return value


@dataclass
class Note:
    """Explicitly safe, locally computed public counts/sizes for console output."""
    text: str


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


class Gateway:
    def __init__(self, base, timeout=45, budget_seconds=600):
        parsed = urllib.parse.urlsplit(base)
        require(parsed.scheme == "https" and parsed.hostname and not parsed.username
                and not parsed.password and not parsed.query and not parsed.fragment
                and parsed.path.rstrip("/") == "/api/nechako-portal",
                "Base must be an HTTPS gateway URL without credentials or query")
        self.base = base.rstrip("/")
        self.timeout = timeout
        self.deadline = time.monotonic() + budget_seconds
        self.received = 0
        # No cookie jar: the gateway capability is the sole client credential.
        self.opener = urllib.request.build_opener(NoRedirect())

    def call(self, action, payload=None, token=None, method=None, origin=ORIGIN, extra=None):
        require(action in {"status", "read", "download", "login", "disconnect"},
                "Unexpected acceptance action")
        remaining = self.deadline - time.monotonic()
        require(remaining > 0, "Overall acceptance time limit reached")
        headers = {"User-Agent": "PGMaps-Nechako-Acceptance/1.0"}
        if origin is not None:
            headers["Origin"] = origin
        if token is not None:
            headers["X-Nechako-Session"] = token
        data = None
        if payload is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(payload, separators=(",", ":")).encode()
        headers.update(extra or {})
        request = urllib.request.Request(self.base + "/" + action, data=data,
                                         headers=headers, method=method or ("POST" if data is not None else "GET"))
        maximum = FILE_LIMIT if action == "download" else JSON_LIMIT
        try:
            try:
                response = self.opener.open(request, timeout=min(self.timeout, remaining))
            except urllib.error.HTTPError as error:
                response = error
            with response:
                raw_length = response.headers.get("Content-Length")
                if raw_length is not None:
                    try:
                        declared = int(raw_length)
                    except ValueError:
                        raise CheckFailure("Invalid declared response size") from None
                    require(0 <= declared <= maximum, "Declared response exceeds acceptance size limit")
                chunks, size = [], 0
                while True:
                    require(time.monotonic() < self.deadline, "Overall acceptance time limit reached")
                    chunk = response.read(min(65536, maximum - size + 1))
                    if not chunk:
                        break
                    size += len(chunk)
                    self.received += len(chunk)
                    require(size <= maximum and self.received <= TOTAL_LIMIT,
                            "Response or aggregate acceptance size limit reached")
                    chunks.append(chunk)
                return Reply(response.status, {k.lower(): v for k, v in response.headers.items()}, b"".join(chunks))
        except (urllib.error.URLError, TimeoutError, socket.timeout, OSError):
            raise CheckFailure("Gateway network request failed or timed out") from None


def common(reply, expected=200):
    require(reply.status == expected, "Unexpected HTTP status (%d)" % reply.status)
    require(reply.headers.get("access-control-allow-origin") == ORIGIN, "Expected exact allowed CORS origin")
    require("origin" in reply.headers.get("vary", "").lower(), "Missing Origin cache separation")
    require(reply.headers.get("cache-control") == "no-store", "Response must be no-store")
    require("set-cookie" not in reply.headers, "Source cookies must not leave the gateway")
    require("access-control-allow-credentials" not in reply.headers, "Gateway must not use browser cookie credentials")
    require(reply.headers.get("x-content-type-options") == "nosniff", "Missing content-type protection")


def status_value(reply, logged_in, is_admin=None):
    common(reply)
    value = reply.json()
    require(value.get("schema") == "nechako-hosted-connection-v1" and value.get("available") is True,
            "Missing hosted status contract")
    require(value.get("loggedIn") is logged_in and value.get("readOnly") is True
            and value.get("canWrite") is False and type(value.get("isAdmin")) is bool
            and (logged_in or value.get("isAdmin") is False)
            and (is_admin is None or value.get("isAdmin") is is_admin),
            "Unexpected identity or write capability")
    require("attributes" not in value, "Status must not expose native identity attributes")
    require(value.get("sessionReset") is not True, "Source session unexpectedly reset")
    return value


def source_value(reply, logged_in=False):
    common(reply)
    value = reply.json()
    require(value.get("status") == "success" and value.get("success") is not False
            and not value.get("error") and value.get("loggedIn") is logged_in,
            "Source read was denied, invalid or had unexpected identity")
    require("attributes" in value, "Source read has no attributes")
    return value["attributes"]


def revoked(reply):
    common(reply, 401)
    value = reply.json()
    require(value.get("sessionExpired") is True and value.get("loggedIn") is False,
            "Old capability is not explicitly revoked")


def rows(value):
    require(isinstance(value, list) and len(value) <= 10000
            and all(isinstance(item, dict) for item in value), "Invalid native resource list")
    return value


def check_file(reply, mode, submission_id):
    common(reply)
    extension = "zip" if mode == "files" else mode
    require(reply.headers.get("content-disposition") ==
            'attachment; filename="nechako-original-submission-%s.%s"' % (submission_id, extension),
            "Unexpected controlled download name")
    mime = {"pdf": "application/pdf", "html": "text/html", "csv": "text/csv", "files": "application/zip"}[mode]
    require(reply.headers.get("content-type", "").split(";")[0] == mime, "Unexpected download MIME type")
    require(reply.headers.get("content-security-policy") == "sandbox; default-src 'none'",
            "Native document must be sandboxed")
    body = reply.body
    require(0 < len(body) <= FILE_LIMIT, "Empty or oversized native download")
    if "content-length" in reply.headers:
        require(reply.headers["content-length"] == str(len(body)), "Download length mismatch")
    if mode == "pdf":
        require(body.startswith(b"%PDF-") and b"%%EOF" in body[-4096:], "Invalid PDF signature or trailer")
    elif mode == "html":
        require(re.match(rb"\s*<(?:!doctype|html|head|body|link|style|div|h[12]|p|table)\b", body[:1024], re.I),
                "Invalid HTML document signature")
    elif mode == "csv":
        require(b"\0" not in body and not body.lstrip().startswith((b"<", b"{")), "CSV contains an error document")
        try:
            csv.field_size_limit(FILE_LIMIT)
            reader = csv.reader(io.StringIO(body.decode("utf-8-sig")), strict=True)
            count = sum(1 for _ in reader)
        except (UnicodeError, csv.Error):
            raise CheckFailure("Invalid UTF-8 CSV download") from None
        require(count > 0, "CSV has no rows")
        return "bytes=%d rows=%d" % (len(body), count)
    else:
        require(body.startswith((b"PK\x03\x04", b"PK\x05\x06")), "Invalid ZIP signature")
        try:
            with zipfile.ZipFile(io.BytesIO(body)) as archive:
                members = archive.infolist()
                require(0 < len(members) <= 10000, "ZIP must contain bounded source files")
                require(sum(item.file_size for item in members) <= EXPANDED_ZIP_LIMIT,
                        "Expanded ZIP exceeds integrity-check size limit")
                expanded = 0
                for item in members:
                    require(not item.flag_bits & 1, "Unexpected encrypted ZIP member")
                    if item.is_dir():
                        continue
                    with archive.open(item) as stream:
                        while chunk := stream.read(65536):
                            expanded += len(chunk)
                            require(expanded <= EXPANDED_ZIP_LIMIT, "Expanded ZIP exceeds integrity-check size limit")
                # Reading each member to EOF verifies its CRC; nothing is extracted.
                return "bytes=%d members=%d CRC=verified" % (len(body), len(members))
        except (zipfile.BadZipFile, RuntimeError, NotImplementedError, OSError):
            raise CheckFailure("ZIP integrity check failed") from None
    return "bytes=%d" % len(body)


class Acceptance:
    def __init__(self, gateway, emit=print):
        self.gateway, self.emit = gateway, emit
        self.tokens = []
        self.passed, self.failed, self.skipped = 0, 0, 0

    def check(self, name, operation):
        try:
            detail = operation()
            self.passed += 1
            self.emit("PASS " + name + (" (" + detail.text + ")" if isinstance(detail, Note) else ""))
            return detail
        except CheckFailure as failure:
            self.failed += 1
            self.emit("FAIL " + name + ": " + str(failure))
        except Exception:
            # Never expose an exception whose representation might contain a body/header.
            self.failed += 1
            self.emit("FAIL " + name + ": unexpected response or local validation failure")
        return None

    def allocate(self):
        value = status_value(self.gateway.call("status", {}), False)
        token = value.get("sessionToken")
        require(isinstance(token, str) and TOKEN.fullmatch(token), "Invalid newly allocated capability")
        self.tokens.append(token)
        return token

    def read(self, token, endpoint, params):
        return self.gateway.call("read", {"path": "rest/portal/" + endpoint, "params": params}, token)

    def children(self, token, parent, expected):
        result = rows(source_value(self.read(token, "getChildren.php", {"parentId": parent})))
        require(len(result) == expected, "Native child count differs from verified expectation")
        return Note("rows=%d" % len(result))

    def run(self, username=None, password=None):
        def deny_origin(origin):
            reply = self.gateway.call("status", origin=origin)
            require(reply.status == 403 and "access-control-allow-origin" not in reply.headers,
                    "Foreign/missing Origin must be denied without CORS access")
        self.check("foreign Origin denied", lambda: deny_origin("https://untrusted.invalid"))
        self.check("missing Origin denied", lambda: deny_origin(None))

        def preflight():
            reply = self.gateway.call("read", method="OPTIONS", extra={
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "Content-Type, X-Nechako-Session"})
            common(reply, 204)
            require("x-nechako-session" in reply.headers.get("access-control-allow-headers", "").lower(),
                    "Capability header absent from allowed preflight")
            bad = self.gateway.call("read", method="OPTIONS", extra={
                "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "X-Unapproved"})
            common(bad, 403)
        self.check("allowed preflight and denied unapproved header", preflight)

        def peek():
            value = status_value(self.gateway.call("status"), False)
            require(value.get("tokenRequired") is True and "sessionToken" not in value,
                    "Status peek must not allocate a session")
        self.check("anonymous status peek has no token", peek)
        self.check("read without session denied", lambda: revoked(self.read(None, "getChildren.php", {"parentId": "9"})))
        first = self.check("allocate anonymous session A", self.allocate)
        second = self.check("allocate anonymous session B", self.allocate)
        if not first or not second:
            self.cleanup()
            return self.finish()
        try:
            self.check("independent capabilities", lambda: require(first != second, "Sessions share a capability"))
            self.check("anonymous A submission 9 children", lambda: self.children(first, "9", 0))
            self.check("anonymous B submission 69 children", lambda: self.children(second, "69", 2))

            def metadata():
                value = source_value(self.read(first, "getSubmissionMetadata.php", {"submissionId": "9"}))
                require(isinstance(value, dict) and str(value.get("submission_id")) == "9",
                        "Metadata does not match requested submission")
            self.check("anonymous native metadata", metadata)
            self.check("anonymous native history", lambda: Note("rows=%d" % len(rows(
                source_value(self.read(first, "getHistory.php", {"sub_id": "9"}))))))
            for mode in ("pdf", "html", "csv", "files"):
                sid = "745" if mode == "files" else "9"
                self.check("native %s download submission %s" % (mode.upper(), sid),
                           lambda mode=mode, sid=sid: Note(check_file(self.gateway.call("download", {
                               "submissionId": sid, "mode": mode}, first), mode, sid)))

            if username and password:
                def sign_in():
                    reply = self.gateway.call("login", {"username": username, "password": password}, first)
                    # Even a denied login may return a newly minted anonymous capability.
                    value = reply.json()
                    fresh = value.get("sessionToken")
                    if isinstance(fresh, str) and TOKEN.fullmatch(fresh):
                        self.tokens.append(fresh)
                    status_value(reply, True)
                    require(isinstance(fresh, str) and TOKEN.fullmatch(fresh) and fresh != first,
                            "Login did not rotate the capability")
                    return fresh
                fresh = self.check("authorized login rotates identity without native attributes", sign_in)
                self.check("pre-login token revoked", lambda: revoked(self.read(first, "getChildren.php", {"parentId": "9"})))
                self.check("other session remains anonymous after login", lambda: self.children(second, "69", 2))
                if fresh:
                    self.check("signed-in status remains read only", lambda: status_value(self.gateway.call("status", token=fresh), True))
                    first = fresh
            else:
                self.skipped += 1
                self.emit("SKIP authorized login/rotation: optional credential environment variables are unset")

            self.check("disconnect our session A", lambda: status_value(self.gateway.call("disconnect", {}, first), False))
            self.check("disconnected capability revoked", lambda: revoked(self.read(first, "getChildren.php", {"parentId": "9"})))
            self.check("disconnect does not affect anonymous session B", lambda: self.children(second, "69", 2))
        finally:
            self.cleanup()
        return self.finish()

    def cleanup(self):
        # Idempotent disconnect affects only capabilities minted by this run.
        for token in set(self.tokens):
            self.check("cleanup own capability", lambda token=token:
                       status_value(self.gateway.call("disconnect", {}, token), False))
        self.tokens.clear()

    def idle_check(self, seconds=35):
        require(11 <= seconds <= 60, "Idle acceptance interval must be between 11 and 60 seconds")
        first = second = None
        try:
            first = self.check("allocate idle session A", self.allocate)
            second = self.check("allocate idle session B", self.allocate)
            if first and second:
                self.check("idle A baseline source", lambda: self.children(first, "9", 0))
                self.check("idle B baseline source", lambda: self.children(second, "69", 2))
                if not self.failed:
                    self.emit("WAIT idle interval seconds=%d; no requests or expiry extension" % seconds)
                    time.sleep(seconds)
                    # Status alone could acknowledge a cold reset. Explicitly reject
                    # sessionReset before reading, so this cannot conceal lost jars.
                    self.check("idle A status retained", lambda: status_value(self.gateway.call("status", token=first), False))
                    self.check("idle B status retained", lambda: status_value(self.gateway.call("status", token=second), False))
                    self.check("idle A source retained", lambda: self.children(first, "9", 0))
                    self.check("idle B source retained", lambda: self.children(second, "69", 2))
        finally:
            self.cleanup()
        return self.finish()

    def finish(self):
        self.emit("RESULT passed=%d failed=%d skipped=%d receivedBytes=%d" %
                  (self.passed, self.failed, self.skipped, self.gateway.received))
        return 1 if self.failed else 0


class OfflineTests(unittest.TestCase):
    def reply(self, value, status=200):
        return Reply(status, {"access-control-allow-origin": ORIGIN, "vary": "Origin", "cache-control": "no-store",
                              "x-content-type-options": "nosniff"}, json.dumps(value).encode())

    def test_source_rejects_contradictory_success_and_wrong_identity(self):
        for extra in ({"success": False}, {"loggedIn": True}, {"error": "private fixture"}):
            with self.assertRaises(CheckFailure):
                source_value(self.reply({"status": "success", "loggedIn": False, "attributes": [], **extra}))

    def test_valid_empty_children_are_not_a_failure(self):
        self.assertEqual(rows(source_value(self.reply({"status": "success", "loggedIn": False, "attributes": []}))), [])
        with self.assertRaises(CheckFailure):
            rows({"results": []})

    def test_cookies_and_nonreadonly_status_fail(self):
        reply = self.reply({"schema": "nechako-hosted-connection-v1", "available": True, "loggedIn": False,
                            "readOnly": True, "canWrite": False, "isAdmin": False})
        status_value(reply, False)
        reply.headers["set-cookie"] = "fixture-never-log"
        with self.assertRaises(CheckFailure):
            status_value(reply, False)

    def test_admin_read_flag_does_not_imply_write_access_or_anonymous_privileges(self):
        value = {"schema": "nechako-hosted-connection-v1", "available": True,
                 "loggedIn": True, "readOnly": True, "canWrite": False, "isAdmin": True}
        status_value(self.reply(value), True, is_admin=True)
        for changes, logged_in in [({"canWrite": True}, True), ({"readOnly": False}, True),
                                   ({"loggedIn": False}, False), ({"isAdmin": "true"}, True)]:
            with self.subTest(changes=changes), self.assertRaises(CheckFailure):
                status_value(self.reply({**value, **changes}), logged_in)

    def test_base_url_rejects_embedded_credentials_and_queries(self):
        for base in ("http://example.com/api/nechako-portal", "https://user:secret@example.com/api/nechako-portal",
                     DEFAULT_BASE + "?token=secret"):
            with self.assertRaises(CheckFailure):
                Gateway(base)

    def file_reply(self, body, mode):
        reply = self.reply({})
        reply.body = body
        ext = "zip" if mode == "files" else mode
        reply.headers.update({"content-disposition": 'attachment; filename="nechako-original-submission-9.%s"' % ext,
                              "content-type": {"pdf": "application/pdf", "html": "text/html", "csv": "text/csv",
                                               "files": "application/zip"}[mode],
                              "content-security-policy": "sandbox; default-src 'none'", "content-length": str(len(body))})
        return reply

    def test_error_documents_cannot_pass_as_files(self):
        for mode in ("pdf", "html", "csv", "files"):
            with self.assertRaises(CheckFailure):
                check_file(self.file_reply(b'{"error":"private fixture"}', mode), mode, "9")

    def test_zip_crc_and_csv_checks(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_STORED) as archive:
            archive.writestr("fixture.txt", "public fixture")
        self.assertIn("CRC=verified", check_file(self.file_reply(buffer.getvalue(), "files"), "files", "9"))
        corrupt = buffer.getvalue().replace(b"public fixture", b"broken fixture")
        with self.assertRaises(CheckFailure):
            check_file(self.file_reply(corrupt, "files"), "files", "9")
        self.assertIn("rows=2", check_file(self.file_reply(b"id,value\n1,0\n", "csv"), "csv", "9"))

    def test_error_output_does_not_echo_unexpected_exception(self):
        output = []
        acceptance = Acceptance(None, output.append)
        acceptance.check("fixture", lambda: (_ for _ in ()).throw(ValueError("PRIVATE TOKEN FIXTURE")))
        self.assertNotIn("PRIVATE TOKEN FIXTURE", " ".join(output))

    def test_operation_returned_tokens_are_never_logged(self):
        output = []
        acceptance = Acceptance(None, output.append)
        value = "X" * 43
        self.assertEqual(acceptance.check("allocate fixture", lambda: value), value)
        self.assertNotIn(value, " ".join(output))

    def test_idle_status_rejects_reset_even_if_identity_is_anonymous(self):
        with self.assertRaises(CheckFailure):
            status_value(self.reply({"schema": "nechako-hosted-connection-v1", "available": True,
                                     "loggedIn": False, "readOnly": True, "canWrite": False,
                                     "isAdmin": False, "sessionReset": True}), False)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base-url", default=DEFAULT_BASE)
    parser.add_argument("--timeout", type=int, default=45, help="Per-request timeout, 1–60 seconds")
    parser.add_argument("--self-test", action="store_true", help="Offline checks only; no gateway/source requests")
    parser.add_argument("--idle-only", action="store_true", help="Check two anonymous sessions across a bounded idle interval")
    parser.add_argument("--idle-seconds", type=int, default=35, help="Idle-only interval, 11–60 seconds (default: 35)")
    args = parser.parse_args()
    if args.self_test:
        suite = unittest.defaultTestLoader.loadTestsFromTestCase(OfflineTests)
        return 0 if unittest.TextTestRunner(verbosity=1).run(suite).wasSuccessful() else 1
    if not 1 <= args.timeout <= 60:
        parser.error("timeout must be between 1 and 60 seconds")
    if not 11 <= args.idle_seconds <= 60:
        parser.error("idle-seconds must be between 11 and 60 seconds")
    username, password = os.environ.get("NECHAKO_CHECK_USERNAME"), os.environ.get("NECHAKO_CHECK_PASSWORD")
    if bool(username) != bool(password):
        parser.error("set both optional credential environment variables together")
    try:
        acceptance = Acceptance(Gateway(args.base_url, args.timeout))
        return acceptance.idle_check(args.idle_seconds) if args.idle_only else acceptance.run(username, password)
    except CheckFailure as failure:
        print("FAIL acceptance setup: " + str(failure))
        return 1
    except KeyboardInterrupt:
        print("FAIL acceptance interrupted; ephemeral sessions expire automatically")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
