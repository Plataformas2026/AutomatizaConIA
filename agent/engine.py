"""
Motor de reglas del agente. Es un PORT FIEL de la lógica de la web
(src/lib/rules/engine.ts, operators.ts y lib/actions): mismas comparaciones, mismos
formatos de número y fecha, mismas huellas por hoja, mismas variables de mensaje.

Es puro: recibe tablas en memoria y devuelve solo nº de fila. No hace I/O ni registra datos.
"""
from __future__ import annotations

import calendar
import hashlib
import math
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

import email_render

OPERATORS = (
    "gt", "gte", "lt", "lte", "eq", "neq",
    "contains", "not_contains", "starts_with", "is_empty", "is_not_empty",
    "elapsed", "on_date",  # solo columnas de fecha: dependen del día de hoy
)
TIME_OPERATORS = ("elapsed", "on_date")
TIME_UNITS = ("days", "weeks", "months", "years")
MAX_ELAPSED = 3650
UNARY = ("is_empty", "is_not_empty")
SEVERITIES = ("info", "warning", "critical")

DAY_MS = 86_400_000
DAY_TOLERANCE_MS = 5 * 60_000
_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


# ── Estructuras ─────────────────────────────────────────────────────────
@dataclass
class Row:
    number: int  # nº de fila como lo ve el usuario (la cabecera es la 1ª fila con datos)
    values: dict[str, Any]


@dataclass
class Table:
    headers: list[str]
    rows: list[Row]


@dataclass
class SheetTable:
    sheet_name: Optional[str]  # None en CSV
    table: Table


@dataclass
class SheetEvaluation:
    sheet_name: Optional[str]
    matched_rows: list[int]

    @property
    def matched_count(self) -> int:
        return len(self.matched_rows)


@dataclass
class MultiSheetEvaluation:
    sheets: list[SheetEvaluation] = field(default_factory=list)
    error: Optional[str] = None


# ── Conversión de valores ───────────────────────────────────────────────
def is_empty(v: Any) -> bool:
    return v is None or (isinstance(v, str) and v.strip() == "")


def js_string(v: Any) -> str:
    """Equivalente a String(v) de JavaScript para los tipos que llegan de una hoja."""
    if v is None:
        return ""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float):
        if math.isfinite(v) and v.is_integer() and abs(v) < 1e21:
            return str(int(v))
        return repr(v)
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, date):
        return v.isoformat()
    return str(v)


def to_number(v: Any) -> Optional[float]:
    """Acepta 1234.56 · 1.234,56 · 1,234.56 · 1234,56 · «12 €» · «15%»."""
    if isinstance(v, bool) or v is None or isinstance(v, (date, datetime)):
        return None
    if isinstance(v, (int, float)):
        return float(v) if math.isfinite(v) else None

    s = re.sub(r"[\s€$£%]", "", str(v).strip())
    if not s:
        return None

    has_comma = "," in s
    has_dot = "." in s
    if has_comma and has_dot:
        decimal = "," if s.rfind(",") > s.rfind(".") else "."
        thousands = "." if decimal == "," else ","
        s = s.replace(thousands, "").replace(decimal, ".", 1)
    elif has_comma:
        s = s.replace(",", "") if s.count(",") > 1 else s.replace(",", ".", 1)
    elif has_dot and s.count(".") > 1:
        s = s.replace(".", "")

    return float(s) if re.fullmatch(r"-?[0-9]+(\.[0-9]+)?", s) else None


def _to_day(ms: float) -> int:
    return math.floor((ms + DAY_TOLERANCE_MS) / DAY_MS)


def _epoch_ms(dt: datetime) -> float:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return (dt - _EPOCH).total_seconds() * 1000


def to_date(v: Any) -> Optional[int]:
    """Fechas: objetos fecha (Excel), ISO (2026-10-09) o dd/mm/aaaa. Se comparan por día."""
    if isinstance(v, datetime):
        return _to_day(_epoch_ms(v))
    if isinstance(v, date):
        return _to_day(_epoch_ms(datetime(v.year, v.month, v.day)))
    if not isinstance(v, str):
        return None
    s = v.strip()

    if re.match(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}", s):
        try:
            if len(s) == 10:
                dt = datetime.fromisoformat(s)
            else:
                dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        except ValueError:
            return None
        return _to_day(_epoch_ms(dt))

    m = re.fullmatch(r"([0-9]{1,2})[/.-]([0-9]{1,2})[/.-]([0-9]{4})", s)
    if m:
        d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        # Date.UTC de JavaScript «desborda» (mes 13 → enero del año siguiente); lo imitamos.
        y += (mo - 1) // 12
        mo = (mo - 1) % 12 + 1
        try:
            dt = datetime(y, mo, 1) + timedelta(days=d - 1)
        except (ValueError, OverflowError):
            return None
        return _to_day(_epoch_ms(dt))
    return None


