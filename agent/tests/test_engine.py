"""Pruebas del motor y del lector. Ejecutar:  python -m unittest discover -s tests -v   (desde la carpeta agent)"""
import io
import os
import sys
import unittest
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import engine as e  # noqa: E402
import readers  # noqa: E402


def table(headers, rows, start=2):
    return e.Table(headers, [e.Row(start + i, dict(zip(headers, r))) for i, r in enumerate(rows)])


class Numbers(unittest.TestCase):
    def test_formats(self):
        n = e.to_number
        self.assertEqual(n("1.234,56"), 1234.56)
        self.assertEqual(n("1,234.56"), 1234.56)
        self.assertEqual(n("1234,5"), 1234.5)
        self.assertEqual(n("12 €"), 12)
        self.assertEqual(n("15%"), 15)
        self.assertEqual(n("1.234.567"), 1234567)
        self.assertEqual(n(7), 7)
        self.assertIsNone(n("abc"))
        self.assertIsNone(n(True))
        self.assertIsNone(n(None))
        self.assertIsNone(n(datetime(2026, 1, 1)))

    def test_dates(self):
        d = e.to_date
        self.assertEqual(d("2026-10-09"), d("09/10/2026"))
        self.assertEqual(d("2026-10-09"), d(datetime(2026, 10, 9)))
        self.assertEqual(d("2026-10-09T10:30:00Z"), d("2026-10-09"))
        self.assertIsNone(d("hola"))
        self.assertEqual(d("1/13/2026"), d("1/1/2027"))  # desborda como JavaScript


class Compare(unittest.TestCase):
    def test_operators(self):
        c = e.compare
        self.assertTrue(c(5, "lt", 10))
        self.assertTrue(c("5", "lt", "10"))        # numérico, no alfabético
        self.assertTrue(c("1.234,5", "gt", 1000))
        self.assertFalse(c("abc", "gt", 1))
        self.assertTrue(c("Hola Mundo", "contains", "mundo"))
        self.assertFalse(c("x", "contains", ""))   # regla mal configurada: nunca dispara
        self.assertTrue(c("Pendiente", "eq", "pendiente"))
        self.assertTrue(c(None, "is_empty", None))
        self.assertTrue(c("  ", "is_empty", None))
        self.assertTrue(c(12.0, "eq", "12"))
        self.assertTrue(c("2026-10-01", "lt", "05/10/2026"))
        self.assertTrue(c("a", "neq", "b"))


class Rules(unittest.TestCase):
    RAW = {
        "id": "r1", "name": "Stock bajo",
        "condition": {"kind": "compare", "left": {"type": "column", "column": "Stock"}, "operator": "lt",
                      "right": {"type": "value", "value": "10"}},
        "actions": [{"type": "alert", "message": "Hay {count} filas (filas {rows}) en {sheet} · {column}", "severity": "warning"}],
    }

    def test_validate(self):
        self.assertIsNotNone(e.validate_rule(self.RAW))
        bad = {**self.RAW, "condition": {"kind": "compare", "left": {"type": "column", "column": "A"}, "operator": "lt"}}
        self.assertIsNone(e.validate_rule(bad))
        self.assertIsNone(e.validate_rule({**self.RAW, "condition": {**self.RAW["condition"], "operator": "drop"}}))

    def test_alerts_and_fingerprints(self):
        rule = e.validate_rule(self.RAW)
        t = table(["Stock"], [[5], [20], [3], [None]])
        ev = e.evaluate_across_sheets(rule, [e.SheetTable("Enero", t)])
        fps, alerts = e.build_alerts(rule, ev, {}, "inv.xlsx")
        self.assertEqual(len(alerts), 1)
        self.assertEqual(alerts[0]["rows"], [2, 4])
        self.assertEqual(alerts[0]["message"], "Hay 2 filas (filas 2, 4) en Enero · Stock")
        # misma situación → no vuelve a avisar
        _, again = e.build_alerts(rule, ev, fps, "inv.xlsx")
        self.assertEqual(again, [])
        # cambia el conjunto de filas → avisa otra vez
        ev2 = e.evaluate_across_sheets(rule, [e.SheetTable("Enero", table(["Stock"], [[5], [20], [3], [1]]))])
        _, third = e.build_alerts(rule, ev2, fps, "inv.xlsx")
        self.assertEqual(len(third), 1)

    def test_missing_column_and_sheets(self):
        rule = e.validate_rule(self.RAW)
        ev = e.evaluate_across_sheets(rule, [e.SheetTable("A", table(["Otra"], [[1]]))])
        self.assertIn("«Stock» ya no existe", ev.error)
        ev = e.evaluate_across_sheets(rule, [e.SheetTable("A", table(["Otra"], [[1]])), e.SheetTable("B", table(["Y"], [[1]]))])
        self.assertIn("ninguna de las hojas", ev.error)
        ev = e.evaluate_across_sheets(rule, [e.SheetTable("A", table(["Otra"], [[1]])), e.SheetTable("B", table(["Stock"], [[1]]))])
        self.assertIsNone(ev.error)
        self.assertEqual([s.sheet_name for s in ev.sheets], ["B"])

    def test_message_ellipsis_and_csv_sheet_name(self):
        msg = e.render_message("{count}|{rows}|{sheet}", count=12, rows=list(range(2, 14)), column="C",
                               sheet=None, file_name="f.csv", rule_name="r")
        self.assertEqual(msg, "12|2, 3, 4, 5, 6, 7, 8, 9, 10, 11…|f.csv")


