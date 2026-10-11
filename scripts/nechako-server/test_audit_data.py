"""Offline checks for audit transport, sizing and native attachment behavior."""

import io
import json
import unittest
import urllib.request
from email.message import Message

from audit_data import Client, HttpsRedirects, attachment_summary, portal_attachment, zotero_inventory


class Response(io.BytesIO):
    def __init__(self, body=b'', **headers):
        super().__init__(body)
        self.read_calls = 0
        self.status = 200
        self.headers = Message()
        for key, value in headers.items():
            self.headers[key] = value

    def read(self, *args):
        self.read_calls += 1
        return super().read(*args)


class Opener:
    def __init__(self, response):
        self.response = response
        self.request = None

    def open(self, request, **_kwargs):
        self.request = request
        return self.response


class AuditTests(unittest.TestCase):
    def test_http_200_business_error_is_failure(self):
        client = Client()
        client.opener = Opener(Response(json.dumps({
            'success': True, 'status': 'failure', 'error': 'Website not registered',
        }).encode()))
        data, check, _ = client.json('https://example.org/projects', {'mode': 'list'})
        self.assertIsNone(data)
        self.assertFalse(check['ok'])
        self.assertEqual(check['http_status'], 200)
        self.assertEqual(check['error'], 'Website not registered')
        self.assertEqual(client.opener.request.data, b'mode=list')

    def test_json_size_bound_marks_inventory_incomplete(self):
        import audit_data
        from unittest.mock import patch
        client = Client()
        client.opener = Opener(Response(b'[1234567890]'))
        with patch.object(audit_data, 'MAX_JSON_BYTES', 10):
            _, check, _ = client.json('https://example.org/data')
        self.assertFalse(check['ok'])
        self.assertIn('incomplete', check['error'])

    def test_html_length_is_not_attachment_size_and_body_is_not_read(self):
        client = Client()
        response = Response(b'login page', **{'Content-Type': 'text/html', 'Content-Length': '1234'})
        client.opener = Opener(response)
        check = client.head('https://example.org/file')
        self.assertEqual(check['status'], 'landing_page_or_nonfile')
        self.assertNotIn('size_bytes', check)
        self.assertEqual(response.read_calls, 0)
        self.assertEqual(client.opener.request.get_method(), 'HEAD')

    def test_file_headers_measure_identity_bytes_only(self):
        client = Client()
        client.opener = Opener(Response(**{'Content-Type': 'application/pdf', 'Content-Length': '1234'}))
        self.assertEqual(client.head('https://example.org/file')['size_bytes'], 1234)
        client.opener = Opener(Response(**{'Content-Type': 'application/pdf', 'Content-Length': '234', 'Content-Encoding': 'gzip'}))
        self.assertNotIn('size_bytes', client.head('https://example.org/file'))

    def test_redirect_preserves_head_and_rejects_http_downgrade(self):
        req = urllib.request.Request('https://example.org/file', method='HEAD')
        handler = HttpsRedirects()
        redirected = handler.redirect_request(req, None, 302, 'Found', {}, 'https://cdn.example.org/file')
        self.assertEqual(redirected.get_method(), 'HEAD')
        with self.assertRaises(ValueError):
            handler.redirect_request(req, None, 302, 'Found', {}, 'http://example.org/file')

    def test_post_download_and_unknown_units_not_treated_as_direct_file(self):
        item = portal_attachment({'name': 'Report.pdf', 'download': 'portal/download.php?id=42', 'size': 500}, 12)
        self.assertEqual(item['method'], 'POST')
        self.assertEqual(item['url'], 'https://nechakowatershed-portal.ca/rest/portal/download.php?id=42')
        self.assertIsNone(item['size_bytes'])
        other = portal_attachment({'url': 'https://example.org/file', 'size_bytes': 100})
        summary = attachment_summary([item, item, other, other])
        self.assertEqual(summary['attachment_references'], 4)
        self.assertEqual(summary['unique_resources'], 2)
        self.assertEqual(summary['known_bytes_subtotal'], 100)
        self.assertEqual(summary['resources_with_unknown_size'], 1)
        self.assertIsNone(summary['total_storage_bytes'])

    def test_truncated_catalogue_does_not_claim_complete_inventory(self):
        class FakeClient:
            def json(self, url):
                if '/top?' in url:
                    return [], {'ok': True, 'total_results': '1408'}, {}
                return [{'key': str(i), 'data': {}, 'links': {}} for i in range(100)], {'ok': True, 'total_results': '101'}, {}
        inventory, attachments = zotero_inventory(FakeClient(), 123, 1)
        self.assertFalse(inventory['catalogue_complete'])
        self.assertEqual(inventory['advertised_attachments'], 101)
        self.assertEqual(len(attachments), 100)


if __name__ == '__main__':
    unittest.main()