def today_day(today: Optional[date] = None) -> int:
    """Día de hoy (nº de días desde 1970) con la fecha de TU ordenador."""
    d = today or date.today()
    return (d - date(1970, 1, 1)).days


def add_units(day: int, n: int, unit: str) -> int:
    """Suma `n` unidades a un día. Los meses/años respetan el calendario (31 ene + 1 mes = 28/29 feb)."""
    if unit == "days":
        return day + n
    if unit == "weeks":
        return day + 7 * n
    d = date(1970, 1, 1) + timedelta(days=day)
    months = d.year * 12 + (d.month - 1) + (12 * n if unit == "years" else n)
    y, m = divmod(months, 12)
    last = calendar.monthrange(y, m + 1)[1]
    return (date(y, m + 1, min(d.day, last)) - date(1970, 1, 1)).days


def looks_like_dates(values: list[Any]) -> bool:
    """¿Al menos el 60 % de los valores con contenido son fechas? (para ofrecer las opciones de fecha)."""
    filled = dates = 0
    for v in values:
        if is_empty(v):
            continue
        filled += 1
        if to_date(v) is not None:
            dates += 1
        if filled >= 200:
            break
    return filled > 0 and dates / filled >= 0.6


def _text(v: Any) -> str:
    return js_string(v).strip().lower()


def _order(a: Any, b: Any) -> Optional[int]:
    na, nb = to_number(a), to_number(b)
    if na is not None and nb is not None:
        return 0 if na == nb else (-1 if na < nb else 1)
    da, db = to_date(a), to_date(b)
    if da is not None and db is not None:
        return 0 if da == db else (-1 if da < db else 1)
    return None


# ── Comparación ─────────────────────────────────────────────────────────
def compare(left: Any, op: str, right: Any, unit: str = "days", today: Optional[int] = None) -> bool:
    if op == "elapsed":
        # «Han pasado al menos N días/semanas/meses/años desde la fecha de la celda».
        day, n = to_date(left), to_number(right)
        if day is None or n is None or not float(n).is_integer() or not 0 <= n <= MAX_ELAPSED:
            return False
        return (today_day() if today is None else today) >= add_units(day, int(n), unit)
    if op == "on_date":
        # «Ya llegó la fecha elegida»: desde ese día, avisa de las filas que tienen una fecha.
        day, target = to_date(left), to_date(right)
        return day is not None and target is not None and (today_day() if today is None else today) >= target
    if op == "is_empty":
        return is_empty(left)
    if op == "is_not_empty":
        return not is_empty(left)
    if op in ("contains", "not_contains", "starts_with"):
        if is_empty(right):
            return False  # regla mal configurada: nunca dispara
        l, r = _text(left), _text(right)
        if op == "contains":
            return r in l
        if op == "not_contains":
            return r not in l
        return l.startswith(r)

    o = _order(left, right)
    if op == "gt":
        return o is not None and o > 0
    if op == "gte":
        return o is not None and o >= 0
    if op == "lt":
        return o is not None and o < 0
    if op == "lte":
        return o is not None and o <= 0
    if op == "eq":
        return o == 0 if o is not None else _text(left) == _text(right)
    if op == "neq":
        return o != 0 if o is not None else _text(left) != _text(right)
    return False


# ── Reglas ──────────────────────────────────────────────────────────────
@dataclass
class Rule:
    id: str
    name: str
    left: str
    operator: str
    right_type: Optional[str]  # 'column' | 'value' | None
    right: Any
    actions: list[dict]
    unit: str = "days"  # unidad de «elapsed»
    emails: list[dict] = field(default_factory=list)  # acciones «correo» (el envío lo decide la web o este agente)


