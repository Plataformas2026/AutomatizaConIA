"""
Rellena una plantilla Word (.docx) con los datos de UNA fila. Los campos de la plantilla se escriben {{así}}.

Es el mismo algoritmo que src/lib/templates/docx.ts (los dos ejecutan tests/fixtures y tests/fill_expected.json).
Todo ocurre en memoria: ni la plantilla rellenada ni la fila se guardan en ningún servidor; el agente solo escribe
el .docx resultante en la carpeta de informes de tu ordenador.

Word parte el texto en «tramos» (runs) de forma impredecible, así que se trabaja por párrafo: si un párrafo contiene
algún {{campo}}, el texto completo del párrafo se recompone y se escribe en su primer tramo (el formato de ese
párrafo se unifica con el de su primer tramo; el resto de párrafos no se tocan).
"""
from __future__ import annotations

import io
import re
import zipfile
from datetime import datetime
from typing import Callable, Optional

import assign as assign_mod
import email_render

MAX_TEMPLATE_BYTES = 1_300_000
PLACEHOLDER = re.compile(r"\{\{\s*([^{}\n]{1,80}?)\s*\}\}")
_PARTS = re.compile(r"^word/(document|header\d*|footer\d*)\.xml$")
_PARA = re.compile(r"<w:p[ >].*?</w:p>", re.S)
_RUN = re.compile(r"(<w:t(?:\s[^>]*)?>)(.*?)(</w:t>)", re.S)


class TemplateError(Exception):
    pass


def _unescape(s: str) -> str:
    return s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"').replace("&apos;", "'").replace("&amp;", "&")


def _escape(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _open(data: bytes) -> zipfile.ZipFile:
    if len(data) > MAX_TEMPLATE_BYTES:
        raise TemplateError("La plantilla es demasiado grande")
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
        if "word/document.xml" not in z.namelist():
            raise TemplateError("No es un documento Word (.docx)")
        return z
    except zipfile.BadZipFile as e:
        raise TemplateError("No es un documento Word (.docx)") from e


def _paragraph_text(para: str) -> str:
    return "".join(_unescape(m.group(2)) for m in _RUN.finditer(para))


def list_fields(data: bytes) -> list[str]:
    """Campos {{así}} de la plantilla, sin repetir y en orden de aparición."""
    out: list[str] = []
    with _open(data) as z:
        for name in z.namelist():
            if not _PARTS.match(name):
                continue
            xml = z.read(name).decode("utf-8", "replace")
            for para in _PARA.findall(xml):
                for m in PLACEHOLDER.finditer(_paragraph_text(para)):
                    if m.group(1) not in out:
                        out.append(m.group(1))
    return out[:200]


def _fill_xml(xml: str, resolve: Callable[[str], str]) -> str:
    def para_sub(m: re.Match) -> str:
        para = m.group(0)
        text = _paragraph_text(para)
        if "{{" not in text or not PLACEHOLDER.search(text):
            return para
        new = PLACEHOLDER.sub(lambda f: resolve(f.group(1)), text)
        state = {"i": 0}

        def run_sub(r: re.Match) -> str:
            first = state["i"] == 0
            state["i"] += 1
            if not first:
                return r.group(1) + r.group(3)
            tag = r.group(1)
            if "xml:space" not in tag:
                tag = tag[:-1] + ' xml:space="preserve">'
            return tag + _escape(new) + r.group(3)

        return _RUN.sub(run_sub, para)

    return _PARA.sub(para_sub, xml)


def fill(data: bytes, resolve: Callable[[str], str]) -> bytes:
    """Devuelve el .docx con todos los {{campos}} sustituidos por resolve(campo)."""
    out = io.BytesIO()
    with _open(data) as zin, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
        for info in zin.infolist():
            raw = zin.read(info.filename)
            if _PARTS.match(info.filename):
                raw = _fill_xml(raw.decode("utf-8"), resolve).encode("utf-8")
            zout.writestr(info.filename, raw)
    return out.getvalue()


def part_xml(data: bytes, name: str = "word/document.xml") -> str:
    with _open(data) as z:
        return z.read(name).decode("utf-8")


# ── Qué dato va en cada campo ───────────────────────────────────────────
SPECIAL = {"hoy": "today", "fecha": "today", "fecha hoy": "today", "fecha de hoy": "today",
           "fila": "row", "numero de fila": "row", "archivo": "file", "hoja": "sheet", "regla": "rule"}


def make_resolver(headers: list[str], values: dict, mapping: Optional[dict], *, row: int, today: str,
                  file_name: str = "", sheet: Optional[str] = None, rule: str = "") -> Callable[[str], str]:
    """Orden: 1) mapeo definido por el administrador · 2) columna con el mismo nombre (sin mayúsculas ni tildes)
    · 3) campos especiales ({{hoy}}, {{fila}}, {{archivo}}, {{hoja}}, {{regla}}). Si no hay dato: vacío."""
    by_norm = {assign_mod.normalize(h): h for h in headers}
    mapped = {assign_mod.normalize(k): v for k, v in (mapping or {}).items() if isinstance(k, str) and isinstance(v, str)}
    special = {"today": today, "row": str(row), "file": file_name, "sheet": sheet or "", "rule": rule}

    def resolve(field: str) -> str:
        key = assign_mod.normalize(field)
        col = mapped.get(key)
        if col and col in headers:
            return email_render.format_cell(values.get(col))
        if key in by_norm:
            return email_render.format_cell(values.get(by_norm[key]))
        if key in SPECIAL:
            return special[SPECIAL[key]]
        return ""

    return resolve


def today_text(now: Optional[datetime] = None) -> str:
    return (now or datetime.now()).strftime("%d/%m/%Y")
