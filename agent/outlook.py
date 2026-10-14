"""
Envío (o borrador) con TU Outlook de escritorio, a través de COM (pywin32). Solo Windows y solo con
el Outlook clásico instalado y con sesión iniciada. No hay contraseñas, ni servidores de correo, ni
registro de aplicaciones: el correo sale con la cuenta que ya tienes abierta en Outlook.

Con varias cuentas en Outlook, la cuenta se elige por su dirección (OUTLOOK_ACCOUNT_EMAIL en .env, o el
remitente de la propia regla): el borrador se crea DENTRO de la carpeta Borradores de esa cuenta.

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
    def __init__(self, default_account: str = "") -> None:
        self._app = None
        self.default_account = default_account.strip()

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

    def list_accounts(self) -> list[str]:
        """Direcciones de las cuentas configuradas en tu Outlook (para diagnóstico)."""
        app = self._outlook()
        try:
            return [str(acc.SmtpAddress).strip() for acc in app.Session.Accounts]
        except Exception:
            raise OutlookUnavailable("No se pudo leer la lista de cuentas de Outlook.") from None

    def _account(self, app, address: str):
        wanted = address.strip().lower()
        try:
            for acc in app.Session.Accounts:
                if str(acc.SmtpAddress).strip().lower() == wanted:
                    return acc
        except Exception:
            raise OutlookUnavailable("No se pudo leer la lista de cuentas de Outlook.") from None
        raise OutlookRejected(f"En tu Outlook no hay una cuenta con la dirección {address}. Revisa OUTLOOK_ACCOUNT_EMAIL en .env.")

    def _drafts_folder(self, app, acc):
        """Carpeta Borradores del buzón de esa cuenta (no la del buzón predeterminado)."""
        try:
            return acc.DeliveryStore.GetDefaultFolder(16)  # 16 = olFolderDrafts
        except Exception:
            pass
        wanted = str(acc.SmtpAddress).strip().lower()
        try:
            for store in app.Session.Stores:
                if str(store.DisplayName).strip().lower() == wanted:
                    return store.GetDefaultFolder(16)
        except Exception:
            pass
        raise OutlookRejected(f"No se encontró la carpeta Borradores de la cuenta {wanted}.")

    def deliver(self, *, to: list[str], subject: str, body: str, sender: Optional[str], draft: bool) -> None:
        app = self._outlook()
        try:
            address = (sender or "").strip() or self.default_account
            acc = self._account(app, address) if address else None
            folder = self._drafts_folder(app, acc) if (draft and acc is not None) else None
            # Creado dentro de Borradores de la cuenta elegida; sin cuenta, en el buzón predeterminado.
            mail = folder.Items.Add(0) if folder is not None else app.CreateItem(0)  # 0 = olMailItem
            mail.To = "; ".join(to)
            mail.Subject = subject
            mail.Body = body  # texto plano: nunca HTML, para no ejecutar nada que venga de las celdas
            if acc is not None:
                mail.SendUsingAccount = acc
            if draft:
                mail.Save()
                if folder is not None:
                    try:
                        if str(mail.Parent.StoreID) != str(folder.StoreID):
                            mail.Move(folder)  # por si Outlook lo dejó en otro buzón
                    except Exception:
                        pass
            else:
                mail.Send()
        except (OutlookRejected, OutlookUnavailable):
            raise
        except Exception as e:
            # El mensaje de COM puede incluir el contenido del correo: solo el tipo.
            raise OutlookUnavailable(f"Outlook no aceptó el correo ({type(e).__name__}).") from None

    def display(self, *, to: list[str], subject: str, body: str, sender: Optional[str]) -> None:
        """Abre una ventana de redacción en Outlook clásico (sin guardar ni enviar nada)."""
        app = self._outlook()
        try:
            address = (sender or "").strip() or self.default_account
            acc = self._account(app, address) if address else None
            mail = app.CreateItem(0)
            mail.To = "; ".join(to)
            mail.Subject = subject
            mail.Body = body
            if acc is not None:
                mail.SendUsingAccount = acc
            mail.Display()
        except (OutlookRejected, OutlookUnavailable):
            raise
        except Exception as e:
            raise OutlookUnavailable(f"Outlook no pudo abrir el correo ({type(e).__name__}).") from None
