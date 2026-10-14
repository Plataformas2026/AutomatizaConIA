"""
Abre un correo de la web («Abrir en Outlook») en tu Outlook CLÁSICO de escritorio.

Lo lanza Windows cuando haces clic en el botón de la web (enlace automatiza-outlook://abrir?id=…).
El enlace solo lleva el identificador del correo: el contenido se pide a Supabase con el token del
agente y se abre en una ventana de redacción de Outlook. No se guarda ni se envía nada solo.

Registro (una sola vez): registrar_abrir_outlook.ps1
"""
from __future__ import annotations

import re
import sys
from urllib.parse import parse_qs, urlparse

import api as api_mod
import config as config_mod
import email_render
import outlook

_UUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


def _message(text: str) -> None:
    """Aviso visible aunque no haya consola (se ejecuta con pythonw)."""
    try:
        import ctypes

        ctypes.windll.user32.MessageBoxW(0, text, "Automatización con IA", 0x40)
    except Exception:
        print(text)


def parse_url(url: str) -> str | None:
    """Devuelve el id del correo si el enlace es correcto; si no, None."""
    try:
        u = urlparse(url.strip().strip('"'))
        if u.scheme.lower() != "automatiza-outlook":
            return None
        ids = parse_qs(u.query).get("id", [])
    except ValueError:
        return None
    return ids[0] if len(ids) == 1 and _UUID.match(ids[0]) else None


def main(argv: list[str]) -> int:
    email_id = parse_url(argv[1]) if len(argv) > 1 else None
    if not email_id:
        _message("Enlace no válido. Vuelve a pulsar «Abrir en Outlook» en la web.")
        return 2
    try:
        cfg = config_mod.load_config()
        client = api_mod.Api(cfg.supabase_url, cfg.anon_key, cfg.token, "abrir-outlook")
        item = client.get_email(email_id)
    except config_mod.ConfigError as e:
        _message(f"Falta configurar el agente: {e}")
        return 2
    except api_mod.TokenError:
        _message("El token del agente no es válido. Revisa AGENT_TOKEN en el archivo .env.")
        return 3
    except (api_mod.ApiUnavailable, api_mod.ApiError) as e:
        _message(f"No se pudo pedir el correo a la web: {e}")
        return 3
    if not item:
        _message("Ese correo ya no está pendiente (se envió o se descartó).")
        return 4
    recipients = email_render.parse_recipients(str(item.get("to") or ""))
    if recipients is None:
        _message("El destinatario del correo no es válido.")
        return 4
    try:
        outlook.OutlookSender(cfg.outlook_account).display(
            to=recipients, subject=str(item.get("subject") or ""), body=str(item.get("body") or ""),
            sender=(item.get("from") or None),
        )
    except (outlook.OutlookRejected, outlook.OutlookUnavailable) as e:
        _message(str(e))
        return 5
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
