"""Correos: mismos casos que la web (tests/email_cases.json) + motor + envío con Outlook simulado.
Ejecutar:  python -m unittest discover -s tests -v   (desde la carpeta agent)"""
import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import email_render as er  # noqa: E402
import engine as e  # noqa: E402
import outlook  # noqa: E402
from agent import Agent  # noqa: E402
from config import Config  # noqa: E402

RULE = "11111111-1111-4111-8111-111111111111"


def revive(v):
    if isinstance(v, dict) and "$date" in v:
        return datetime.fromisoformat(v["$date"].replace("Z", "+00:00")).astimezone(timezone.utc)
    return v


class Shared(unittest.TestCase):
    def test_same_output_as_web(self):
        cases = json.loads((Path(__file__).parent / "email_cases.json").read_text(encoding="utf-8"))
        self.assertGreaterEqual(len(cases), 5)
        for c in cases:
            rows = [{"rowNumber": r["rowNumber"], "values": {k: revive(v) for k, v in r["values"].items()}} for r in c["rows"]]
            action = {"from": "", "mode": "per_row", **c["action"]}
            got = er.build_emails(action, RULE, c["meta"], rows, c["headers"])
            self.assertEqual(got, c["expected"], c["name"])


class Formats(unittest.TestCase):
    def test_numbers(self):
        f = er.format_number
        self.assertEqual(f(12), "12")
        self.assertEqual(f(1234.5), "1234,5")
        self.assertEqual(f(12345.678), "12.345,68")
        self.assertEqual(f(-0.5), "-0,5")
        self.assertEqual(f(-0.001), "0")
        self.assertEqual(f(100), "100")
        self.assertEqual(f(1000000), "1.000.000")
        self.assertEqual(f(0.125), "0,13")
        self.assertEqual(f(20.0), "20")

    def test_cells(self):
        self.assertEqual(er.format_cell(datetime(2026, 10, 9)), "09/10/2026")
        self.assertEqual(er.format_cell(datetime(2026, 10, 8, 23, 58)), "09/10/2026")
        self.assertEqual(er.format_cell(True), "Sí")
        self.assertEqual(er.format_cell(None), "")
        self.assertEqual(er.format_cell("  Ana\r\nBcc: x@y.com  "), "Ana Bcc: x@y.com")

    def test_recipients(self):
        self.assertEqual(er.parse_recipients("a@x.com; b@y.es"), ["a@x.com", "b@y.es"])
        self.assertIsNone(er.parse_recipients("a@x.com; mal"))
        self.assertIsNone(er.parse_recipients("a@x.com\nbcc:b@y.es"))


class Engine(unittest.TestCase):
    RAW = {
        "id": RULE, "name": "Vencidas",
        "condition": {"kind": "compare", "left": {"type": "column", "column": "Estado"}, "operator": "eq",
                      "right": {"type": "value", "value": "Vencida"}},
        "actions": [
            {"type": "alert", "message": "{count} vencidas", "severity": "warning"},
            {"type": "email", "to": "{col:Email}", "subject": "Factura {col:Nº}", "body": "Hola {col:Cliente}, debes {col:Importe}", "mode": "per_row"},
        ],
    }

    def table(self):
        h = ["Email", "Nº", "Cliente", "Importe", "Estado"]
        rows = [["a@x.com", 1, "Ana", 10.5, "Vencida"], ["b@x.com", 2, "Luis", 99, "Pagada"], ["c@x.com", 3, "Eva", 1500.25, "Vencida"]]
        return e.SheetTable("Hoja1", e.Table(h, [e.Row(2 + i, dict(zip(h, r))) for i, r in enumerate(rows)]))

    def test_rule_with_email_action(self):
        rule = e.validate_rule(self.RAW)
        self.assertIsNotNone(rule)
        self.assertEqual(len(rule.actions), 1)
        self.assertEqual(len(rule.emails), 1)
        sheet = self.table()
        ev = e.evaluate_across_sheets(rule, [sheet])
        fps, alerts, emails = e.build_outputs(rule, ev, {}, "f.xlsx", [sheet])
        self.assertEqual(len(alerts), 1)
        self.assertEqual([(m["to"], m["subject"], m["body"]) for m in emails],
                         [("a@x.com", "Factura 1", "Hola Ana, debes 10,5"), ("c@x.com", "Factura 3", "Hola Eva, debes 1500,25")])
        # Misma huella → no se vuelve a avisar ni a redactar
        _, alerts2, emails2 = e.build_outputs(rule, ev, fps, "f.xlsx", [sheet])
        self.assertEqual((alerts2, emails2), ([], []))

    def test_only_email_action_and_invalid(self):
        raw = {**self.RAW, "actions": [self.RAW["actions"][1]]}
        rule = e.validate_rule(raw)
        self.assertIsNotNone(rule)
        sheet = self.table()
        ev = e.evaluate_across_sheets(rule, [sheet])
        _, alerts, emails = e.build_outputs(rule, ev, {}, "f.xlsx", [sheet])
        self.assertEqual((alerts, len(emails)), ([], 2))
        bad = {**self.RAW, "actions": [{**self.RAW["actions"][1], "mode": "todos"}]}
        self.assertIsNone(e.validate_rule(bad))
        bad = {**self.RAW, "actions": [{**self.RAW["actions"][1], "subject": ""}]}
        self.assertIsNone(e.validate_rule(bad))


