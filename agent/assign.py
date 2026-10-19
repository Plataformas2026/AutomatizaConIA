"""
Reparto de filas por persona («Quedan 7 informes sin completar, 3 te corresponden a ti»).

La columna de reparto (p. ej. «Responsable») contiene un nombre o un correo. Si hay varios («Ana / Luis») el
primero es el responsable y los demás quedan de reserva: la tarea se puede pasar al siguiente (build_chains). Para no guardar ese dato en la base
de datos, cada nombre/correo se convierte en una HUELLA (sha256 con el id de la regla) y solo se envían a la web:
    { huella: {"n": cuántas filas, "rows": [primeras filas]} }       y   "-" = sin responsable.
La web calcula las huellas del usuario que mira (su correo y sus alias) y las busca ahí. Es el mismo algoritmo
que src/lib/assign/assign.ts (los dos ejecutan agent/tests/assign_cases.json).

Aviso honesto: una huella protege del acceso casual, no es anonimato: quien conozca el id de la regla y adivine un
nombre puede comprobar si aparece. Por eso solo la ven las personas con acceso a esa alerta.
"""
from __future__ import annotations

import hashlib
import re
import unicodedata
from typing import Any, Iterable

UNASSIGNED = "-"
MAX_PEOPLE = 150
MAX_ROWS_PER_PERSON = 20
_SPLIT = re.compile(r"[;\n\r/|]+")
_EMAIL = re.compile(r"[^\s<>,;()\[\]]+@[^\s<>,;()\[\]]+")


def normalize(s: Any) -> str:
    """Minúsculas, sin tildes y con espacios simples."""
    t = unicodedata.normalize("NFD", "" if s is None else str(s))
    t = "".join(ch for ch in t if not unicodedata.combining(ch))
    return re.sub(r"\s+", " ", t).strip().lower()


def digest(rule_id: str, key: str) -> str:
    return hashlib.sha256(f"{rule_id}|{key}".encode("utf-8")).hexdigest()[:16]


def cell_keys(cell: Any) -> list[str]:
    """Nombres/correos que contiene una celda. «Ana <ana@x.com>; Luis» → ['ana@x.com', 'luis']."""
    raw = "" if cell is None else str(cell)
    if "@" in raw:
        raw = raw.replace(",", ";")
    keys: list[str] = []
    for part in _SPLIT.split(raw):
        p = normalize(part)
        if not p:
            continue
        emails = [normalize(m) for m in _EMAIL.findall(p)]
        for k in (emails or [p]):  # con correo, el correo identifica a la persona (el nombre que lo acompaña se ignora)
            if k and k not in keys:
                keys.append(k)
    return keys


def build_assignees(rule_id: str, rows: Iterable[tuple[int, Any]]) -> dict:
    """rows = (nº de fila, valor de la celda de reparto) de las filas que cumplen la regla."""
    out: dict[str, dict] = {}

    def add(h: str, number: int) -> None:
        e = out.setdefault(h, {"n": 0, "rows": []})
        e["n"] += 1
        if len(e["rows"]) < MAX_ROWS_PER_PERSON:
            e["rows"].append(number)

    for number, cell in rows:
        keys = cell_keys(cell)
        if not keys:
            add(digest(rule_id, UNASSIGNED), number)
            continue
        add(digest(rule_id, keys[0]), number)  # «Ana / Luis»: la tarea es de Ana; Luis queda de reserva (ver build_chains)
    # Límite de tamaño: se conservan las personas con más filas.
    if len(out) > MAX_PEOPLE:
        keep = sorted(out.items(), key=lambda kv: -kv[1]["n"])[:MAX_PEOPLE]
        out = dict(keep)
    return out


MAX_CHAIN_ROWS = 200
MAX_CHAIN = 5


def build_chains(rule_id: str, rows: Iterable[tuple[int, Any]]) -> dict:
    """Filas con VARIOS nombres («Ana / Luis»): { fila: [huella de Ana, huella de Luis] }. El primero es el
    responsable; la tarea puede pasarse al siguiente desde la web. Las filas con un solo nombre no hacen falta."""
    out: dict[str, list[str]] = {}
    for number, cell in rows:
        keys = cell_keys(cell)[:MAX_CHAIN]
        if len(keys) >= 2 and len(out) < MAX_CHAIN_ROWS:
            out[str(number)] = [digest(rule_id, k) for k in keys]
    return out


def identifiers(email: str, aliases: Iterable[str] = ()) -> list[str]:
    """Con qué nombres puede aparecer una persona en la columna de reparto."""
    e = normalize(email)
    ids = [e, e.split("@")[0]] if "@" in e else [e]
    ids += [normalize(a) for a in aliases]
    return [i for i in dict.fromkeys(ids) if i]


def my_share(assignees: dict, rule_id: str, ids: Iterable[str], chains: dict | None = None, handoffs: dict | None = None) -> dict:
    """Espejo de myShare() de la web (se usa en las pruebas para comprobar que los dos dan lo mismo)."""
    wanted = {digest(rule_id, i) for i in ids}
    mine, rows = 0, []
    for h, v in assignees.items():
        if h in wanted:
            mine += v["n"]
            rows += [r for r in v["rows"] if r not in rows]
    for row, chain in (chains or {}).items():
        level = min((handoffs or {}).get(int(row), 0), len(chain) - 1)
        if level <= 0:
            continue
        n = int(row)
        if chain[0] in wanted:
            mine = max(0, mine - 1)
            rows = [r for r in rows if r != n]
        if chain[level] in wanted:
            mine += 1
            if n not in rows:
                rows.append(n)
    return {"mine": mine, "rows": sorted(rows), "unassigned": assignees.get(digest(rule_id, UNASSIGNED), {}).get("n", 0)}
