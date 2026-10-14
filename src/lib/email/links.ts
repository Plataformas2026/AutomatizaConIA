/**
 * Enlace del botón «Abrir en Outlook». Windows lo entrega al programa local `abrir_outlook.py`
 * del agente (se registra una vez con registrar_abrir_outlook.ps1), que abre el correo en el
 * Outlook CLÁSICO de escritorio. El enlace solo lleva el identificador: ni el destinatario ni el
 * texto viajan en la URL.
 */
export function openInOutlookLink(emailId: string): string {
  return `automatiza-outlook://abrir?id=${encodeURIComponent(emailId)}`;
}
