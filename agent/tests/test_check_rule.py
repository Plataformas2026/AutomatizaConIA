import unittest
import engine as e


class CheckRule(unittest.TestCase):
    BASE = {
        "id": "11111111-1111-1111-1111-111111111111", "name": "Prueba",
        "condition": {"kind": "compare", "left": {"type": "column", "column": "Importe"},
                      "operator": "gt", "right": {"type": "value", "value": 100}},
        "actions": [{"type": "email", "from": "", "to": "ithaisamoralesarbelo@gmail.com",
                     "subject": "Correo automático de prueba. Draft", "body": "Hay {count} filas.", "mode": "summary"}],
    }

    def test_email_only_rule_is_valid(self):
        rule, why = e.check_rule(self.BASE)
        self.assertIsNotNone(rule)
        self.assertEqual(why, "")
        self.assertEqual(len(rule.emails), 1)

    def test_reasons(self):
        bad = {**self.BASE, "actions": [{"type": "webhook"}]}
        self.assertIn("no soportado", e.check_rule(bad)[1])
        bad = {**self.BASE, "actions": [{**self.BASE["actions"][0], "mode": "x"}]}
        self.assertIn("modo", e.check_rule(bad)[1])
        self.assertIn("ninguna acción", e.check_rule({**self.BASE, "actions": []})[1])
        self.assertIn("condition", e.check_rule({"id": "1", "name": "n"})[1])


if __name__ == "__main__":
    unittest.main()


class DateOperators(unittest.TestCase):
    def test_same_results_as_web(self):
        import json
        from datetime import date
        from pathlib import Path

        data = json.loads((Path(__file__).parent / "date_cases.json").read_text(encoding="utf-8"))
        y, m, d = map(int, data["today"].split("-"))
        today = e.today_day(date(y, m, d))
        for c in data["cases"]:
            self.assertEqual(e.compare(c["left"], c["op"], c["right"], c["unit"], today), c["expected"], c)

    def test_date_reader_same_as_web(self):
        import json
        from datetime import date, timedelta
        from pathlib import Path

        data = json.loads((Path(__file__).parent / "date_cases.json").read_text(encoding="utf-8"))
        iso = lambda n: "null" if n is None else (date(1970, 1, 1) + timedelta(days=n)).isoformat()
        for text, expected in data["parse"]:
            self.assertEqual(iso(e.to_date(text)), expected, text)
        for value, expected in data["loose"]:
            self.assertEqual(iso(e.to_date_loose(value)), expected, value)

    def test_unreadable_and_hint(self):
        rule = e.check_rule({"id": "1", "name": "n", "actions": [{"type": "alert", "message": "m"}],
                             "condition": {"kind": "compare", "left": {"type": "column", "column": "Alta"},
                                           "operator": "elapsed", "unit": "months", "right": {"type": "value", "value": 6}}})[0]
        table = e.Table(["Alta"], [e.Row(2, {"Alta": "15/10/2026"}), e.Row(3, {"Alta": "pronto"}), e.Row(4, {"Alta": None}), e.Row(5, {"Alta": 45123})])
        self.assertEqual(e.unreadable_dates(rule, table), [3])
        self.assertTrue(e.looks_like_dates(["pronto", "15/10/2026", "n/a"], "Fecha de alta"))
        self.assertFalse(e.looks_like_dates(["pronto", "15/10/2026", "n/a"], "Notas"))

    def test_six_months_use_case(self):
        rule = e.check_rule({"id": "1", "name": "n", "actions": [{"type": "alert", "message": "m"}],
                             "condition": {"kind": "compare", "left": {"type": "column", "column": "Alta"},
                                           "operator": "elapsed", "unit": "months", "right": {"type": "value", "value": 6}}})[0]
        table = e.Table(["Alta"], [e.Row(2, {"Alta": "14/04/2026"}), e.Row(3, {"Alta": "15/04/2026"}),
                                    e.Row(4, {"Alta": "31-ago-25"}), e.Row(5, {"Alta": "pronto"})])
        from datetime import date
        self.assertEqual(e.evaluate_rule(rule, table, e.today_day(date(2026, 10, 14)))[0], [2, 4])
        self.assertEqual(e.evaluate_rule(rule, table, e.today_day(date(2026, 10, 15)))[0], [2, 3, 4])

    def test_add_units(self):
        day = lambda iso: e.to_date(iso)
        self.assertEqual(e.add_units(day("2026-01-31"), 1, "months"), day("2026-02-28"))
        self.assertEqual(e.add_units(day("2024-02-29"), 1, "years"), day("2025-02-28"))
        self.assertEqual(e.add_units(day("2026-11-30"), 3, "months"), day("2027-02-28"))

    def test_rule_validation(self):
        base = {
            "id": "1", "name": "n",
            "condition": {"kind": "compare", "left": {"type": "column", "column": "Alta"}, "operator": "elapsed",
                          "unit": "weeks", "right": {"type": "value", "value": 3}},
            "actions": [{"type": "email", "to": "a@x.com", "cc": "b@x.com", "subject": "s", "body": "b", "mode": "summary"}],
        }
        rule, why = e.check_rule(base)
        self.assertIsNotNone(rule, why)
        self.assertEqual((rule.unit, rule.emails[0]["cc"]), ("weeks", "b@x.com"))
        bad = {**base, "condition": {**base["condition"], "right": {"type": "value", "value": "abc"}}}
        self.assertIn("número entero", e.check_rule(bad)[1])
        bad = {**base, "condition": {**base["condition"], "operator": "on_date", "right": {"type": "value", "value": "31/12/2026"}}}
        self.assertIn("fecha del calendario", e.check_rule(bad)[1])
        bad = {**base, "condition": {**base["condition"], "unit": "decades"}}
        self.assertIn("unidad", e.check_rule(bad)[1])

    def test_evaluate_with_today(self):
        rule = e.check_rule({
            "id": "1", "name": "n",
            "condition": {"kind": "compare", "left": {"type": "column", "column": "Alta"}, "operator": "elapsed",
                          "right": {"type": "value", "value": 30}},
            "actions": [{"type": "alert", "message": "m"}],
        })[0]
        table = e.Table(["Alta"], [e.Row(2, {"Alta": "2026-08-01"}), e.Row(3, {"Alta": "2026-10-10"}), e.Row(4, {"Alta": None})])
        from datetime import date
        self.assertEqual(e.evaluate_rule(rule, table, e.today_day(date(2026, 10, 14)))[0], [2])
        self.assertEqual(e.evaluate_rule(rule, table, e.today_day(date(2026, 8, 20)))[0], [])


