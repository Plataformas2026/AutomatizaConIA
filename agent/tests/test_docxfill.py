import json
import unittest
from pathlib import Path

import docxfill as d

HERE = Path(__file__).parent
DATA = (HERE / "fixtures" / "plantilla.docx").read_bytes()
EXP = json.loads((HERE / "fill_expected.json").read_text(encoding="utf-8"))


def resolver():
    return d.make_resolver(EXP["headers"], EXP["values"], EXP["mapping"], row=EXP["row"], today=EXP["today"],
                           file_name=EXP["file"], sheet=EXP["sheet"], rule=EXP["rule"])


class DocxFill(unittest.TestCase):
    def test_fields(self):
        self.assertEqual(d.list_fields(DATA), EXP["fields"])

    def test_fill_matches_shared_expectation(self):
        out = d.fill(DATA, resolver())
        self.assertEqual(d.part_xml(out), EXP["document"])
        self.assertEqual(d.part_xml(out, "word/header1.xml"), EXP["header"])
        self.assertEqual(d.list_fields(out), [])  # no queda ningún campo sin sustituir

    def test_resolver_order(self):
        r = d.make_resolver(["Nombre", "Importe"], {"Nombre": "Ana", "Importe": 3}, {"Titular": "Nombre"}, row=9, today="01/01/2027")
        self.assertEqual([r("titular"), r(" NOMBRE "), r("importe"), r("fila"), r("hoy"), r("nada")], ["Ana", "Ana", "3", "9", "01/01/2027", ""])
        # El mapeo apunta a una columna que ya no existe → se cae al nombre igual, y si no, vacío
        r2 = d.make_resolver(["Importe"], {"Importe": 3}, {"Importe": "Borrada"}, row=1, today="x")
        self.assertEqual(r2("Importe"), "3")

    def test_not_a_docx(self):
        with self.assertRaises(d.TemplateError):
            d.list_fields(b"esto no es un zip")
        with self.assertRaises(d.TemplateError):
            d.list_fields(b"x" * (d.MAX_TEMPLATE_BYTES + 1))


if __name__ == "__main__":
    unittest.main()