def check_rule(raw: dict) -> tuple[Optional[Rule], str]:
    """Valida una regla guardada en la base de datos (no es de fiar). Devuelve (regla, motivo).
    Si no es válida, `motivo` explica QUÉ campo falla (nunca incluye datos de las celdas)."""
    try:
        cond = raw["condition"]
        if not isinstance(cond, dict) or cond.get("kind") != "compare":
            return None, "la condición no es de tipo «compare»"
        left = cond["left"]
        if left.get("type") != "column" or not isinstance(left.get("column"), str):
            return None, "falta la columna de la condición"
        column = left["column"].strip()
        if not 1 <= len(column) <= 200:
            return None, "el nombre de la columna es demasiado largo o está vacío"
        op = cond["operator"]
        if op not in OPERATORS:
            return None, f"operador desconocido «{str(op)[:30]}»"

        right_type, right = None, None
        if op not in UNARY:
            r = cond.get("right")
            if not isinstance(r, dict):
                return None, "falta el segundo operando de la condición"
            if r.get("type") == "column" and isinstance(r.get("column"), str) and r["column"].strip():
                right_type, right = "column", r["column"].strip()
            elif r.get("type") == "value" and isinstance(r.get("value"), (str, int, float)) and not isinstance(r.get("value"), bool):
                right_type, right = "value", r["value"]
            else:
                return None, "el segundo operando de la condición no es válido"
            if op == "elapsed":
                n = to_number(right) if right_type == "value" else None
                if n is None or not float(n).is_integer() or not 0 <= n <= MAX_ELAPSED:
                    return None, f"«ha pasado al menos…» necesita un número entero de 0 a {MAX_ELAPSED}"
            if op == "on_date" and (right_type != "value" or not isinstance(right, str)
                                    or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", right) or to_date(right) is None):
                return None, "«ya llegó la fecha elegida» necesita una fecha del calendario"
        unit = cond.get("unit") or "days"
        if unit not in TIME_UNITS:
            return None, f"unidad de tiempo desconocida «{str(unit)[:20]}»"

        actions: list[dict] = []
        emails: list[dict] = []
        items = raw.get("actions") or []
        if not isinstance(items, list):
            return None, "las acciones no son una lista"
        if len(items) > 5:
            return None, "más de 5 acciones"
        for i, a in enumerate(items, 1):
            if not isinstance(a, dict):
                return None, f"la acción {i} no es válida"
            kind = a.get("type")
            if kind == "email":
                to, subject, body = a.get("to"), a.get("subject"), a.get("body")
                sender, mode, cc = a.get("from") or "", a.get("mode") or "per_row", a.get("cc") or ""
                if not all(isinstance(x, str) for x in (to, subject, body, sender, cc)):
                    return None, f"la acción {i} (correo) tiene un campo que no es texto"
                to, subject, body, sender, cc = to.strip(), subject.strip(), body.strip(), sender.strip(), cc.strip()
                for label, val, lo, hi in (("destinatario", to, 1, 500), ("copia", cc, 0, 500), ("asunto", subject, 1, 200),
                                           ("cuerpo", body, 1, 4000), ("remitente", sender, 0, 254)):
                    if not lo <= len(val) <= hi:
                        return None, f"correo: {label} vacío o demasiado largo"
                if mode not in ("per_row", "summary"):
                    return None, f"correo: modo desconocido «{str(mode)[:20]}»"
                emails.append({"from": sender, "to": to, "cc": cc, "subject": subject, "body": body, "mode": mode})
                continue
            if kind != "alert":
                return None, f"tipo de acción «{str(kind)[:20]}» no soportado por esta versión del agente"
            if not isinstance(a.get("message"), str):
                return None, f"la acción {i} (alerta) no tiene mensaje"
            msg = a["message"].strip()
            if not 1 <= len(msg) <= 500:
                return None, "el mensaje de la alerta está vacío o es demasiado largo"
            sev = a.get("severity", "info")
            actions.append({"message": msg, "severity": sev if sev in SEVERITIES else "info"})
        if not actions and not emails:
            return None, "la regla no tiene ninguna acción"
        return Rule(str(raw["id"]), str(raw["name"]), column, op, right_type, right, actions, unit=unit, emails=emails), ""
    except KeyError as e:
        return None, f"falta el campo {e}"
    except (TypeError, AttributeError):
        return None, "estructura de la regla inesperada"


def validate_rule(raw: dict) -> Optional[Rule]:
    return check_rule(raw)[0]


def evaluate_rule(rule: Rule, table: Table, today: Optional[int] = None) -> tuple[list[int], Optional[str]]:
    today = today_day() if today is None else today
    headers = set(table.headers)
    needed = [rule.left] + ([rule.right] if rule.right_type == "column" else [])
    for col in needed:
        if col not in headers:
            return [], f"La columna «{col}» ya no existe en el archivo"

    matched: list[int] = []
    for row in table.rows:
        left = row.values.get(rule.left)
        if rule.right_type == "column":
            right = row.values.get(rule.right)
        elif rule.right_type == "value":
            right = rule.right
        else:
            right = None
        if compare(left, rule.operator, right, rule.unit, today):
            matched.append(row.number)
    return matched, None


def evaluate_across_sheets(rule: Rule, sheets: list[SheetTable], today: Optional[int] = None) -> MultiSheetEvaluation:
    """Evalúa en cada hoja; solo hay error si NINGUNA hoja tiene las columnas de la regla."""
    if not sheets:
        return MultiSheetEvaluation(error="No hay hojas que vigilar: revisa la selección de hojas")

    results: list[SheetEvaluation] = []
    first_error: Optional[str] = None
    for s in sheets:
        matched, err = evaluate_rule(rule, s.table, today)
        if err:
            first_error = first_error or err
            continue
        results.append(SheetEvaluation(s.sheet_name, matched))

    if not results:
        return MultiSheetEvaluation(
            error=first_error
            if len(sheets) == 1
            else "Las columnas de la regla no existen en ninguna de las hojas vigiladas"
        )
    return MultiSheetEvaluation(sheets=results)


# ── Alertas ─────────────────────────────────────────────────────────────
def fingerprint(rule_id: str, sheet_key: str, rows: list[int]) -> str:
    """Huella del conjunto de nº de fila. Solo cambia si cambia qué filas cumplen la regla."""
    raw = f"match:{rule_id}|{sheet_key}:{','.join(str(r) for r in rows)}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


_VAR = re.compile(r"\{(count|rows|column|sheet|file|rule)\}")


def render_message(template: str, *, count: int, rows: list[int], column: str,
                   sheet: Optional[str], file_name: str, rule_name: str) -> str:
    """Solo variables que NO salen de las celdas: el aviso nunca copia datos del archivo."""
    preview = ", ".join(str(r) for r in rows[:10]) + ("…" if count > 10 else "")
    values = {
        "count": str(count), "rows": preview, "column": column,
        "sheet": sheet if sheet is not None else file_name, "file": file_name, "rule": rule_name,
    }
    return _VAR.sub(lambda m: values[m.group(1)], template)


def resolve_sheets(available: list[str], mode: str, names: list[str]) -> list[str]:
    if mode == "all":
        chosen = available
    elif mode == "selected":
        chosen = [n for n in available if n in names]
    else:
        chosen = available[:1]
    return chosen[:50]


def build_outputs(rule: Rule, evaluation: MultiSheetEvaluation, previous: dict[str, str], file_name: str,
                  sheets: Optional[list[SheetTable]] = None) -> tuple[dict[str, str], list[dict], list[dict]]:
    """Una huella por hoja: solo se avisa por las hojas cuyo conjunto de filas cambió.
    Devuelve (huellas, alertas, correos ya redactados)."""
    nxt: dict[str, str] = {}
    alerts: list[dict] = []
    emails: list[dict] = []
    tables = {s.sheet_name: s.table for s in (sheets or [])}
    columns: list[str] = []
    for em in rule.emails:
        columns += [c for c in email_render.referenced_columns([em["to"], em.get("cc", ""), em["subject"], em["body"]]) if c not in columns]

    for sheet in evaluation.sheets:
        key = sheet.sheet_name or ""
        fp = fingerprint(rule.id, key, sheet.matched_rows) if sheet.matched_count > 0 else None
        if not fp:
            continue
        nxt[key] = fp
        if fp == previous.get(key):
            continue
        refs = sheet.matched_rows[:200]
        for action in rule.actions:
            alerts.append({
                "sheet": sheet.sheet_name,
                "message": render_message(
                    action["message"], count=sheet.matched_count, rows=refs, column=rule.left,
                    sheet=sheet.sheet_name, file_name=file_name, rule_name=rule.name,
                ),
                "severity": action["severity"],
                "count": sheet.matched_count,
                "rows": refs,
            })
        table = tables.get(sheet.sheet_name)
        if rule.emails and table is not None:
            wanted = set(refs)
            matched = [
                {"rowNumber": r.number, "values": {c: r.values.get(c) for c in columns}}
                for r in table.rows if r.number in wanted
            ]
            meta = {"fileName": file_name, "ruleName": rule.name, "sheetName": sheet.sheet_name,
                    "columnName": rule.left, "count": sheet.matched_count}
            for em in rule.emails:
                emails += email_render.build_emails(em, rule.id, meta, matched, table.headers)
    return nxt, alerts, emails


def build_alerts(rule: Rule, evaluation: MultiSheetEvaluation, previous: dict[str, str],
                 file_name: str) -> tuple[dict[str, str], list[dict]]:
    """Solo huellas y alertas (compatibilidad con las pruebas del motor)."""
    nxt, alerts, _ = build_outputs(rule, evaluation, previous, file_name)
    return nxt, alerts
