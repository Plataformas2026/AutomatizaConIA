"""
Envío de avisos y errores del agente a la pestaña «Logs» de la web.

· Solo viajan los registros de nivel WARNING y ERROR, y los que el propio agente marca con
  extra={"remote": True} (p. ej. «Agente en marcha»). El resto se queda en agent.log.
· El texto se limpia antes de salir: se quitan direcciones de correo y se recorta. Nunca se envían
  filas ni celdas de los archivos (el agente ya no las escribe en sus mensajes).
· Si no hay red, los registros esperan en memoria (máx. 200) y se envían al volver la conexión.
· Mensajes repetidos seguidos se agrupan en uno con «n» repeticiones.
"""
from __future__ import annotations

import logging
import re
import threading
import time
from collections import deque
from typing import Any, Callable, Optional

MAX_PENDING = 200
BATCH = 50
MAX_CHARS = 500
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_LEVEL = {logging.WARNING: "warning", logging.ERROR: "error", logging.CRITICAL: "error"}


def clean(text: str) -> str:
    t = _EMAIL.sub("[correo]", text)
    t = re.sub(r"\s+", " ", t).strip()
    return t[:MAX_CHARS]


class RemoteLogHandler(logging.Handler):
    def __init__(self, clock: Callable[[], float] = time.time) -> None:
        super().__init__(level=logging.INFO)
        self._clock = clock
        self._lock = threading.Lock()
        self._queue: deque[dict[str, Any]] = deque()

    def emit(self, record: logging.LogRecord) -> None:
        try:
            if record.levelno < logging.WARNING and not getattr(record, "remote", False):
                return
            level = _LEVEL.get(record.levelno, "error" if record.levelno > logging.WARNING else "info")
            msg = clean(record.getMessage())
            if not msg:
                return
            now = self._clock()
            with self._lock:
                last = self._queue[-1] if self._queue else None
                if last and last["level"] == level and last["message"] == msg:
                    last["n"] += 1
                    last["_at"] = now
                    return
                if len(self._queue) >= MAX_PENDING:
                    self._queue.popleft()
                self._queue.append({"level": level, "message": msg, "n": 1, "_at": now})
        except Exception:  # un fallo de registro nunca debe romper el agente
            self.handleError(record)

    def pending(self) -> int:
        with self._lock:
            return len(self._queue)

    def flush_to(self, send: Callable[[list[dict]], Any]) -> int:
        """Entrega hasta BATCH registros con `send`. Si falla, quedan en cola. Devuelve cuántos se enviaron."""
        with self._lock:
            batch = [self._queue[i] for i in range(min(BATCH, len(self._queue)))]
        if not batch:
            return 0
        now = self._clock()
        payload = [
            {"level": e["level"], "message": e["message"], "n": e["n"], "age": max(0, min(86400, int(now - e["_at"])))}
            for e in batch
        ]
        send(payload)  # puede lanzar: entonces no se quita nada de la cola
        with self._lock:
            for _ in batch:
                if self._queue:
                    self._queue.popleft()
        return len(batch)


def install(handler: Optional[RemoteLogHandler] = None) -> RemoteLogHandler:
    h = handler or RemoteLogHandler()
    logging.getLogger().addHandler(h)
    return h