class CompoundConditions(unittest.TestCase):
    """Reglas multicondición: los mismos casos se ejecutan en la web (engine.test.ts)."""

    @staticmethod
    def _cases():
        import json
        from pathlib import Path
        return json.loads((Path(__file__).parent / "compound_cases.json").read_text(encoding="utf-8"))

    def test_shared_cases(self):
        import engine as e
        from datetime import date
        for c in self._cases()["cases"]:
            with self.subTest(c["name"]):
                rule, why = e.check_rule({"id": "r1", "name": "n", "condition": c["condition"],
                                          "actions": [{"type": "alert", "message": "m"}]})
                self.assertIsNotNone(rule, why)
                table = e.Table(sorted({k for r in c["rows"] for k in r["v"]}), [e.Row(r["n"], r["v"]) for r in c["rows"]])
                today = None
                if c.get("today"):
                    y, m, d = map(int, c["today"].split("-"))
                    today = e.to_date(date(y, m, d).isoformat())
                matched, err = e.evaluate_rule(rule, table, today)
                self.assertIsNone(err)
                self.assertEqual(matched, c["expected"])

    def test_valid_and_invalid(self):
        import engine as e
        for c in self._cases()["valid"]:
            self.assertIsNotNone(e.parse_condition(c)[0], c)
        for c in self._cases()["invalid"]:
            tree, why = e.parse_condition(c)
            self.assertIsNone(tree, c)
            self.assertTrue(why)

    def test_missing_column_in_any_branch(self):
        import engine as e
        c = self._cases()["cases"][0]
        rule, _ = e.check_rule({"id": "r", "name": "n", "condition": c["condition"], "actions": [{"type": "alert", "message": "m"}]})
        matched, err = e.evaluate_rule(rule, e.Table(["X"], [e.Row(2, {"X": "y"})]))
        self.assertEqual(matched, [])
        self.assertIn("«H»", err)

    def test_has_time_and_columns(self):
        import engine as e
        c = self._cases()["cases"][6]
        rule, _ = e.check_rule({"id": "r", "name": "n", "condition": c["condition"], "actions": [{"type": "alert", "message": "m"}]})
        self.assertTrue(rule.has_time)
        self.assertEqual(rule.columns, ["f", "done"])
        self.assertEqual(e.date_columns(rule), ["f"])
        self.assertTrue(e.condition_has_time(c["condition"]))
        self.assertFalse(e.condition_has_time(self._cases()["cases"][0]["condition"]))
