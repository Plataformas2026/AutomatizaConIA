"""
Servidor LOCAL del agente (solo 127.0.0.1): permite que TU navegador, desde el panel web, pida a ESTE agente
- la vista previa de un archivo (primeras filas), y
- abrir su carpeta o el propio archivo en tu ordenador.

Por qué es seguro y no guarda datos:
  · Escucha únicamente en 127.0.0.1: no es accesible desde otras máquinas.
  · Solo responde a la web que tú indicas en WEB_ORIGIN (comprobación del encabezado Origin) y exige un
    encabezado propio, de modo que ninguna otra página abierta en tu navegador puede usarlo.
  · Solo conoce los archivos que la web le ha asignado y que están dentro de WATCH_FOLDERS.
  · La vista previa viaja de tu ordenador a tu navegador. NO pasa por Supabase ni por Vercel y no se guarda.
"""
from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable, Optional
from urllib.parse import parse_qs, urlparse

import email_render
import readers

log = logging.getLogger("agente.local")

DEFAULT_PORT = 47821  # el mismo valor está en la web (src/lib/agents/local-api.ts)
PREVIEW_ROWS = 100
PREVIEW_COLS = 30
CELL_CHARS = 120
_UUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
HEADER = "X-Automatiza"


def open_folder(path: Path) -> None:
    """Abre el Explorador de Windows con el archivo seleccionado."""
    if sys.platform == "win32":
        subprocess.Popen(f'explorer /select,"{path}"')  # noqa: S603 (ruta de un archivo ya validado)
    else:
        raise OSError("unsupported")


def open_file(path: Path) -> None:
    """Abre el archivo con su programa predeterminado (Excel…)."""
    if sys.platform == "win32":
        os.startfile(str(path))  # type: ignore[attr-defined]  # noqa: S606
    else:
        raise OSError("unsupported")


def build_preview(data: bytes, path: Path, file_cfg: dict, sheet: Optional[str]) -> dict:
    """Primeras filas de una hoja, ya formateadas como texto. Todo en memoria."""
    mode, names = file_cfg.get("sheet_mode") or "first", file_cfg.get("sheet_names") or []
    wb = readers.read_workbook(data, path.suffix, mode, names)
    if sheet and sheet in wb.available:  # el usuario eligió otra hoja en la vista previa
        wb = readers.read_workbook(data, path.suffix, "selected", [sheet])
    if not wb.sheets:
        return {"fileName": path.name, "sheets": wb.available, "sheet": None, "headers": [], "rows": [],
                "totalRows": 0, "truncated": False}
    chosen = wb.sheets[0]
    table = chosen.table
    headers = table.headers[:PREVIEW_COLS]
    rows = [
        {"n": r.number, "cells": [_cell(r.values.get(h)) for h in headers]}
        for r in table.rows[:PREVIEW_ROWS]
    ]
    return {
        "fileName": path.name,
        "sheets": wb.available,
        "sheet": chosen.sheet_name,
        "headers": headers,
        "rows": rows,
        "totalRows": len(table.rows),
        "truncated": len(table.rows) > PREVIEW_ROWS or len(table.headers) > PREVIEW_COLS,
    }


def _cell(v: Any) -> str:
    s = email_render.format_cell(v)
    return s[:CELL_CHARS]


