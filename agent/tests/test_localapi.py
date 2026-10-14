import http.client
import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

import localapi

FID = "0a1b2c3d-0000-4000-8000-0123456789ab"
ORIGIN = "https://miapp.vercel.app"


def request(port, method, path, headers=None, body=None):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    conn.request(method, path, body=body, headers=headers or {})
    r = conn.getresponse()
    raw = r.read()
    out = (r.status, dict(r.getheaders()), json.loads(raw) if raw else None)
    conn.close()
    return out


GOOD = {"Origin": ORIGIN, "X-Automatiza": "1"}


class LocalApiTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.csv = Path(self.tmp.name) / "datos.csv"
        rows = ["Cliente;Importe;Alta"] + [f"Cliente {i};{i}.5;2026-10-{(i % 28) + 1:02d}" for i in range(1, 151)]
        self.csv.write_text("\n".join(rows), encoding="utf-8")
        self.opened = []
        self.srv = localapi.LocalApi(
            port=0, origins=(ORIGIN,), version="t",
            lookup=lambda fid: ({"sheet_mode": "first", "sheet_names": []}, self.csv) if fid == FID else None,
            folder_opener=lambda p: self.opened.append(("folder", p)),
            file_opener=lambda p: self.opened.append(("file", p)),
        )
        self.srv.start()
        self.port = self.srv.port

    def tearDown(self):
        self.srv.stop()
        self.tmp.cleanup()

    def test_preview_limits_and_formats(self):
        status, headers, body = request(self.port, "GET", f"/v1/preview?file={FID}", GOOD)
        self.assertEqual(status, 200)
        self.assertEqual(headers["Access-Control-Allow-Origin"], ORIGIN)
        self.assertEqual(headers["Access-Control-Allow-Private-Network"], "true")
        self.assertEqual(body["headers"], ["Cliente", "Importe", "Alta"])
        self.assertEqual(len(body["rows"]), 100)
        self.assertEqual((body["totalRows"], body["truncated"]), (150, True))
        self.assertEqual(body["rows"][0]["n"], 2)
        self.assertEqual(body["rows"][0]["cells"][0], "Cliente 1")

    def test_foreign_origin_or_missing_header_rejected(self):
        self.assertEqual(request(self.port, "GET", "/v1/ping", {"Origin": "https://malo.com", "X-Automatiza": "1"})[0], 403)
        self.assertEqual(request(self.port, "GET", "/v1/ping", {"X-Automatiza": "1"})[0], 403)
        self.assertEqual(request(self.port, "GET", "/v1/ping", {"Origin": ORIGIN})[0], 403)
        # DNS rebinding: Host distinto de localhost/127.0.0.1
        self.assertEqual(request(self.port, "GET", "/v1/ping", {**GOOD, "Host": "evil.example.com"})[0], 403)
        self.assertEqual(request(self.port, "GET", "/v1/ping", GOOD)[0], 200)

    def test_preflight(self):
        status, headers, _ = request(self.port, "OPTIONS", "/v1/open", {"Origin": ORIGIN, "Access-Control-Request-Method": "POST"})
        self.assertEqual(status, 204)
        self.assertIn("X-Automatiza", headers["Access-Control-Allow-Headers"])
        self.assertEqual(request(self.port, "OPTIONS", "/v1/open", {"Origin": "https://malo.com"})[0], 403)

    def test_unknown_or_malformed_ids(self):
        for fid in ("00000000-0000-4000-8000-000000000000", "../../etc/passwd", "x"):
            self.assertEqual(request(self.port, "GET", f"/v1/preview?file={fid}", GOOD)[0], 404)

    def test_open_delegates_only_known_files(self):
        h = {**GOOD, "Content-Type": "application/json"}
        self.assertEqual(request(self.port, "POST", "/v1/open", h, json.dumps({"file": FID, "what": "folder"}))[0], 200)
        self.assertEqual(request(self.port, "POST", "/v1/open", h, json.dumps({"file": FID, "what": "file"}))[0], 200)
        self.assertEqual(request(self.port, "POST", "/v1/open", h, json.dumps({"file": FID, "what": "exe"}))[0], 400)
        self.assertEqual(request(self.port, "POST", "/v1/open", h, json.dumps({"file": "1" * 8 + "-1111-4111-8111-" + "1" * 12, "what": "file"}))[0], 404)
        self.assertEqual(self.opened, [("folder", self.csv), ("file", self.csv)])

    def test_dates_in_preview(self):
        self.assertEqual(localapi._cell(datetime(2026, 10, 9)), "09/10/2026")
        self.assertEqual(len(localapi._cell("x" * 500)), localapi.CELL_CHARS)


if __name__ == "__main__":
    unittest.main()
