"""
Redacta los correos de una regla. PORT FIEL de src/lib/email/render.ts: mismas variables,
mismo formato de números y fechas, misma clave anti-duplicados. Las pruebas comparten los
casos de tests/email_cases.json con la versión de la web.

Puro: recibe las filas que cumplen la regla (en memoria) y devuelve correos ya redactados.
"""
from __future__ import annotations

import hashlib
import math
import re
from datetime import date, datetime, timedelta
from typing import Any, Optional

import assign

MAX_EMAILS_PER_RULE = 25
MAX_DISTINCT_VALUES = 10
MAX_TEXT_CELL = 200
_TOLERANCE = timedelta(minutes=5)

_TOKEN = re.compile(r"\{(count|rows|column|sheet|file|rule)\}|\{col:([^{}]{1,200})\}")
_CONTROL = re.compile(r"[\x00-\x1f\x7f]+")
_ADDRESS = re.compile(r"^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$")


# ── Formato de celdas ───────────────────────────────────────────────────
def format_number(n: float) -> str:
    if isinstance(n, float) and not math.isfinite(n):
        return ""
    absn = abs(n)
    if absn >= 1e13:
        return "(número demasiado grande)"
    scaled = math.floor(absn * 100 + 0.5)
    integer, frac = divmod(scaled, 100)
    s = f"{integer:,}".replace(",", ".") if integer >= 10000 else str(integer)
    if frac:
        s += "," + (f"0{frac}" if frac < 10 else str(frac)).removesuffix("0")
    return ("-" if n < 0 and scaled != 0 else "") + s


def format_date(d: Any) -> str:
    if isinstance(d, datetime):
        t = d.replace(tzinfo=None) + _TOLERANCE  # las fechas de Excel no llevan zona horaria
        return f"{t.day:02d}/{t.month:02d}/{t.year}"
    return f"{d.day:02d}/{d.month:02d}/{d.year}"


def format_cell(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, bool):
        return "Sí" if v else "No"
    if isinstance(v, (int, float)):
        return format_number(v)
    if isinstance(v, (date, datetime)):
        return format_date(v)
    s = _CONTROL.sub(" ", str(v))
    s = re.sub(r" {2,}", " ", s).strip()
    return s[:MAX_TEXT_CELL] + "…" if len(s) > MAX_TEXT_CELL else s


# ── Plantillas ──────────────────────────────────────────────────────────
def referenced_columns(templates: list[str]) -> list[str]:
    out: list[str] = []
    for t in templates:
        for m in _TOKEN.finditer(t):
            name = (m.group(2) or "").strip()
            if name and name not in out:
                out.append(name)
    return out


def _distinct(values: list[str]) -> str:
    seen: list[str] = []
    for v in values:
        if v != "" and v not in seen:
            seen.append(v)
    shown = ", ".join(seen[:MAX_DISTINCT_VALUES])
    return f"{shown}… (+{len(seen) - MAX_DISTINCT_VALUES} más)" if len(seen) > MAX_DISTINCT_VALUES else shown


def _render(template: str, meta: dict, rows: list[dict], per_row: bool) -> str:
    numbers = [r["rowNumber"] for r in rows]
    rows_text = ", ".join(map(str, numbers)) if per_row else ", ".join(map(str, numbers[:10])) + ("…" if meta["count"] > 10 else "")

    def sub(m: re.Match) -> str:
        col, key = m.group(2), m.group(1)
        if col is not None:
            name = col.strip()
            values = [format_cell(r["values"].get(name)) for r in rows]
            return (values[0] if values else "") if per_row else _distinct(values)
        if key == "count":
            return str(meta["count"])
        if key == "rows":
            return rows_text
        if key == "column":
            return meta["columnName"]
        if key == "sheet":
            return meta["sheetName"] if meta["sheetName"] is not None else meta["fileName"]
        if key == "file":
            return meta["fileName"]
        return meta["ruleName"]

    return _TOKEN.sub(sub, template)


def parse_recipients(text: str) -> Optional[list[str]]:
    parts = [p.strip() for p in re.split(r"[;,]", text) if p.strip()]
    if not parts or len(parts) > 10:
        return None
    return parts if all(len(p) <= 254 and _ADDRESS.match(p) for p in parts) else None


def _one_line(s: str) -> str:
    return re.sub(r" {2,}", " ", _CONTROL.sub(" ", s)).strip()


def dedupe_key(rule_id: str, sheet: Optional[str], subject: str, to: str, body: str) -> str:
    raw = "\x01".join([rule_id, sheet or "", subject, to, body])
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:40]


def build_emails(action: dict, rule_id: str, meta: dict, matched: list[dict], headers: list[str]) -> list[dict]:
    """`action`: {from,to,subject,body,mode}. `matched`: [{rowNumber, values}] con solo las columnas usadas."""
    if not matched:
        return []
    used = referenced_columns([action["to"], action.get("cc") or "", action["subject"], action["body"]])
    sender_col = action.get("sender_column") or ""
    if sender_col and sender_col not in used:
        used.append(sender_col)
    missing = [c for c in used if c not in headers]

    def make(rows: list[dict], per_row: bool) -> dict:
        to = _one_line(_render(action["to"], meta, rows, per_row))
        cc = _one_line(_render(action.get("cc") or "", meta, rows, per_row))
        subject = _one_line(_render(action["subject"], meta, rows, per_row))[:200]
        body = re.sub(r"\r\n?", "\n", _render(action["body"], meta, rows, per_row))[:6000]
        problem = None
        if missing:
            problem = f"La columna «{missing[0]}» ya no existe en el archivo."
        elif not to:
            problem = "El destinatario está vacío en esta fila."
        elif parse_recipients(to) is None:
            problem = f"El destinatario «{to[:80]}» no es una dirección de correo válida."
        elif cc and parse_recipients(cc) is None:
            problem = f"La copia «{cc[:80]}» no es una dirección de correo válida."
        return {
            "sheet": meta["sheetName"],
            "row": rows[0]["rowNumber"] if per_row else None,
            "key": dedupe_key(rule_id, meta["sheetName"], subject, to, body),
            "from": action.get("from") or "",
            "to": to,
            "cc": cc,
            "subject": subject,
            "body": body,
            "problem": problem,
            # «Ana / Luis» → ['ana', 'luis']: el primero es el responsable de mandar este correo.
            **({"sender": assign.cell_keys(rows[0]["values"].get(sender_col))} if (per_row and sender_col) else {}),
        }

    if action.get("mode") == "summary":
        return [make(matched, False)]

    seen: set[str] = set()
    drafts: list[dict] = []
    for row in matched:
        d = make([row], True)
        if d["key"] in seen:
            continue
        seen.add(d["key"])
        drafts.append(d)
        if len(drafts) >= MAX_EMAILS_PER_RULE:
            break
    return drafts
