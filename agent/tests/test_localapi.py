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

    def test_rows_returns_requested_rows_as_text(self):
        status, _, body = request(self.port, "GET", f"/v1/rows?file={FID}&rows=2,5,999", GOOD)
        self.assertEqual(status, 200)
        self.assertEqual(body["headers"], ["Cliente", "Importe", "Alta"])
        self.assertEqual([r["n"] for r in body["rows"]], [2, 5])
        self.assertEqual(body["rows"][0]["cells"][0], "Cliente 1")
        self.assertEqual(body["missing"], [999])

    def test_rows_validates_input_and_origin(self):
        for q in ("", "&rows=", "&rows=abc", "&rows=0", "&rows=-3"):
            self.assertEqual(request(self.port, "GET", f"/v1/rows?file={FID}{q}", GOOD)[0], 400, q)
        self.assertEqual(request(self.port, "GET", "/v1/rows?file=nope&rows=2", GOOD)[0], 404)
        self.assertEqual(request(self.port, "GET", f"/v1/rows?file={FID}&rows=2", {"Origin": "https://malo.com", "X-Automatiza": "1"})[0], 403)
        many = ",".join(str(i) for i in range(2, 400))
        status, _, body = request(self.port, "GET", f"/v1/rows?file={FID}&rows={many}", GOOD)
        self.assertEqual((status, len(body["rows"])), (200, 150))  # se piden como mucho 200; el archivo tiene 150 filas

    def test_tables_for_stats(self):
        status, _, body = request(self.port, "GET", f"/v1/tables?file={FID}", GOOD)
        self.assertEqual(status, 200)
        self.assertEqual(len(body["sheets"]), 1)
        sh = body["sheets"][0]
        self.assertEqual(sh["headers"], ["Cliente", "Importe", "Alta"])
        self.assertEqual(len(sh["rows"]), 150)
        self.assertEqual(sh["rows"][0]["n"], 2)
        self.assertEqual(sh["rows"][0]["v"][0], "Cliente 1")
        self.assertFalse(body["truncated"])
        self.assertEqual(request(self.port, "GET", "/v1/tables?file=nope", GOOD)[0], 404)

    def test_tables_encode_dates_and_cap_cells(self):
        from datetime import date as _d
        enc = localapi._encode_value
        self.assertEqual(enc(datetime(2026, 3, 1, 14, 30)), {"d": "2026-03-01"})
        self.assertEqual(enc(_d(2026, 3, 2)), {"d": "2026-03-02"})
        self.assertIsNone(enc(float("nan")))
        self.assertEqual(enc(3.5), 3.5)
        old = localapi.TABLES_MAX_CELLS
        localapi.TABLES_MAX_CELLS = 30  # 10 filas × 3 columnas
        try:
            _, _, body = request(self.port, "GET", f"/v1/tables?file={FID}", GOOD)
        finally:
            localapi.TABLES_MAX_CELLS = old
        self.assertEqual(len(body["sheets"][0]["rows"]), 10)
        self.assertTrue(body["truncated"] and body["sheets"][0]["truncated"])

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


class FillTests(unittest.TestCase):
    TID = "99999999-0000-4000-8000-0123456789ab"

    def setUp(self):
        import base64
        self.tmp = tempfile.TemporaryDirectory()
        self.csv = Path(self.tmp.name) / "informes.csv"
        self.csv.write_text("Cliente;Responsable;Importe;Notas\nAcme;Ana López;1500,25;ok\nBeta & Co;Luis;20;\n", encoding="utf-8")
        self.out = Path(self.tmp.name) / "informes_rellenados"
        tpl = (Path(__file__).parent / "fixtures" / "plantilla.docx").read_bytes()
        self.template = {"id": self.TID, "name": "Informe mensual", "mapping": {"importe total": "Importe"},
                         "content_b64": base64.b64encode(tpl).decode()}
        self.opened = []
        self.srv = localapi.LocalApi(
            port=0, origins=(ORIGIN,), version="t",
            lookup=lambda fid: ({"sheet_mode": "first", "sheet_names": []}, self.csv) if fid == FID else None,
            file_opener=lambda p: self.opened.append(p),
            template_loader=lambda tid: self.template if tid == self.TID else None,
            fill_dir=self.out,
        )
        self.srv.start()

    def tearDown(self):
        self.srv.stop()
        self.tmp.cleanup()

    def post(self, body, headers=None):
        return request(self.srv.port, "POST", "/v1/fill", {**(headers or GOOD), "Content-Type": "application/json"}, json.dumps(body))

    def test_fills_and_opens(self):
        import docxfill
        status, _, body = self.post({"file": FID, "template": self.TID, "row": 3})
        self.assertEqual(status, 200)
        self.assertTrue(body["ok"] and body["name"].endswith(".docx") and "fila3" in body["name"])
        (written,) = list(self.out.glob("*.docx"))
        self.assertEqual(self.opened, [written])
        xml = docxfill.part_xml(written.read_bytes())
        self.assertIn("Beta &amp; Co", xml)      # {{Cliente}} (escapado)
        self.assertIn("Luis", xml)               # {{Responsable}}, un campo partido en dos tramos
        self.assertIn(">20<", xml)               # {{importe total}} vía mapeo
        self.assertNotIn("{{", xml)
        self.assertNotIn("Beta", json.dumps(body))  # la respuesta nunca incluye datos de la fila

    def test_guards_and_errors(self):
        self.assertEqual(self.post({"file": FID, "template": self.TID, "row": 3}, {"X-Automatiza": "1"})[0], 403)
        self.assertEqual(self.post({"file": FID, "template": self.TID, "row": 3}, {"Origin": "https://malo.com", "X-Automatiza": "1"})[0], 403)
        self.assertEqual(self.post({"file": FID, "template": self.TID, "row": "3"})[0], 400)
        self.assertEqual(self.post({"file": FID, "template": "nada", "row": 3})[0], 400)
        self.assertEqual(self.post({"file": "11111111-0000-4000-8000-0123456789ab", "template": self.TID, "row": 3})[0], 404)
        self.assertEqual(self.post({"file": FID, "template": "11111111-0000-4000-8000-0123456789ab", "row": 3})[1:][1]["error"], "template_not_found")
        self.assertEqual(self.post({"file": FID, "template": self.TID, "row": 99})[2]["error"], "row_not_found")
        self.assertFalse(self.out.exists())  # ningún fallo deja archivos

    def test_name_is_sanitised(self):
        self.template["name"] = "../../Informe: <mensual>?"
        self.post({"file": FID, "template": self.TID, "row": 2})
        (written,) = list(self.out.glob("*.docx"))
        self.assertEqual(written.parent, self.out)
        self.assertNotIn("..", written.name)
