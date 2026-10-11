"""Exercise the candidate PHP middleware using an isolated synthetic handler.
Usage: python3 scripts/nechako-server/test_cors.py /path/to/php
This is patch verification, not evidence that the live portal has been changed.
"""
import json
import os
import pathlib
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request


class CorsPatchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix='nechako-php-cors-')
        root = pathlib.Path(cls.directory.name)
        patch = pathlib.Path(__file__).with_name('cors.inc.php').resolve()
        cls.php = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] != '-v' else 'php'
        with socket.socket() as instance:
            instance.bind(('127.0.0.1', 0))
            port = instance.getsockname()[1]
        cls.url = f'http://127.0.0.1:{port}'
        router = root / 'router.php'
        router.write_text('<?php\nrequire ' + json.dumps(str(patch)) + ';\nheader("Content-Type: application/json");\nif (isset($_GET["error"])) http_response_code(401);\necho json_encode(["handlerRan" => true, "fields" => $_POST]);\n')
        environment = {**os.environ, 'NECHAKO_ALLOWED_ORIGINS': 'https://pgmaps.ahmadjalil.com,https://nechakowatershed-portal.ca,http://127.0.0.1:42173'}
        cls.process = subprocess.Popen([cls.php, '-n', '-S', f'127.0.0.1:{port}', str(router)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=environment)
        cls.client = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        for _ in range(30):
            try:
                cls.client.open(cls.url, timeout=1).close()
                return
            except OSError:
                if cls.process.poll() is not None:
                    raise RuntimeError('PHP test server failed to start.')
                time.sleep(0.1)
        raise RuntimeError('PHP test server did not become ready.')

    @classmethod
    def tearDownClass(cls):
        cls.process.terminate()
        cls.process.wait(timeout=5)
        cls.directory.cleanup()

    def request(self, method='GET', headers=None, body=None, query=''):
        request = urllib.request.Request(self.url + query, method=method, headers=headers or {}, data=body)
        try:
            response = self.client.open(request, timeout=5)
        except urllib.error.HTTPError as error:
            response = error
        return response.status, response.headers, response.read()

    def test_exact_origin_credentials_and_form_transport(self):
        status, headers, body = self.request('POST', {'Origin': 'https://pgmaps.ahmadjalil.com', 'Content-Type': 'application/x-www-form-urlencoded'}, b'mode=list')
        self.assertEqual(status, 200)
        self.assertEqual(headers['Access-Control-Allow-Origin'], 'https://pgmaps.ahmadjalil.com')
        self.assertEqual(headers['Access-Control-Allow-Credentials'], 'true')
        self.assertIn('Origin', headers['Vary'])
        self.assertEqual(json.loads(body)['fields'], {'mode': 'list'})

    def test_options_does_not_run_business_handler(self):
        status, headers, body = self.request('OPTIONS', {'Origin': 'https://pgmaps.ahmadjalil.com', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type, X-Requested-With'})
        self.assertEqual(status, 204)
        self.assertEqual(body, b'')
        self.assertIn('X-Requested-With', headers['Access-Control-Allow-Headers'])
        self.assertIn('POST', headers['Access-Control-Allow-Methods'])

    def test_unknown_origin_header_and_method_are_rejected(self):
        for origin in ['https://pgmaps.ahmadjalil.com.evil.example', 'null', 'http://pgmaps.ahmadjalil.com']:
            status, headers, _ = self.request(headers={'Origin': origin})
            self.assertEqual(status, 403)
            self.assertIsNone(headers.get('Access-Control-Allow-Origin'))
        for method, header in [('DELETE', ''), ('POST', 'Authorization')]:
            status, _, _ = self.request('OPTIONS', {'Origin': 'https://pgmaps.ahmadjalil.com', 'Access-Control-Request-Method': method, 'Access-Control-Request-Headers': header})
            self.assertEqual(status, 403)

    def test_auth_errors_keep_allowed_cors_headers(self):
        status, headers, _ = self.request(headers={'Origin': 'https://pgmaps.ahmadjalil.com'}, query='?error=1')
        self.assertEqual(status, 401)
        self.assertEqual(headers['Access-Control-Allow-Origin'], 'https://pgmaps.ahmadjalil.com')

    def test_no_origin_and_original_portal(self):
        self.assertEqual(self.request()[0], 200)
        status, headers, _ = self.request(headers={'Origin': 'https://nechakowatershed-portal.ca'})
        self.assertEqual(status, 200)
        self.assertEqual(headers['Access-Control-Allow-Origin'], 'https://nechakowatershed-portal.ca')


if __name__ == '__main__':
    unittest.main(argv=[sys.argv[0]], verbosity=2)
