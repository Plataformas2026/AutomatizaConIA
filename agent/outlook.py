"""
Envío (o borrador) con TU Outlook de escritorio, a través de COM (pywin32). Solo Windows y solo con
el Outlook clásico instalado y con sesión iniciada. No hay contraseñas, ni servidores de correo, ni
registro de aplicaciones: el correo sale con la cuenta que ya tienes abierta en Outlook.

Este módulo no decide NADA: solo ejecuta lo que le pide agent.py, que ya ha comprobado el modo,
los dominios autorizados y el límite por hora.
"""
from __future__ import annotations

import sys
from typing import Optional


class OutlookUnavailable(Exception):
    """Outlook no está instalado, no está abierto o este equipo no es Windows."""


class OutlookRejected(Exception):
    """Outlook no puede hacer lo pedido con ese correo (p. ej. no existe la cuenta remitente)."""


class OutlookSender:
    def __init__(self) -> None:
        self._app = None

    def _outlook(self):
        if sys.platform != "win32":
            raise OutlookUnavailable("El envío con Outlook solo funciona en Windows.")
        if self._app is None:
            try:
                import win32com.client  # type: ignore[import-not-found]

                self._app = win32com.client.Dispatch("Outlook.Application")
            except ImportError:
                raise OutlookUnavailable("Falta instalar pywin32 (pip install pywin32).") from None
            except Exception:
                raise OutlookUnavailable("No se pudo abrir Outlook (¿está instalado el Outlook clásico?).") from None
        return self._app

    def _account(self, app, address: str):
        wanted = address.strip().lower()
        try:
            for acc in app.Session.Accounts:
                if str(acc.SmtpAddress).strip().lower() == wanted:
                    return acc
        except Exception:
            raise OutlookUnavailable("No se pudo leer la lista de cuentas de Outlook.") from None
        raise OutlookRejected(f"En tu Outlook no hay una cuenta con la dirección {address}.")

    def deliver(self, *, to: list[str], subject: str, body: str, sender: Optional[str], draft: bool) -> None:
        app = self._outlook()
        try:
            mail = app.CreateItem(0)  # 0 = olMailItem
            mail.To = "; ".join(to)
            mail.Subject = subject
            mail.Body = body  # texto plano: nunca HTML, para no ejecutar nada que venga de las celdas
            if sender:
                mail.SendUsingAccount = self._account(app, sender)
            if draft:
                mail.Save()
            else:
                mail.Send()
        except (OutlookRejected, OutlookUnavailable):
            raise
        except Exception as e:
            # El mensaje de COM puede incluir el contenido del correo: solo el tipo.
            raise OutlookUnavailable(f"Outlook no aceptó el correo ({type(e).__name__}).") from None
