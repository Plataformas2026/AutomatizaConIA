"""
Prueba de extremo a extremo con un «Supabase» falso en memoria: el agente real, Watchdog real y archivos reales.
Ejecutar:  python -m unittest discover -s tests -v   (desde la carpeta agent)
"""
import json
import os
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from api import Api  # noqa: E402
from agent import Agent  # noqa: E402
from config import Config  # noqa: E402

TOKEN = "t" * 40


class FakeSupabase:
    def __init__(self):
        self.files = {}
        self.alerts = []
        self.reports = []
        self.rule_errors = []
        self.lock = threading.Lock()

    def handler(self):
        outer = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                fn = self.path.rsplit("/", 1)[-1]
                code, out = 200, None
                with outer.lock:
                    if body.get("p_token") != TOKEN:
                        code, out = 400, {"message": "invalid_token"}
                    elif fn == "agent_get_config":
                        out = {"agent": {"id": "a1", "name": "PC test"}, "files": [
                            {"id": fid, "name": f["name"], "path": f.get("path"), "sheet_mode": "first",
                             "sheet_names": [], "has_structure": f.get("structure") is not None, "rules": f["rules"]}
                            for fid, f in outer.files.items()]}
                    elif fn == "agent_report_file":
                        f = outer.files[body["p_file"]]
                        f["status"], f["error"] = body["p_status"], body["p_error"]
                        if body["p_structure"] is not None:
                            f["structure"] = body["p_structure"]
                        outer.reports.append(body["p_status"])
                    elif fn == "agent_report_rule":
                        rule = next(r for r in outer.files[body["p_file"]]["rules"] if r["id"] == body["p_rule"])
                        if body["p_error"]:
                            outer.rule_errors.append(body["p_error"])
                        else:
                            outer.alerts += body["p_alerts"]
                            rule["fingerprints"] = body["p_fingerprints"]
                        out = len(body["p_alerts"] or [])
                payload = json.dumps(out).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

        return H


def make_xlsx(path: Path, stocks):
    from openpyxl import Workbook
    wb = Workbook()
    ws = wb.active
    ws.append(["Producto", "Stock"])
    for i, s in enumerate(stocks):
        ws.append([f"P{i}", s])
    tmp = path.with_suffix(".tmp.xlsx")
    wb.save(tmp)
    os.replace(tmp, path)  # así guarda Excel: archivo temporal + renombrar


RULE = {
    "id": "r1", "name": "Stock bajo", "updated_at": "2026-01-01",
    "condition": {"kind": "compare", "left": {"type": "column", "column": "Stock"}, "operator": "lt",
                  "right": {"type": "value", "value": 10}},
    "actions": [{"type": "alert", "message": "Hay {count} filas: {rows}", "severity": "warning"}],
    "fingerprints": {},
}


def wait_for(cond, timeout=20):
    end = time.time() + timeout
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.2)
    return False


class Integration(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name).resolve()
        (self.root / "sub").mkdir()
        self.fake = FakeSupabase()
        self.server = HTTPServer(("127.0.0.1", 0), self.fake.handler())
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        base = self.root / "agent"
        base.mkdir()
        self.cfg = Config(f"http://127.0.0.1:{self.server.server_port}", "anon", TOKEN, (self.root / "sub",), 1, 1,
                          10 * 1024 * 1024, base)
        self.agent = Agent(self.cfg, Api(self.cfg.supabase_url, "anon", TOKEN, "test"))
        self.thread = None

    def tearDown(self):
        self.agent.stop.set()
        if self.thread:
            self.thread.join(timeout=10)
        self.server.shutdown()
        self.tmp.cleanup()

    def start(self):
        self.thread = threading.Thread(target=self.agent.run, daemon=True)
        self.thread.start()

    def test_full_flow(self):
        target = self.root / "sub" / "inv.xlsx"
        make_xlsx(target, [5, 20, 3])
        self.fake.files["f1"] = {"name": "inv.xlsx", "rules": [json.loads(json.dumps(RULE))]}
        self.start()

        # 1) primera lectura: estructura (solo nombres) y primera alerta
        self.assertTrue(wait_for(lambda: len(self.fake.alerts) == 1), "no llegó la primera alerta")
        self.assertEqual(self.fake.alerts[0]["rows"], [2, 4])
        self.assertEqual(self.fake.alerts[0]["message"], "Hay 2 filas: 2, 4")
        self.assertEqual(self.fake.files["f1"]["structure"]["tables"][0]["columns"], ["Producto", "Stock"])
        self.assertNotIn("P0", json.dumps(self.fake.files["f1"]["structure"]))  # nunca datos de celdas

        # 2) sin cambios reales: no repite
        time.sleep(3)
        self.assertEqual(len(self.fake.alerts), 1)

        # 3) guardado «a lo Excel» (temporal + renombrar) con otro conjunto de filas → Watchdog lo detecta
        make_xlsx(target, [5, 20, 3, 1])
        self.assertTrue(wait_for(lambda: len(self.fake.alerts) == 2), "Watchdog no detectó el cambio")
        self.assertEqual(self.fake.alerts[1]["rows"], [2, 4, 5])

        # 4) mismo contenido guardado de nuevo → misma huella → sin alerta nueva
        make_xlsx(target, [5, 20, 3, 1])
        time.sleep(4)
        self.assertEqual(len(self.fake.alerts), 2)

    def test_errors_and_recovery(self):
        self.fake.files["f2"] = {"name": "falta.xlsx", "rules": []}
        self.start()
        self.assertTrue(wait_for(lambda: self.fake.files["f2"].get("status") == "error"))
        self.assertIn("No se encuentra", self.fake.files["f2"]["error"])
        make_xlsx(self.root / "sub" / "falta.xlsx", [1, 2])
        self.assertTrue(wait_for(lambda: self.fake.files["f2"].get("status") == "active"), "no se recuperó")

    def test_path_outside_allowed_folders(self):
        outside = self.root / "fuera.xlsx"
        make_xlsx(outside, [1])
        self.fake.files["f3"] = {"name": "fuera.xlsx", "path": str(outside), "rules": []}
        self.start()
        self.assertTrue(wait_for(lambda: self.fake.files["f3"].get("status") == "error"))
        self.assertIn("carpetas autorizadas", self.fake.files["f3"]["error"])

    def test_new_rule_is_picked_up(self):
        make_xlsx(self.root / "sub" / "inv.xlsx", [5, 20, 3])
        self.fake.files["f1"] = {"name": "inv.xlsx", "rules": []}
        self.start()
        self.assertTrue(wait_for(lambda: self.fake.files["f1"].get("structure")))
        with self.fake.lock:
            self.fake.files["f1"]["rules"].append(json.loads(json.dumps({**RULE, "updated_at": "2026-02-02"})))
        self.assertTrue(wait_for(lambda: len(self.fake.alerts) == 1), "no evaluó la regla nueva")

    def test_invalid_token_stops(self):
        self.agent.api._token = "x" * 40
        self.thread = threading.Thread(target=lambda: setattr(self, "code", self.agent.run()), daemon=True)
        self.thread.start()
        time.sleep(2)           # tiempo de sobra para que falle la autenticación…
        self.agent.stop.set()   # …y se corta la espera de 10 min de reintento
        self.thread.join(timeout=10)
        self.assertEqual(getattr(self, "code", None), 2)


if __name__ == "__main__":
    unittest.main()