class Readers(unittest.TestCase):
    def _xlsx(self):
        from openpyxl import Workbook
        wb = Workbook()
        ws = wb.active
        ws.title = "Ventas"
        ws.append(["Producto", "Stock", "Fecha"])
        ws.append(["A", 5, datetime(2026, 10, 9)])
        ws.append([None, None, None])
        ws.append(["B", "1.234,5", None])
        ws2 = wb.create_sheet("Otra")
        ws2.append(["X"])
        ws2.append([1])
        buf = io.BytesIO()
        wb.save(buf)
        return buf.getvalue()

    def test_xlsx_selection_and_structure(self):
        wb = readers.read_workbook(self._xlsx(), ".xlsx", "first")
        self.assertEqual(wb.available, ["Ventas", "Otra"])
        self.assertEqual([s.sheet_name for s in wb.sheets], ["Ventas"])
        self.assertEqual([r.number for r in wb.sheets[0].table.rows], [2, 4])  # la fila vacía se salta
        self.assertEqual({t["sheet"]: t["columns"] for t in wb.structure["tables"]}, {"Ventas": ["Producto", "Stock", "Fecha"], "Otra": ["X"]})
        wb = readers.read_workbook(self._xlsx(), ".xlsx", "all")
        self.assertEqual(len(wb.sheets), 2)
        wb = readers.read_workbook(self._xlsx(), ".xlsx", "selected", ["Otra"])
        self.assertEqual([s.sheet_name for s in wb.sheets], ["Otra"])
        wb = readers.read_workbook(self._xlsx(), ".xlsx", "selected", ["Borrada"])
        self.assertEqual(wb.sheets, [])

    def test_csv_delimiters_and_encoding(self):
        wb = readers.read_workbook("Nombre;Importe\nÁrbol;1.234,5\n".encode("cp1252"), ".csv")
        t = wb.sheets[0].table
        self.assertEqual(t.headers, ["Nombre", "Importe"])
        self.assertEqual(t.rows[0].values["Nombre"], "Árbol")
        self.assertIsNone(wb.sheets[0].sheet_name)
        wb = readers.read_workbook(b"a,b,c\n1,2,3\n", ".csv")
        self.assertEqual(wb.sheets[0].table.headers, ["a", "b", "c"])

    def test_duplicate_and_blank_headers(self):
        wb = readers.read_workbook(b"a,a,,b\n1,2,3,4\n", ".csv")
        self.assertEqual(wb.sheets[0].table.headers, ["a", "a (2)", "Columna 3", "b"])

    def test_broken_file(self):
        with self.assertRaises(readers.ReadError):
            readers.read_workbook(b"no soy un excel", ".xlsx")


if __name__ == "__main__":
    unittest.main()
