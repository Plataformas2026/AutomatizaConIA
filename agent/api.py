"""Cliente de las funciones del agente en Supabase (RPC). Solo se usa la clave anon + el token del agente."""
from __future__ import annotations

from typing import Any, Optional

import requests


class TokenError(Exception):
    """El token es incorrecto o el agente se eliminó en la web."""


class ApiUnavailable(Exception):
    """Sin red o Supabase no responde: se reintenta más tarde."""


class ApiError(Exception):
    """Supabase rechazó la petición."""


class Api:
    def __init__(self, url: str, anon_key: str, token: str, version: str):
        self._base = f"{url}/rest/v1/rpc"
        self._token = token
        self._version = version
        self._http = requests.Session()
        self._http.headers.update({
            "apikey": anon_key,
            "Authorization": f"Bearer {anon_key}",
            "Content-Type": "application/json",
        })

    def _call(self, fn: str, payload: dict[str, Any]) -> Any:
        try:
            res = self._http.post(f"{self._base}/{fn}", json={"p_token": self._token, **payload}, timeout=25)
        except requests.RequestException as e:
            raise ApiUnavailable(type(e).__name__) from None
        if res.status_code >= 500 or res.status_code in (408, 429):
            raise ApiUnavailable(f"HTTP {res.status_code}")
        if not res.ok:
            msg = ""
            try:
                msg = str(res.json().get("message", ""))
            except ValueError:
                pass
            if "invalid_token" in msg:
                raise TokenError()
            if res.status_code in (401, 403):
                raise ApiError("Clave anon rechazada: revisa SUPABASE_ANON_KEY")
            if res.status_code == 404:
                raise ApiError("Faltan migraciones en Supabase: ejecuta las migraciones 0007, 0008, 0010, 0012 y 0014 de supabase/migrations")
            raise ApiError(msg[:200] or f"HTTP {res.status_code}")
        return res.json() if res.content else None

    def get_config(self) -> dict:
        return self._call("agent_get_config", {"p_version": self._version})

    def report_file(self, file_id: str, status: str, error: Optional[str], version: Optional[str],
                    structure: Optional[dict]) -> None:
        self._call("agent_report_file", {
            "p_file": file_id, "p_status": status, "p_error": error,
            "p_version": version, "p_structure": structure,
        })

    def report_rule(self, file_id: str, rule_id: str, fingerprints: Optional[dict], error: Optional[str],
                    alerts: Optional[list], emails: Optional[list] = None) -> int:
        out = self._call("agent_report_rule", {
            "p_file": file_id, "p_rule": rule_id, "p_fingerprints": fingerprints,
            "p_error": error, "p_alerts": alerts or [], "p_emails": emails or [],
        })
        return int(out or 0)

    def get_template(self, template_id: str) -> Optional[dict]:
        """Plantilla Word de TU empresa (documento en blanco + mapeo de campos). No contiene datos de filas."""
        return self._call("agent_get_template", {"p_id": template_id})

    def get_outbox(self) -> list[dict]:
        """Correos pendientes de enviar (ya redactados). Solo se piden si el envío automático está activado."""
        return self._call("agent_get_outbox", {}) or []

    def report_email(self, email_id: str, status: str, error: Optional[str] = None) -> None:
        """status: 'sent' (enviado), 'drafted' (borrador en Outlook) o 'failed'."""
        self._call("agent_report_email", {"p_id": email_id, "p_status": status, "p_error": error})

    def report_logs(self, entries: list[dict]) -> int:
        """Avisos y errores del agente para la pestaña «Logs» de la web (texto ya limpiado, sin datos de filas)."""
        return int(self._call("agent_report_logs", {"p_entries": entries}) or 0)
