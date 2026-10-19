import json
import unittest
from pathlib import Path

import assign as a
import engine as e

CASES = json.loads((Path(__file__).parent / "assign_cases.json").read_text(encoding="utf-8"))
TPL = "11111111-2222-3333-4444-555555555555"


class AssignTests(unittest.TestCase):
    def test_cell_keys(self):
        for c in CASES["cells"]:
            self.assertEqual(a.cell_keys(c["cell"]), c["keys"], c["cell"])

    def test_assignees_and_identifiers(self):
        self.assertEqual(a.build_assignees(CASES["ruleId"], [tuple(r) for r in CASES["rows"]]), CASES["assignees"])
        i = CASES["identifiers"]
        self.assertEqual(a.identifiers(i["email"], i["aliases"]), i["expected"])
        self.assertEqual(a.digest(CASES["ruleId"], "-"), CASES["unassigned"])

    def test_chains_and_handoff(self):
        rows = [tuple(r) for r in CASES["rows"]]
        self.assertEqual(a.build_chains(CASES["ruleId"], rows), CASES["chains"])
        h = {int(k): v for k, v in CASES["handoff"]["handoffs"].items()}
        for p in CASES["handoff"]["people"]:
            s = a.my_share(CASES["assignees"], CASES["ruleId"], a.identifiers(p["email"], p["aliases"]), CASES["chains"], h)
            self.assertEqual(s["mine"], p["mine"], p["email"])
            if "rows" in p:
                self.assertEqual(s["rows"], p["rows"], p["email"])

    def test_limits(self):
        many = a.build_assignees("r", [(n, f"persona {n}") for n in range(2, 400)])
        self.assertEqual(len(many), a.MAX_PEOPLE)
        same = a.build_assignees("r", [(n, "Ana") for n in range(2, 100)])
        (only,) = same.values()
        self.assertEqual((only["n"], len(only["rows"])), (98, a.MAX_ROWS_PER_PERSON))


class ReportUseCase(unittest.TestCase):
    """Ejemplo B: «Quedan N informes sin completar» repartidos por la columna H."""

    def test_alert_carries_assignees_and_template(self):
        cond = {"kind": "group", "op": "and", "conditions": [
            {"kind": "compare", "left": {"type": "column", "column": "X"}, "operator": "is_not_empty"},
            {"kind": "group", "op": "or", "conditions": [
                {"kind": "compare", "left": {"type": "column", "column": "Y"}, "operator": "is_empty"},
                {"kind": "compare", "left": {"type": "column", "column": "Y"}, "operator": "eq", "right": {"type": "value", "value": "y"}}]}]}
        raw = {"id": "r1", "name": "Completar informes", "condition": cond,
               "actions": [{"type": "alert", "message": "Quedan {count} informes sin completar", "assignColumn": "H", "templateId": TPL}]}
        rule, why = e.check_rule(raw)
        self.assertIsNotNone(rule, why)
        self.assertEqual((rule.assign_column, rule.template_id), ("H", TPL))
        data = [("a", None, "Ana López"), ("b", "y", "ana@x.com"), ("c", "hecho", "Luis"), ("d", "", "Luis"), (None, None, "Eva")]
        table = e.Table(["X", "Y", "H"], [e.Row(i + 2, {"X": x, "Y": y, "H": h}) for i, (x, y, h) in enumerate(data)])
        sheet = e.SheetTable(None, table)
        ev = e.evaluate_across_sheets(rule, [sheet])
        self.assertEqual(ev.sheets[0].matched_rows, [2, 3, 5])
        _, alerts, _ = e.build_outputs(rule, ev, {}, "inf.xlsx", [sheet])
        (al,) = alerts
        self.assertEqual(al["message"], "Quedan 3 informes sin completar")
        self.assertEqual(al["template"], TPL)
        mine = sum(v["n"] for h, v in al["assignees"].items() if h in {a.digest("r1", k) for k in a.identifiers("ana@x.com", ["Ana López"])})
        self.assertEqual(mine, 2)  # filas 2 (por alias) y 3 (por correo)
        self.assertEqual(al["assignees"][a.digest("r1", "luis")]["rows"], [5])

    def test_invalid_assign_or_template(self):
        base = {"id": "r1", "name": "n", "condition": {"kind": "compare", "left": {"type": "column", "column": "X"}, "operator": "is_empty"}}
        self.assertIsNone(e.check_rule({**base, "actions": [{"type": "alert", "message": "m", "assignColumn": ""}]})[0])
        self.assertIsNone(e.check_rule({**base, "actions": [{"type": "alert", "message": "m", "templateId": "no-es-uuid"}]})[0])
        rule, _ = e.check_rule({**base, "actions": [{"type": "alert", "message": "m"}]})
        self.assertEqual((rule.assign_column, rule.template_id), (None, None))
        table = e.Table(["X"], [e.Row(2, {"X": None})])
        ev = e.evaluate_across_sheets(rule, [e.SheetTable(None, table)])
        _, alerts, _ = e.build_outputs(rule, ev, {}, "f", [e.SheetTable(None, table)])
        self.assertNotIn("assignees", alerts[0])


if __name__ == "__main__":
    unittest.main()