class LocalApi:
    def __init__(self, *, port: int, origins: tuple[str, ...], version: str,
                 lookup: Callable[[str], Optional[tuple[dict, Path]]],
                 max_bytes: int = 50 * 1024 * 1024,
                 folder_opener: Callable[[Path], None] = open_folder,
                 file_opener: Callable[[Path], None] = open_file) -> None:
        self.origins = {o.rstrip("/") for o in origins}
        self.version = version
        self.lookup = lookup
        self.max_bytes = max_bytes
        self.folder_opener = folder_opener
        self.file_opener = file_opener
        api = self

        class Handler(BaseHTTPRequestHandler):
            server_version = "AutomatizaAgente"
            protocol_version = "HTTP/1.1"

            def log_message(self, *args: Any) -> None:  # nunca registrar rutas ni parámetros
                return

            # ── utilidades ──
            def _allowed_origin(self) -> Optional[str]:
                origin = (self.headers.get("Origin") or "").rstrip("/")
                host = (self.headers.get("Host") or "").lower()
                ok_host = host in (f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}")
                return origin if ok_host and origin in api.origins else None

            def _send(self, status: int, body: Optional[dict], origin: Optional[str]) -> None:
                raw = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else b""
                self.send_response(status)
                if origin:
                    self.send_header("Access-Control-Allow-Origin", origin)
                    self.send_header("Vary", "Origin")
                    self.send_header("Access-Control-Allow-Private-Network", "true")
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def _guard(self) -> Optional[str]:
                origin = self._allowed_origin()
                if origin is None:
                    self._send(403, {"error": "forbidden"}, None)
                    return None
                if self.headers.get(HEADER) != "1":
                    self._send(403, {"error": "forbidden"}, origin)
                    return None
                return origin

            # ── métodos ──
            def do_OPTIONS(self) -> None:  # noqa: N802
                origin = self._allowed_origin()
                if origin is None:
                    self._send(403, {"error": "forbidden"}, None)
                    return
                self.send_response(204)
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", f"Content-Type, {HEADER}")
                self.send_header("Access-Control-Allow-Private-Network", "true")
                self.send_header("Access-Control-Max-Age", "600")
                self.send_header("Content-Length", "0")
                self.end_headers()

            def do_GET(self) -> None:  # noqa: N802
                origin = self._guard()
                if origin is None:
                    return
                url = urlparse(self.path)
                q = parse_qs(url.query)
                if url.path == "/v1/ping":
                    self._send(200, {"ok": True, "version": api.version}, origin)
                elif url.path == "/v1/preview":
                    self._preview(q, origin)
                else:
                    self._send(404, {"error": "not_found"}, origin)

            def do_POST(self) -> None:  # noqa: N802
                origin = self._guard()
                if origin is None:
                    return
                if urlparse(self.path).path != "/v1/open":
                    self._send(404, {"error": "not_found"}, origin)
                    return
                try:
                    length = min(int(self.headers.get("Content-Length") or 0), 2048)
                    body = json.loads(self.rfile.read(length) or b"{}")
                except (ValueError, UnicodeDecodeError):
                    self._send(400, {"error": "bad_request"}, origin)
                    return
                fid, what = str(body.get("file", "")), body.get("what")
                found = api.lookup(fid) if _UUID.match(fid) else None
                if not found or what not in ("folder", "file"):
                    self._send(404 if not found else 400, {"error": "not_found" if not found else "bad_request"}, origin)
                    return
                _, path = found
                try:
                    (api.folder_opener if what == "folder" else api.file_opener)(path)
                except OSError:
                    self._send(501, {"error": "unsupported"}, origin)
                    return
                self._send(200, {"ok": True}, origin)

            def _preview(self, q: dict, origin: str) -> None:
                fid = (q.get("file") or [""])[0]
                found = api.lookup(fid) if _UUID.match(fid) else None
                if not found:
                    self._send(404, {"error": "not_found"}, origin)
                    return
                cfg, path = found
                sheet = (q.get("sheet") or [""])[0][:200] or None
                try:
                    if path.stat().st_size > api.max_bytes:
                        self._send(413, {"error": "too_big"}, origin)
                        return
                    data = path.read_bytes()
                except OSError:
                    self._send(423, {"error": "busy"}, origin)  # abierto/bloqueado por otro programa
                    return
                try:
                    result = build_preview(data, path, cfg, sheet)
                except readers.ReadError:
                    self._send(422, {"error": "unreadable"}, origin)
                    return
                except Exception as e:  # nunca registrar el mensaje: podría citar datos
                    log.error("Error en la vista previa: %s", type(e).__name__)
                    self._send(500, {"error": "error"}, origin)
                    return
                finally:
                    data = b""  # el contenido no se conserva
                self._send(200, result, origin)

        self.httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
        self.httpd.daemon_threads = True
        self.port = self.httpd.server_port
        self._thread = threading.Thread(target=self.httpd.serve_forever, name="local-api", daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()