class FakeApi:
    def __init__(self, items):
        self.items, self.reports = items, []

    def get_outbox(self):
        return self.items

    def report_email(self, eid, status, error=None):
        self.reports.append((eid, status, error))


class FakeOutlook:
    def __init__(self, fail=None):
        self.delivered, self.fail = [], fail

    def deliver(self, **kw):
        if self.fail:
            raise self.fail
        self.delivered.append(kw)


def make_agent(mode, items, domains=("empresa.com",), per_hour=20, fake=None):
    tmp = Path(tempfile.mkdtemp())
    cfg = Config("https://x.supabase.co", "k", "t" * 40, (tmp,), 30, 3, 10**7, tmp,
                 email_mode=mode, email_allowed_domains=domains, email_max_per_hour=per_hour)
    api = FakeApi(items)
    ag = Agent(cfg, api)
    ag.outlook = fake or FakeOutlook()
    return ag, api


def item(i, to="ana@empresa.com", sender=None):
    return {"id": f"id{i}", "to": to, "subject": f"Asunto {i}", "body": "cuerpo", "from": sender}


class Outbox(unittest.TestCase):
    def test_off_does_nothing(self):
        ag, api = make_agent("off", [item(1)])
        ag.process_outbox()
        self.assertEqual((api.reports, ag.outlook.delivered), ([], []))

    def test_send_only_to_allowed_domains(self):
        ag, api = make_agent("send", [item(1), item(2, "otro@gmail.com"), item(3, "a@empresa.com; b@gmail.com")])
        ag.process_outbox()
        self.assertEqual([d["subject"] for d in ag.outlook.delivered], ["Asunto 1"])
        self.assertEqual([r[:2] for r in api.reports], [("id1", "sent"), ("id2", "failed"), ("id3", "failed")])
        self.assertFalse(ag.outlook.delivered[0]["draft"])

    def test_draft_mode_saves_drafts_to_any_domain(self):
        ag, api = make_agent("draft", [item(1, "x@gmail.com")], domains=())
        ag.process_outbox()
        self.assertTrue(ag.outlook.delivered[0]["draft"])
        self.assertEqual(api.reports, [("id1", "drafted", None)])

    def test_hourly_limit(self):
        ag, api = make_agent("send", [item(i) for i in range(5)], per_hour=2)
        ag.process_outbox()
        self.assertEqual(len(ag.outlook.delivered), 2)
        self.assertEqual(len(api.reports), 2)  # el resto sigue pendiente

    def test_never_sends_twice(self):
        ag, api = make_agent("send", [item(1)])
        ag.process_outbox()
        ag.process_outbox()  # la web aún lo devuelve como pendiente
        self.assertEqual(len(ag.outlook.delivered), 1)
        self.assertEqual([r[1] for r in api.reports], ["sent", "sent"])

    def test_outlook_unavailable_reports_and_stops(self):
        ag, api = make_agent("send", [item(1), item(2)], fake=FakeOutlook(outlook.OutlookUnavailable("Outlook cerrado")))
        ag.process_outbox()
        self.assertEqual([r[:2] for r in api.reports], [("id1", "failed")])

    def test_invalid_recipient(self):
        ag, api = make_agent("send", [item(1, "mal")])
        ag.process_outbox()
        self.assertEqual(api.reports[0][:2], ("id1", "failed"))
        self.assertEqual(ag.outlook.delivered, [])


class Config_(unittest.TestCase):
    def test_send_requires_domains(self):
        from config import ConfigError, load_config

        tmp = Path(tempfile.mkdtemp())
        (tmp / ".env").write_text(
            f"SUPABASE_URL=https://x.supabase.co\nSUPABASE_ANON_KEY=k\nAGENT_TOKEN={'t' * 40}\nWATCH_FOLDERS={tmp}\nEMAIL_MODE=send\n",
            encoding="utf-8",
        )
        with self.assertRaises(ConfigError):
            load_config(tmp)
        (tmp / ".env").write_text((tmp / ".env").read_text(encoding="utf-8") + "EMAIL_ALLOWED_DOMAINS=Empresa.com, @otra.es\n", encoding="utf-8")
        cfg = load_config(tmp)
        self.assertEqual(cfg.email_allowed_domains, ("empresa.com", "otra.es"))


if __name__ == "__main__":
    unittest.main()
